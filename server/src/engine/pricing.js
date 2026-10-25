export const round2 = (n) => Math.round((n + Number.EPSILON) * 100) / 100
export const round1 = (n) => Math.round((n + Number.EPSILON) * 10) / 10

export function buildLines(selection, itemsById) {
  const lines = []
  for (const pick of selection) {
    const item = itemsById[pick.code]
    if (!item) continue
    const qty = Math.max(1, Math.min(20, Number(pick.qty) || 1))
    lines.push({
      ...item,
      code: item.code,
      name: item.name,
      category: item.category,
      protein: item.protein,
      price: item.price,
      qty,
      subtotal: round2(item.price * qty),
      image: item.image,
      soldOut: Boolean(item.soldOut),
      nutrition: item.nutrition || null,
      contents: item.contents || null
    })
  }
  return lines
}

export function summarize(lines) {
  const subtotal = round2(lines.reduce((s, l) => s + l.subtotal, 0))
  const itemCount = lines.reduce((s, l) => s + l.qty, 0)
  const categoryCounts = {}
  const proteinSet = new Set()
  for (const line of lines) {
    categoryCounts[line.category] = (categoryCounts[line.category] || 0) + line.qty
    // 套餐里的主食 / 小食 / 饮品 / 甜品同样计入关卡品类
    for (const part of line.contents || []) {
      categoryCounts[part.category] = (categoryCounts[part.category] || 0) + part.qty * line.qty
      if (part.protein && part.protein !== 'none' && part.protein !== 'mixed') proteinSet.add(part.protein)
    }
    if (line.protein && line.protein !== 'none' && line.protein !== 'mixed') proteinSet.add(line.protein)
  }
  return { subtotal, itemCount, categoryCounts, proteins: [...proteinSet] }
}

const ITEM_COUPON_TYPES = new Set(['fixedPrice', 'freeItem', 'bundlePrice'])

function matcher(coupon) {
  let regex = null
  if (coupon.match) {
    try {
      regex = new RegExp(coupon.match)
    } catch {
      regex = null
    }
  }
  return (line) => {
    if (coupon.code && line.code === String(coupon.code)) return true
    if (!regex) return false
    if (coupon.category && line.category !== coupon.category) return false
    if (coupon.protein && line.protein !== coupon.protein) return false
    return regex.test(line.name)
  }
}

/** 判断某条结流行是否命中这张券，券引擎和求解器共用同一套匹配规则 */
export function matchesCoupon(coupon, line) {
  return matcher(coupon)(line)
}

function unitPrices(lines, coupon) {
  const test = matcher(coupon)
  const prices = []
  for (const line of lines || []) {
    if (!test(line)) continue
    for (let i = 0; i < line.qty; i += 1) prices.push(line.price)
  }
  return prices.sort((a, b) => b - a)
}

/**
 * 优惠券叠算：
 * 1. 单品券（一口价 / 免费 / 任选 N 件价）先按单品原价抵扣
 * 2. 满减券按减免金额从大到小，在剩余金额上逐张校验门槛
 * 3. 折扣券最后生效
 */
export function applyCoupons(subtotal, coupons = [], lines = []) {
  let running = subtotal
  const applied = []
  const skipped = []

  const itemCoupons = coupons.filter((c) => ITEM_COUPON_TYPES.has(c.type))
  for (const coupon of itemCoupons) {
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
      const picked = prices.slice(0, need).reduce((s, p) => s + p, 0)
      saved = Math.max(0, picked - coupon.price)
    }
    saved = round2(Math.min(saved, running))
    if (saved <= 0) {
      skipped.push({ ...coupon, reason: '当前搭配无法再优惠' })
      continue
    }
    running = round2(running - saved)
    applied.push({ ...coupon, saved })
  }

  const thresholds = coupons
    .filter((c) => c.type === 'threshold')
    .sort((a, b) => (b.reduce || 0) - (a.reduce || 0))
  for (const coupon of thresholds) {
    if (running >= coupon.threshold) {
      running = round2(running - coupon.reduce)
      applied.push({ ...coupon, saved: coupon.reduce })
    } else {
      skipped.push({ ...coupon, reason: `差 ¥${round2(coupon.threshold - running)} 可用`, gap: round2(coupon.threshold - running) })
    }
  }

  const percents = coupons
    .filter((c) => c.type === 'percent')
    .sort((a, b) => (b.rate || 0) - (a.rate || 0))
  for (const coupon of percents) {
    const saved = round2(running * coupon.rate)
    if (saved <= 0) {
      skipped.push({ ...coupon, reason: '当前金额无可优惠部分' })
      continue
    }
    running = round2(running - saved)
    applied.push({ ...coupon, saved })
  }

  const paid = Math.max(0, round2(running))
  return { paid, applied, skipped, discount: round2(subtotal - paid) }
}

export function couponHint(coupon) {
  if (coupon.desc) return coupon.desc
  if (coupon.type === 'threshold') return `满 ${coupon.threshold} 减 ${coupon.reduce}`
  if (coupon.type === 'percent') return `全场 ${Math.round((1 - coupon.rate) * 10)} 折`
  if (coupon.type === 'fixedPrice') return `指定单品 ¥${coupon.price}`
  if (coupon.type === 'freeItem') return '指定单品免费'
  if (coupon.type === 'bundlePrice') return `任选 ${coupon.needQty || 2} 件 ¥${coupon.price}`
  return coupon.title || ''
}

export function nutritionSummary(lines) {
  const totals = { kcal: 0, protein: 0, fat: 0, carb: 0, sodium: 0 }
  let covered = 0
  const missing = []
  for (const line of lines) {
    if (!line.nutrition) {
      missing.push(line.name)
      continue
    }
    covered += line.qty
    for (const key of Object.keys(totals)) totals[key] += (line.nutrition[key] || 0) * line.qty
  }
  for (const key of Object.keys(totals)) totals[key] = Math.round(totals[key] * 10) / 10
  return { totals, covered, missing: [...new Set(missing)] }
}
