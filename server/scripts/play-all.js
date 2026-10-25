/**
 * 内置智能体跑关脚本：用 admin 账号把 20 关全部打到 3 星。
 *
 * 用法：
 *   node scripts/play-all.js            # 跑全部关卡
 *   node scripts/play-all.js N01 F03    # 只跑指定关卡
 *   PLAY_RESTARTS=60 node scripts/play-all.js
 *
 * 说明：
 * - 走真实 HTTP 接口（/api/session → /api/session/:id/submit），因此能连带验证路由与判定一致性；
 * - 组合搜索在本地跑 evaluateChallenge（与后端同一份 shared/challenges.js），避免大量 HTTP 往返；
 * - 每一关输出是否 3 星、实付、未达成条件，最后汇总。
 */
import { ALL_LEVELS, TRACKS, getLevel } from '../src/levels.js'
import { expandChallengeLines, challengePeople } from '../../shared/challenges.js'
import { buildLines, summarize } from '../src/engine/pricing.js'
import { judge } from '../src/engine/judge.js'

const BASE = process.env.BASE_URL || 'http://localhost:3001'
const USERNAME = process.env.PLAY_USER || 'admin'
const PASSWORD = process.env.PLAY_PASS || 'admin123456'

let token = ''

async function api(path, { method = 'GET', body } = {}) {
  const res = await fetch(`${BASE}${path}`, {
    method,
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {})
    },
    body: body === undefined ? undefined : JSON.stringify(body)
  })
  const data = await res.json().catch(() => ({}))
  if (!res.ok) throw new Error(`${method} ${path} -> ${res.status} ${data.error || ''}`)
  return data
}

async function ensureAccount() {
  try {
    const data = await api('/api/auth/login', { method: 'POST', body: { username: USERNAME, password: PASSWORD } })
    token = data.token
    return 'login'
  } catch {
    const data = await api('/api/auth/register', { method: 'POST', body: { username: USERNAME, password: PASSWORD } })
    token = data.token
    return 'register'
  }
}

const spicyOf = (p) => p.spicy === true || (p.flavors || []).includes('spicy')

/** 根据关卡的人物分配模式，尽量生成一份合法分配 */
function makeAssignments(level, lines) {
  const mode = level.rules?.assignmentMode
  if (!mode) return []
  const people = challengePeople(level)
  const pool = expandChallengeLines(lines).map((part) => ({ part, left: part.qty }))
  const rows = []
  const take = (entry, personId, qty = 1) => {
    const use = Math.min(qty, entry.left)
    if (use <= 0) return 0
    entry.left -= use
    rows.push({ personId, partKey: entry.part.partKey, qty: use })
    return use
  }
  for (const person of people) {
    const entry = pool.find((e) => e.left > 0
      && e.part.category === 'burger'
      && (!person.protein || e.part.protein === person.protein)
      && (!person.nonSpicy || !spicyOf(e.part)))
    if (entry) take(entry, person.id, 1)
  }
  if (mode === 'party') {
    for (const person of people) {
      const entry = pool.find((e) => e.left > 0 && e.part.category === 'drink')
      if (entry) take(entry, person.id, 1)
    }
  }
  if (mode === 'family') {
    const entry = pool.find((e) => e.left > 0 && e.part.category === 'snack')
    if (entry) take(entry, 'shared', 1)
  }
  if (mode === 'party') {
    let need = 4
    for (const e of pool) {
      if (need <= 0) break
      if (e.part.category !== 'snack' || e.left <= 0) continue
      need -= take(e, 'shared', Math.min(need, e.left))
    }
  }
  return rows
}

function evaluate(level, selection, itemsById, coupons, thresholds, optimal = null) {
  const rows = Object.entries(selection).map(([code, qty]) => ({ code, qty }))
  const lines = buildLines(rows, itemsById)
  const assignments = level.track === 'saving' ? [] : makeAssignments(level, lines)
  // 直接复用后端 judge，保证脚本判定与提交后判定完全一致
  const result = judge({ level, selection: rows, itemsById, coupons, session: { revive: false }, thresholds, optimal, assignments })
  return { ...result, assignments, level }
}

function conditions(result) {
  return [...result.checks, ...result.extras].filter((c) => c.available !== false && !c.advisory)
}

