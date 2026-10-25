import fs from 'node:fs'
import { DEFAULT_STORE_CODE, getStore, storePrice, storeView } from '../data/stores.js'

const catalog = JSON.parse(fs.readFileSync(new URL('../data/catalog.json', import.meta.url), 'utf8'))
const MCP_URL = process.env.MCD_MCP_URL || ''
const MCP_TOKEN = process.env.MCD_MCP_TOKEN || ''

export const isLive = Boolean(MCP_URL)

let clientPromise = null

async function getClient() {
  if (!isLive) return null
  if (!clientPromise) {
    clientPromise = (async () => {
      const { Client } = await import('@modelcontextprotocol/sdk/client/index.js')
      const { StreamableHTTPClientTransport } = await import('@modelcontextprotocol/sdk/client/streamableHttp.js')
      const transport = new StreamableHTTPClientTransport(new URL(MCP_URL), {
        requestInit: MCP_TOKEN ? { headers: { Authorization: `Bearer ${MCP_TOKEN}` } } : undefined
      })
      const client = new Client({ name: 'mdl-game', version: '1.0.0' }, { capabilities: {} })
      await client.connect(transport)
      return client
    })().catch((error) => {
      clientPromise = null
      throw error
    })
  }
  return clientPromise
}

function parseToolText(result) {
  const text = (result?.content || []).map((c) => c.text || '').join('\n')
  const marker = text.lastIndexOf('{"success"')
  const start = marker >= 0 ? marker : text.indexOf('{')
  if (start < 0) throw new Error('MCP 返回中没有 JSON')
  const end = text.lastIndexOf('}')
  return JSON.parse(text.slice(start, end + 1))
}

async function callTool(name, args) {
  const client = await getClient()
  if (!client) throw new Error('未配置 MCD_MCP_URL')
  const result = await client.callTool({ name, arguments: args })
  return parseToolText(result)
}

async function callToolText(name, args) {
  const client = await getClient()
  if (!client) throw new Error('未配置 MCD_MCP_URL')
  const result = await client.callTool({ name, arguments: args })
  return (result?.content || []).map((content) => content.text || '').join('\n')
}

/**
 * available-coupons / query-my-coupons 返回的都是 Markdown，但排版不同：
 * - 卡包用 `## 标题` 分段，券面信息在 `- **有效期**: xxx`
 * - 麦麦省用 `- 优惠券标题：xxx` 分段
 * 两种都解析成统一的 { title, image, expiry } 交给券包合成。
 */
function parseMarkdownCoupons(text) {
  const source = String(text || '')
  const coupons = []

  for (const block of source.split(/\n#{2,3}\s+/).slice(1)) {
    const title = block.split('\n')[0].trim()
    if (!title) continue
    coupons.push({
      title,
      image: (block.match(/<img[^>]+src="([^"]+)"/) || [])[1] || '',
      expiry: (block.match(/\*\*有效期\*\*[:：]\s*([^\n]+)/) || [])[1]?.trim() || ''
    })
  }
  if (coupons.length) return coupons

  for (const block of source.split(/-\s*优惠券标题：/).slice(1)) {
    const title = block.split('\n')[0].trim().replace(/\\$/, '')
    if (!title) continue
    coupons.push({
      title,
      image: (block.match(/<img[^>]+src="([^"]+)"/) || [])[1] || '',
      expiry: '',
      status: (block.match(/状态：([^\n]+)/) || [])[1]?.trim() || ''
    })
  }
  return coupons
}

const CATEGORY_RULES = [
  { match: /蘸酱$|风味酱$|牧场酱|番茄酱/, category: 'sauce' },
  { match: /套餐|随心配|分享餐|三件套|四件套|双人餐|多人餐|拼盘|乐园餐|亲子餐/, category: 'combo' },
  { match: /汉堡|堡|卷/, category: 'burger' },
  { match: /薯条|薯饼|鸡块|鸡翅|鸡排|炸鸡|玉米杯|苹果片|洋葱圈/, category: 'snack' },
  { match: /冰淇淋|圆筒|麦旋风|新地|派|甜品|拉明顿/, category: 'dessert' },
  { match: /可乐|雪碧|咖啡|红茶|牛奶|果汁|纯悦|奶昔|橙|柠|豆浆|美式|拿铁|奶铁|黑巧|阿芙佳朵|麦炫酷/, category: 'drink' }
]

/** 开心乐园餐里的玩具、随机赠品不计入营养求和，也不阻塞整单匹配 */
const NON_FOOD_PICK = /玩具|周边|赠品|贴纸|徽章|帽|捶/

/**
 * 麦当劳营养表与菜单的命名差异（括号写法、连字符、麦咖啡前缀、盒装后缀、块数顺序）统一压成候选键。
 * 索引和查询都走这套候选键，避免为每个商品手写别名。
 * 只做「同一商品的命名对齐」，不做份数换算——官方没列的营养值一律留空，由界面显示「未收录」。
 */
function nameVariants(raw = '') {
  const base = String(raw)
    .replace(/[™®]/g, '')
    .replace(/\s+/g, '')
    .replace(/^麦咖啡/, '')
  const forms = [
    base,
    base.replace(/[（(]盒装[）)]/g, ''),
    base.replace(/[（(][^）)]*[）)]/g, ''),
    base.replace(/[（()）]/g, ''),
    base.replace(/[（(]盒装[）)]/g, '').replace(/[（()）]/g, ''),
    base.replace(/[-—_]/g, ''),
    // 「5块麦乐鸡」与「麦乐鸡5块」是同一份商品的不同写法
    base.replace(/^(\d+)(块|根|个|只|条)(.+)$/, '$3$1$2'),
    // 「苹果片一袋(60g)」即「苹果片」
    base.replace(/一袋(\(?\d+g\)?)?$/, '')
  ]
  return [...new Set(forms.filter(Boolean))]
}

