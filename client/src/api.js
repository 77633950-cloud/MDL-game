const BASE = import.meta.env.VITE_API_BASE || ''
const TOKEN_KEY = 'mdl_token'

export function getToken() {
  try {
    return localStorage.getItem(TOKEN_KEY) || ''
  } catch {
    return ''
  }
}

export function setToken(token) {
  try {
    localStorage.setItem(TOKEN_KEY, token)
  } catch {
    /* ignore */
  }
}

export function clearToken() {
  try {
    localStorage.removeItem(TOKEN_KEY)
  } catch {
    /* ignore */
  }
}

async function request(path, options = {}) {
  const headers = { 'Content-Type': 'application/json' }
  const token = getToken()
  if (token) headers.Authorization = `Bearer ${token}`
  const res = await fetch(`${BASE}${path}`, {
    ...options,
    headers: { ...headers, ...(options.headers || {}) },
    body: options.body ? JSON.stringify(options.body) : undefined
  })
  const data = await res.json().catch(() => ({}))
  if (res.status === 401) {
    clearToken()
    window.dispatchEvent(new Event('mdl:unauthorized'))
    throw new Error(data.error || '登录已失效，请重新登录')
  }
  if (!res.ok) throw new Error(data.error || `请求失败（${res.status}）`)
  return data
}

export const api = {
  auth: {
    register: (username, password) => request('/api/auth/register', { method: 'POST', body: { username, password } }),
    login: (username, password) => request('/api/auth/login', { method: 'POST', body: { username, password } }),
    logout: () => request('/api/auth/logout', { method: 'POST' }),
    me: () => request('/api/auth/me')
  },
  bootstrap: () => request('/api/bootstrap'),
  profile: () => request('/api/profile'),
  stores: () => request('/api/stores'),
  location: ({ lat, lng, ip, keyword, city } = {}) => {
    const search = new URLSearchParams()
    if (Number.isFinite(lat) && Number.isFinite(lng)) {
      search.set('lat', lat)
      search.set('lng', lng)
    } else if (ip) {
      search.set('ip', ip)
    }
    if (keyword) search.set('keyword', keyword)
    if (city) search.set('city', city)
    const query = search.toString()
    return request(`/api/location${query ? `?${query}` : ''}`)
  },
  switchStore: (storeCode) => request('/api/store', { method: 'POST', body: { storeCode } }),
  createSession: (levelId) => request('/api/session', { method: 'POST', body: { levelId } }),
  evaluate: (sessionId, body) => request(`/api/session/${sessionId}/evaluate`, { method: 'POST', body }),
  submit: (sessionId, body) => request(`/api/session/${sessionId}/submit`, { method: 'POST', body }),
  useTool: (toolId, sessionId) => request('/api/tools/use', { method: 'POST', body: { toolId, sessionId } }),
  checkin: () => request('/api/checkin', { method: 'POST' }),
  share: () => request('/api/share', { method: 'POST' })
}

export const CHALLENGE_TRACKS = {
  nutrition: {
    name: '营养控卡', subtitle: '健康向 · 对接官方营养成分', emoji: '🥗', color: 'green',
    levels: [
      ['N01', '轻盈早餐：500 千卡以内', '早餐要吃饱也要轻负担：热量和饮品碳水都会计入。'],
      ['N02', '高蛋白午餐：蛋白质优先', '蛋白质与热量效率同时考虑。'],
      ['N03', '低脂但不寡淡', '小食也要低脂，苹果片、玉米杯比薯条更合适。'],
      ['N04', '控碳饮品挑战', '官方营养表没有糖分，本关以碳水作为控糖口径。'],
      ['N05', '营养均衡终局', '综合得分：热量35%、蛋白质30%、脂肪20%、品类15%。']
    ]
  },
  fun: {
    name: '奇葩整活', subtitle: '欢乐向 · 黑暗料理与社交传播', emoji: '🤪', color: 'purple',
    levels: [
      ['F01', '辣度警告色', '至少两份辣味商品，主食和小食各一份辣味。'],
      ['F02', '甜咸反差王', '咸甜、冷热标签只采用商品资料。'],
      ['F03', '名字最长的一单', '同一商品只计一次字数，套餐名称计一次。'],
      ['F04', '社恐点餐模拟', '少种类、多件数；套餐拆开就算多件。'],
      ['F05', '终极黑暗料理', '咸甜、辣甜都算冲突维度，凑齐两个维度更稳。']
    ]
  },
  scene: {
    name: '场景模拟', subtitle: '沉浸向 · 还原真实点餐场景', emoji: '🏃', color: 'blue',
    levels: [
      ['C01', '一个人的加班晚餐', '套餐内小食计入，快速由种类数衡量。'],
      ['C02', '三人同事午餐', '鸡肉同事、牛肉同事、不吃辣同事分别分配主食。'],
      ['C03', '亲子欢乐餐', '成人、儿童、共享分别分配；儿童的主食必须不辣。'],
      ['C04', '健身后补给', '蛋白质、碳水、脂肪都必须有真实营养数据。'],
      ['C05', '八人聚会拼单', '每人独立主食，个人饮品与共享小食不能重复占用。']
    ]
  }
}

