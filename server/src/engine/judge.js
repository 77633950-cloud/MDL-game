import { applyCoupons, buildLines, nutritionSummary, round1, round2, summarize } from './pricing.js'
import { CATEGORY_LABELS, REWARD_BY_STARS } from '../levels.js'
import { evaluateChallenge } from '../../../shared/challenges.js'

export function judge({ level, selection, itemsById, coupons = [], session = null, thresholds, optimal = null, assignments = [] }) {
  const lines = buildLines(selection, itemsById)
  const sum = summarize(lines)
  const nutrition = nutritionSummary(lines)
  const couponResult = applyCoupons(sum.subtotal, coupons, lines)
  if (level.track !== 'saving') {
    const challenge = evaluateChallenge({ ...level, challengeThresholds: thresholds }, lines, couponResult.paid, assignments)
    const reward = REWARD_BY_STARS[challenge.stars] || 0
    const failed = [...challenge.checks, ...challenge.extras].filter((item) => item.available !== false && !item.advisory && !item.ok)
    const suggestions = failed.map((item) => `${item.label}${item.detail ? `：${item.detail}` : ''}`)
    const isPrice = level.objective === 'price' || level.objective === 'pricePerPerson'
    const scoreValue = isPrice ? couponResult.paid : challenge.score
    const scoreNote = [
      level.objectiveText,
      isPrice ? `实付 ¥${couponResult.paid}` : (challenge.score === null ? '暂无可比核心分' : `核心分 ${challenge.score}`)
    ].filter(Boolean).join(' · ')
    return {
      levelId: level.id, passed: challenge.passed, stars: challenge.stars, revived: false,
      subtotal: sum.subtotal, paid: couponResult.paid, discount: couponResult.discount,
      discountRate: sum.subtotal > 0 ? Math.round((couponResult.discount / sum.subtotal) * 1000) / 1000 : 0,
      itemCount: sum.itemCount, categoryCounts: sum.categoryCounts, proteins: sum.proteins,
      lines, nutrition: nutrition.totals, nutritionCovered: nutrition.covered,
      coupons: { applied: couponResult.applied, skipped: couponResult.skipped },
      checks: challenge.checks, extras: challenge.extras, metrics: challenge.metrics,
      unavailable: challenge.unavailable, available: challenge.available,
      scores: { challenge: { label: '赛道评分', value: scoreValue, max: null, note: scoreNote } },
      target: thresholds || null, optimal: null, reward, suggestions
    }
  }
  const rules = level.rules || {}
  const target = thresholds || level.base
  const checks = []

  const soldOutLines = lines.filter((l) => l.soldOut)
  checks.push({
    key: 'available',
    label: '门店在售',
    ok: lines.length > 0 && soldOutLines.length === 0,
    detail: lines.length === 0 ? '还没有选任何单品' : soldOutLines.length ? `售罄：${soldOutLines.map((l) => l.name).join('、')}` : '全部在售'
  })

  for (const [category, qty] of Object.entries(rules.minQty || {})) {
    const have = sum.categoryCounts[category] || 0
    checks.push({
      key: `cat-${category}`,
      label: `至少 ${qty} 份${CATEGORY_LABELS[category] || category}`,
      ok: have >= qty,
      detail: `已选 ${have} / ${qty}`
    })
  }

  if (rules.maxSameItem) {
    const over = lines.find((l) => l.qty > rules.maxSameItem)
    checks.push({
      key: 'max-same',
      label: `同一单品最多 ${rules.maxSameItem} 份`,
      ok: !over,
      detail: over ? `${over.name} 选了 ${over.qty} 份` : '符合'
    })
  }

  if (rules.onlyProtein) {
    const bad = lines.filter((l) => !rules.onlyProtein.includes(l.protein))
    checks.push({
      key: 'protein',
      label: '全部为鸡肉单品',
      ok: lines.length > 0 && bad.length === 0,
      detail: bad.length ? `不符合：${bad.map((l) => l.name).join('、')}` : '全部含鸡肉'
    })
  }

  if (rules.minItems) {
    checks.push({
      key: 'item-count',
      label: `单品数量 ≥ ${rules.minItems} 件`,
      ok: sum.itemCount >= rules.minItems,
      detail: `已选 ${sum.itemCount} 件`
    })
  }

  if (rules.couponMinCount) {
    checks.push({
      key: 'coupon-count',
      label: `至少叠加 ${rules.couponMinCount} 张优惠券`,
      ok: couponResult.applied.length >= rules.couponMinCount,
      detail: `已生效 ${couponResult.applied.length} 张`
    })
  }

  const discountRate = sum.subtotal > 0 ? couponResult.discount / sum.subtotal : 0
  const paid = couponResult.paid

  const extras = (level.star3Extra || []).map((extra) => {
    let ok = false
    let detail = ''
    if (extra.type === 'category') {
      const have = sum.categoryCounts[extra.category] || 0
      ok = have >= extra.qty
      detail = `已选 ${have} / ${extra.qty}`
    } else if (extra.type === 'proteinCoverage') {
      const proteinPool = new Set()
      for (const line of lines) {
        for (const part of [line, ...(line.contents || [])]) {
          if (!part.protein || part.protein === 'none' || part.protein === 'mixed') continue
          if (extra.mainOnly && part.category !== 'burger' && part.category !== 'combo') continue
          proteinPool.add(part.protein)
        }
      }
      const missing = extra.proteins.filter((p) => !proteinPool.has(p))
      ok = missing.length === 0
      detail = missing.length ? `缺少 ${missing.map(proteinLabel).join('、')}` : '已覆盖'
    } else if (extra.type === 'itemCount') {
      ok = sum.itemCount >= extra.min
      detail = `已选 ${sum.itemCount} / ${extra.min} 件`
    } else if (extra.type === 'comboCount') {
      const combos = lines.filter((line) => line.category === 'combo').reduce((total, line) => total + line.qty, 0)
      ok = combos >= extra.min
      detail = `已用 ${combos} / ${extra.min} 个套餐`
    } else if (extra.type === 'couponCount') {
      ok = couponResult.applied.length >= extra.min
      detail = `已叠加 ${couponResult.applied.length} / ${extra.min} 张`
    }
    return { label: extra.label, ok, detail }
  })

  const budget = {
    // 3 星线 = 本店前五套答案里的最高价，2 星线 = 3 星线 × 1.25
    star3: paid <= target.star3,
    star2: paid <= target.star2,
    gap: round2(Math.max(0, paid - target.star2))
  }

  const hardOk = checks.every((check) => check.ok)
  const extraFails = extras.filter((extra) => !extra.ok).length
  // 价格罚分：进前五套 0 罚；比 3 星线高但在 2 星线内 1 罚；连 2 星线都够不到就是「价格实在相差太大」2 罚
  const pricePenalty = paid <= target.star3 ? 0 : paid <= target.star2 ? 1 : 2

  let stars = 0
  if (hardOk && sum.subtotal > 0) {
    // 每个罚分掉一颗星：0 罚 3 星 / 1 罚 2 星 / 2 罚及以上 1 星
    const penalty = pricePenalty + extraFails
    stars = penalty === 0 ? 3 : penalty === 1 ? 2 : 1
  }

  let revived = false
  if (stars === 0 && session?.revive) {
    stars = 1
    revived = true
  }

  const scores = {
    price: priceScore({ target, paid, optimal }),
    nutrition: nutritionScore({
      nutrition: nutrition.totals,
      covered: nutrition.covered,
      itemCount: sum.itemCount,
      missing: nutrition.missing
    }),
    compliance: complianceScore({ checks, extras, revived, pricePenalty })
  }

  const baseReward = REWARD_BY_STARS[stars] || 0
  const reward = session?.event?.id === 'points_double' ? baseReward * 2 : baseReward

  const suggestions = []
  if (stars === 0) {
    for (const check of checks) {
      if (check.ok) continue
      if (check.key.startsWith('cat-')) {
        const cat = check.key.slice(4)
        suggestions.push(`还差 ${CATEGORY_LABELS[cat] || cat}，去「${CATEGORY_LABELS[cat] || cat}」分类里补最便宜的一款。`)
      } else if (check.key === 'max-same') {
        suggestions.push(`同一单品最多 ${rules.maxSameItem} 份，把多出来的换成第二便宜的单品。`)
      } else if (check.key === 'protein') {
        suggestions.push('全鸡宴只认鸡肉：汉堡、鸡块、鸡翅可以，牛肉和鳕鱼不行。')
      } else if (check.key === 'item-count') {
        suggestions.push('件数不够：加最便宜的蘸酱炸鸡或苹果片凑数。')
      } else if (check.key === 'coupon-count') {
        suggestions.push('券没用上：挑餐盘里对得上的单品，把券勾上。')
      }
    }
    if (optimal != null) suggestions.push(`本店理论最低可做到 ¥${optimal}，可以再压一压。`)
  } else if (stars < 3) {
    if (!budget.star3) suggestions.push(`想拿三星，实付还要再压 ¥${round2(paid - target.star3)}（三星线 ¥${target.star3}）。`)
    for (const extra of extras) if (!extra.ok) suggestions.push(`隐藏条件「${extra.label}」还没达成。`)
  }

  return {
    levelId: level.id,
    passed: stars > 0,
    stars,
    revived,
    subtotal: sum.subtotal,
    paid,
    discount: couponResult.discount,
    discountRate: Math.round(discountRate * 1000) / 1000,
    itemCount: sum.itemCount,
    categoryCounts: sum.categoryCounts,
    proteins: sum.proteins,
    lines,
    nutrition: nutrition.totals,
    nutritionCovered: nutrition.covered,
    coupons: { applied: couponResult.applied, skipped: couponResult.skipped },
    checks,
    extras,
    budget,
    scores,
    target,
    optimal,
    reward,
    suggestions
  }
}