function parseNutritionText(text) {
  const table = new Map()
  if (typeof text !== 'string') return table
  for (const line of text.split(/\r?\n/)) {
    const row = line.trim()
    if (!row || row.startsWith('[') || row.startsWith('{')) continue
    const cells = row.split(',')
    // 列结构固定为：productName, nutritionDescription, energyKj, energyKcal, protein, fat, carbohydrate, sodium, calcium
    if (cells.length < 9) continue
    const numbers = cells.slice(-7).map(Number)
    if (numbers.some((value) => !Number.isFinite(value))) continue
    const [energyKj, kcal, protein, fat, carb, sodium, calcium] = numbers
    const nutrition = { kcal, protein, fat, carb, sodium, calcium, energyKj }
    for (const key of nameVariants(cells[0])) if (!table.has(key)) table.set(key, nutrition)
  }
  return table
}

function sumNutrition(list) {
  return list.reduce(
    (total, item) => ({
      kcal: total.kcal + item.kcal,
      protein: Math.round((total.protein + item.protein) * 10) / 10,
      fat: Math.round((total.fat + item.fat) * 10) / 10,
      carb: Math.round((total.carb + item.carb) * 10) / 10,
      sodium: total.sodium + item.sodium,
      calcium: total.calcium + (item.calcium || 0),
      energyKj: total.energyKj + (item.energyKj || 0)
    }),
    { kcal: 0, protein: 0, fat: 0, carb: 0, sodium: 0, calcium: 0, energyKj: 0 }
  )
}

function lookupNutrition(name, table) {
  if (!table) return null
  for (const key of nameVariants(name)) if (table.has(key)) return table.get(key)
  return null
}

let nutritionState = { at: 0, table: null }

async function getNutritionTable() {
  if (!isLive) return null
  if (nutritionState.table && Date.now() - nutritionState.at < 1000 * 60 * 60) return nutritionState.table
  try {
    const payload = await callTool('list-nutrition-foods', {})
    const table = parseNutritionText(payload?.data)
    if (table.size) nutritionState = { at: Date.now(), table }
    return table.size ? table : null
  } catch {
    return null
  }
}

const detailNutritionCache = new Map()

/** 用门店真实的默认选配结果算营养：单个默认选项取自身，多选项（套餐）求和 */
async function nutritionFromDetail(item, table, storeCode) {
  if (!table) return null
  if (detailNutritionCache.has(item.code)) return detailNutritionCache.get(item.code)
  let nutrition = null
  try {
    const payload = await callTool('query-meal-detail', {
      storeCode,
      orderType: 1,
      beType: 1,
      code: item.code
    })
    const data = payload?.data || {}
    const picks = []
    for (const round of data.rounds || []) {
      const choices = round.choices || []
      const defaults = choices.filter((choice) => choice.isDefault === 1)
      for (const choice of defaults.length ? defaults : choices.length === 1 ? choices : []) {
        picks.push(choice.name)
      }
    }
    const parts = picks
      .filter((name) => !NON_FOOD_PICK.test(name))
      .map((name) => lookupNutrition(name, table))
    if (parts.length && parts.every(Boolean)) nutrition = sumNutrition(parts)
    if (!nutrition) nutrition = lookupNutrition(data.name, table)
  } catch {
    nutrition = null
  }
  detailNutritionCache.set(item.code, nutrition)
  return nutrition
}

