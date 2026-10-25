import './env.js'
import express from 'express'
import cors from 'cors'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { randomUUID } from 'node:crypto'

import { SAVING_LEVELS, ALL_LEVELS, TRACKS, getLevel } from './levels.js'
import { fetchMenu, fetchRawCoupons, sourceInfo, fetchPrice } from './mcp/client.js'
import { ipLocation, locateStores } from './location.js'
import { buildCoupons } from './data/coupons.js'
import { calibrate, buildHints } from './engine/solver.js'
import { judge } from './engine/judge.js'
import { rollEvent } from './engine/events.js'
import { applyCoupons, round2 } from './engine/pricing.js'
import {
  addCoins,
  addHistory,
  addShare,
  achievementIds,
  checkin as dbCheckin,
  getCoins,
  getProfileData,
  getStoreCode,
  login,
  logout,
  register,
  setStar,
  setStoreCode,
  shareCountToday,
  spendCoins,
  todayKey,
  unlockAchievement,
  updateBest,
  userByToken,
  validateAccount
} from './db.js'
import { DEFAULT_STORE_CODE, getStore, findStore, storeView } from './data/stores.js'

const here = path.dirname(fileURLToPath(import.meta.url))

const app = express()
app.use(cors())
app.use(express.json({ limit: '256kb' }))

const sessions = new Map()
const SESSION_TTL = 1000 * 60 * 60 * 2

const wrap = (fn) => (req, res) => fn(req, res).catch((error) => {
  console.error('[api]', error)
  res.status(500).json({ error: error.message })
})

const ACHIEVEMENTS = {
  saving_full: { id: 'saving_full', title: '麦门抠门大师', desc: '省钱大师赛道全满星', bonus: 100 }
}

function achievementList(ids) {
  return ids.map((id) => ACHIEVEMENTS[id]).filter(Boolean)
}

function publicProfile(userId) {
  const data = getProfileData(userId)
  if (!data) return null
  const stars = data.stars
  const totalStars = ALL_LEVELS.reduce((sum, level) => sum + (stars[level.id] || 0), 0)
  return {
    id: data.user.id,
    username: data.user.username,
    coins: data.user.coins,
    stars,
    bestPaid: data.bestPaid,
    totalStars,
    maxStars: ALL_LEVELS.length * 3,
    cleared: ALL_LEVELS.filter((level) => (stars[level.id] || 0) > 0).length,
    achievements: achievementList(data.achievementIds),
    history: data.history.map((row) => ({
      levelId: row.level_id,
      label: row.level_label,
      name: row.level_name,
      stars: row.stars,
      paid: row.paid,
      subtotal: row.subtotal,
      discountRate: row.discount_rate,
      at: row.at
    })),
    lastCheckin: data.lastCheckin,
    checkedInToday: data.lastCheckin === todayKey(),
    share: { date: todayKey(), count: data.shareCount }
  }
}

function isUnlocked(level, stars) {
  if (level.order === 1) return true
  const previous = ALL_LEVELS.find((item) => item.track === level.track && item.order === level.order - 1)
  return Boolean(previous && (stars[previous.id] || 0) > 0)
}

const menuCache = new Map()
async function getMenu(storeCode) {
  const cached = menuCache.get(storeCode)
  if (cached && Date.now() - cached.at < 1000 * 60 * 5) return cached.data
  const menu = await fetchMenu(storeCode)
  menuCache.set(storeCode, { at: Date.now(), data: menu })
  return menu
}

const couponCache = new Map()
async function getCoupons(storeCode) {
  const cached = couponCache.get(storeCode)
  if (cached && Date.now() - cached.at < 1000 * 60 * 5) return cached.data
  const raw = await fetchRawCoupons(storeCode)
  const normalized = buildCoupons(raw)
  const data = { ...normalized, fetchedAt: new Date().toISOString(), degraded: raw.degraded }
  couponCache.set(storeCode, { at: Date.now(), data })
  return data
}

