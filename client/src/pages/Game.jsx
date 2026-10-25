import { useEffect, useMemo, useState } from 'react'
import { api, applyCouponsLocal, CATEGORY_META, couponHint, PROTEIN_META, yuan } from '../api.js'
import { StarRow } from '../components/StarRow.jsx'
import ResultModal from '../components/ResultModal.jsx'

const CATS = ['all', 'burger', 'snack', 'drink', 'dessert', 'combo', 'sauce']

export default function Game({ session, profile, storeName, onExit, onRefresh, onNextLevel, notify }) {
  const level = session.level
  const rules = level.rules || {}
  const coins = profile?.coins || 0

  const [picks, setPicks] = useState({})
  // 券包全是真券，默认全部勾上：关卡阈值本来就是按用券后实付定的，不用券等于白白多花钱
  const [couponIds, setCouponIds] = useState(session.coupons.map((coupon) => coupon.couponId))
  const [activeCat, setActiveCat] = useState('all')
  const [query, setQuery] = useState('')
  const [sortAsc, setSortAsc] = useState(true)
  const [result, setResult] = useState(null)
  const [hints, setHints] = useState(null)
  const [busy, setBusy] = useState(false)
  const [revive, setRevive] = useState(session.revive)
  const isChallenge = level.track !== 'saving'
  const assignmentMode = rules.assignmentMode
  const people = assignmentMode === 'colleagues'
    ? [{ id: 'chicken', label: '鸡肉同事' }, { id: 'beef', label: '牛肉同事' }, { id: 'nonSpicy', label: '不吃辣同事' }]
    : assignmentMode === 'family'
      ? [{ id: 'adult', label: '成人' }, { id: 'child', label: '儿童' }, { id: 'shared', label: '共享' }]
      : assignmentMode === 'party'
        ? Array.from({ length: 8 }, (_, index) => ({ id: `person${index + 1}`, label: `聚会成员 ${index + 1}` }))
        : []
  const [assignments, setAssignments] = useState([])
  const [preview, setPreview] = useState(null)
  const [previewPending, setPreviewPending] = useState(false)

  const itemMap = useMemo(() => new Map(session.items.map((item) => [item.code, item])), [session.items])

  const lines = useMemo(
    () =>
      Object.entries(picks)
        .map(([code, qty]) => ({ item: itemMap.get(code), qty }))
        .filter((line) => line.item && line.qty > 0),
    [picks, itemMap]
  )

  const subtotal = Math.round(lines.reduce((sum, line) => sum + line.item.price * line.qty, 0) * 100) / 100
  const itemCount = lines.reduce((sum, line) => sum + line.qty, 0)
  const categoryCounts = {}
  const proteinSet = new Set()
  const mainProteinSet = new Set()
  let comboCount = 0
  for (const line of lines) {
    categoryCounts[line.item.category] = (categoryCounts[line.item.category] || 0) + line.qty
    for (const part of line.item.contents || []) {
      categoryCounts[part.category] = (categoryCounts[part.category] || 0) + part.qty * line.qty
    }
    if (line.item.category === 'combo') comboCount += line.qty
    if (line.item.protein && !['none', 'mixed'].includes(line.item.protein)) {
      proteinSet.add(line.item.protein)
      if (line.item.category === 'burger' || line.item.category === 'combo') mainProteinSet.add(line.item.protein)
    }
  }
  const activeCoupons = session.coupons.filter((coupon) => couponIds.includes(coupon.couponId))
  const previewLines = lines.map((line) => ({
    code: line.item.code,
    name: line.item.name,
    category: line.item.category,
    protein: line.item.protein,
    price: line.item.price,
    qty: line.qty
  }))
  const price = applyCouponsLocal(subtotal, activeCoupons, previewLines)
  const appliedMap = new Map(price.applied.map((coupon) => [coupon.couponId, coupon]))

  const evaluated = useMemo(
    () => Object.entries(picks).map(([code, qty]) => ({ code, qty })),
    [picks]
  )

  const previewKey = JSON.stringify([session.id, evaluated, couponIds, assignments, revive])
  const currentPreview = preview?.key === previewKey ? preview.result : null

  // 所有赛道与正式提交共用后端判题，切换餐盘后不显示上一次星级。
  useEffect(() => {
    if (!evaluated.length) {
      setPreview(null)
      setPreviewPending(false)
      return undefined
    }
    let cancelled = false
    setPreviewPending(true)
    const timer = setTimeout(async () => {
      try {
        const response = await api.evaluate(session.id, {
          items: evaluated,
          couponIds,
          ...(assignmentMode ? { assignments } : {})
        })
        if (!cancelled) setPreview({ key: previewKey, result: response.preview })
      } catch {
        if (!cancelled) setPreview(null)
      } finally {
        if (!cancelled) setPreviewPending(false)
      }
    }, 300)
    return () => {
      cancelled = true
      clearTimeout(timer)
    }
  }, [previewKey, session.id, evaluated, couponIds, assignments, assignmentMode])

  const checks = []
  const sold = lines.filter((line) => line.item.soldOut)
  checks.push({
    key: 'available',
    label: '门店在售',
    ok: lines.length > 0 && sold.length === 0,
    detail: lines.length === 0 ? '还没选菜' : sold.length ? `${sold.map((l) => l.item.name).join('、')} 售罄` : '全部在售'
  })
  for (const [category, qty] of Object.entries(rules.minQty || {})) {
    const have = categoryCounts[category] || 0
    checks.push({
      key: `cat-${category}`,
      label: `${CATEGORY_META[category]?.label || category} ×${qty}`,
      ok: have >= qty,
      detail: `${have}/${qty}`
    })
  }
  if (rules.maxSameItem) {
    const over = lines.find((line) => line.qty > rules.maxSameItem)
    checks.push({
      key: 'max-same',
      label: `同一单品 ≤ ${rules.maxSameItem} 份`,
      ok: !over,
      detail: over ? `${over.item.name} ×${over.qty}` : '符合'
    })
  }
  if (rules.onlyProtein) {
    const bad = lines.filter((line) => !rules.onlyProtein.includes(line.item.protein))
    checks.push({
      key: 'protein',
      label: '全部含鸡肉',
      ok: lines.length > 0 && bad.length === 0,
      detail: bad.length ? `${bad.length} 件不符合` : '全部符合'
    })
  }
  if (rules.minItems) {
    checks.push({
      key: 'item-count',
      label: `单品 ≥ ${rules.minItems} 件`,
      ok: itemCount >= rules.minItems,
      detail: `${itemCount}/${rules.minItems}`
    })
  }
  if (rules.couponMinCount) {
    checks.push({
      key: 'coupon-count',
      label: `至少用上 ${rules.couponMinCount} 张券`,
      ok: price.applied.length >= rules.couponMinCount,
      detail: `${price.applied.length}/${rules.couponMinCount}`
    })
  }

  const extras = (level.extras || []).map((extra) => {
    let ok = false
    let detail = ''
    if (extra.type === 'category') {
      const have = categoryCounts[extra.category] || 0
      ok = have >= extra.qty
      detail = `${have}/${extra.qty} 份`
    } else if (extra.type === 'proteinCoverage') {
      const pool = extra.mainOnly ? mainProteinSet : proteinSet
      const missing = extra.proteins.filter((protein) => !pool.has(protein))
      ok = missing.length === 0
      detail = missing.length ? `缺 ${missing.map((p) => PROTEIN_META[p]?.label).join('、')}` : '已覆盖'
    } else if (extra.type === 'itemCount') {
      ok = itemCount >= extra.min
      detail = `${itemCount}/${extra.min} 件`
    } else if (extra.type === 'comboCount') {
      ok = comboCount >= extra.min
      detail = `${comboCount}/${extra.min} 个套餐`
    } else if (extra.type === 'couponCount') {
      ok = price.applied.length >= extra.min
      detail = `${price.applied.length}/${extra.min} 张`
    }
    return { label: extra.label, ok, detail }
  })

  const star2 = Number(level.thresholds?.star2)
  const star3 = Number(level.thresholds?.star3)
  const hasPriceLine = !isChallenge && Number.isFinite(star2) && star2 > 0

  const hardOk = checks.every((check) => check.ok)
  const extraFails = extras.filter((extra) => !extra.ok).length
  const pricePenalty = hasPriceLine ? (price.paid <= star3 ? 0 : price.paid <= star2 ? 1 : 2) : 0

  const shownChecks = currentPreview?.checks || (isChallenge ? [] : checks)
  const shownExtras = currentPreview?.extras || (isChallenge ? [] : extras)
  const countable = [...shownChecks, ...shownExtras].filter((item) => item.available !== false && !item.advisory)
  const doneCount = countable.filter((item) => item.ok).length

  const projected = currentPreview?.stars ?? 0
  const previewLabel = currentPreview
    ? (projected ? `预计 ${projected}★` : '未达标')
    : lines.length ? (previewPending ? '计算中…' : '待重新校验') : '未选餐'

  const filtered = session.items
    .filter((item) => (activeCat === 'all' ? true : item.category === activeCat))
    .filter((item) => (query ? item.name.includes(query) : true))
    .sort((a, b) => (sortAsc ? a.price - b.price : b.price - a.price))

  const addItem = (item) => {
    setPicks((prev) => {
      const current = prev[item.code] || 0
      if (rules.maxSameItem && current >= rules.maxSameItem) {
        notify(`同一单品最多 ${rules.maxSameItem} 份`)
        return prev
      }
      return { ...prev, [item.code]: current + 1 }
    })
  }

  const removeItem = (code) => {
    setPicks((prev) => {
      const current = prev[code] || 0
      if (current <= 1) {
        const next = { ...prev }
        delete next[code]
        return next
      }
      return { ...prev, [code]: current - 1 }
    })
  }

  const toggleCoupon = (couponId) => {
    setCouponIds((prev) => (prev.includes(couponId) ? prev.filter((id) => id !== couponId) : [...prev, couponId]))
  }

  // 餐盘减量后同步收缩分配，避免把已经不存在的份数提交给判题器
  useEffect(() => {
    setAssignments((prev) => {
      const next = []
      for (const row of prev) {
        const left = picks[row.itemCode] || 0
        if (!left) continue
        const used = next.filter((item) => item.itemCode === row.itemCode).reduce((sum, item) => sum + item.qty, 0)
        const qty = Math.min(row.qty, Math.max(0, left - used))
        if (qty > 0) next.push({ ...row, qty })
      }
      const same =
        next.length === prev.length &&
        next.every((row, index) => row.personId === prev[index].personId && row.itemCode === prev[index].itemCode && row.qty === prev[index].qty)
      return same ? prev : next
    })
  }, [picks])

  const assignItem = (personId, code, delta) => {
    const total = picks[code] || 0
    const current = assignments.find((row) => row.personId === personId && row.itemCode === code)
    const used = assignments
      .filter((row) => row.itemCode === code && row.personId !== personId)
      .reduce((sum, row) => sum + row.qty, 0)
    const qty = Math.max(0, Math.min(total - used, (current?.qty || 0) + delta))
    if (delta > 0 && qty === (current?.qty || 0)) {
      notify(`餐盘里「${itemMap.get(code)?.name || code}」只剩 ${Math.max(0, total - used)} 份可分配`)
      return
    }
    const rest = assignments.filter((row) => !(row.personId === personId && row.itemCode === code))
    setAssignments(qty > 0 ? [...rest, { personId, itemCode: code, qty }] : rest)
  }

  const submit = async () => {
    if (!lines.length || busy) return
    setBusy(true)
    try {
      const response = await api.submit(session.id, {
        items: Object.entries(picks).map(([code, qty]) => ({ code, qty })),
        couponIds,
        ...(assignmentMode ? { assignments } : {})
      })
      setResult(response)
      onRefresh()
    } catch (error) {
      notify(error.message, 'bad')
    } finally {
      setBusy(false)
    }
  }

  const useTool = async (toolId) => {
    try {
      const response = await api.useTool(toolId, session.id)
      if (response.hints) setHints(response.hints)
      if (response.revive) setRevive(true)
      notify(`已使用${toolId === 'revive' ? '免死金牌' : '价格透视镜'}，金币 -${response.coinsSpent}`)
      onRefresh()
    } catch (error) {
      notify(error.message, 'bad')
    }
  }

  const meter = isChallenge
    ? (countable.length ? Math.round((doneCount / countable.length) * 100) : 0)
    : hasPriceLine
      ? Math.min(100, Math.round((price.paid / star2) * 100))
      : 0
  const over = !isChallenge && hasPriceLine && price.paid > star2

  return (
    <div className="game">
      <div className="game-head">
        <button className="back-link" onClick={onExit}>← 退出关卡</button>
        <div className="game-title">
          <span className="game-id">{level.label}</span>
          <h1>{level.name}</h1>
          <StarRow stars={profile.stars[level.id] || 0} size="sm" />
        </div>
        <div className="game-meta">
          <span>{isChallenge ? '真实字段判定' : `理论最低 ${level.calibration.optimal != null ? yuan(level.calibration.optimal) : '—'}`}</span>
          <span>{isChallenge ? (level.objectiveText ? `目标：${level.objectiveText}` : '按真实营养字段判定') : `三星线 ${Number.isFinite(star3) ? yuan(star3) : '—'}`}</span>
        </div>
      </div>

      {session.event && (
        <div className="event-banner">
          <span className="event-tag">随机事件</span>
          <strong>{session.event.name}</strong>
          <p>{session.event.desc}</p>
        </div>
      )}

      <div className="budget-bar">
        <div className="budget-labels">
          <span>{isChallenge ? '条件完成度' : '实付进度'}</span>
          <strong>{isChallenge ? `${doneCount}/${countable.length}` : yuan(price.paid)}</strong>
          <span className="budget-note">
            {isChallenge
              ? previewPending
                ? '判定中…'
                : countable.length
                  ? `预计 ${projected}★ · 还剩 ${countable.length - doneCount} 项`
                  : '选几样菜开始判定'
              : !hasPriceLine
                ? '本关无价格线，按条件判星'
                : pricePenalty === 0
                  ? `已进前五套，三星线 ¥${star3}`
                  : pricePenalty === 1
                    ? `超出三星线 ¥${Math.round((price.paid - star3) * 10) / 10}`
                    : `超出二星线 ¥${Math.round((price.paid - star2) * 10) / 10}`}
          </span>
        </div>
        <div className="budget-track">
          <span className={`budget-fill ${over ? 'over' : ''}`} style={{ width: `${meter}%` }} />
        </div>
        <div className="budget-ticks">
          {isChallenge ? (
            <>
              <span>硬约束 + 附加条件</span>
              <span>{previewLabel}</span>
            </>
          ) : (
            <>
              <span>¥0</span>
              <span className="tick-star3">3★ 线 {Number.isFinite(star3) ? yuan(star3) : '—'}</span>
              <span className="tick-star2">2★ 线 {Number.isFinite(star2) ? yuan(star2) : '—'}</span>
            </>
          )}
        </div>
      </div>

      <div className="game-layout">
        <section className="menu-panel">
          <div className="menu-toolbar">
            <div className="cat-tabs">
              {CATS.map((cat) => (
                <button
                  key={cat}
                  className={`cat-tab ${activeCat === cat ? 'active' : ''}`}
                  onClick={() => setActiveCat(cat)}
                >
                  {cat === 'all' ? '全部' : `${CATEGORY_META[cat].emoji} ${CATEGORY_META[cat].label}`}
                </button>
              ))}
            </div>
            <div className="menu-search">
              <input
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                placeholder="搜单品，比如 麦香鸡"
                aria-label="搜索单品"
              />
              <button className="sort-btn" onClick={() => setSortAsc((prev) => !prev)}>
                价格 {sortAsc ? '↑' : '↓'}
              </button>
            </div>
          </div>

          {hints && (
            <div className="hint-strip">
              <span>🔍 透视结果</span>
              {hints.map((hint) => (
                <button key={hint.code} className="hint-chip" onClick={() => addItem(itemMap.get(hint.code))}>
                  {hint.name} {yuan(hint.price)}
                </button>
              ))}
              <button className="hint-close" onClick={() => setHints(null)}>×</button>
            </div>
          )}

          <div className="menu-grid">
            {filtered.map((item) => {
              const qty = picks[item.code] || 0
              return (
                <article
                  key={item.code}
                  className={`food-card ${qty ? 'picked' : ''} ${item.soldOut ? 'sold-out' : ''}`}
                  data-emoji={CATEGORY_META[item.category]?.emoji || '🍔'}
                >
                  <div className="food-img">
                    {item.image && <img src={item.image} alt={item.name} loading="lazy" />}
                    {item.soldOut && <div className="sold-out-mask">售罄</div>}
                  </div>
                  <div className="food-body">
                    <h4>{item.name}</h4>
                    <div className="food-tags">
                      <span>{PROTEIN_META[item.protein]?.label || '—'}</span>
                      {item.tags?.slice(0, 1).map((tag) => <span key={tag}>{tag}</span>)}
                      {item.nutrition ? (
                        <span title={`脂肪 ${item.nutrition.fat}g · 碳水 ${item.nutrition.carb}g · 钠 ${item.nutrition.sodium}mg`}>
                          {item.nutrition.kcal} kcal · 蛋白 {item.nutrition.protein}g
                        </span>
                      ) : (
                        <span className="tag-missing" title="麦当劳官方营养表未收录该商品">
                          营养未收录
                        </span>
                      )}
                    </div>
                    {(item.category === 'combo' || item.contents?.length > 0) && (
                      <p className="food-contents">
                        含 {item.contentsText || item.contents?.map((part) => `${part.name || CATEGORY_META[part.category]?.label || part.category}×${part.qty}`).join(' · ') || '门店暂未返回具体组成'}
                      </p>
                    )}
                    <div className="food-bottom">
                      <div className="food-price">
                        <strong>{yuan(item.price)}</strong>
                        {item.originalPrice > item.price && <del>{yuan(item.originalPrice)}</del>}
                      </div>
                      {!item.soldOut && (
                        qty > 0 ? (
                          <div className="stepper">
                            <button onClick={() => removeItem(item.code)} aria-label="减少">−</button>
                            <span>{qty}</span>
                            <button onClick={() => addItem(item)} aria-label="增加">+</button>
                          </div>
                        ) : (
                          <button className="add-btn" onClick={() => addItem(item)}>加入餐盘</button>
                        )
                      )}
                    </div>
                  </div>
                </article>
              )
            })}
            {filtered.length === 0 && <div className="empty-menu">没有符合条件的单品，换个关键词试试</div>}
          </div>
        </section>

        <aside className="tray-panel">
          <div className="tray-head">
            <h2>我的餐盘</h2>
            <span>{itemCount} 件</span>
          </div>

          <div className="tray-list">
            {lines.length === 0 && <p className="tray-empty">还没点任何东西。<br />从左边挑主食和饮品开始。</p>}
            {lines.map((line) => (
              <div className="tray-line" key={line.item.code}>
                <div className="tray-line-main">
                  <strong>{line.item.name}</strong>
                  <span>{yuan(line.item.price)} × {line.qty}</span>
                </div>
                <div className="tray-line-side">
                  <span>{yuan(line.item.price * line.qty)}</span>
                  <div className="stepper stepper-sm">
                    <button onClick={() => removeItem(line.item.code)}>−</button>
                    <span>{line.qty}</span>
                    <button onClick={() => addItem(line.item)}>+</button>
                  </div>
                </div>
              </div>
            ))}
          </div>

          <div className="coupon-box">
            <div className="coupon-head">
              <h3>优惠券</h3>
              <span className="coupon-count">{price.applied.length} 张生效</span>
            </div>
            <div className="coupon-list">
              {session.coupons.map((coupon) => {
                const active = couponIds.includes(coupon.couponId)
                const applied = appliedMap.get(coupon.couponId)
                return (
                  <button
                    key={coupon.couponId}
                    className={`coupon-chip ${active ? 'on' : ''}`}
                    onClick={() => toggleCoupon(coupon.couponId)}
                  >
                    <span className="coupon-main">
                      <span className="coupon-title">{coupon.title}</span>
                      <small className="coupon-desc">{couponHint(coupon)}</small>
                    </span>
                    <span className="coupon-th">
                      {applied ? `-¥${applied.saved}` : active ? '待生效' : '未选'}
                    </span>
                  </button>
                )
              })}
            </div>
            {price.skipped.length > 0 && (
              <p className="coupon-hint">{price.skipped[0].reason || `暂时用不上「${price.skipped[0].title}」`}</p>
            )}
          </div>

          <div className="check-box">
            <div className="check-head">
              <h3>{isChallenge ? '挑战判定' : '关卡要求'}</h3>
              <span className={`projected projected-${projected}`}>{previewLabel}</span>
            </div>
            <ul className="check-list">
              {shownChecks.map((check) => (
                <li
                  key={check.key}
                  className={`${check.ok ? 'ok' : 'no'}${check.available === false ? ' na' : ''}`}
                  title={check.available === false ? '官方数据不足以判定该条件' : undefined}
                >
                  <span className="check-dot">{check.ok ? '✓' : check.available === false ? '!' : '×'}</span>
                  <span className="check-label">{check.label}</span>
                  <span className="check-detail">{check.detail}</span>
                </li>
              ))}
            </ul>
            {shownExtras.length > 0 && (
              <ul className="check-list extras">
                {shownExtras.map((extra) => (
                  <li
                    key={extra.key || extra.label}
                    className={`${extra.ok ? 'ok' : 'no'}${extra.available === false ? ' na' : ''}${extra.advisory ? ' advisory' : ''}`}
                    title={extra.advisory ? '仅作参考，不影响星级' : undefined}
                  >
                    <span className="check-dot">{extra.ok ? '★' : extra.available === false ? '!' : '☆'}</span>
                    <span className="check-label">{extra.label}</span>
                    <span className="check-detail">{extra.detail}</span>
                  </li>
                ))}
              </ul>
            )}
            {isChallenge && shownChecks.length === 0 && (
              <div className="check-empty">
                {previewPending ? (
                  <p>正在计算条件…</p>
                ) : (
                  <>
                    <p>本关硬条件（选菜后实时校验）：</p>
                    <ul className="check-static">
                      {(level.constraintText || []).map((text) => (
                        <li key={text}>{text}</li>
                      ))}
                    </ul>
                    {level.star3Text && <p className="check-static-note">{level.star3Text}</p>}
                  </>
                )}
              </div>
            )}
            <p className="check-tip">💡 {level.tip}</p>
            {assignmentMode && (
              <div className="assignment-box">
                <h4>场景分配</h4>
                <p>按「人物 × 商品」分配份数；每人至少 1 份独立主食，没分配出去的份数不会算给任何人。</p>
                <div className="assignment-list">
                  {people.map((person) => (
                    <div className="assignment-row" key={person.id}>
                      <span className="assignment-person">{person.label}</span>
                      <div className="assignment-items">
                        {lines.length === 0 && <em>先从左边选餐盘商品</em>}
                        {lines.map((line) => {
                          const row = assignments.find((item) => item.personId === person.id && item.itemCode === line.item.code)
                          return (
                            <div className={`assignment-item ${row ? 'on' : ''}`} key={line.item.code}>
                              <span className="assignment-item-name">{line.item.name}</span>
                              <div className="stepper stepper-sm">
                                <button onClick={() => assignItem(person.id, line.item.code, -1)} aria-label={`减少 ${line.item.name} 分配`}>−</button>
                                <span>{row?.qty || 0}</span>
                                <button onClick={() => assignItem(person.id, line.item.code, 1)} aria-label={`增加 ${line.item.name} 分配`}>+</button>
                              </div>
                            </div>
                          )
                        })}
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}
            {isChallenge && session.level.calibration?.unsolvable && (
              <p className="unavailable-note">本关当前商品数据不足，部分条件暂不可用；提交后会明确返回 unavailable，不会伪造通过。</p>
            )}
          </div>

          <div className="tool-row">
            <button className="tool-btn" onClick={() => useTool('price_mirror')}>
              🔍 透视镜 <span className={coins < 50 ? 'short' : ''}>50</span>
            </button>
            <button
              className={`tool-btn ${revive ? 'used' : ''}`}
              onClick={() => useTool('revive')}
              disabled={revive || isChallenge}
              title={isChallenge ? '挑战关卡按真实条件判星，免死金牌不生效' : undefined}
            >
              {isChallenge ? '🛡️ 本关不适用' : revive ? '🛡️ 已待命' : <>🛡️ 免死金牌 <span className={coins < 100 ? 'short' : ''}>100</span></>}
            </button>
          </div>

          <div className="tray-foot">
            <div className="tray-total">
              <div>
                <span>原价</span>
                <strong>{yuan(subtotal)}</strong>
              </div>
              <div>
                <span>优惠</span>
                <strong className="discount">-{yuan(price.discount)}</strong>
              </div>
              <div className="pay">
                <span>实付</span>
                <strong>{yuan(price.paid)}</strong>
              </div>
            </div>
            <button className="btn btn-red btn-submit" disabled={!lines.length || busy} onClick={submit}>
              {busy ? '判题中…' : '提交搭配'}
            </button>
            {revive && <p className="revive-note">免死金牌已待命：硬性要求没达标也会判 1 星通关</p>}
          </div>
        </aside>
      </div>

      {result && (
        <ResultModal
          data={result}
          level={level}
          storeName={storeName}
          onRetry={() => {
            setResult(null)
            setPicks({})
            setHints(null)
          }}
          onNext={() => {
            if (result.nextLevel) onNextLevel(result.nextLevel.id)
          }}
          onClose={() => setResult(null)}
          onExit={onExit}
        />
      )}
    </div>
  )
}