function fitness(result) {
  const list = conditions(result)
  const ok = list.filter((c) => c.ok).length
  const hard = list.filter((c) => c.structural)
  const hardOk = hard.filter((c) => c.ok).length
  const ratio = list.length ? ok / list.length : 0
  // 星级 > 硬性条件 > 品类进度 > 条件总数 > 价格（越低越好）
  return result.stars * 1e7 + hardOk * 1e5 + progress(result) * 1e4 + ok * 1e3 + ratio * 100 - (result.paid || 0) * 0.01
}

/** 品类进度：minQty / minItems 的完成比例，避免束搜索被「便宜但离目标更远」的状态占满槽位 */
function progress(result) {
  const rules = result.level?.rules || {}
  const counts = result.metrics?.categoryCounts || result.categoryCounts || {}
  const goals = Object.entries(rules.minQty || {}).map(([cat, need]) => Math.min(1, (counts[cat] || 0) / need))
  if (rules.minItems) {
    const parts = result.metrics?.totalQty ?? result.itemCount ?? 0
    goals.push(Math.min(1, parts / rules.minItems))
  }
  return goals.length ? goals.reduce((sum, value) => sum + value, 0) / goals.length : 0
}

function better(a, b) {
  return fitness(a) > fitness(b)
}

/** 品类构成指纹：用于保证束里同时保留「不同补齐方向」的状态（如少甜品 / 少饮品） */
function shapeKey(result) {
  const counts = result.metrics?.categoryCounts || {}
  return Object.keys(counts)
    .sort()
    .map((cat) => `${cat}${Math.min(counts[cat], 5)}`)
    .join('|')
}

/** 去掉绝大多数无竞争力的商品，保留每类最便宜的一批 + 各玩法需要的极端值 */
function prunePool(items) {
  const byCat = new Map()
  for (const item of items) {
    if (!byCat.has(item.category)) byCat.set(item.category, [])
    byCat.get(item.category).push(item)
  }
  const keep = new Set()
  for (const [cat, list] of byCat) {
    const limit = cat === 'combo' ? 10 : 8
    ;[...list].sort((a, b) => a.price - b.price).slice(0, limit).forEach((i) => keep.add(i.code))
    ;[...list].sort((a, b) => b.name.length - a.name.length).slice(0, 3).forEach((i) => keep.add(i.code))
    list.filter(spicyOf).forEach((i) => keep.add(i.code))
    if (cat === 'burger' || cat === 'snack') {
      ;[...list].sort((a, b) => (b.nutrition?.protein || 0) - (a.nutrition?.protein || 0)).slice(0, 3).forEach((i) => keep.add(i.code))
    }
    if (cat === 'burger' || cat === 'drink' || cat === 'dessert') {
      ;[...list].sort((a, b) => (a.nutrition?.carb ?? 999) - (b.nutrition?.carb ?? 999)).slice(0, 3).forEach((i) => keep.add(i.code))
      ;[...list].sort((a, b) => (a.nutrition?.fat ?? 999) - (b.nutrition?.fat ?? 999)).slice(0, 3).forEach((i) => keep.add(i.code))
    }
  }
  return items.filter((item) => keep.has(item.code))
}

const stateKey = (selection) => Object.keys(selection).sort().map((code) => `${code}x${selection[code]}`).join(',')

/**
 * 种子方案：枚举 0~3 个套餐，再用各品类最便宜的单品补齐缺口。
 * 束搜索按「条件完成度」排序时会漏掉「便宜但品类没齐」的路径（S03 就漏了套餐 + 极便宜单品），
 * 这里直接构造这类方案作为兜底。
 */
function fillCandidates(pool, itemsById, rules) {
  const cap = rules.maxSameItem ?? 8
  const combos = pool.filter((item) => item.category === 'combo').slice(0, 8)
  const singles = pool.filter((item) => item.category !== 'combo')
  const cheapest = {}
  for (const item of singles) {
    if (!cheapest[item.category] || item.price < cheapest[item.category].price) cheapest[item.category] = item
  }
  const cheapestAny = [...singles].sort((a, b) => a.price - b.price)
  const coverage = (selection) => {
    const lines = buildLines(Object.entries(selection).map(([code, qty]) => ({ code, qty })), itemsById)
    const counts = summarize(lines).categoryCounts
    const parts = lines.reduce((sum, line) => {
      const partsPerUnit = line.contents?.length ? line.contents.reduce((s, part) => s + part.qty, 0) : 1
      return sum + partsPerUnit * line.qty
    }, 0)
    return { counts, parts }
  }

  const sets = [[]]
  for (let size = 1; size <= 3; size += 1) {
    const walk = (start, picked) => {
      if (picked.length === size) {
        sets.push([...picked])
        return
      }
      for (let index = start; index < combos.length; index += 1) {
        picked.push(combos[index])
        walk(index, picked)
        picked.pop()
      }
    }
    walk(0, [])
  }

  const out = []
  for (const set of sets) {
    const selection = {}
    for (const combo of set) selection[combo.code] = (selection[combo.code] || 0) + 1
    for (const [cat, need] of Object.entries(rules.minQty || {})) {
      let { counts } = coverage(selection)
      while ((counts[cat] || 0) < need) {
        const pick = cheapest[cat]
        if (!pick || (selection[pick.code] || 0) >= cap) break
        selection[pick.code] = (selection[pick.code] || 0) + 1
        counts = coverage(selection).counts
      }
    }
    if (rules.minItems) {
      while (coverage(selection).parts < rules.minItems) {
        const pick = cheapestAny.find((item) => (selection[item.code] || 0) < cap)
        if (!pick) break
        selection[pick.code] = (selection[pick.code] || 0) + 1
      }
    }
    out.push(selection)
  }
  return out
}

