/**
 * 券包里的每一张券都来自麦当劳 MCP 的真实返回，没有任何模拟券：
 * - query-store-coupons  该门店当前可用的专属券
 * - query-my-coupons     用户卡包里已经领到的券
 * - available-coupons    麦麦省当前可领的券
 *
 * 官方券只有三类：指定单品一口价 / 指定单品免费 / 任选 N 件一口价。
 * 这三类天然不可叠加，所以引擎按「品名匹配」把它们落在最贵的那件单品上算钱。
 */

/** 「19.9元王牌炸鸡任选2」券面没写清具体哪几款，按官方同类炸鸡小食匹配 */
const CHICKEN_SNACK_MATCH = '麦乐鸡|麦辣鸡翅|薄皮焦香V翅|薄皮V翅|那么大鸡排|蘸酱麦麦脆汁鸡|麦麦脆汁鸡|肉骨鸡'

/**
 * 券标题 → 引擎规则。
 * 麦当劳券面写的是俗称（「麦辣鸡腿堡」），菜单里的正式名是「麦辣鸡腿汉堡」，这里做一次对齐；
 * 对齐不上的券宁可不放进券包，也不假装它能用。
 */
const TITLE_TEMPLATES = [
  { test: /麦辣鸡腿/, coupon: { type: 'fixedPrice', match: '^麦辣鸡腿汉堡$' } },
  { test: /王牌炸鸡任选/, coupon: { type: 'bundlePrice', needQty: 2, category: 'snack', match: CHICKEN_SNACK_MATCH } },
  { test: /薯饼/, coupon: { type: 'freeItem', category: 'snack', match: '薯饼' } }
]

function describe(coupon, title) {
  if (coupon.type === 'fixedPrice') return `${title.replace(/^\d+(?:\.\d+)?元/, '')}一口价 ¥${coupon.price}`
  if (coupon.type === 'bundlePrice') return `炸鸡小食任选 ${coupon.needQty} 件 ¥${coupon.price}`
  if (coupon.type === 'freeItem') return `${title.replace(/^免费/, '')}免费 1 份`
  if (coupon.type === 'threshold') return `满 ¥${coupon.threshold} 减 ¥${coupon.reduce}`
  if (coupon.type === 'percent') return `全场 ${Math.round((1 - coupon.rate) * 10)} 折`
  return title
}

/** 把 MCP 返回的一条券面翻译成引擎能算的券，翻译不了返回 null */
function buildCoupon(raw, source) {
  const title = String(raw.title || raw.couponName || '').trim()
  if (!title) return null
  const image = raw.image || raw.imgUrl || raw.couponImg || ''
  const couponId = raw.couponId || raw.couponCode || `${source}:${title}`
  const base = { couponId, couponCode: couponId, title, source, image, expiry: raw.expiry || '', simulated: false }

  const template = TITLE_TEMPLATES.find((entry) => entry.test.test(title))
  if (template) {
    const coupon = { ...template.coupon }
    if (coupon.type !== 'freeItem') {
      const amount = title.match(/(\d+(?:\.\d+)?)\s*元/)
      if (!amount) return null
      coupon.price = Number(amount[1])
    }
    return { ...base, ...coupon, desc: describe(coupon, title) }
  }

  const threshold = title.match(/满\s*(\d+(?:\.\d+)?)\s*减\s*(\d+(?:\.\d+)?)/)
  if (threshold) {
    const coupon = { type: 'threshold', threshold: Number(threshold[1]), reduce: Number(threshold[2]) }
    return { ...base, ...coupon, desc: describe(coupon, title) }
  }
  const percent = title.match(/(\d(?:\.\d)?)\s*折/)
  if (percent) {
    const coupon = { type: 'percent', rate: 1 - Number(percent[1]) / 10 }
    return { ...base, ...coupon, desc: describe(coupon, title) }
  }
  return null
}

/**
 * 合并券包。同一个标题（比如卡包里两张不同有效期的「11.9元麦辣鸡腿堡」）只留一张，
 * 保留最先出现的那张——卡包顺序是按到期时间排的，越靠前越紧急。
 */
export function buildCoupons({ store = [], wallet = [], available = [] } = {}) {
  const coupons = []
  const seen = new Set()
  for (const group of [
    { source: '门店专属', raw: store },
    { source: '我的卡包', raw: wallet },
    { source: '麦麦省可领', raw: available }
  ]) {
    for (const raw of group.raw) {
      const coupon = buildCoupon(raw, group.source)
      if (!coupon || seen.has(coupon.title)) continue
      seen.add(coupon.title)
      coupons.push(coupon)
    }
  }
  return { coupons, realCount: coupons.length, simulated: false, simulatedCount: 0 }
}