function storeCodeFor(userId) {
  const code = getStoreCode(userId)
  if (!code) return DEFAULT_STORE_CODE
  // 运行时发现的店在进程重启后可能还没登记，此时回退到默认店，避免拿到空门店
  return findStore(code)?.code || DEFAULT_STORE_CODE
}

function levelView(level, items, profileData, coupons = []) {
  const cal = calibrate(level, items, coupons)
  const extraText = (level.star3Extra || []).map((e) => e.label).join('，')
  const answers = cal.answers || []
  const star3Text = cal.mode === 'relative'
    ? `实付 ≤ ¥${cal.thresholds.star3}（本店前五套最高价，按券后实付算）${extraText ? `，且${extraText}` : ''}`
    : level.star3Text
  return {
    id: level.id,
    label: level.label,
    track: level.track,
    order: level.order,
    name: level.name,
    tagline: level.tagline,
    difficulty: level.difficulty,
    constraintText: level.constraintText,
    objectiveText: level.objectiveText || '',
    budgetText: cal.mode === 'challenge'
      ? `按任务条件 + 附加条件判定，全部达成即三星${answers.length ? `（本店已校准 ${cal.answerCount} 套参考）` : ''}`
      : answers.length
        ? `实付 ≤ ¥${cal.thresholds.pass}（或只差 1 个隐藏条件）`
        : `实付 ≤ ¥${cal.thresholds.pass}`,
    star3Text,
    tip: level.tip,
    base: level.base,
    rules: level.rules,
    extras: (level.star3Extra || []).map((e) => ({ ...e })),
    thresholds: cal.thresholds,
    answers,
    answerCount: answers.length,
    answerText: answers.map((answer) => `¥${answer.cost}`).join(' / '),
    calibration: {
      optimal: cal.optimal,
      perfect: cal.perfect,
      factor: cal.factor,
      adjusted: cal.adjusted,
      mode: cal.mode,
      unsolvable: Boolean(cal.unsolvable),
      basePass: level.base.pass
    },
    stars: profileData.stars[level.id] || 0,
    bestPaid: profileData.bestPaid?.[level.id] ?? null,
    unlocked: isUnlocked(level, profileData.stars)
  }
}

function serializeSession(session) {
  return {
    id: session.id,
    levelId: session.levelId,
    level: session.levelView,
    event: session.event,
    items: session.items,
    coupons: session.coupons,
    revive: session.revive,
    hintUsed: session.hintUsed,
    thresholds: session.thresholds,
    optimal: session.optimal,
    store: storeView(getStore(session.storeCode || DEFAULT_STORE_CODE)),
    createdAt: session.createdAt
  }
}

function pruneSessions() {
  const now = Date.now()
  for (const [id, session] of sessions) {
    if (now - session.createdAt > SESSION_TTL) sessions.delete(id)
  }
}

function requireAuth(req, res, next) {
  const token = (req.headers.authorization || '').replace(/^Bearer\s+/i, '')
  const user = userByToken(token)
  if (!user) return res.status(401).json({ error: '请先登录' })
  req.user = user
  req.token = token
  next()
}

function ownedSession(req, res) {
  const session = sessions.get(req.params.id)
  if (!session || session.userId !== req.user.id) {
    res.status(404).json({ error: '会话已过期，请重新进关' })
    return null
  }
  return session
}

// ---- 账号体系 ----
app.post('/api/auth/register', wrap(async (req, res) => {
  const username = String(req.body?.username || '').trim()
  const password = String(req.body?.password || '')
  const invalid = validateAccount(username, password)
  if (invalid) return res.status(400).json({ error: invalid })
  const result = register(username, password)
  if (result.error) return res.status(400).json({ error: result.error })
  res.json({ token: result.token, profile: publicProfile(result.userId) })
}))

