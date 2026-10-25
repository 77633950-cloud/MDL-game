import { applyCoupons, matchesCoupon, round1, buildLines } from './pricing.js'
import { evaluateChallenge, expandChallengeLines, challengePeople } from '../../../shared/challenges.js'

const byPrice = (a, b) => a.price - b.price

function addPick(picks, code, qty = 1) {
  picks[code] = (picks[code] || 0) + qty
}

function planKey(picks) {
  return Object.entries(picks)
    .sort((a, b) => a[0].localeCompare(b[0]))
    .map(([code, qty]) => `${code}x${qty}`)
    .join(',')
}

function cheapestUnits(pool, count, maxSame = Infinity) {
  if (count <= 0) return { cost: 0, picks: {} }
  if (!pool.length) return null
  let left = count
  let cost = 0
  const picks = {}
  for (const item of [...pool].sort(byPrice)) {
    const take = Math.min(maxSame, left)
    if (take <= 0) continue
    cost += take * item.price
    left -= take
    addPick(picks, item.code, take)
    if (left <= 0) break
  }
  return left > 0 ? null : { cost: round1(cost), picks }
}

function buildRequirements(level, includeExtras) {
  const rules = level.rules || {}
  const required = { ...(rules.minQty || {}) }
  let minItems = rules.minItems || 0
  let proteins = []
  let proteinMainOnly = false
  let minCombos = 0
  if (includeExtras) {
    for (const extra of level.star3Extra || []) {
      if (extra.type === 'category') required[extra.category] = (required[extra.category] || 0) + extra.qty
      if (extra.type === 'itemCount') minItems = Math.max(minItems, extra.min)
      if (extra.type === 'comboCount') minCombos = Math.max(minCombos, extra.min)
      if (extra.type === 'proteinCoverage') {
        proteins = extra.proteins
        proteinMainOnly = Boolean(extra.mainOnly)
      }
    }
  }
  return {
    required,
    minItems,
    proteins,
    proteinMainOnly,
    minCombos,
    onlyProtein: rules.onlyProtein || null,
    maxSame: rules.maxSameItem || Infinity
  }
}

function enumerateComboSets(combos, maxSame, maxSize = 3) {
  const sets = [[]]
  const walk = (start, picked) => {
    if (picked.length >= maxSize) return
    for (let i = start; i < combos.length; i += 1) {
      const item = combos[i]
      const used = picked.filter((p) => p.code === item.code).length
      if (used >= maxSame) continue
      const next = [...picked, item]
      sets.push(next)
      walk(i, next)
    }
  }
  walk(0, [])
  return sets
}

function buildPools(items) {
  const singles = items
    .filter((i) => i.price != null && !i.soldOut && i.category !== 'combo')
    .sort(byPrice)
  const byCategory = {}
  const byProtein = {}
  for (const item of singles) {
    ;(byCategory[item.category] ||= []).push(item)
    ;(byProtein[item.protein] ||= []).push(item)
  }
  return { singles, byCategory, byProtein }
}

function estimateSet(req, set, pools) {
  if (set.length < req.minCombos) return null
  const covered = {}
  const proteins = new Set()
  const picks = {}
  let total = 0
  let count = 0

  for (const combo of set) {
    total += combo.price
    count += 1
    addPick(picks, combo.code)
    for (const part of combo.contents || []) {
      covered[part.category] = (covered[part.category] || 0) + part.qty
      if (part.protein && part.protein !== 'none' && part.protein !== 'mixed') {
        proteins.add(part.protein)
      }
    }
    if (combo.protein && combo.protein !== 'none' && combo.protein !== 'mixed') proteins.add(combo.protein)
  }

  // 先补齐肉类覆盖，选对应肉类里最便宜的单品
  for (const protein of req.proteins) {
    if (proteins.has(protein)) continue
    const candidates = (pools.byProtein[protein] || []).filter(
      (item) => !req.proteinMainOnly || item.category === 'burger'
    )
    const pick = candidates[0]
    if (!pick) return null
    total += pick.price
    count += 1
    addPick(picks, pick.code)
    covered[pick.category] = (covered[pick.category] || 0) + 1
  }

  for (const [category, qty] of Object.entries(req.required)) {
    const need = qty - (covered[category] || 0)
    if (need <= 0) continue
    const fill = cheapestUnits(pools.byCategory[category] || [], need, req.maxSame)
    if (!fill) return null
    total += fill.cost
    count += need
    for (const [code, qtyPart] of Object.entries(fill.picks)) addPick(picks, code, qtyPart)
  }

  if (count < req.minItems) {
    const fill = cheapestUnits(pools.singles, req.minItems - count, req.maxSame)
    if (!fill) return null
    total += fill.cost
    for (const [code, qtyPart] of Object.entries(fill.picks)) addPick(picks, code, qtyPart)
  }

  return { cost: round1(total), picks }
}