function clampScore(value) {
  return Math.max(0, Math.min(10, value))
}

function roundScore(value) {
  return Math.round(clampScore(value) * 10) / 10
}

function priceScore({ target, paid, optimal }) {
  const floor = optimal ?? target.star3
  const { star2, star3 } = target
  let value
  if (paid <= floor) value = 10
  else if (paid <= star3) value = 10 - 2 * ((paid - floor) / (star3 - floor || 1))
  else if (paid <= star2) value = 8 - 2 * ((paid - star3) / (star2 - star3 || 1))
  else value = Math.max(0, 6 * (star2 / paid))

  const note =
    paid <= star3
      ? `实付 ¥${paid} · 已进本店前五套（三星线 ¥${round1(star3)}）`
      : paid <= star2
        ? `实付 ¥${paid} · 超出三星线 ¥${round2(paid - star3)}`
        : `实付 ¥${paid} · 超出二星线 ¥${round2(paid - star2)}`
  return { label: '总价', value: roundScore(value), note }
}

function nutritionScore({ nutrition, covered, itemCount, missing = [] }) {
  const coverage = itemCount > 0 ? Math.min(1, covered / itemCount) : 0
  const kcal = nutrition.kcal || 0
  const protein = nutrition.protein || 0
  const fat = nutrition.fat || 0
  const sodium = nutrition.sodium || 0

  let raw = 5
  if (kcal > 0) {
    const proteinDensity = (protein / kcal) * 100
    const fatDensity = (fat / kcal) * 100
    const sodiumDensity = (sodium / kcal) * 1000
    raw = 0
    raw += Math.min(1, proteinDensity / 6) * 4
    raw += Math.min(1, Math.max(0, (7 - fatDensity) / 4)) * 3
    raw += Math.min(1, Math.max(0, (4000 - sodiumDensity) / 2000)) * 3
  }

  // 营养数据缺失的部分按中性 5 分计，避免套餐无数据时直接判 0 分
  const value = raw * coverage + 5 * (1 - coverage)
  const baseNote =
    covered > 0
      ? `已收录 ${covered}/${itemCount} 件 · 蛋白质 ${protein}g · 热量 ${kcal}kcal · 钠 ${sodium}mg`
      : '本单营养数据未收录，按中性分计'
  const missingNote = missing.length
    ? ` · 未收录：${missing.slice(0, 3).join('、')}${missing.length > 3 ? ' 等' : ''}`
    : ''
  return { label: '营养值', value: roundScore(value), note: baseNote + missingNote }
}