/**
 * 束搜索：每层从当前束里各加一件商品，用「多重集合 key」去重（避免排列重复），
 * 再按适应度保留前 N 个状态。相比随机爬山，能稳定搜到「必须同时凑够某几个条件」的组合。
 */
function search(level, items, itemsById, coupons, thresholds, optimal = null) {
  const rules = level.rules || {}
  const cap = rules.maxSameItem ?? 8
  const need = Object.values(rules.minQty || {}).reduce((sum, qty) => sum + qty, 0)
  const maxTotal = Math.min(40, Math.max(need + 6, (rules.minItems || 0) + 4, 10))
  const beamWidth = Number(process.env.PLAY_BEAM) || 32
  const pool = prunePool(items).sort((a, b) => a.price - b.price)
  if (process.env.PLAY_DEBUG) {
    const counts = {}
    for (const item of pool) counts[item.category] = (counts[item.category] || 0) + 1
    console.log(`[debug] ${level.id} pool=${pool.length} ${JSON.stringify(counts)}`)
  }
  const cache = new Map()
  const evalState = (selection) => {
    const key = stateKey(selection)
    const hit = cache.get(key)
    if (hit) return hit
    const value = evaluate(level, selection, itemsById, coupons, thresholds, optimal)
    cache.set(key, value)
    return value
  }

  const empty = { selection: {}, result: evalState({}) }
  let beam = [empty]
  let best = empty

  for (const selection of fillCandidates(pool, itemsById, rules)) {
    const result = evalState(selection)
    if (better(result, best.result)) best = { selection, result }
  }

  for (let depth = 0; depth < maxTotal; depth += 1) {
    const next = new Map()
    for (const state of beam) {
      const bestPaid = best.result.stars === 3 ? best.result.paid : Infinity
      if (state.result.stars === 3 && better(state.result, best.result)) best = state
      for (const item of pool) {
        if ((state.selection[item.code] || 0) >= cap) continue
        // 已找到三星方案时，任何比它更贵的扩展都不可能更优
        if (state.result.paid + item.price > bestPaid + 0.001) continue
        const selection = { ...state.selection, [item.code]: (state.selection[item.code] || 0) + 1 }
        const result = evalState(selection)
        if (better(result, best.result)) best = { selection, result }
        const key = stateKey(selection)
        const existing = next.get(key)
        if (!existing || better(result, existing.result)) next.set(key, { selection, result })
      }
    }
    if (!next.size) break
    const ranked = [...next.values()].sort((a, b) => fitness(b.result) - fitness(a.result))
    // 同一「品类构成」最多留 3 个，避免 32 个槽位被同一补齐方向占满（S03 曾因此漏掉便宜甜品补齐路径）
    const beamLimit = Number(process.env.PLAY_SHAPE_CAP) || 3
    const perShape = new Map()
    const picked = []
    for (const state of ranked) {
      if (picked.length >= beamWidth) break
      const key = shapeKey(state.result)
      const used = perShape.get(key) || 0
      if (used >= beamLimit) continue
      perShape.set(key, used + 1)
      picked.push(state)
    }
    for (const state of ranked) {
      if (picked.length >= beamWidth) break
      if (!picked.includes(state)) picked.push(state)
    }
    beam = picked
    if (process.env.PLAY_DEBUG) console.log(`[debug] ${level.id} depth=${depth + 1} beam=${beam.length} best=${best.result.stars}★ ¥${best.result.paid} [${stateKey(best.selection)}]`)
    if (process.env.PLAY_DEBUG && depth < 4) {
      for (const state of beam.slice(0, 6)) {
        const list = conditions(state.result)
        const names = state.result.lines.map((l) => `${l.name}x${l.qty}`).join('/')
        console.log(`   · ${state.result.stars}★ ¥${state.result.paid} ok=${list.filter((c) => c.ok).length}/${list.length} ${names} | fail ${list.filter((c) => !c.ok).map((c) => c.key).join(',')}`)
      }
    }
    if (best.result.stars === 3 && beam.every((state) => state.result.stars === 3)) {
      const cheapest = [...beam].sort((a, b) => a.result.paid - b.result.paid)[0]
      if (cheapest && cheapest.result.paid <= best.result.paid) best = cheapest
      break
    }
  }
  return best
}

