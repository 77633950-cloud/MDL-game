import { useEffect, useState } from 'react'

export default function StorePicker({
  open,
  stores = [],
  current,
  reference,
  origin,
  locateState,
  geoDenied,
  busy,
  searching,
  searchedKeyword,
  onRelocate,
  onSearch,
  onSelect,
  onClose
}) {
  const [query, setQuery] = useState('')

  // 搜索成功后清空输入框，让 MCP 返回的结果完整展示（否则本地过滤会把结果又筛掉一部分）
  useEffect(() => {
    if (searchedKeyword) setQuery('')
  }, [searchedKeyword])

  useEffect(() => {
    if (!open) {
      setQuery('')
      return
    }
    const onKey = (event) => {
      if (event.key === 'Escape' && !busy) onClose()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [open, busy, onClose])

  if (!open) return null

  const keyword = query.trim()
  const visible = keyword
    ? stores.filter((store) =>
        [store.name, store.shortName, store.address].some((text) => (text || '').includes(keyword))
      )
    : stores

  const locating = locateState === 'locating'
  const where = origin?.address || reference?.address || ''
  const basis = origin
    ? origin.source === 'gps'
      ? `浏览器 GPS 定位到「${where || origin.label || '你所在位置'}」`
      : geoDenied
        ? `浏览器定位权限被拒绝，只能按 IP 判断你在「${origin.city || reference?.city || '本城市'}」${
            origin.district ? `（${origin.district}）` : ''
          }，这个位置只到城区中心。在地址栏左侧允许定位后点「重新定位」，或直接搜索门店`
        : `IP 定位只到城市级，判你在「${origin.city || reference?.city || '本城市'}」${
            origin.district ? `（${origin.district}）` : ''
          }。城区内可能偏几公里，允许浏览器定位、或直接搜索门店会更准`
    : reference?.source === 'default'
      ? `默认基准点「${reference.label}」，点「重新定位」可以按你的实际位置找店`
      : ''

  return (
    <div className="modal-mask" role="dialog" aria-modal="true" onClick={() => !busy && onClose()}>
      <div className="store-modal" onClick={(event) => event.stopPropagation()}>
        <button className="modal-close" onClick={onClose} disabled={busy} aria-label="关闭">×</button>
        <div className="store-modal-head">
          <img src="/mcd-logo.png" alt="" className="store-modal-logo" />
          <div>
            <h2>切换门店</h2>
            <p>菜单、价格、预算线、券包都会按所选门店重新适配。</p>
          </div>
        </div>

        <div className="store-locate">
          <span className={`locate-dot locate-${locateState}`} aria-hidden="true" />
          <span className="locate-text">
            {locating
              ? '正在定位你的位置…'
              : basis || '暂未拿到你的位置，门店按默认基准点排序'}
          </span>
          <button className="locate-btn" onClick={onRelocate} disabled={locating || busy}>
            {locating ? '定位中…' : '重新定位'}
          </button>
        </div>

        <div className="store-search">
          <input
            type="search"
            value={query}
            placeholder="搜索门店名或地址，例如「万象城」"
            onChange={(event) => setQuery(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === 'Enter' && keyword && !searching) onSearch(keyword)
            }}
            disabled={busy}
          />
          <button
            className="store-search-btn"
            onClick={() => keyword && onSearch(keyword)}
            disabled={!keyword || searching || busy}
          >
            {searching ? '搜索中…' : '搜索'}
          </button>
        </div>

        {searchedKeyword && (
          <p className="store-search-note">
            已按「{searchedKeyword}」从麦当劳 MCP 搜到 {stores.length} 家门店，点「重新定位」可回到附近门店
          </p>
        )}

        <div className="store-list">
          {visible.map((store) => {
            const active = store.code === current?.code
            return (
              <button
                key={store.code}
                className={`store-option ${active ? 'on' : ''}`}
                onClick={() => !active && onSelect(store.code)}
                disabled={busy || active}
              >
                <span className="store-option-mark" aria-hidden="true">
                  <img src="/mcd-logo.png" alt="" />
                </span>
                <span className="store-option-body">
                  <strong>{store.shortName}</strong>
                  <small>{store.name}</small>
                  <em>{store.address}</em>
                </span>
                <span className="store-option-side">
                  <span className="store-distance">{store.distanceLabel || '距离待定位'}</span>
                  <span className="store-factor">
                    {store.hours ? `${store.hours} · ${store.openNow ? '营业中' : '休息中'}` : store.priceNote}
                  </span>
                  {active && <span className="store-current">当前门店</span>}
                </span>
              </button>
            )
          })}
          {!visible.length && (
            <p className="store-empty">
              {keyword
                ? `附近列表里没有「${keyword}」。点「搜索」让麦当劳 MCP 按这个关键词再查一次。`
                : '没有可用的门店列表，请点「重新定位」再试。'}
            </p>
          )}
        </div>

        <p className="store-modal-note">
          {busy
            ? '正在切换门店，重新拉取菜单与价格…'
            : `门店号、名称、地址、营业时间来自麦当劳 MCP query-nearby-stores，菜单 / 价格 / 营养按门店实时拉取，可领券与卡包券来自 available-coupons 和 query-my-coupons。距离是「你 → 门店」的直线距离，用高德把你的位置和门店坐标对上后算的${
                origin?.source === 'ip' ? '（IP 定位只到城市级，标「约」）' : ''
              }。切换门店不会清空已获得的星星和金币。`}
        </p>
      </div>
    </div>
  )
}