export const SAVING_LEVELS = [
  {
    id: 'S01',
    label: '第一关',
    track: 'saving',
    order: 1,
    name: '20元单人饱腹战',
    tagline: '用最低预算搭配一份完整单人餐',
    difficulty: 1,
    base: { pass: 20, star2: 18, star3: 17 },
    rules: { minQty: { burger: 1, drink: 1 } },
    star3Extra: [{ type: 'category', category: 'snack', qty: 1, label: '含 1 份小食' }],
    constraintText: ['1 份主食（汉堡）', '1 份饮品', '套餐内含的主食 / 饮品同样计入'],
    star3Text: '总价 ≤ 17 元，且含 1 份小食',
    tip: '先对比单点与套餐：套餐里的汉堡 + 饮品往往比单点更便宜，再考虑加小食。'
  },
  {
    id: 'S02',
    label: '第二关',
    track: 'saving',
    order: 2,
    name: '30元三人温饱挑战',
    tagline: '30 元内满足 3 人基础用餐',
    difficulty: 2,
    base: { pass: 30, star2: 27, star3: 26 },
    rules: { minQty: { burger: 3 }, maxSameItem: 2, people: 3 },
    star3Extra: [{ type: 'proteinCoverage', proteins: ['chicken', 'beef'], mainOnly: true, label: '主食同时覆盖鸡肉和牛肉' }],
    constraintText: ['3 人各 1 份主食（共 3 份汉堡）', '同一单品最多重复 2 份', '套餐内含的主食计入份数'],
    star3Text: '总价进前五套，且主食覆盖鸡 / 牛',
    tip: '两份最便宜汉堡 + 一份随心配是底价；想拿三星，把其中一份换成鸡肉汉堡。'
  },
  {
    id: 'S03',
    label: '第三关',
    track: 'saving',
    order: 3,
    name: '50元全家桶搭建',
    tagline: '配齐一套完整多人餐',
    difficulty: 3,
    base: { pass: 50, star2: 45, star3: 44 },
    rules: { minQty: { burger: 2, snack: 3, drink: 3, dessert: 1 } },
    star3Extra: [{ type: 'comboCount', min: 2, label: '至少使用 2 个套餐' }],
    constraintText: ['汉堡 2 份', '小食 3 份', '饮品 3 份', '甜品 1 份', '套餐拆出的品类同样计入'],
    star3Text: '总价进前五套，且至少用 2 个套餐',
    tip: '三 / 四件套能一次补齐汉堡、小食和饮品，凑品类时先算套餐再补单点。'
  },
  {
    id: 'S04',
    label: '第四关',
    track: 'saving',
    order: 4,
    name: '全鸡宴极限省钱',
    tagline: '用最少的钱买到最多份鸡肉单品',
    difficulty: 4,
    base: { pass: 40, star2: 36, star3: 35 },
    rules: { onlyProtein: ['chicken'], minItems: 5, maxSameItem: 2 },
    star3Extra: [{ type: 'category', category: 'burger', qty: 1, label: '含 1 份鸡肉汉堡' }],
    constraintText: ['所有单品必须含鸡肉', '至少 5 件单品', '同一单品最多 2 份', '以鸡肉为主食的套餐可用'],
    star3Text: '总价进前五套，且含 1 份鸡肉汉堡',
    tip: '蘸酱炸鸡和鸡块是全场最低价鸡肉，同一款最多 2 份，凑件数时轮换着点。'
  },
  {
    id: 'S05',
    label: '第五关',
    track: 'saving',
    order: 5,
    name: '优惠券搭配战',
    tagline: '把当天到手的真券都用在对的单品上',
    difficulty: 5,
    base: { pass: 28, star2: 28, star3: 22 },
    rules: { minQty: { burger: 1, drink: 1 }, couponMinCount: 1 },
    star3Extra: [{ type: 'couponCount', min: 2, label: '至少用上 2 张券' }],
    constraintText: ['1 份主食', '1 份饮品', '至少用上 1 张真实券', '券只能各用一张，落在最贵的单品上'],
    star3Text: '实付进前五套，且至少用上 2 张券',
    tip: '官方券只能各用一张：一口价汉堡、任选 2 件炸鸡、指定单品免费。先凑齐品类，再让每张券都落在最贵的那件上。'
  }
]

