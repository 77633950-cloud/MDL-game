export const DEFAULT_STORE_CODE = process.env.MCD_STORE_CODE || '3330439'

/**
 * 温州 5 家真实门店：
 * - 门店号 / 名称 / 地址 / mcpDistance 来自麦当劳 MCP query-nearby-stores（city=温州）
 * - lng / lat 来自高德 MCP maps_geo（温州南站店用 maps_search_detail 精确到出站口）
 * 菜单与价格均按门店实时拉取，不再做价差系数估算。
 */
export const STORES = [
  {
    code: '3330439',
    shortName: '温州南站店',
    name: '麦当劳温州火车南站到达层餐厅',
    address: '温州南站1层',
    landmark: '温州南站 · 到达层',
    mcpDistance: 86,
    priceFactor: 1
  },
  {
    code: '3330198',
    shortName: '温州大象城店',
    name: '麦当劳温州大象城餐厅',
    address: '潘桥街道宁波路2889号大象城商贸中心',
    landmark: '大象城商贸中心',
    mcpDistance: 683,
    priceFactor: 1
  },
  {
    code: '3330138',
    shortName: '大西洋银泰城店',
    name: '麦当劳温州大西洋银泰城餐厅',
    address: '娄桥街道瓯海大道1299号',
    landmark: '大西洋银泰城',
    mcpDistance: 1789,
    priceFactor: 1
  },
  {
    code: '3330385',
    shortName: '盛宏锦园店',
    name: '麦当劳温州盛宏锦园餐厅',
    address: '娄桥街道平天路187号盛宏锦园3幢102室',
    landmark: '盛宏锦园',
    mcpDistance: 2971,
    priceFactor: 1
  },
  {
    code: '3330556',
    shortName: '亚运汽车公园店',
    name: '麦当劳温州亚运汽车公园餐厅',
    address: '娄桥街道瓯海大道997号',
    landmark: '亚运汽车公园',
    mcpDistance: 3004,
    priceFactor: 1
  }
]

/** 运行时发现的门店（来自麦当劳 MCP query-nearby-stores），进程内缓存 */
const runtime = new Map()

export function shortStoreName(name = '') {
  return String(name)
    .replace(/^麦当劳/, '')
    .replace(/餐厅$/, '')
    .replace(/^温州/, '')
    .replace(/^市/, '') || String(name)
}

export function registerStores(list = []) {
  for (const store of list) {
    if (!store?.code) continue
    runtime.set(store.code, { ...(runtime.get(store.code) || {}), ...store })
  }
}

export function findStore(code) {
  return STORES.find((store) => store.code === code) || runtime.get(code) || null
}

export function getStore(code) {
  return findStore(code) || STORES.find((store) => store.code === DEFAULT_STORE_CODE) || STORES[0]
}

export function storeView(store) {
  return {
    code: store.code,
    shortName: store.shortName,
    name: store.name,
    address: store.address,
    landmark: store.landmark,
    lng: store.lng,
    lat: store.lat,
    distance: store.mcpDistance,
    openNow: store.openNow,
    hours: store.hours,
    priceFactor: store.priceFactor,
    priceNote: '门店实时价格'
  }
}

export function storePrice(price, factor) {
  if (!Number.isFinite(price)) return price
  if (Math.abs(factor - 1) < 0.0001) return price
  return Math.round(price * factor * 10) / 10
}
