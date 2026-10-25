const finite = n => typeof n === 'number' && Number.isFinite(n) && n >= 0
const count = p => p.qty === undefined ? 1 : p.qty
const tags = (p, field) => Array.isArray(p[field]) ? p[field] : []
const has = (p, field, tag) => tags(p, field).includes(tag)
const length = s => [...(s || '')].length
// 官方营养口径只有这 5 项，没有 sugar 字段
const nutrientKeys = ['kcal', 'protein', 'fat', 'carb', 'sodium']

export function expandChallengeLines(lines) {
  const parts = []
  const walk = (part, qty, root, path) => {
    if (part.category === 'combo' && part.contents?.length) {
      part.contents.forEach((child, i) => walk(child, qty * count(child), root, `${path}.${i}`))
    } else parts.push({ ...part, qty, rootCode: root.code, root, partKey: path })
  }
  lines.forEach(line => walk(line, line.qty, line, String(line.code)))
  return parts
}

// For each nutrient use either complete component data or the bundle total, never both.
export function challengeNutrition(lines) {
  const missing = Object.fromEntries(nutrientKeys.map(k => [k, []]))
  const read = (item, key) => {
    if (item.category === 'combo' && item.contents?.length) {
      const values = item.contents.map(p => ({ value: read(p, key), qty: count(p) }))
      if (values.every(p => p.value !== null)) return values.reduce((s, p) => s + p.value * p.qty, 0)
    }
    return finite(item.nutrition?.[key]) ? item.nutrition[key] : null
  }
  const totals = {}
  for (const key of nutrientKeys) {
    let value = 0
    for (const line of lines) {
      const n = read(line, key)
      if (n === null) missing[key].push(line.name || line.code)
      else value += n * line.qty
    }
    totals[key] = missing[key].length ? null : Math.round(value * 100) / 100
  }
  return { totals, missing }
}

const flavorKnown = p => tags(p, 'flavors').length > 0
const spicy = p => p.spicy === true || has(p, 'flavors', 'spicy')

export function challengePeople(level) {
  const mode = level.rules?.assignmentMode
  if (mode === 'colleagues') return [{ id: 'chicken', protein: 'chicken' }, { id: 'beef', protein: 'beef' }, { id: 'nonSpicy', nonSpicy: true }]
  if (mode === 'family') return [{ id: 'adult' }, { id: 'child', nonSpicy: true }]
  if (mode === 'party') return Array.from({ length: 8 }, (_, i) => ({ id: `person${i + 1}` }))
  return []
}

function validateAssignments(level, parts, assignments) {
  const people = challengePeople(level)
  const rows = Array.isArray(assignments) ? assignments : [...(assignments?.personalPicks || []), ...(assignments?.sharedPicks || []).map(p => ({ ...p, personId: 'shared' }))]
  const used = new Map()
  const allocated = []
  const errors = []
  const missing = []
  for (const row of rows) {
    const qty = row.qty ?? 1
    if (!Number.isInteger(qty) || qty < 1 || (!people.some(p => p.id === row.personId) && row.personId !== 'shared')) { errors.push('人物或数量无效'); continue }
    const candidates = parts.filter(p => row.partKey ? p.partKey === row.partKey : String(p.code) === String(row.itemCode) || String(p.rootCode) === String(row.itemCode))
    // A root bundle assignment claims all its components, including spicy sides/drinks.
    const roots = !row.partKey && candidates.some(p => String(p.rootCode) === String(row.itemCode) && p.root.category === 'combo')
    let left = qty
    for (const p of candidates) {
      const available = p.qty - (used.get(p.partKey) || 0)
      const rootUnitQty = p.qty / count(p.root)
      const take = roots ? qty * rootUnitQty : Math.min(left, available)
      if (take <= 0) continue
      if (take > available + 1e-9) { errors.push('分配超出已购份数'); continue }
      used.set(p.partKey, (used.get(p.partKey) || 0) + take)
      allocated.push({ personId: row.personId, part: p, qty: take })
      if (!roots) left -= take
    }
    if (!candidates.length || (!roots && left > 0)) errors.push('商品不存在或份数不足')
  }
  for (const person of people) {
    const own = allocated.filter(a => a.personId === person.id)
    if (!own.some(a => a.part.category === 'burger')) errors.push(`${person.id} 缺少独立主食`)
    if (person.nonSpicy) {
      for (const { part } of own) {
        // 套餐拆出的部件没有口味字段时不做无依据的判定
        if (spicy(part)) errors.push(`${person.id} 分配到辣味商品`)
      }
    }
  }
  const preferenceOk = people.every(person => !person.protein || allocated.some(a => a.personId === person.id && a.part.category === 'burger' && a.part.protein === person.protein))
  const sharedSnack = allocated.some(a => a.personId === 'shared' && a.part.category === 'snack')
  const partyOk = people.every(person => allocated.filter(a => a.personId === person.id && a.part.category === 'drink').reduce((s, a) => s + a.qty, 0) <= 1) && allocated.filter(a => a.personId === 'shared' && a.part.category === 'snack').reduce((s, a) => s + a.qty, 0) >= 4 && allocated.filter(a => a.personId !== 'shared' && a.part.category === 'drink').reduce((s, a) => s + a.qty, 0) >= 6
  return {
    people,
    allocated: allocated.map(a => ({ personId: a.personId, partKey: a.part.partKey, code: a.part.code, name: a.part.name || '', category: a.part.category, protein: a.part.protein, spicy: spicy(a.part), qty: a.qty })),
    errors: [...new Set(errors)], missing: [...new Set(missing)], ok: errors.length === 0 && missing.length === 0, preferenceOk, sharedSnack, partyOk
  }
}