/** 并发补齐缺失营养，避免逐个串行请求太慢 */
async function fillMissingNutrition(items, table, storeCode) {
  const queue = items.filter((item) => !item.nutrition)
  const workers = Array.from({ length: Math.min(6, queue.length) }, async () => {
    while (queue.length) {
      const item = queue.shift()
      const nutrition = await nutritionFromDetail(item, table, storeCode)
      if (nutrition) item.nutrition = nutrition
    }
  })
  await Promise.all(workers)
  return items
}

const comboDescriptionCache = new Map()
const CONTENT_LABELS = { burger: '主食', snack: '小食', drink: '饮品', dessert: '甜品', sauce: '酱料' }

async function fillComboDescriptions(items, storeCode) {
  const queue = items.filter((item) => item.category === 'combo')
  await Promise.all(Array.from({ length: Math.min(6, queue.length) }, async () => {
    while (queue.length) {
      const item = queue.shift()
      const key = `${storeCode}:${item.code}`
      let description = comboDescriptionCache.get(key)
      if (!description) {
        try {
          const payload = await callTool('query-meal-detail', { storeCode, orderType: 1, beType: 1, code: item.code })
          const groups = (payload?.data?.rounds || []).map((round) => {
            const choices = (round.choices || []).filter((choice) => !NON_FOOD_PICK.test(choice.name || ''))
            const defaults = choices.filter((choice) => choice.isDefault === 1)
            if (defaults.length) return defaults.map((choice) => {
              const qty = Number(choice.quantity) || (defaults.length === 1 ? Number(round.quantity) : 0) || 1
              return `${choice.name}×${qty}`
            }).join('、')
            if (choices.length === 1) return `${choices[0].name}×${Number(choices[0].quantity) || Number(round.quantity) || 1}`
            return choices.length ? `任选${Number(round.quantity) || Number(round.minQuantity) || 1}份：${choices.map((choice) => choice.name).join(' / ')}` : ''
          }).filter(Boolean)
          description = groups.join(' + ')
          if (description) comboDescriptionCache.set(key, description)
        } catch {
          // 详情暂不可用时仍展示已有组成，不凭图片推测具体商品。
        }
      }
      item.contentsText = description || (item.contents || []).map((part) => `${part.name || CONTENT_LABELS[part.category] || part.category}×${part.qty}`).join(' + ') || '门店暂未返回具体组成，请查看套餐详情'
    }
  }))
}

function inferCategory(name, categoryName = '') {
  const source = `${categoryName} ${name}`
  if (/周边|玩具|帽|徽章|捶|贴|百宝袋/.test(name)) return 'merch'
  for (const rule of CATEGORY_RULES) if (rule.match.test(source)) return rule.category
  return 'other'
}

function inferProtein(name) {
  if (/鱼|鳕|虾|三文/.test(name)) return 'fish'
  if (/牛|安格斯|吉士/.test(name)) return 'beef'
  if (/鸡|麦乐|翅|板烧/.test(name)) return 'chicken'
  return 'none'
}

function normalizeLiveMenu(payload, nutritionTable) {
  const data = payload?.data || {}
  const meals = data.meals || {}
  const categoryOf = new Map()
  for (const cat of data.categories || []) {
    for (const meal of cat.meals || []) if (!categoryOf.has(meal.code)) categoryOf.set(meal.code, cat.name || '')
  }
  const knownByCode = new Map(catalog.items.map((item) => [item.code, item]))
  const items = []
  for (const [code, meal] of Object.entries(meals)) {
    const known = knownByCode.get(code)
    const name = meal.name || known?.name || code
    const price = Number(meal.currentPrice)
    if (!Number.isFinite(price) || /帽|徽章|捶|周边|贴|百宝袋/.test(name)) continue
    const category = known?.category || inferCategory(name, categoryOf.get(code))
    if (category === 'merch' || category === 'other') continue
    items.push({
      code,
      name,
      price,
      originalPrice: Number(meal.originalPrice) || price,
      category,
      protein: known?.protein || inferProtein(name),
      flavors: known?.flavors || ['salty'],
      // 先只按名字精确匹配，剩下的交给 query-meal-detail 用门店真实默认规格补齐
      nutrition: lookupNutrition(name, nutritionTable),
      image: meal.image || known?.image || '',
      tags: known?.tags || [],
      popular: known?.popular || false,
      contents: known?.contents || null
    })
  }
  return items
}

export function snapshotMenu(storeCode = DEFAULT_STORE_CODE) {
  const store = getStore(storeCode)
  const factor = store.priceFactor
  return {
    items: catalog.items.map((item) => ({
      ...item,
      price: storePrice(item.price, factor),
      originalPrice: storePrice(item.originalPrice ?? item.price, factor),
      nutrition: lookupNutrition(item.name, nutritionState.table) || item.nutrition || null
    })),
    source: {
      ...catalog.source,
      storeCode: store.code,
      storeName: store.name,
      address: store.address,
      priceFactor: factor,
      calibrated: Math.abs(factor - 1) > 0.0001
    }
  }
}

