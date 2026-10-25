export const EVENT_RATE = 0.15

const pick = (arr) => arr[Math.floor(Math.random() * arr.length)]

const candidates = ['sold_out', 'points_double', 'new_item_discount']

export function rollEvent(levelId, items) {
  if (Math.random() > EVENT_RATE) return null

  const pool = items.filter((i) => i.category !== 'merch')
  if (!pool.length) return null

  const id = pick(candidates)

  if (id === 'sold_out') {
    const popular = pool.filter((i) => i.popular)
    const target = pick(popular.length ? popular : pool)
    return {
      id,
      name: '热门单品售罄',
      desc: `「${target.name}」临时售罄，本关不可选，换个单品顶上`,
      soldOutCode: target.code
    }
  }

  if (id === 'points_double') {
    return { id, name: '会员积分翻倍', desc: '本关通关金币奖励 ×2', pointsMultiplier: 2 }
  }

  if (id === 'new_item_discount') {
    const newItems = pool.filter((i) => (i.tags || []).some((t) => t.includes('上新')))
    const target = pick(newItems.length ? newItems : pool)
    return {
      id,
      name: '新品限时折扣',
      desc: `「${target.name}」立减 ¥2，鼓励尝鲜`,
      discountedCode: target.code,
      discountDelta: 2
    }
  }

  return null
}
