import { StarRow } from './StarRow.jsx'

export default function TopBar({ profile, store, onCheckin, onOpenStore, onHome, onLogout }) {
  return (
    <header className="topbar">
      <button className="brand" onClick={onHome} title="回到首页">
        <img className="brand-logo" src="/mcd-logo.png" alt="麦当劳" />
        <span className="brand-text">
          <strong>麦门省钱大闯关</strong>
          <small>MCD SAVING QUEST</small>
        </span>
      </button>

      {store && (
        <button className="store-pill" onClick={onOpenStore} title="切换门店">
          <img src="/mcd-logo.png" alt="" className="store-pill-logo" />
          <span>
            <strong>{store.shortName}</strong>
            <small>#{store.code} · 切换门店</small>
          </span>
          <em aria-hidden="true">⇄</em>
        </button>
      )}

      <div className="topbar-right">
        <div className="user-pill" title="当前登录账号">
          <span className="user-dot" aria-hidden="true">M</span>
          <strong>{profile.username}</strong>
        </div>
        <div className="progress-pill" title="省钱赛道星数">
          <StarRow stars={profile.totalStars} max={3} compact />
          <span>{profile.totalStars}/{profile.maxStars}</span>
        </div>
        <div className="coin-pill">
          <span className="coin-dot" aria-hidden="true">¥</span>
          <strong>{profile.coins}</strong>
          <em>金币</em>
        </div>
        <button className="btn btn-mini btn-yellow" onClick={onCheckin} disabled={profile.checkedInToday}>
          {profile.checkedInToday ? '今日已签' : '签到 +20'}
        </button>
        <button className="btn btn-mini btn-ghost topbar-logout" onClick={onLogout}>
          退出
        </button>
      </div>
    </header>
  )
}