function complianceScore({ checks, extras, revived, pricePenalty }) {
  const parts = [
    ...checks.map((check) => ({ ok: check.ok, weight: 1.5 })),
    ...[0, 1, 2].map((step) => ({ ok: pricePenalty <= step, weight: 1 })),
    ...extras.map((extra) => ({ ok: extra.ok, weight: 1 }))
  ]
  const total = parts.reduce((sum, part) => sum + part.weight, 0)
  const got = parts.reduce((sum, part) => sum + (part.ok ? part.weight : 0), 0)
  let value = total > 0 ? (10 * got) / total : 10
  if (revived) value = Math.min(value, 5)

  const hardOk = checks.filter((check) => check.ok).length
  const extraOk = extras.filter((extra) => extra.ok).length
  const noteParts = [`硬约束 ${hardOk}/${checks.length}`]
  noteParts.push(pricePenalty === 0 ? '实付进前五套' : `实付超出三星线 ${pricePenalty} 档`)
  if (extras.length) noteParts.push(`隐藏 ${extraOk}/${extras.length}`)
  return { label: '合规性', value: roundScore(value), note: noteParts.join(' · ') }
}

function proteinLabel(p) {
  return { chicken: '鸡肉', beef: '牛肉', fish: '鱼肉' }[p] || p
}