function planSatisfies(picks, map, req) {
  let count = 0
  let comboCount = 0
  const categoryCounts = {}
  const proteins = new Set()
  for (const [code, qty] of Object.entries(picks)) {
    const item = map.get(code)
    if (!item) return false
    if (req.onlyProtein && !req.onlyProtein.includes(item.protein)) return false
    if (qty > req.maxSame) return false
    if (item.category === 'combo') comboCount += qty
    categoryCounts[item.category] = (categoryCounts[item.category] || 0) + qty
    for (const part of item.contents || []) {
      categoryCounts[part.category] = (categoryCounts[part.category] || 0) + part.qty * qty
      if (part.protein && part.protein !== 'none' && part.protein !== 'mixed') {
        if (!req.proteinMainOnly || part.category === 'burger') proteins.add(part.protein)
      }
    }
    count += qty
    if (item.protein && item.protein !== 'none' && item.protein !== 'mixed') {
      if (!req.proteinMainOnly || item.category === 'burger' || item.category === 'combo') proteins.add(item.protein)
    }
  }
  for (const [category, qty] of Object.entries(req.required)) {
    if ((categoryCounts[category] || 0) < qty) return false
  }
  if (req.minItems && count < req.minItems) return false
  if (req.minCombos && comboCount < req.minCombos) return false
  for (const protein of req.proteins) if (!proteins.has(protein)) return false
  return true
}

function createCollector(limit, { distinctCost = false } = {}) {
  const best = []
  const seen = new Set()
  return {
    get worst() {
      return best.length >= limit ? best[best.length - 1].cost : Infinity
    },
    add(plan) {
      if (!plan) return
      const key = planKey(plan.picks)
      if (seen.has(key)) return
      if (best.length >= limit && plan.cost >= best[best.length - 1].cost) return
      // 五个答案取五个不同价位，避免“换个圆筒口味”这种同价凑数
      if (distinctCost && best.some((item) => Math.abs(item.cost - plan.cost) < 0.05)) return
      seen.add(key)
      if (best.length < limit) {
        best.push(plan)
        best.sort((a, b) => a.cost - b.cost)
      } else {
        best[best.length - 1] = plan
        best.sort((a, b) => a.cost - b.cost)
      }
    },
    results() {
      return best.slice().sort((a, b) => a.cost - b.cost)
    }
  }
}

/**
 * 枚举“只靠单品”的前若干套方案，用于全鸡宴这类 onlyProtein 关卡。
 * 组合数被限制在最便宜的 9 个单品内，足够覆盖前 5 套答案。
 */
function enumerateSinglePlans(items, req, limit, distinctCost = false) {
  const source = items.filter(
    (item) => item.price != null && !item.soldOut && (!req.onlyProtein || req.onlyProtein.includes(item.protein))
  )
  const pool = source.sort(byPrice).slice(0, 9)
  const map = new Map(pool.map((item) => [item.code, item]))
  const target = Math.max(req.minItems || 0, Object.values(req.required).reduce((a, b) => a + b, 0), 1)
  const maxCount = target + 2
  const collector = createCollector(limit, { distinctCost })
  const picks = {}

  const walk = (index, count, cost) => {
    if (count >= (req.minItems || 0) && planSatisfies(picks, map, req)) {
      collector.add({ cost: round1(cost), picks: { ...picks } })
    }
    if (index >= pool.length || count >= maxCount) return
    const item = pool[index]
    const maxQty = Math.min(req.maxSame, maxCount - count)
    for (let qty = 0; qty <= maxQty; qty += 1) {
      if (qty > 0) picks[item.code] = qty
      else delete picks[item.code]
      walk(index + 1, count + qty, cost + item.price * qty)
    }
    delete picks[item.code]
  }
  walk(0, 0, 0)
  return collector.results()
}