const CATEGORY_NAMES = { burger: '主食（汉堡）', snack: '小食', drink: '饮品', dessert: '甜品' }
const PROTEIN_NAMES = { chicken: '鸡肉', beef: '牛肉' }
const ASSIGNMENT_NAMES = { colleagues: '按鸡肉 / 牛肉 / 不吃辣分给三位同事', family: '分给成人和儿童，儿童主食不辣、另需共享小食', party: '分给八人，每人 1 份主食、至多 1 杯饮品，共享小食 ≥ 4' }
const OBJECTIVE_TEXT = {
  calories: '核心分：总热量越低越好',
  proteinEfficiency: '核心分：蛋白质 / 热量效率越高越好',
  fat: '核心分：总脂肪越低越好',
  carb: '核心分：总碳水越低越好',
  balance: '核心分：热量 35% + 蛋白质 30% + 脂肪 20% + 品类 15%',
  spicy: '核心分：辣味商品份数越多越好',
  contrast: '核心分：口味反差维度越多越好',
  nameLength: '核心分：商品名字符数越多越好',
  efficiency: '核心分：件数多、种类少、套餐多',
  conflicts: '核心分：口味冲突维度越多越好',
  price: '核心分：实付越低越好',
  pricePerPerson: '核心分：人均实付越低越好'
}

const describeRules = (rules) => {
  const lines = []
  for (const [cat, qty] of Object.entries(rules.minQty || {})) lines.push(`${CATEGORY_NAMES[cat] || cat} ${qty} 份`)
  if (rules.sideOrDessert) lines.push('至少 1 份小食或甜品')
  if (rules.maxCalories !== undefined) lines.push(`总热量 ≤ ${rules.maxCalories} kcal`)
  if (rules.minProtein !== undefined) lines.push(`蛋白质 ≥ ${rules.minProtein} g`)
  if (rules.maxFat !== undefined) lines.push(`脂肪 ≤ ${rules.maxFat} g`)
  if (rules.maxCarb !== undefined) lines.push(`碳水 ≤ ${rules.maxCarb} g`)
  if (rules.lowCarbDrinks) lines.push(`每杯饮品碳水 ≤ ${rules.lowCarbThreshold ?? 20} g`)
  if (rules.maxPaid !== undefined) lines.push(`实付 ≤ ${rules.maxPaid} 元`)
  if (rules.maxSameItem) lines.push(`同一单品最多 ${rules.maxSameItem} 份`)
  if (rules.minDistinct) lines.push(`至少 ${rules.minDistinct} 种商品`)
  if (rules.maxDistinct) lines.push(`最多 ${rules.maxDistinct} 种商品`)
  if (rules.minItems) lines.push(`拆开至少 ${rules.minItems} 件`)
  if (rules.minNameLength) lines.push(`商品名合计 ≥ ${rules.minNameLength} 字符`)
  if (rules.minCategories) lines.push(`覆盖至少 ${rules.minCategories} 个品类`)
  if (rules.mainProteins) lines.push(`主食覆盖${rules.mainProteins.map(p => PROTEIN_NAMES[p] || p).join('和')}`)
  if (rules.minSpicy) lines.push(`辣味商品 ≥ ${rules.minSpicy} 份`)
  if (rules.saltyMain) lines.push('主食为咸味')
  if (rules.minConflicts) lines.push(`口味冲突 ≥ ${rules.minConflicts} 组`)
  if (rules.assignmentMode) lines.push(ASSIGNMENT_NAMES[rules.assignmentMode])
  return lines
}

