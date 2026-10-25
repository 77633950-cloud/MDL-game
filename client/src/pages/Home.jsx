import { yuan } from '../api.js'
import { StarRow } from '../components/StarRow.jsx'

const TICKER = [
  '麦门省钱大闯关',
  '真实菜单 · 真实价格 · 真实优惠券',
  '1 星通关不算赢',
  '套餐拆开也算品类',
  '别让套餐刺客得逞',
  '每一关都能直接抄作业'
]

export default function Home({ boot, onOpenTrack, onOpenLevel, onOpenStore, loadingLevel }) {
  let lastTrackId = 'saving'
  try {
    lastTrackId = localStorage.getItem(`mdl:last-track:${boot.profile.id}`) || 'saving'
  } catch {
    // 浏览器禁用存储时使用默认赛道。
  }
  const activeTrack = boot.tracks.find((track) => track.id === lastTrackId && track.status === 'open')
    || boot.tracks.find((track) => track.id === 'saving')
  const levels = activeTrack?.levels ?? []
  const trackStars = levels.reduce((sum, level) => sum + level.stars, 0)
  const nextLevel = levels.find((level) => level.stars < 3 && level.unlocked) || levels[levels.length - 1]
  const cleared = levels.filter((level) => level.stars > 0).length
  const isNewPlayer = cleared === 0
  const adjusted = activeTrack?.id === 'saving' && levels.find((level) => level.calibration?.adjusted)

  return (
    <div className="home">
      <section className="hero">
        <div className="hero-copy">
          <div className="sticker sticker-red">麦当劳 MCP 官方数据</div>
          <h1 className="hero-title">
            麦门
            <span className="hero-title-accent">省钱</span>
            大闯关
          </h1>
          <p className="hero-lede">
            按真实门店菜单点餐，在限定预算里凑出一份能吃饱的组合。
            <br />
            每一关都来自今天的真实价格，通关方案可以直接拿到柜台用。
          </p>
          <div className="hero-actions">
            <button className="btn btn-big btn-yellow" onClick={() => onOpenTrack(activeTrack?.id || 'saving')}>
              进入{activeTrack?.id === 'saving' ? '省钱赛道' : activeTrack?.name} <span aria-hidden="true">→</span>
            </button>
            <button
              className="btn btn-big btn-paper"
              disabled={!nextLevel || loadingLevel}
              onClick={() => nextLevel && onOpenLevel(nextLevel.id)}
            >
              {loadingLevel ? '正在进店…' : `${isNewPlayer ? '开始挑战' : '继续挑战'} ${nextLevel?.label || ''}`}
            </button>
          </div>
          <div className="hero-stats">
            <div>
              <strong>{cleared}/{levels.length}</strong>
              <span>已通关</span>
            </div>
            <div>
              <strong>{trackStars}/{levels.length * 3}</strong>
              <span>已收集星</span>
            </div>
            <div>
              <strong>{boot.profile.coins}</strong>
              <span>金币余额</span>
            </div>
          </div>
        </div>

        <aside className="store-ticket">
          <div className="ticket-top">
            <span className="ticket-brand">
              <img src="/mcd-logo.png" alt="" />
              本关基准门店
            </span>
            <span className="ticket-dot" />
          </div>
          <h2>{boot.store.name}</h2>
          <p className="ticket-address">{boot.store.address}</p>
          <div className="ticket-divider" />
          <dl className="ticket-grid">
            <div>
              <dt>数据源</dt>
              <dd>{boot.source.label}</dd>
            </div>
            <div>
              <dt>快照时间</dt>
              <dd>{boot.source.store.fetchedAt?.slice(0, 16)}</dd>
            </div>
            <div>
              <dt>菜单状态</dt>
              <dd>{boot.source.degraded ? '降级缓存' : '实时可用'}</dd>
            </div>
            <div>
              <dt>优惠券</dt>
              <dd>{boot.coupons.list.length ? `${boot.coupons.list.length} 张可用（全部真实）` : '暂无可用券'}</dd>
            </div>
          </dl>
          <button className="store-switch-btn" onClick={onOpenStore}>
            <span aria-hidden="true">⇄</span> 切换门店
          </button>
          <div className="ticket-footer">
            <span className="barcode" aria-hidden="true" />
            <span>STORE #{boot.store.code}</span>
          </div>
        </aside>
      </section>

      <div className="ticker" aria-hidden="true">
        <div className="ticker-track">
          {[...TICKER, ...TICKER].map((text, index) => (
            <span key={index}>{text}<i>✦</i></span>
          ))}
        </div>
      </div>

      {adjusted && (
        <section className="notice">
          <span className="notice-tag">物价校准</span>
          <p>
            每关会先用「本店真实价格 + 你券包里的真券」算出前 5 套合法搭配，取其中最高价作为 3 星线：买齐这五套任意一套就是 3
            星，超出一点点拿 2 星，差得多或少了隐藏条件只能拿 1 星（例如
            {' '}{levels[0].name}：{levels[0].answerText || '—'}，3 星线 {yuan(levels[0].thresholds.star3)}、2 星线{' '}
            {yuan(levels[0].thresholds.star2)}）。价格、预算与券包已按当前门店自动重算，换个门店也能照着抄作业。
          </p>
        </section>
      )}

      <section className="section">
        <div className="section-head">
          <h2>四大赛道</h2>
          <span className="section-sub">省钱 · 营养 · 整活 · 场景</span>
        </div>
        <div className="track-grid">
          {boot.tracks.map((track) => {
            const open = track.status === 'open'
            const trackStars = track.levels.reduce((sum, level) => sum + level.stars, 0)
            return (
              <button
                key={track.id}
                className={`track-card track-${track.color} ${open ? '' : 'track-soon'}`}
                onClick={() => open && onOpenTrack(track.id)}
                disabled={!open}
              >
                <div className="track-emoji">{track.emoji}</div>
                <div className="track-body">
                  <h3>{track.name}</h3>
                  <p>{track.subtitle}</p>
                  {open ? (
                    <>
                      <div className="track-progress">
                        <span style={{ width: `${(trackStars / 15) * 100}%` }} />
                      </div>
                      <div className="track-meta">
                        <StarRow stars={trackStars} max={15} size="sm" compact />
                        <span>{trackStars}/15</span>
                      </div>
                    </>
                  ) : (
                    <span className="soon-badge">敬请期待</span>
                  )}
                </div>
                {open && <span className="track-arrow">→</span>}
              </button>
            )
          })}
        </div>
      </section>

      <section className="section">
        <div className="section-head">
          <h2>星级怎么算</h2>
          <span className="section-sub">同一关可以反复刷</span>
        </div>
        <div className="rule-grid">
          <article className="rule-card">
            <b>★</b>
            <h3>通关</h3>
            <p>满足全部硬约束，实付进入本店前 5 套合法搭配。</p>
          </article>
          <article className="rule-card">
            <b>★★</b>
            <h3>良好</h3>
            <p>继续省，压到前 5 套里第二便宜的价位。</p>
          </article>
          <article className="rule-card">
            <b>★★★</b>
            <h3>完美</h3>
            <p>压到最低价，同时凑齐本关隐藏搭配条件。</p>
          </article>
        </div>
      </section>

      {boot.profile.history.length > 0 && (
        <section className="section">
          <div className="section-head">
            <h2>最近战绩</h2>
            <span className="section-sub">记录会写进战绩卡</span>
          </div>
          <div className="history-list">
            {boot.profile.history.slice(0, 4).map((item, index) => (
              <div className="history-row" key={`${item.at}-${index}`}>
                <span className="history-id">{item.label || item.levelId}</span>
                <span className="history-name">{item.name}</span>
                <span className="history-paid">{yuan(item.paid)}</span>
                <StarRow stars={item.stars} size="sm" />
              </div>
            ))}
          </div>
        </section>
      )}

      <section className="achievement-strip">
        {boot.profile.achievements.length > 0 ? (
          boot.profile.achievements.map((item) => (
            <div className="achievement" key={item.id}>
              <span className="achievement-icon">🏅</span>
              <div>
                <strong>{item.title}</strong>
                <p>{item.desc}</p>
              </div>
            </div>
          ))
        ) : (
          <div className="achievement achievement-locked">
            <span className="achievement-icon">🏅</span>
            <div>
              <strong>麦门抠门大师</strong>
              <p>省钱赛道 5 关全部 3 星即可解锁，额外 +100 金币</p>
            </div>
          </div>
        )}
        <div className="achievement-tip">
          当前称号预览：<strong>{boot.profile.achievements.length ? '麦门抠门大师' : '省钱练习生'}</strong>
        </div>
      </section>
    </div>
  )
}