app.post('/api/auth/login', wrap(async (req, res) => {
  const username = String(req.body?.username || '').trim()
  const password = String(req.body?.password || '')
  if (!username || !password) return res.status(400).json({ error: '请输入用户名和密码' })
  const result = login(username, password)
  if (result.error) return res.status(400).json({ error: result.error })
  res.json({ token: result.token, profile: publicProfile(result.userId) })
}))

app.post('/api/auth/logout', wrap(async (req, res) => {
  const token = (req.headers.authorization || '').replace(/^Bearer\s+/i, '')
  if (token) logout(token)
  res.json({ ok: true })
}))

app.get('/api/auth/me', requireAuth, wrap(async (req, res) => {
  res.json({ profile: publicProfile(req.user.id) })
}))

app.use('/api', (req, res, next) => {
  if (req.path === '/health' || req.path.startsWith('/auth/')) return next()
  return requireAuth(req, res, next)
})

app.get('/api/health', (req, res) => {
  res.json({ ok: true, source: sourceInfo(DEFAULT_STORE_CODE), storeCode: DEFAULT_STORE_CODE, time: new Date().toISOString() })
})

app.get('/api/bootstrap', wrap(async (req, res) => {
  const storeCode = storeCodeFor(req.user.id)
  const [menu, couponPack, located] = await Promise.all([
    getMenu(storeCode),
    getCoupons(storeCode),
    locateStores(null, storeCode)
  ])
  const profileData = getProfileData(req.user.id)
  const store = getStore(storeCode)
  res.json({
    source: {
      ...sourceInfo(storeCode),
      degraded: Boolean(menu.degraded),
      provider: menu.source.provider || sourceInfo(storeCode).provider,
      itemCount: menu.items.length,
      nutritionCount: menu.source.nutritionCount ?? 0,
      fetchedAt: menu.source.fetchedAt
    },
    store: storeView(store),
    stores: located.stores,
    storeLocation: located.reference,
    tracks: TRACKS.map((track) => ({
      ...track,
      levels: ALL_LEVELS.filter((level) => level.track === track.id).map((level) =>
        levelView(level, menu.items, profileData, couponPack.coupons)
      )
    })),
    profile: publicProfile(req.user.id),
    coupons: {
      list: couponPack.coupons,
      realCount: couponPack.realCount,
      simulated: false,
      simulatedCount: 0,
      degraded: Boolean(couponPack.degraded)
    }
  })
}))

app.get('/api/stores', wrap(async (req, res) => {
  const storeCode = storeCodeFor(req.user.id)
  const located = await locateStores(null, storeCode)
  res.json({
    stores: located.stores,
    storeLocation: located.reference,
    current: storeView(getStore(storeCode)),
    source: sourceInfo(storeCode)
  })
}))

app.get('/api/location', wrap(async (req, res) => {
  const lat = Number(req.query.lat)
  const lng = Number(req.query.lng)
  const ip = typeof req.query.ip === 'string' && req.query.ip ? req.query.ip : ''
  const keyword = typeof req.query.keyword === 'string' ? req.query.keyword.trim() : ''
  const city = typeof req.query.city === 'string' ? req.query.city.trim() : ''
  let origin = null
  if (Number.isFinite(lat) && Number.isFinite(lng) && Math.abs(lat) <= 90 && Math.abs(lng) <= 180) {
    origin = { lat, lng, source: 'gps', label: '你' }
  } else {
    const byIp = await ipLocation(ip || (req.headers['x-forwarded-for'] || '').split(',')[0].trim())
    if (byIp) origin = { ...byIp, label: byIp.city || '你所在城市' }
  }
  const storeCode = storeCodeFor(req.user.id)
  const located = await locateStores(origin, storeCode, keyword, city)
  res.json({
    origin: located.origin || origin,
    reference: located.reference,
    mode: located.mode,
    keyword,
    stores: located.stores
  })
}))

