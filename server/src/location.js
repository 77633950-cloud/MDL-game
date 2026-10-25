import { findStore, getStore, registerStores, shortStoreName, STORES } from './data/stores.js'
import { fetchNearbyStores } from './mcp/client.js'

const AMAP_KEY = process.env.AMAP_MAPS_API_KEY || ''

export function haversine(lng1, lat1, lng2, lat2) {
  const rad = Math.PI / 180
  const R = 6371000
  const dLat = (lat2 - lat1) * rad
  const dLng = (lng2 - lng1) * rad
  const a =
    Math.sin(dLat / 2) ** 2 + Math.cos(lat1 * rad) * Math.cos(lat2 * rad) * Math.sin(dLng / 2) ** 2
  return 2 * R * Math.asin(Math.sqrt(a))
}

export function distanceText(meters) {
  if (!Number.isFinite(meters)) return '—'
  if (meters < 1000) return `${Math.max(1, Math.round(meters))}m`
  return `${(meters / 1000).toFixed(1)}km`
}

async function amapJson(url) {
  const response = await fetch(url, { signal: AbortSignal.timeout(6000) })
  if (!response.ok) throw new Error(`高德接口 ${response.status}`)
  return response.json()
}

let ipCache = new Map()

/**
 * 高德 IP 定位：ip 由前端上报（浏览器能拿到公网 IP，服务端出口 IP 往往是机房地址）。
 * 没有 GPS 权限时作为兜底，返回城市级矩形中心点（不是精确坐标，界面会标注）。
 */
export async function ipLocation(ip = '') {
  if (!AMAP_KEY) return null
  const cached = ipCache.get(ip)
  if (cached && Date.now() - cached.at < 1000 * 60 * 30) return cached.data
  try {
    const url = `https://restapi.amap.com/v3/ip?key=${AMAP_KEY}${ip ? `&ip=${encodeURIComponent(ip)}` : ''}`
    const data = await amapJson(url)
    if (data.status !== '1' || !data.rectangle) return null
    const [first, second] = String(data.rectangle).split(';')
    if (!first || !second) return null
    const [lng1, lat1] = first.split(',').map(Number)
    const [lng2, lat2] = second.split(',').map(Number)
    if (![lng1, lat1, lng2, lat2].every(Number.isFinite)) return null
    const located = {
      lng: (lng1 + lng2) / 2,
      lat: (lat1 + lat2) / 2,
      city: Array.isArray(data.city) ? '' : data.city,
      province: Array.isArray(data.province) ? '' : data.province,
      source: 'ip'
    }
    ipCache.set(ip, { at: Date.now(), data: located })
    return located
  } catch {
    return null
  }
}

const pickText = (value) => (Array.isArray(value) ? '' : typeof value === 'string' ? value : '')

let regeoCache = new Map()

/**
 * 高德逆地理编码：把定位点换算成「城市 + 最近地标 + 完整地址」。
 * 地标是后面传给麦当劳 MCP query-nearby-stores 的检索关键词，完整地址直接展示给用户。
 */
export async function amapRegeo(lng, lat) {
  if (!AMAP_KEY) return null
  const cacheKey = `${lng.toFixed(4)},${lat.toFixed(4)}`
  const cached = regeoCache.get(cacheKey)
  if (cached && Date.now() - cached.at < 1000 * 60 * 60) return cached.data
  try {
    const url = `https://restapi.amap.com/v3/geocode/regeo?key=${AMAP_KEY}&location=${lng},${lat}&extensions=all&radius=1500`
    const data = await amapJson(url)
    if (data.status !== '1' || !data.regeocode) return null
    const component = data.regeocode.addressComponent || {}
    const located = {
      city: pickText(component.city) || pickText(component.province),
      district: pickText(component.district),
      township: pickText(component.township),
      poi: data.regeocode.pois?.[0]?.name || '',
      address: data.regeocode.formatted_address || ''
    }
    regeoCache.set(cacheKey, { at: Date.now(), data: located })
    return located
  } catch {
    return null
  }
}