/**
 * 枚举组合方案：套餐集合 + 单点补齐，再给每套方案加 1 件最便宜单品制造
 * “并列答案”。这样能覆盖“套餐 + 便宜甜品/小食”这类真实点法。
 */
function enumerateComboPlans(items, req, limit, distinctCost = false) {
  const usable = items.filter((item) => item.price != null && !item.soldOut)
  const combos = usable
    .filter((item) => item.category === 'combo' && item.price <= 40)
    .sort(byPrice)
  const pools = buildPools(usable)
  const map = new Map(usable.map((item) => [item.code, item]))
  const cheapAddons = usable
    .filter((item) => item.category !== 'combo' && item.category !== 'sauce' && item.price <= 20)
    .sort(byPrice)
    .slice(0, 5)
  const collector = createCollector(limit, { distinctCost })

  for (const set of enumerateComboSets(combos, req.maxSame)) {
    const setCost = set.reduce((sum, combo) => sum + combo.price, 0)
    if (setCost >= collector.worst) continue
    const plan = estimateSet(req, set, pools)
    if (!plan) continue
    collector.add(plan)
    if (plan.cost >= collector.worst) continue

    for (const addon of cheapAddons) {
      if (plan.cost + addon.price >= collector.worst) continue
      const qty = plan.picks[addon.code] || 0
      if (qty >= req.maxSame) continue
      const picks = { ...plan.picks }
      addPick(picks, addon.code)
      if (planSatisfies(picks, map, req)) {
        collector.add({ cost: round1(plan.cost + addon.price), picks })
      }
    }
  }

  // 用最便宜的同品类单品替换其中一件，制造“换一款主食/小食”的并列答案
  const seeded = createCollector(limit, { distinctCost })
  for (const plan of collector.results()) {
    seeded.add(plan)
    for (const [code, qty] of Object.entries(plan.picks)) {
      const picked = map.get(code)
      if (!picked || picked.category === 'combo' || qty <= 0) continue
      const alternatives = (pools.byCategory[picked.category] || []).slice(0, 4)
      for (const alt of alternatives) {
        if (alt.code === code) continue
        if ((plan.picks[alt.code] || 0) >= req.maxSame) continue
        const cost = round1(plan.cost - picked.price + alt.price)
        if (cost >= seeded.worst) continue
        const picks = { ...plan.picks }
        picks[code] -= 1
        if (picks[code] <= 0) delete picks[code]
        addPick(picks, alt.code)
        if (planSatisfies(picks, map, req)) seeded.add({ cost, picks })
      }
    }
  }
  return seeded.results()
}

/**
 * 枚举本身只会用「最便宜的单品」去补品类，所以券里的指定商品（比如一口价麦辣鸡腿堡）
 * 永远不会出现在候选里。这里拿已有的便宜方案做几种变形，把券匹配的单品换进去或加进去，
 * 让「用券后的真实最低价」也能成为答案之一。
 */