export async function fetchMenu(storeCode = DEFAULT_STORE_CODE) {
  if (!isLive) return { ...snapshotMenu(storeCode), degraded: false }
  try {
    const [payload, nutritionTable] = await Promise.all([
      callTool('query-meals', { storeCode, orderType: 1, beType: 1 }),
      getNutritionTable()
    ])
    const items = normalizeLiveMenu(payload, nutritionTable)
    if (!items.length) throw new Error('实时菜单为空')
    await fillMissingNutrition(items, nutritionTable, storeCode)
    await fillComboDescriptions(items, storeCode)
    // 仍缺营养的少数商品（新品尝鲜 / 酱料 / 周边赠品）不做任何估算，UI 会显示「未收录」
    const store = getStore(storeCode)
    return {
      items,
      source: {
        provider: '麦当劳 MCP · query-meals + list-nutrition-foods + query-meal-detail',
        storeCode,
        storeName: store.name,
        address: store.address,
        nutritionCount: items.filter((item) => item.nutrition).length,
        fetchedAt: new Date().toISOString(),
        live: true
      },
      degraded: false
    }
  } catch (error) {
    return { ...snapshotMenu(storeCode), degraded: true, error: error.message }
  }
}

export async function fetchRawCoupons(storeCode) {
  if (!isLive) return { store: [], available: [], wallet: [], degraded: false }
  const [store, available, wallet] = await Promise.allSettled([
    callTool('query-store-coupons', { storeCode, orderType: 1, beType: 1 }),
    callToolText('available-coupons', {}),
    callToolText('query-my-coupons', {})
  ])
  const storeCoupons = store.status === 'fulfilled' && Array.isArray(store.value?.data) ? store.value.data : []
  return {
    store: storeCoupons,
    available: available.status === 'fulfilled' ? parseMarkdownCoupons(available.value) : [],
    wallet: wallet.status === 'fulfilled' ? parseMarkdownCoupons(wallet.value) : [],
    degraded: store.status !== 'fulfilled' && available.status !== 'fulfilled',
    error: store.status === 'rejected' ? store.reason?.message : undefined
  }
}

export async function fetchPrice(storeCode, lines) {
  if (!isLive) return null
  try {
    const payload = await callTool('calculate-price', {
      storeCode,
      orderType: 1,
      beType: 1,
      items: lines.map((line) => ({ productCode: line.code, quantity: line.qty }))
    })
    return {
      originalPrice: payload.data.originalPrice / 100,
      price: payload.data.price / 100,
      discount: payload.data.discount / 100,
      productList: payload.data.productList || []
    }
  } catch {
    return null
  }
}

const nearbyCache = new Map()

/**
 * 麦当劳 MCP 的门店检索：searchType=2 时按「城市 + 地标关键词」返回最近的 5 家门店，
 * distance 是 MCP 以该地标为基准算出的真实直线距离。
 */
export async function fetchNearbyStores(city, keyword) {
  if (!isLive || !city || !keyword) return []
  const cacheKey = `${city}|${keyword}`
  const cached = nearbyCache.get(cacheKey)
  if (cached && Date.now() - cached.at < 1000 * 60 * 10) return cached.data
  try {
    const payload = await callTool('query-nearby-stores', { beType: 1, searchType: 2, city, keyword })
    const list = Array.isArray(payload?.data) ? payload.data : []
    nearbyCache.set(cacheKey, { at: Date.now(), data: list })
    return list
  } catch {
    return []
  }
}

export function sourceInfo(storeCode = DEFAULT_STORE_CODE) {
  const store = getStore(storeCode)
  const view = storeView(store)
  return {
    mode: isLive ? 'live' : 'snapshot',
    label: isLive ? '麦当劳 MCP 实时数据' : '麦当劳 MCP 门店快照',
    store: {
      ...catalog.source,
      code: store.code,
      storeCode: store.code,
      name: store.name,
      storeName: store.name,
      address: store.address,
      priceFactor: store.priceFactor
    },
    stores: [view],
    note: isLive
      ? '菜单 / 价格 / 营养 / 可领券均按当前门店实时拉取'
      : `快照时间 ${catalog.source.fetchedAt}，菜单来自官方 MCP 真实返回${
          Math.abs(store.priceFactor - 1) > 0.0001
            ? `；本店无逐店快照，价格按系数 ×${store.priceFactor.toFixed(2)} 估算`
            : ''
        }`
  }
}