let placeCache = new Map()

/**
 * 高德地理编码：把门店名 / 门店地址换成真实经纬度。
 * 麦当劳 MCP 的门店检索只给「到地标的距离」，门店经纬度返回的是 0，所以这里补一次地理编码，
 * 才算得出「门店离用户本人到底多远」。
 * 先用 POI 检索（门店名），失败再用地址地理编码兜底；只到「城市 / 省」级的模糊结果会被丢弃，
 * 免得算出一个看起来精确、其实完全不对的距离。
 */
async function amapPoint(keyword, city, address) {
  if (!AMAP_KEY) return null
  const cacheKey = `${city}|${keyword}|${address || ''}`
  const cached = placeCache.get(cacheKey)
  if (cached && Date.now() - cached.at < 1000 * 60 * 60 * 24) return cached.data
  const attempts = []
  if (keyword) {
    attempts.push({
      url: `https://restapi.amap.com/v3/place/text?key=${AMAP_KEY}&keywords=${encodeURIComponent(
        keyword
      )}&city=${encodeURIComponent(city)}&offset=1&page=1&extensions=base`,
      pick: (data) => data.pois?.[0]?.location
    })
  }
  if (address) {
    attempts.push({
      url: `https://restapi.amap.com/v3/geocode/geo?key=${AMAP_KEY}&address=${encodeURIComponent(
        address
      )}&city=${encodeURIComponent(city)}`,
      pick: (data) => {
        const hit = data.geocodes?.[0]
        if (!hit) return ''
        // 只到城市 / 省级别的结果不能当作门店坐标
        if (['省', '城市'].includes(hit.level)) return ''
        return hit.location
      }
    })
  }
  for (const attempt of attempts) {
    try {
      const data = await amapJson(attempt.url)
      const location = data.status === '1' ? attempt.pick(data) : ''
      if (!location) continue
      const [lng, lat] = String(location).split(',').map(Number)
      if (!Number.isFinite(lng) || !Number.isFinite(lat)) continue
      const found = { lng, lat }
      placeCache.set(cacheKey, { at: Date.now(), data: found })
      return found
    } catch {
      /* 换下一种检索方式 */
    }
  }
  return null
}

/**
 * 把 MCP 返回的原始门店行转成界面用的结构，并把门店登记进运行时注册表。
 * 距离优先算「用户 → 门店」的真实直线距离（门店坐标来自高德 POI 检索）；
 * 补不到坐标时才退回展示「距地标 xxx」，绝不把地标距离说成离用户的距离。
 */
async function fromNearby(raw, reference, currentCode, origin) {
  const rows = raw.filter((row) => row?.storeCode)
  const stores = await Promise.all(
    rows.map(async (row) => {
      const known = findStore(row.storeCode)
      const landmarkDistance = Number(row.distance)
      let meters = Number.POSITIVE_INFINITY
      let distanceLabel = `距${reference.label} ${distanceText(landmarkDistance)}`
      let distanceSource = 'mcp-nearby'
      let point = null
      if (origin && Number.isFinite(origin.lng) && Number.isFinite(origin.lat)) {
        point = await amapPoint(row.storeName, reference.city, row.address)
        if (point) {
          meters = haversine(origin.lng, origin.lat, point.lng, point.lat)
          // IP 定位只到城市级中心点，加「约」字如实说明这不是精确到米的距离
          distanceLabel = `距你${origin.source === 'gps' ? '' : '约'} ${distanceText(meters)}`
          distanceSource = origin.source === 'gps' ? 'gps' : 'ip'
        }
      }
      return {
        code: row.storeCode,
        shortName: known?.shortName || `${shortStoreName(row.storeName)}店`,
        name: row.storeName,
        address: row.address,
        landmark: reference.label,
        lng: point?.lng,
        lat: point?.lat,
        distance: Number.isFinite(meters) ? Math.round(meters) : landmarkDistance,
        distanceLabel,
        distanceSource,
        openNow: Boolean(row.businessStatus),
        hours: row.businessStartTime && row.businessEndTime ? `${row.businessStartTime}-${row.businessEndTime}` : '',
        priceFactor: 1,
        current: row.storeCode === currentCode,
        priceNote: '门店实时价格'
      }
    })
  )
  registerStores(
    stores.map((store) => ({
      code: store.code,
      shortName: store.shortName,
      name: store.name,
      address: store.address,
      landmark: store.landmark,
      lng: store.lng,
      lat: store.lat,
      mcpDistance: store.distance,
      openNow: store.openNow,
      hours: store.hours,
      priceFactor: 1
    }))
  )
  return stores.sort((a, b) => a.distance - b.distance)
}