function couponVariants(plan, items, coupons, req, map) {
  const variants = []
  const targetGroups = coupons
    .map((coupon) => items.filter((item) => matchesCoupon(coupon, item)).sort(byPrice))
    .filter((group) => group.length)
  for (const targets of targetGroups) {
    for (const [code, qty] of Object.entries(plan.picks)) {
      const picked = map.get(code)
      if (!picked || picked.category === 'combo') continue
      for (const target of targets) {
        if (target.category !== picked.category || target.code === code) continue
        if ((plan.picks[target.code] || 0) >= req.maxSame) continue
        const picks = { ...plan.picks }
        picks[code] -= 1
        if (picks[code] <= 0) delete picks[code]
        addPick(picks, target.code)
        if (planSatisfies(picks, map, req)) {
          variants.push({ cost: round1(plan.cost - picked.price + target.price), picks })
        }
      }
    }
    for (const target of targets) {
      if ((plan.picks[target.code] || 0) >= req.maxSame) continue
      const picks = { ...plan.picks }
      addPick(picks, target.code)
      variants.push({ cost: round1(plan.cost + target.price), picks })
    }
  }

  // 多张券同时用：枚举 2~3 张券的所有组合，每张券各挑最便宜的命中商品，
  // 同品类优先顶掉方案里最贵的那件。这样「一口价汉堡 + 免费小食」这种最省钱的
  // 组合才会进入候选（第五关要求至少 2 张券）。
  if (targetGroups.length > 1) {
    const subsets = []
    const walk = (start, picked) => {
      if (picked.length >= 2) subsets.push([...picked])
      if (picked.length >= 3) return
      for (let i = start; i < targetGroups.length; i += 1) {
        picked.push(targetGroups[i])
        walk(i + 1, picked)
        picked.pop()
      }
    }
    walk(0, [])
    for (const subset of subsets) {
      // 每张券有两种落法：直接加一件，或顶掉同品类里最便宜的一件。
      // 一口价券顶掉便宜汉堡往往更划算（25.5 的堡用券变 11.9，比 15 的原价堡还低），
      // 所以两种都生成，最后按券后实付排序自然会选出更省的那种。
      const branch = (index, picks, cost, used) => {
        if (index >= subset.length) {
          if (used >= subset.length && planSatisfies(picks, map, req)) variants.push({ cost, picks })
          return
        }
        const targets = subset[index]
        if (targets.some((target) => (picks[target.code] || 0) > 0)) {
          branch(index + 1, picks, cost, used + 1)
          return
        }
        const target = targets.find((item) => (picks[item.code] || 0) < req.maxSame)
        if (!target) {
          branch(index + 1, picks, cost, used)
          return
        }
        const added = { ...picks }
        addPick(added, target.code)
        branch(index + 1, added, round1(cost + target.price), used + 1)

        const sameCategory = Object.keys(picks)
          .map((code) => map.get(code))
          .filter((item) => item && item.category === target.category && item.code !== target.code)
          .sort(byPrice)[0]
        if (sameCategory) {
          const replaced = { ...picks }
          replaced[sameCategory.code] -= 1
          if (replaced[sameCategory.code] <= 0) delete replaced[sameCategory.code]
          addPick(replaced, target.code)
          branch(
            index + 1,
            replaced,
            round1(cost - sameCategory.price + target.price),
            used + 1
          )
        }
      }
      branch(0, { ...plan.picks }, plan.cost, 0)
    }
  }
  return variants
}

export function enumeratePlans(level, items, { includeExtras = false, limit = 5 } = {}) {
  const req = buildRequirements(level, includeExtras)
  const distinctCost = !includeExtras
  if (req.onlyProtein) return enumerateSinglePlans(items, req, limit, distinctCost)
  return enumerateComboPlans(items, req, limit, distinctCost)
}

/** 把一套方案翻译成结算行，交给券引擎按品名匹配算用券后实付 */
function planLines(picks, map) {
  const lines = []
  for (const [code, qty] of Object.entries(picks)) {
    const item = map.get(code)
    if (!item) continue
    lines.push({
      code: item.code,
      name: item.name,
      category: item.category,
      protein: item.protein,
      price: item.price,
      qty
    })
  }
  return lines
}

function unsolvable(level) {  return {
    optimal: null,
    perfect: null,
    factor: 1,
    thresholds: level.base,
    answers: [],
    answerCount: 0,
    adjusted: false,
    mode: 'absolute',
    unsolvable: true
  }
}

/**
 * 关卡阈值规则（用户指定）：
 * - 取本店前 5 套合法搭配，其中价格最高的那套 = 3 星线（向上取整到 0.5 元）；
 * - 2 星线 = 3 星线 × 1.25（实付偏高，或只差 1 个隐藏条件）；
 * - 连 2 星线都够不到就是「价格实在相差太大」，只能拿 1 星。
 * 阈值一律按「用券后实付」算：券是真的、玩家也真的会用，只按原价定线会让所有人都轻松三星。
 */