app.post('/api/store', wrap(async (req, res) => {
  const code = String(req.body?.storeCode || '')
  const store = findStore(code)
  if (!store) return res.status(400).json({ error: '门店不存在' })
  setStoreCode(req.user.id, code)
  for (const [id, session] of sessions) {
    if (session.userId === req.user.id) sessions.delete(id)
  }
  const located = await locateStores(null, code)
  res.json({
    ok: true,
    store: storeView(store),
    stores: located.stores,
    storeLocation: located.reference,
    source: sourceInfo(code)
  })
}))

app.get('/api/profile', (req, res) => {
  res.json({ profile: publicProfile(req.user.id), source: sourceInfo(storeCodeFor(req.user.id)) })
})

app.post('/api/session', wrap(async (req, res) => {
  pruneSessions()
  const levelId = req.body?.levelId
  const level = getLevel(levelId)
  if (!level) return res.status(404).json({ error: '关卡不存在' })

  const profileData = getProfileData(req.user.id)
  if (!isUnlocked(level, profileData.stars)) return res.status(403).json({ error: '先通关上一关才能解锁' })

  const storeCode = storeCodeFor(req.user.id)
  const menu = await getMenu(storeCode)
  const couponPack = await getCoupons(storeCode)
  const event = rollEvent(level.id, menu.items)

  const soldOutCode = event?.soldOutCode || null
  const discountedCode = event?.discountedCode || null
  const items = menu.items.map((item) => ({
    ...item,
    price: discountedCode === item.code ? round2(item.price - event.discountDelta) : item.price,
    soldOut: soldOutCode === item.code
  }))

  const coupons = couponPack.coupons.map((coupon) => ({ ...coupon }))

  const cal = calibrate(level, items.filter((item) => !item.soldOut), coupons)
  const session = {
    id: randomUUID(),
    userId: req.user.id,
    storeCode,
    levelId: level.id,
    levelView: levelView(level, items.filter((item) => !item.soldOut), profileData, coupons),
    event,
    items,
    coupons,
    revive: false,
    hintUsed: false,
    thresholds: cal.thresholds,
    optimal: cal.optimal,
    createdAt: Date.now()
  }
  sessions.set(session.id, session)
  res.json({ session: serializeSession(session) })
}))

app.get('/api/session/:id', (req, res) => {
  const session = ownedSession(req, res)
  if (!session) return
  res.json({ session: serializeSession(session) })
})

app.post('/api/session/:id/price', (req, res) => {
  const session = ownedSession(req, res)
  if (!session) return
  const { lines, invalid } = resolveSelection(session, Array.isArray(req.body?.items) ? req.body.items : [])
  if (invalid.length) return res.status(400).json({ error: `${invalid[0].name || invalid[0].code}${invalid[0].reason}`, invalid })
  res.json(priceOf(session, lines, Array.isArray(req.body?.couponIds) ? req.body.couponIds : []))
})

app.post('/api/session/:id/evaluate', (req, res) => {
  const session = ownedSession(req, res)
  if (!session) return
  const level = getLevel(session.levelId)
  const selection = Array.isArray(req.body?.items) ? req.body.items : []
  const couponIds = Array.isArray(req.body?.couponIds) ? req.body.couponIds : []
  const assignments = Array.isArray(req.body?.assignments) ? req.body.assignments : []
  const { lines, invalid } = resolveSelection(session, selection)
  if (invalid.length) return res.status(400).json({ error: `${invalid[0].name || invalid[0].code}${invalid[0].reason}`, invalid })
  const itemsById = Object.fromEntries(session.items.map((item) => [item.code, item]))
  const coupons = session.coupons.filter((coupon) => couponIds.includes(coupon.couponId))
  // 预演不查实时价格、不写库，仅返回与 submit 同源的判定结果
  const result = judge({
    level,
    selection: lines.map((line) => ({ code: line.code, qty: line.qty })),
    itemsById,
    coupons,
    session,
    thresholds: session.thresholds,
    optimal: session.optimal,
    assignments
  })
  res.json({ preview: result })
})