function failedList(result) {
  return conditions(result).filter((c) => !c.ok).map((c) => `${c.label}${c.detail ? `（${c.detail}）` : ''}`)
}

async function playLevel(level) {
  const created = await api('/api/session', { method: 'POST', body: { levelId: level.id } })
  const session = created.session
  const items = session.items.filter((item) => !item.soldOut && Number.isFinite(item.price))
  const itemsById = Object.fromEntries(items.map((item) => [item.code, item]))
  const coupons = session.coupons
  const thresholds = session.thresholds
  const best = search(level, items, itemsById, coupons, thresholds, session.optimal ?? null)
  if (!best) return { id: level.id, name: level.name, stars: 0, error: '搜索未产出任何方案' }

  const selections = Object.entries(best.selection).map(([code, qty]) => ({ code, qty }))
  const body = {
    items: selections,
    couponIds: coupons.map((coupon) => coupon.couponId),
    assignments: best.result.assignments
  }
  const { preview } = await api(`/api/session/${session.id}/evaluate`, { method: 'POST', body })
  const submit = await api(`/api/session/${session.id}/submit`, { method: 'POST', body })
  if (preview.stars !== submit.result.stars || preview.paid !== submit.result.paid) {
    throw new Error(`预演与结算不一致：${preview.stars}★ / ${submit.result.stars}★，¥${preview.paid} / ¥${submit.result.paid}`)
  }
  return {
    id: level.id,
    name: level.name,
    stars: submit.result.stars,
    paid: submit.result.paid,
    lines: best.result.lines.map((l) => `${l.name}×${l.qty}`),
    localFailed: failedList(best.result),
    remoteFailed: (submit.result.checks || [])
      .filter((c) => c.available !== false && !c.ok)
      .map((c) => c.label)
      .concat((submit.result.extras || []).filter((c) => c.available !== false && !c.advisory && !c.ok).map((c) => c.label)),
    suggestions: submit.result.suggestions || []
  }
}

async function main() {
  const how = await ensureAccount()
  console.log(`账号 ${USERNAME}：${how} 成功 · ${BASE}`)
  const wanted = process.argv.slice(2)
  const levels = wanted.length
    ? wanted.map((id) => getLevel(id)).filter(Boolean)
    : TRACKS.flatMap((track) => ALL_LEVELS.filter((l) => l.track === track.id).sort((a, b) => a.order - b.order))

  const results = []
  for (const level of levels) {
    try {
      const result = await playLevel(level)
      results.push(result)
      const mark = result.stars === 3 ? '✅' : result.stars > 0 ? '⚠️' : '❌'
      console.log(`${mark} ${result.id} ${result.name} · ${result.stars}★ · 实付 ¥${result.paid} · ${result.lines.join(' / ')}`)
      if (result.stars !== 3) {
        console.log(`   未达成：${result.localFailed.join('；') || '—'}`)
        if (result.suggestions.length) console.log(`   服务端建议：${result.suggestions.join('；')}`)
        if (result.remoteFailed.length) console.log(`   服务端未达成：${result.remoteFailed.join('；')}`)
      }
    } catch (error) {
      results.push({ id: level.id, name: level.name, stars: 0, error: error.message })
      console.log(`❌ ${level.id} ${level.name} · 异常：${error.message}`)
    }
  }

  const ok = results.filter((r) => r.stars === 3).length
  console.log(`\n汇总：${ok}/${results.length} 关达成 3 星`)
  for (const r of results.filter((item) => item.stars !== 3)) console.log(`  - ${r.id} ${r.name}：${r.error || `${r.stars}★`}`)
  if (ok !== results.length) process.exitCode = 1
}

main().catch((error) => {
  console.error(error)
  process.exitCode = 1
})