export function calibrate(level, items, coupons = []) {
  if (level.track !== 'saving') return calibrateChallenge(level, items, coupons)
  const solved = solveAnswers(level, items, coupons)
  if (!solved) return unsolvable(level)
  const { entries, star2, star3 } = solved
  const optimal = round1(entries[0].paid)
  return {
    optimal,
    // 满分方案就是前五套里最便宜的那套（它已经满足全部三星条件）
    perfect: optimal,
    factor: Math.round((star2 / level.base.pass) * 100) / 100,
    adjusted: true,
    mode: 'relative',
    answers: entries.map((entry, index) => ({ rank: index + 1, cost: entry.paid })),
    answerCount: entries.length,
    thresholds: { pass: star2, star2, star3 }
  }
}

/**
 * 前五套答案的明细（商品、份数、原价、券后实付）。
 * 关卡答案文档直接用它生成，保证文档和游戏里的阈值来自同一套计算。
 */
function calibrateChallenge(level, items, coupons = []) {
  const usable = items.filter(item => item.price != null && !item.soldOut)
  const candidates = []
  const pools = {}
  for (const item of usable) (pools[item.category] ||= []).push(item)
  for (const pool of Object.values(pools)) pool.sort(byPrice)
  const required = Object.entries(level.rules?.minQty || {})
  const picks = {}
  const add = (item, qty = 1) => { picks[item.code] = (picks[item.code] || 0) + qty }
  const make = () => {
    const selection = Object.entries(picks).map(([code, qty]) => ({ code, qty }))
    const lines = buildLines(selection, Object.fromEntries(usable.map(i => [i.code, i])))
    const paid = applyCoupons(lines.reduce((s, l) => s + l.price * l.qty, 0), coupons, lines).paid
    // 校准只关心核心条件，人物分配由玩家自行完成
    const result = evaluateChallenge(level, lines, paid, [], { skipAssignments: true })
    if (result.structuralOk && result.hardOk && result.score !== null) candidates.push({ paid, score: result.score, picks: { ...picks } })
  }
  const walk = index => {
    if (index >= required.length) { make(); return }
    const [category, qty] = required[index]
    const pool = (pools[category] || []).slice(0, 6)
    if (!pool.length) return
    for (const item of pool) { add(item, qty); walk(index + 1); picks[item.code] -= qty; if (!picks[item.code]) delete picks[item.code] }
  }
  if (required.length) walk(0)
  const unique = [...new Map(candidates.map(c => [`${c.paid}:${c.score}`, c])).values()]
  unique.sort((a, b) => level.objective === 'price' || level.objective === 'pricePerPerson' ? a.paid - b.paid : b.score - a.score)
  const answers = unique.slice(0, 5)
  const reference = answers.length >= 5 ? answers[answers.length - 1].score : null
  const thresholds = { kind: 'challenge', referenceCount: answers.length, score: reference }
  return { optimal: answers[0]?.paid ?? null, perfect: answers[0]?.paid ?? null, factor: null, adjusted: false, mode: 'challenge', answers: answers.map((a, i) => ({ rank: i + 1, cost: a.paid, score: a.score })), answerCount: answers.length, thresholds, unsolvable: false, notGuaranteedFive: answers.length < 5 }
}
export function answerSheet(level, items, coupons = []) {
  if (level.track !== 'saving') return null
  const solved = solveAnswers(level, items, coupons)
  if (!solved) return null
  const { entries, star2, star3, map } = solved
  return {
    star3,
    star2,
    answers: entries.map((entry, index) => ({
      rank: index + 1,
      cost: entry.cost,
      paid: entry.paid,
      items: Object.entries(entry.picks).map(([code, qty]) => {
        const item = map.get(code)
        return {
          name: item?.name || code,
          category: item?.category || '',
          price: item?.price ?? 0,
          qty,
          contents: item?.contents || []
        }
      })
    }))
  }
}