export function evaluateChallenge(level, lines, paid, assignments = [], options = {}) {
  const r = level.rules || {}
  const checks = [], extras = [], unavailable = []
  const displayNames = { burger: '汉堡', snack: '小食', drink: '饮品', dessert: '甜品', combo: '套餐', sauce: '酱料', kcal: '千卡', protein: '蛋白质', fat: '脂肪', carb: '碳水化合物', sodium: '钠', chicken: '鸡肉', beef: '牛肉', egg: '鸡蛋', milk: '牛奶', fish: '鱼肉', salty: '咸味', sweet: '甜味', spicy: '辣味', hot: '热食', cold: '冷食', g: '克', mg: '毫克' }
  const chineseText = value => String(value).replace(/[a-zA-Z]+/g, word => displayNames[word] || word)
  const add = (target, key, label, ok, detail = '', available = true, structural = false, advisory = false) => {
    label = chineseText(label)
    detail = chineseText(detail)
    target.push({ key, label, ok: Boolean(ok) && available, detail: available ? detail : `不可用：${detail}`, available, structural, advisory })
    if (!available && !advisory) unavailable.push(`${label}：${detail}`)
  }
  const parts = expandChallengeLines(lines)
  const nutrition = challengeNutrition(lines)
  const n = nutrition.totals
  const categories = {}
  for (const p of parts) categories[p.category] = (categories[p.category] || 0) + p.qty
  const unique = [...new Map(lines.map(l => [String(l.code), l])).values()]
  const quantities = Object.fromEntries(unique.map(l => [l.code, lines.filter(p => String(p.code) === String(l.code)).reduce((s, p) => s + p.qty, 0)]))
  const drinks = parts.filter(p => p.category === 'drink')
  const mains = parts.filter(p => p.category === 'burger')
  const snacks = parts.filter(p => p.category === 'snack')
  const proteins = [...new Set(mains.map(p => p.protein).filter(p => p && !['none', 'mixed'].includes(p)))]
  const sumQty = ps => ps.reduce((s, p) => s + p.qty, 0)
  const comboCount = sumQty(lines.filter(p => p.category === 'combo'))
  const spicyQty = sumQty(parts.filter(spicy))
  const flavors = new Set(parts.flatMap(p => tags(p, 'flavors')))
  const conflicts = [['salty', 'sweet'], ['spicy', 'sweet'], ['hot', 'cold']].filter(pair => pair.every(t => flavors.has(t)))
  const nameLength = unique.reduce((s, p) => s + length(p.name), 0)
  const longestName = unique.reduce((best, p) => length(p.name) > length(best) ? p.name : best, '')
  const carbLimit = r.lowCarbThreshold ?? 20
  const drinkCarbKnown = drinks.length > 0 && drinks.every(p => finite(p.nutrition?.carb))
  const lowCarb = drinks.length > 0 && drinks.every(p => finite(p.nutrition?.carb) && p.nutrition.carb <= carbLimit)
  const maxDrinkCarb = drinkCarbKnown ? Math.max(...drinks.map(p => p.nutrition.carb)) : null
  const proteinMain = mains.some(p => ['chicken', 'beef'].includes(p.protein))
  add(checks, 'available', '门店在售且订单可执行', lines.length > 0 && lines.every(p => !p.soldOut && finite(p.price) && Number.isInteger(p.qty) && p.qty > 0 && p.qty <= 20) && parts.every(p => Number.isInteger(p.qty) && p.qty > 0), '', true, true)
  for (const [cat, qty] of Object.entries(r.minQty || {})) add(checks, `cat-${cat}`, `${cat} ≥ ${qty} 份`, (categories[cat] || 0) >= qty, categories[cat] || 0, true, true)
  if (r.sideOrDessert) add(checks, 'side', '至少一份小食或甜品', (categories.snack || 0) + (categories.dessert || 0) >= r.sideOrDessert, '', true, true)
  const bound = (key, field, limit, min = false) => {
    if (limit === undefined) return
    const name = field === 'kcal' ? '热量' : displayNames[field]
    const unit = field === 'kcal' ? '千卡' : field === 'sodium' ? '毫克' : '克'
    add(checks, key, `${name} ${min ? '≥' : '≤'} ${limit} ${unit}`, min ? n[field] >= limit : n[field] <= limit, n[field] ?? `缺少${name}营养数据`, n[field] !== null)
  }
  bound('calories', 'kcal', r.maxCalories)
  bound('protein', 'protein', r.minProtein, true)
  bound('fat', 'fat', r.maxFat)
  bound('carb', 'carb', r.maxCarb)
  if (r.maxPaid !== undefined) add(checks, 'budget', `预算 ≤ ${r.maxPaid}`, paid <= r.maxPaid, paid, finite(paid))
  if (r.maxSameItem) add(checks, 'max-same', `单品最多 ${r.maxSameItem} 份`, Object.values(quantities).every(q => q <= r.maxSameItem), '', true, true)
  if (r.minDistinct) add(checks, 'distinct-min', '不同商品数达标', unique.length >= r.minDistinct, unique.length, true, true)
  if (r.maxDistinct) add(checks, 'distinct-max', '点餐种类数达标', unique.length <= r.maxDistinct, unique.length, true, true)
  if (r.minItems) add(checks, 'qty', '展开件数达标', sumQty(parts) >= r.minItems, sumQty(parts), true, true)
  if (r.minNameLength) add(checks, 'name-length', '名称字符数达标', nameLength >= r.minNameLength, nameLength, true, true)
  if (r.minCategories) add(checks, 'categories', '品类覆盖达标', Object.keys(categories).length >= r.minCategories, Object.keys(categories).length, true, true)
  if (r.mainProteins) add(checks, 'main-proteins', '主食覆盖鸡肉和牛肉', r.mainProteins.every(p => proteins.includes(p)), proteins.join('、'), mains.every(p => p.protein && p.protein !== 'mixed'), true)
  if (r.minSpicy) add(checks, 'spicy', `辣味商品 ≥ ${r.minSpicy}`, spicyQty >= r.minSpicy, spicyQty || '缺少辣味口味标签', parts.some(flavorKnown), true)
  if (r.saltyMain) add(checks, 'salty-main', '咸味主食', mains.some(p => has(p, 'flavors', 'salty')), '需要咸味主食标签', mains.some(p => flavorKnown(p)), true)
  if (r.minConflicts) add(checks, 'conflicts', '冲突主题成立', conflicts.length >= r.minConflicts, conflicts.map(p => p.join('+')).join('、'), parts.some(p => flavorKnown(p)), true)
  if (r.noComplexRemarks) add(checks, 'remarks', '不含无法执行的复杂备注商品', lines.every(p => !p.requiresRemarks || p.remarksSupported === true), '', true, true)
  if (r.lowCarbDrinks) add(checks, 'drink-carb', `每杯饮品碳水 ≤ ${carbLimit}g`, lowCarb, drinkCarbKnown ? `最高 ${maxDrinkCarb}g` : '需要每杯实际碳水', drinkCarbKnown)
  const assignment = r.assignmentMode && !options.skipAssignments ? validateAssignments(level, parts, assignments) : null
  const assignmentAvailable = Boolean(r.assignmentMode) && !options.skipAssignments
  if (r.assignmentMode) add(checks, 'assignments', '人物独立份数与忌口校验', assignment?.ok, [...(assignment?.errors || []), ...(assignment?.missing || [])].join('；') || '分配有效', assignmentAvailable)
  const ex = (key, label, ok, detail = '', available = true, advisory = false) => add(extras, key, label, ok, detail, available, false, advisory)
  for (const key of level.challengeExtras || []) {
    switch (key) {
      case 'proteinSource': ex(key, '明确蛋白质来源', parts.some(p => ['chicken', 'beef', 'egg', 'milk', 'fish'].includes(p.protein)), [...new Set(parts.map(p => p.protein).filter(p => ['chicken', 'beef', 'egg', 'milk', 'fish'].includes(p)))].join('、') || '缺少真实 protein 字段'); break
      case 'lowCarbDrink': ex(key, `每杯饮品碳水 ≤ ${carbLimit}g`, lowCarb, drinkCarbKnown ? `最高 ${maxDrinkCarb}g` : '需要饮品碳水字段', drinkCarbKnown); break
      case 'lowCarbDrinks': ex(key, `每杯饮品碳水 ≤ ${carbLimit}g`, lowCarb, drinkCarbKnown ? `最高 ${maxDrinkCarb}g` : '需要饮品碳水字段', drinkCarbKnown); break
      case 'calories650': ex(key, '热量 ≤ 650 kcal', n.kcal <= 650, n.kcal, n.kcal !== null); break
      case 'proteinMain': ex(key, '鸡肉或牛肉主食', proteinMain); break
      case 'protein20': ex(key, '蛋白质 ≥ 20g', n.protein >= 20, n.protein, n.protein !== null); break
      case 'leanSnack': ex(key, '非油炸或低脂小食', snacks.some(p => p.fried === false || has(p, 'tags', 'lowFat') || (finite(p.nutrition?.fat) && p.nutrition.fat <= (r.lowFatSnackThreshold ?? 5))), '营养脂肪≤5g 或真实标签', snacks.some(p => p.fried !== undefined || finite(p.nutrition?.fat) || has(p, 'tags', 'lowFat'))); break
      case 'noRepeatedHighCarbDrink': { const high = drinks.filter(p => finite(p.nutrition?.carb) && p.nutrition.carb >= carbLimit); const groups = {}; high.forEach(p => { groups[p.code || p.name] = (groups[p.code || p.name] || 0) + p.qty }); ex(key, '高碳水饮品不能重复', Object.values(groups).every(q => q <= 1), '', drinks.every(p => finite(p.nutrition?.carb))); break }
      case 'balancedSafety': ex(key, '均衡安全线：1600kcal / 45g蛋白质 / 60g脂肪', n.kcal <= 1600 && n.protein >= 45 && n.fat <= 60, '脂肪安全线为关卡配置60g', ['kcal', 'protein', 'fat'].every(k => n[k] !== null)); break
      case 'twoMainProteins': ex(key, '主食两种蛋白质来源', proteins.length >= 2); break
      case 'spicyMain': ex(key, '辣味主食', mains.some(spicy), '需要真实口味标签', mains.some(p => flavorKnown(p))); break
      case 'spicySnack': ex(key, '辣味小食', snacks.some(spicy), '需要真实口味标签', snacks.some(p => flavorKnown(p))); break
      case 'saltyMain': ex(key, '咸味主食', mains.some(p => has(p, 'flavors', 'salty')), '需要真实口味标签', mains.some(p => flavorKnown(p))); break
      case 'sweetDessert': ex(key, '甜味甜品', parts.some(p => p.category === 'dessert' && has(p, 'flavors', 'sweet')), '需要真实口味标签', parts.some(p => p.category === 'dessert' && flavorKnown(p))); break
      case 'contrast': ex(key, '咸甜或冷热反差', conflicts.length > 0, conflicts.map(p => p.join('+')).join('、')); break
      case 'longNames': ex(key, `至少三个商品名超过 ${r.longNameThreshold ?? 8} 字符`, unique.filter(p => length(p.name) > (r.longNameThreshold ?? 8)).length >= 3, unique.map(p => length(p.name)).join('/')); break
      case 'combo': ex(key, '至少一个真实套餐', comboCount >= 1); break
      case 'twoCombos': ex(key, '至少两个真实套餐', comboCount >= 2); break
      case 'twoConflicts': ex(key, '至少两个独立冲突维度', conflicts.length >= 2, conflicts.map(p => p.join('+')).join('、')); break
      case 'side': ex(key, '含小食', (categories.snack || 0) >= 1); break
      case 'quickOrder': {
        const limit = r.maxDistinct ?? 2
        ex(key, `种类数不超过${limit}`, unique.length <= limit, `已选 ${unique.length} 种`)
        break
      }
      case 'threeDrinks': ex(key, '三人各有饮品份数', (categories.drink || 0) >= 3); break
      case 'personPreferences': ex(key, '人物偏好对应独立主食', assignment?.preferenceOk && assignment.ok, '', assignmentAvailable); break
      case 'sharedSnack': ex(key, '共享栏至少一份小食', assignment?.sharedSnack, '需要在共享栏分配小食', assignmentAvailable && snacks.length > 0); break
      case 'childFriendly': ex(key, '儿童分到不辣的主食', assignment?.allocated.some(a => a.personId === 'child' && a.category === 'burger' && !a.spicy), '儿童需要独立主食', assignmentAvailable && Boolean(assignment?.allocated.some(a => a.personId === 'child'))); break
      case 'maxTwo': ex(key, '同款最多两份', Object.values(quantities).every(q => q <= 2)); break
      case 'partyDistribution': ex(key, '个人饮品与共享小食合理分配', assignment?.partyOk && assignment.ok, '', assignmentAvailable); break
      case 'noHighFatSnack': ex(key, '无高脂小食', snacks.every(p => p.nutrition?.fat <= (r.highFatSnackThreshold ?? 15)), '需要小食脂肪字段', snacks.every(p => finite(p.nutrition?.fat))); break
    }
  }
  const balanceComponents = n.kcal !== null && n.protein !== null && n.fat !== null ? {
    calories: 35 * Math.max(0, 1 - Math.abs(n.kcal - 1200) / 1200),
    protein: 30 * Math.min(1, n.protein / 45), fat: 20 * Math.max(0, 1 - n.fat / 60),
    categories: 15 * Math.min(1, Object.keys(categories).length / 4)
  } : null
  const rarityScore = parts.reduce((s, p) => s + (finite(p.rarityScore) ? p.rarityScore : 0), 0)
  const objective = level.objective
  let score = null
  switch (objective) {
    case 'calories': score = n.kcal === null ? null : -n.kcal; break
    case 'fat': score = n.fat === null ? null : -n.fat; break
    case 'carb': score = n.carb === null ? null : -n.carb; break
    case 'proteinEfficiency': score = n.kcal > 0 && n.protein !== null ? n.protein / n.kcal * 1000 : null; break
    case 'balance': score = balanceComponents ? Object.values(balanceComponents).reduce((s, v) => s + v, 0) : null; break
    case 'spicy': score = spicyQty; break
    case 'contrast': score = conflicts.length * 10 + sumQty(parts.filter(p => tags(p, 'flavors').some(t => ['salty', 'sweet', 'hot', 'cold'].includes(t)))); break
    case 'nameLength': score = nameLength; break
    case 'efficiency': score = sumQty(parts) * 10 + comboCount * 5 - unique.length * 3 - nameLength / 100; break
    case 'conflicts': score = conflicts.length * 20 + Object.keys(categories).length * 5 + rarityScore; break
    case 'price': score = finite(paid) ? -paid : null; break
    case 'pricePerPerson': score = finite(paid) ? -paid / (r.people || 1) : null; break
  }
  if (score === null) unavailable.push('核心评分数据不足')
  const rank = level.challengeThresholds || level.thresholds
  const rankAvailable = rank?.kind === 'challenge' && finite(rank.referenceCount) && rank.referenceCount >= 5 && Number.isFinite(rank.score)
  // 参考线只做展示，不参与星级，避免候选不足 5 套时永远拿不到三星
  ex('ranking', '达到已校准候选前五参考线', rankAvailable && score !== null && score >= rank.score, rankAvailable ? `核心分 ${score} / 参考 ${rank.score}` : '尚未校准出五套参考方案', rankAvailable, true)
  const eligible = [...checks, ...extras].filter(c => c.available !== false && !c.advisory)
  const structuralOk = eligible.filter(c => c.structural).every(c => c.ok)
  const hardOk = checks.filter(c => c.available !== false).every(c => c.ok)
  const fails = eligible.filter(c => !c.ok).length
  const stars = !structuralOk ? 0 : hardOk && fails === 0 ? 3 : fails <= 1 ? 2 : 1
  return {
    checks,
    extras,
    metrics: { nutrition: n, nutritionMissing: nutrition.missing, categoryCounts: categories, proteins, distinctItemCount: unique.length, totalQty: sumQty(parts), comboCount, nameLength, longestName, spicyCount: spicyQty, flavorConflictCount: conflicts.length, categoryContrastCount: Object.keys(categories).length, rarityScore, balanceComponents, pricePerPerson: finite(paid) ? paid / (r.people || 1) : null, score, objective, assignment, themeReasons: conflicts.map(p => p.join(' + ')) },
    stars,
    passed: stars > 0,
    hardOk,
    structuralOk,
    available: unavailable.length === 0,
    unavailable: [...new Set(unavailable)],
    score
  }
}