function resolveSelection(session, selection) {
  const byId = new Map(session.items.map((item) => [item.code, item]))
  const lines = []
  const invalid = []
  for (const pick of selection) {
    const item = byId.get(pick?.code)
    if (!item) {
      invalid.push({ code: pick?.code ?? '', name: '', reason: '不存在' })
      continue
    }
    if (item.soldOut) {
      invalid.push({ code: item.code, name: item.name, reason: '已售罄' })
      continue
    }
    const qty = Math.max(1, Math.min(20, Number(pick.qty) || 1))
    lines.push({ code: item.code, name: item.name, category: item.category, price: item.price, qty })
  }
  return { lines, invalid }
}

function priceOf(session, lines, couponIds) {
  const subtotal = round2(lines.reduce((sum, line) => sum + line.price * line.qty, 0))
  const coupons = session.coupons.filter((coupon) => couponIds.includes(coupon.couponId))
  const result = applyCoupons(subtotal, coupons, lines)
  return { lines, paid: result.paid, applied: result.applied, skipped: result.skipped, subtotal, discount: result.discount }
}

app.post('/api/session/:id/submit', wrap(async (req, res) => {
  const session = ownedSession(req, res)
  if (!session) return
  const level = getLevel(session.levelId)
  const selection = Array.isArray(req.body?.items) ? req.body.items : []
  const couponIds = Array.isArray(req.body?.couponIds) ? req.body.couponIds : []
  const assignments = Array.isArray(req.body?.assignments) ? req.body.assignments : []
  const itemsById = Object.fromEntries(session.items.map((item) => [item.code, item]))
  const coupons = session.coupons.filter((coupon) => couponIds.includes(coupon.couponId))
  const { invalid } = resolveSelection(session, selection)
  if (invalid.length) return res.status(400).json({ error: `${invalid[0].name || invalid[0].code}${invalid[0].reason}`, invalid })

  const result = judge({
    level,
    selection,
    itemsById,
    coupons,
    session,
    thresholds: session.thresholds,
    optimal: session.optimal,
    assignments
  })

  const livePrice = await fetchPrice(session.storeCode || DEFAULT_STORE_CODE, result.lines)
  if (livePrice) {
    result.liveChecked = true
    result.livePaid = livePrice.price
  }
  result.store = storeView(getStore(session.storeCode || DEFAULT_STORE_CODE))

  const before = getProfileData(req.user.id)
  const prevStars = before.stars[level.id] || 0
  const coinsEarned = result.stars > 0 ? (result.stars > prevStars ? result.reward : 5) : 0
  const newAchievements = []

  if (result.stars > 0) addCoins(req.user.id, coinsEarned)
  const prevBest = before.bestPaid[level.id]
  setStar(
    req.user.id,
    level.id,
    Math.max(prevStars, result.stars),
    result.stars > 0 ? Math.min(prevBest ?? result.paid, result.paid) : prevBest ?? null
  )
  addHistory(req.user.id, {
    levelId: level.id,
    levelLabel: level.label,
    levelName: level.name,
    stars: result.stars,
    paid: result.paid,
    subtotal: result.subtotal,
    discountRate: result.discountRate
  })

  const after = getProfileData(req.user.id)
  const allFull = ALL_LEVELS.every((item) => (after.stars[item.id] || 0) === 3)
  if (allFull && !after.achievementIds.includes('saving_full')) {
    unlockAchievement(req.user.id, 'saving_full')
    addCoins(req.user.id, ACHIEVEMENTS.saving_full.bonus)
    newAchievements.push({ id: 'saving_full', title: '麦门抠门大师', bonus: 100 })
  }

  const nextLevel = ALL_LEVELS.find((item) => item.track === level.track && item.order === level.order + 1)
  res.json({
    result,
    coinsEarned: newAchievements.length ? coinsEarned + ACHIEVEMENTS.saving_full.bonus : coinsEarned,
    newAchievements,
    nextLevel: nextLevel ? { id: nextLevel.id, label: nextLevel.label, name: nextLevel.name, unlocked: result.stars > 0 } : null,
    profile: publicProfile(req.user.id)
  })
}))