export function fallbackTrack(track) {
  const meta = CHALLENGE_TRACKS[track.id]
  if (!meta || track.levels?.length) return track
  return {
    ...track, ...meta,
    levels: meta.levels.map(([id, name, tip], index) => ({
      id, label: `第${index + 1}关`, order: index + 1, name, tagline: name, tip,
      difficulty: index + 1, stars: 0, unlocked: index === 0,
      constraintText: ['真实菜单字段校验', '提交后返回 checks / extras / metrics'],
      budgetText: '按本店实时数据判定', star3Text: '满足关卡硬约束与附加条件',
      thresholds: {}, calibration: { adjusted: false, unsolvable: false }
    }))
  }
}

export const yuan = (n) => {
  if (n == null || Number.isNaN(Number(n))) return '—'
  return `¥${(Math.round(Number(n) * 10) / 10).toFixed(1)}`
}

export const CATEGORY_META = {
  burger: { label: '主食', emoji: '🍔' },
  snack: { label: '小食', emoji: '🍟' },
  drink: { label: '饮品', emoji: '🥤' },
  dessert: { label: '甜品', emoji: '🍦' },
  combo: { label: '套餐', emoji: '🎁' },
  sauce: { label: '蘸酱', emoji: '🧂' }
}

export const PROTEIN_META = {
  chicken: { label: '鸡', emoji: '🍗' },
  beef: { label: '牛', emoji: '🥩' },
  fish: { label: '鱼', emoji: '🐟' },
  veg: { label: '素', emoji: '🥬' },
  none: { label: '—', emoji: '' },
  mixed: { label: '混', emoji: '🍱' }
}

export function couponHint(coupon) {
  if (coupon.desc) return coupon.desc
  if (coupon.type === 'threshold') return `满 ${coupon.threshold} 减 ${coupon.reduce}`
  if (coupon.type === 'percent') return `全场 ${Math.round((1 - coupon.rate) * 10)} 折`
  return coupon.title || ''
}

const ITEM_COUPON_TYPES = new Set(['fixedPrice', 'freeItem', 'bundlePrice'])

function unitPrices(lines, coupon) {
  let regex = null
  if (coupon.match) {
    try {
      regex = new RegExp(coupon.match)
    } catch {
      regex = null
    }
  }
  const prices = []
  for (const line of lines || []) {
    const hit =
      (coupon.code && line.code === String(coupon.code)) ||
      (regex && (!coupon.category || line.category === coupon.category) && (!coupon.protein || line.protein === coupon.protein) && regex.test(line.name))
    if (!hit) continue
    for (let i = 0; i < line.qty; i += 1) prices.push(line.price)
  }
  return prices.sort((a, b) => b - a)
}

const r2 = (n) => Math.round((n + Number.EPSILON) * 100) / 100

export function applyCouponsLocal(subtotal, coupons, lines = []) {
  let running = subtotal
  const applied = []
  const skipped = []

  for (const coupon of coupons.filter((c) => ITEM_COUPON_TYPES.has(c.type))) {
    const prices = unitPrices(lines, coupon)
    let saved = 0
    if (coupon.type === 'freeItem') {
      if (!prices.length) {
        skipped.push({ ...coupon, reason: '餐盘里没有可用的单品' })
        continue
      }
      saved = prices[0]
    } else if (coupon.type === 'fixedPrice') {
      if (!prices.length) {
        skipped.push({ ...coupon, reason: '餐盘里没有可用的单品' })
        continue
      }
      saved = Math.max(0, prices[0] - coupon.price)
    } else if (coupon.type === 'bundlePrice') {
      const need = coupon.needQty || 2
      if (prices.length < need) {
        skipped.push({ ...coupon, reason: `餐盘里匹配单品不足 ${need} 件` })
        continue
      }
      saved = Math.max(0, prices.slice(0, need).reduce((s, p) => s + p, 0) - coupon.price)
    }
    saved = r2(Math.min(saved, running))
    if (saved <= 0) {
      skipped.push({ ...coupon, reason: '当前搭配无法再优惠' })
      continue
    }
    running = r2(running - saved)
    applied.push({ ...coupon, saved })
  }

  for (const coupon of coupons.filter((c) => c.type === 'threshold').sort((a, b) => b.reduce - a.reduce)) {
    if (running >= coupon.threshold) {
      running = r2(running - coupon.reduce)
      applied.push({ ...coupon, saved: coupon.reduce })
    } else {
      skipped.push({ ...coupon, gap: r2(coupon.threshold - running), reason: `差 ¥${r2(coupon.threshold - running)} 可用` })
    }
  }

  for (const coupon of coupons.filter((c) => c.type === 'percent').sort((a, b) => b.rate - a.rate)) {
    const saved = r2(running * coupon.rate)
    if (saved <= 0) continue
    running = r2(running - saved)
    applied.push({ ...coupon, saved })
  }

  return { paid: r2(running), applied, skipped, discount: r2(subtotal - running) }
}