// 附加条件也要在关卡页提前公开，避免玩家按提示选完才发现还有隐藏门槛
const EXTRA_TEXT = {
  proteinSource: () => '至少一件商品有明确蛋白质来源（鸡/牛/蛋/奶/鱼）',
  lowCarbDrink: (rules) => `每杯饮品碳水 ≤ ${rules.lowCarbThreshold ?? 20}g`,
  lowCarbDrinks: (rules) => `每杯饮品碳水 ≤ ${rules.lowCarbThreshold ?? 20}g`,
  noRepeatedHighCarbDrink: () => '高碳水饮品不能重复',
  calories650: () => '总热量 ≤ 650 kcal',
  proteinMain: () => '主食为鸡肉或牛肉',
  protein20: () => '蛋白质 ≥ 20g',
  leanSnack: () => '小食非油炸或脂肪 ≤ 5g',
  balancedSafety: () => '热量 ≤ 1600 kcal、蛋白质 ≥ 45g、脂肪 ≤ 60g',
  twoMainProteins: () => '主食覆盖两种蛋白质',
  spicyMain: () => '至少一份辣味主食',
  spicySnack: () => '至少一份辣味小食',
  saltyMain: () => '至少一份咸味主食',
  sweetDessert: () => '至少一份甜味甜品',
  contrast: () => '咸甜或冷热至少一组反差',
  longNames: (rules) => `至少 3 个商品名超过 ${rules.longNameThreshold ?? 8} 字符`,
  combo: () => '至少一个真实套餐',
  twoCombos: () => '至少两个真实套餐',
  twoConflicts: () => '至少两个独立冲突维度',
  side: () => '含至少一份小食',
  quickOrder: (rules) => `点餐种类 ≤ ${rules.maxDistinct ?? 2}`,
  threeDrinks: () => '饮品 ≥ 3 份',
  personPreferences: () => '每位同事分到对应肉类主食',
  sharedSnack: () => '共享栏至少一份小食',
  childFriendly: () => '儿童分到不辣的主食',
  maxTwo: () => '同款最多两份',
  partyDistribution: () => '每人至多 1 杯饮品，共享小食 ≥ 4 份',
  noHighFatSnack: () => '小食脂肪 ≤ 15g'
}

const challenge = (id, track, order, name, rules, extras, objective, tip) => ({
  id, track, order, name, label: `第${order}关`, difficulty: order,
  tagline: name, base: { pass: null, star2: null, star3: null },
  rules, challengeExtras: extras, objective, tip,
  constraintText: [...describeRules(rules), ...extras.map((key) => EXTRA_TEXT[key]?.(rules)).filter(Boolean)],
  star3Text: '完成全部任务条件与附加条件即可三星',
  objectiveText: OBJECTIVE_TEXT[objective] || ''
})

export const NUTRITION_LEVELS = [
  challenge('N01', 'nutrition', 1, '轻盈早餐：500 千卡以内', { minQty: { burger: 1, drink: 1 }, maxCalories: 500, lowCarbThreshold: 20 }, ['proteinSource', 'lowCarbDrink'], 'calories', '早餐要吃饱也要轻负担：热量和饮品碳水都会计入。'),
  challenge('N02', 'nutrition', 2, '高蛋白午餐：蛋白质优先', { minQty: { burger: 1, drink: 1 }, maxCalories: 800, minProtein: 25 }, ['calories650', 'proteinMain'], 'proteinEfficiency', '蛋白质与热量效率同时考虑。'),
  challenge('N03', 'nutrition', 3, '低脂但不寡淡', { minQty: { burger: 1, snack: 1, drink: 1 }, maxFat: 30, maxCalories: 900 }, ['protein20', 'leanSnack'], 'fat', '小食也要低脂，苹果片、玉米杯比薯条更合适。'),
  challenge('N04', 'nutrition', 4, '控碳饮品挑战', { minQty: { burger: 2, drink: 2 }, maxCarb: 80, maxCalories: 1200, lowCarbThreshold: 20 }, ['lowCarbDrinks', 'noRepeatedHighCarbDrink'], 'carb', '官方营养表没有糖分，本关以碳水作为控糖口径。'),
  challenge('N05', 'nutrition', 5, '营养均衡终局', { minQty: { burger: 2, drink: 2 }, sideOrDessert: 1, maxCalories: 1600, minProtein: 45 }, ['balancedSafety', 'twoMainProteins'], 'balance', '综合得分：热量35%、蛋白质30%、脂肪20%、品类15%。')
]