/** MCP 门店检索不可用时的兜底：用内置的 5 家门店 + 直线距离 */
function fromSeed(reference, currentCode, located) {
  const list = STORES.map((store) => {
    const view = {
      code: store.code,
      shortName: store.shortName,
      name: store.name,
      address: store.address,
      landmark: store.landmark,
      lng: store.lng,
      lat: store.lat,
      distance: store.mcpDistance,
      distanceLabel: `距${reference.label} ${distanceText(store.mcpDistance)}`,
      distanceSource: 'mcp',
      priceFactor: 1,
      current: store.code === currentCode,
      priceNote: '门店实时价格'
    }
    if (located) {
      const meters = haversine(located.lng, located.lat, store.lng, store.lat)
      view.distance = Math.round(meters)
      view.distanceLabel = `距你${located.source === 'gps' ? '' : '约'} ${distanceText(meters)}`
      view.distanceSource = located.source === 'gps' ? 'gps' : 'ip'
    }
    return view
  })
  return list.sort((a, b) => a.distance - b.distance)
}

/**
 * 定位链路：高德 IP / 浏览器 GPS 定位 → 高德逆地理取最近地标与地址 → 麦当劳 MCP query-nearby-stores 取最近门店。
 * 门店清单与营业信息一律来自 MCP；距离用高德把门店名编码回坐标后算「用户 → 门店」的真实直线距离。
 * reference 说明这次距离的计算基准，界面上会写明，避免看起来像凭空来的距离。
 */
export async function locateStores(origin, currentCode, searchKeyword = '', cityHint = '') {
  const current = getStore(currentCode).code
  const located = origin && Number.isFinite(origin.lng) && Number.isFinite(origin.lat) ? { ...origin } : null

  let reference = { city: '温州', keyword: '温州南站', label: '温州南站', source: 'default' }
  if (located) {
    const geo = await amapRegeo(located.lng, located.lat)
    const city = pickText(located.city).replace(/市$/, '') || pickText(geo?.city).replace(/市$/, '') || '温州'
    const keyword = geo?.poi || geo?.township || geo?.district || city
    reference = {
      city,
      keyword,
      label: geo?.poi || located.label || '你所在位置',
      address: geo?.address || '',
      source: located.source === 'gps' ? 'gps' : 'ip'
    }
    // 把判断出来的真实地址回填给 origin，界面直接展示用户所在位置
    located.city = city
    located.district = geo?.district || ''
    located.address = geo?.address || ''
    located.label = reference.label
  } else if (searchKeyword && cityHint) {
    // 没有坐标时照样能按关键词搜：用调用方给的所在城市，避免搜索被迫等一次定位
    reference = { city: cityHint.replace(/市$/, ''), keyword: searchKeyword, label: searchKeyword, source: 'search' }
  }

  // 用户主动搜索门店时，用搜索词代替「最近地标」作为 MCP 的检索关键词
  const nearby = await fetchNearbyStores(
    reference.city,
    searchKeyword ? searchKeyword : reference.keyword
  )
  if (nearby.length) {
    return { stores: await fromNearby(nearby, reference, current, located), reference, origin: located, mode: 'mcp-nearby' }
  }
  return { stores: fromSeed(reference, current, located), reference, origin: located, mode: 'seed' }
}