function solveAnswers(level, items, coupons) {
  const usable = items.filter((item) => item.price != null && !item.soldOut)
  const map = new Map(usable.map((item) => [item.code, item]))
  // 三星要求「价格达标 + 隐藏条件全达成」，所以候选池必须按同一套条件生成。
  // 只按硬性要求取前五，会出现「照要求点到最低价，结果比三星线还贵」的死局。
  const starCouponNeed = (level.star3Extra || [])
    .filter((extra) => extra.type === 'couponCount')
    .reduce((max, extra) => Math.max(max, extra.min || 0), 0)
  const needCoupons = Math.max(level.rules?.couponMinCount || 0, starCouponNeed)

  // 先按原价多枚举一批候选，再用券后实付重新排序取前 5。
  // 池子必须开得够大：券只减特定的几款单品，按原价排在后面的方案用券后可能反而最便宜。
  const req = buildRequirements(level, true)
  const candidates = enumeratePlans(level, usable, { includeExtras: true, limit: 160 })
  // 枚举只会挑「最便宜的单品」，券指定的商品（一口价汉堡、任选炸鸡、免费薯饼）永远进不了候选。
  // 这里对最便宜的一批方案做券变形（替换/追加券匹配单品），把「用券后的真实最低价」补进候选池。
  const pool = [...candidates]
  for (const plan of candidates.slice(0, 60)) {
    pool.push(...couponVariants(plan, usable, coupons, req, map))
  }
  const scored = []
  const seenPaid = new Set()
  for (const plan of pool) {
    const result = applyCoupons(plan.cost, coupons, planLines(plan.picks, map))
    if (result.applied.length < needCoupons) continue
    const paid = round1(result.paid)
    // 五套答案取五个不同价位，避免“换个圆筒口味”这种同价凑数
    if (seenPaid.has(paid)) continue
    seenPaid.add(paid)
    scored.push({ cost: plan.cost, paid, picks: plan.picks })
  }
  if (!scored.length) return null
  scored.sort((a, b) => a.paid - b.paid)

  const entries = scored.slice(0, 5)
  // 三星线取「前五套里最贵的那套」，再向上取整到 0.5 元：
  // 麦当劳价格都是 0.5 元一跳，不取整会出现「差 1 毛钱掉一颗星」的别扭体验。
  const star3 = round1(Math.ceil(entries[entries.length - 1].paid * 2) / 2)
  return { entries, star3, star2: round1(star3 * 1.25), map }
}

export function optimalCost(level, items, coupons = []) {
  if (level.track !== 'saving') return calibrateChallenge(level, items, coupons).optimal
  const cal = calibrate(level, items, coupons)
  return cal.answers.length ? cal.answers[0].cost : null
}

export function optimalPerfect(level, items, coupons = []) {
  const req = buildRequirements(level, true)
  const plans = req.onlyProtein
    ? enumerateSinglePlans(items, req, 1)
    : enumerateComboPlans(items, req, 1)
  return plans[0]?.cost ?? null
}

export function buildHints(level, items, limit = 3) {
  const usable = items.filter((i) => !i.soldOut && i.price != null && i.category !== 'sauce')
  const picks = []
  const rules = level.rules || {}
  if (rules.onlyProtein) {
    const pool = usable.filter((i) => rules.onlyProtein.includes(i.protein)).sort(byPrice)
    for (const item of pool.slice(0, limit)) {
      picks.push({ code: item.code, name: item.name, price: item.price, reason: '鸡肉最低价' })
    }
    return picks
  }
  for (const [category, qty] of Object.entries(rules.minQty || {})) {
    const pool = usable.filter((i) => i.category === category).sort(byPrice)
    if (pool[0]) {
      picks.push({ code: pool[0].code, name: pool[0].name, price: pool[0].price, reason: `最便宜的${labelOf(category)} ×${qty}` })
    }
  }
  const combos = usable.filter((i) => i.category === 'combo').sort(byPrice)
  if (combos[0]) {
    picks.push({ code: combos[0].code, name: combos[0].name, price: combos[0].price, reason: '最便宜的多品类套餐' })
  }
  return picks.slice(0, limit)
}

function labelOf(category) {
  return { burger: '主食', snack: '小食', drink: '饮品', dessert: '甜品', combo: '套餐', sauce: '蘸酱' }[category] || category
}