export const FUN_LEVELS = [
  challenge('F01', 'fun', 1, '辣度警告色', { minQty: { burger: 1, snack: 1, drink: 1 }, minSpicy: 2 }, ['spicyMain', 'spicySnack'], 'spicy', '至少两份辣味商品，主食和小食各一份辣味。'),
  challenge('F02', 'fun', 2, '甜咸反差王', { minQty: { burger: 1, snack: 1, dessert: 1 } }, ['saltyMain', 'sweetDessert', 'contrast'], 'contrast', '咸甜、冷热标签只采用商品资料。'),
  challenge('F03', 'fun', 3, '名字最长的一单', { minQty: { burger: 1, snack: 1, drink: 1 }, minDistinct: 3, minNameLength: 24, maxSameItem: 1, longNameThreshold: 7 }, ['longNames', 'combo'], 'nameLength', '同一商品只计一次字数，套餐名称计一次，组成参与品类统计。'),
  challenge('F04', 'fun', 4, '社恐点餐模拟', { minQty: { burger: 1, snack: 1, drink: 1 }, maxDistinct: 3, minItems: 4, noComplexRemarks: true }, ['combo'], 'efficiency', '少种类、多件数；套餐拆开就算多件，最适合不想多说一句话的人。'),
  challenge('F05', 'fun', 5, '终极黑暗料理', { minQty: { burger: 1, dessert: 1, drink: 1 }, minCategories: 4, saltyMain: true, minConflicts: 1, maxSameItem: 1 }, ['twoConflicts'], 'conflicts', '咸甜、辣甜都算冲突维度，凑齐两个维度更稳。')
]

export const SCENE_LEVELS = [
  challenge('C01', 'scene', 1, '一个人的加班晚餐', { minQty: { burger: 1, drink: 1 }, maxPaid: 30, maxDistinct: 3, people: 1 }, ['side', 'quickOrder'], 'price', '套餐内小食计入，快速由种类数衡量。'),
  challenge('C02', 'scene', 2, '三人同事午餐', { minQty: { burger: 3, drink: 3 }, mainProteins: ['chicken', 'beef'], maxSameItem: 2, people: 3, assignmentMode: 'colleagues' }, ['threeDrinks', 'personPreferences'], 'price', '鸡肉同事、牛肉同事、不吃辣同事分别分配主食。'),
  challenge('C03', 'scene', 3, '亲子欢乐餐', { minQty: { burger: 2, drink: 2, snack: 2 }, people: 2, assignmentMode: 'family' }, ['sharedSnack', 'combo', 'childFriendly'], 'price', '成人、儿童、共享分别分配；儿童的主食必须不辣。'),
  challenge('C04', 'scene', 4, '健身后补给', { minQty: { burger: 1, drink: 1 }, minProtein: 30, maxFat: 30, lowCarbDrinks: true, lowCarbThreshold: 20, people: 1 }, ['proteinMain', 'noHighFatSnack'], 'proteinEfficiency', '蛋白质、碳水、脂肪都必须有真实营养数据。'),
  challenge('C05', 'scene', 5, '八人聚会拼单', { minQty: { burger: 8, drink: 6, snack: 4, dessert: 1 }, mainProteins: ['chicken', 'beef'], maxSameItem: 3, people: 8, assignmentMode: 'party' }, ['twoCombos', 'maxTwo', 'partyDistribution'], 'pricePerPerson', '每人独立主食，个人饮品与共享小食不能重复占用。')
]

export const ALL_LEVELS = [...SAVING_LEVELS, ...NUTRITION_LEVELS, ...FUN_LEVELS, ...SCENE_LEVELS]

export const TRACKS = [
  {
    id: 'saving',
    name: '省钱大师',
    subtitle: '硬核实用向 · 通关技巧可直接复用',
    emoji: '💰',
    color: 'red',
    levels: SAVING_LEVELS.map((l) => l.id),
    status: 'open'
  },
  { id: 'nutrition', name: '营养控卡', subtitle: '健康向 · 对接官方营养成分', emoji: '🥗', color: 'green', levels: NUTRITION_LEVELS.map(l => l.id), status: 'open' },
  { id: 'fun', name: '奇葩整活', subtitle: '欢乐向 · 黑暗料理与社交传播', emoji: '🤪', color: 'purple', levels: FUN_LEVELS.map(l => l.id), status: 'open' },
  { id: 'scene', name: '场景模拟', subtitle: '沉浸向 · 还原真实点餐场景', emoji: '🏃', color: 'blue', levels: SCENE_LEVELS.map(l => l.id), status: 'open' }
]

export const getLevel = (id) => ALL_LEVELS.find((l) => l.id === id) || null

export const CATEGORY_LABELS = {
  burger: '主食',
  snack: '小食',
  drink: '饮品',
  dessert: '甜品',
  combo: '套餐',
  sauce: '蘸酱'
}

export const REWARD_BY_STARS = { 1: 20, 2: 35, 3: 50 }