const TOOLS = [
  { id: 'price_mirror', name: '价格透视镜', cost: 50, desc: '显示本关 3 个核心最低价单品', usable: true, emoji: '🔍' },
  { id: 'revive', name: '免死金牌', cost: 100, desc: '一次超预算 / 超指标不判失败，直接 1 星通关', usable: true, emoji: '🛡️' },
  { id: 'category_pass', name: '品类解锁卡', cost: 80, desc: '临时解除 1 条品类约束', usable: false, reason: '奇葩整活赛道专用', emoji: '🎫' },
  { id: 'nutrition_waiver', name: '营养豁免卡', cost: 70, desc: '营养指标误差范围扩大到 ±10%', usable: false, reason: '营养控卡赛道专用', emoji: '🧪' },
  { id: 'price_up', name: '对手涨价卡', cost: 120, desc: '使对方所有单品价格 +1 元', usable: false, reason: '1v1 对战专属', emoji: '📈' }
]

app.get('/api/tools', (req, res) => {
  res.json({ tools: TOOLS, profile: publicProfile(req.user.id) })
})

app.post('/api/tools/use', (req, res) => {
  const { toolId, sessionId } = req.body || {}
  const tool = TOOLS.find((item) => item.id === toolId)
  if (!tool) return res.status(404).json({ error: '道具不存在' })
  if (!tool.usable) return res.status(400).json({ error: tool.reason || '该道具暂不可用' })
  const session = sessions.get(sessionId)
  if (!session || session.userId !== req.user.id) return res.status(404).json({ error: '会话已过期，请重新进关' })
  if (getCoins(req.user.id) < tool.cost) return res.status(400).json({ error: '金币不足' })

  if (toolId === 'price_mirror') {
    if (session.hintUsed) return res.status(400).json({ error: '本关已经用过价格透视镜' })
    if (!spendCoins(req.user.id, tool.cost)) return res.status(400).json({ error: '金币不足' })
    session.hintUsed = true
    const hints = buildHints(getLevel(session.levelId), session.items.filter((item) => !item.soldOut), 3)
    return res.json({ ok: true, hints, profile: publicProfile(req.user.id), coinsSpent: tool.cost })
  }

  if (toolId === 'revive') {
    if (session.revive) return res.status(400).json({ error: '本关已经使用过免死金牌' })
    if (!spendCoins(req.user.id, tool.cost)) return res.status(400).json({ error: '金币不足' })
    session.revive = true
    return res.json({ ok: true, revive: true, profile: publicProfile(req.user.id), coinsSpent: tool.cost })
  }

  res.status(400).json({ error: '该道具暂不可用' })
})

app.post('/api/checkin', (req, res) => {
  const result = dbCheckin(req.user.id)
  if (!result.ok) return res.status(400).json({ error: '今天已经签到过了' })
  addCoins(req.user.id, 20)
  res.json({ ok: true, coinsEarned: 20, profile: publicProfile(req.user.id) })
})

app.post('/api/share', (req, res) => {
  if (shareCountToday(req.user.id) >= 3) return res.status(400).json({ error: '今天分享奖励已拿满（3 次）' })
  addShare(req.user.id)
  addCoins(req.user.id, 5)
  res.json({ ok: true, coinsEarned: 5, profile: publicProfile(req.user.id) })
})

const dist = path.join(here, '..', '..', 'client', 'dist')
if (fs.existsSync(dist)) {
  app.use(express.static(dist))
  app.get(/^\/(?!api).*/, (req, res) => res.sendFile(path.join(dist, 'index.html')))
}

const PORT = Number(process.env.PORT) || 3001
app.listen(PORT, "0.0.0.0", () => {
  console.log(`麦门省钱大闯关 API 已启动`)
  console.log(`数据源：${sourceInfo(DEFAULT_STORE_CODE).label} · 门店 ${DEFAULT_STORE_CODE}`)
})

