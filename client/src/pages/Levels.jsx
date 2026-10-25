import { StarRow } from '../components/StarRow.jsx'
import { yuan } from '../api.js'

const DIFFICULTY = ['★', '★★', '★★★', '★★★★', '★★★★★']

export default function Levels({ boot, trackId, onBack, onOpenLevel, loadingLevel }) {
  const track = boot.tracks.find((item) => item.id === trackId) || boot.tracks[0]
  const levels = track.levels || []
  const challengeTrack = trackId !== 'saving'

  return (
    <div className="levels">
      <button className="back-link" onClick={onBack}>← 返回首页</button>

      <header className="levels-head">
        <div>
          <span className="sticker sticker-yellow">{track.emoji} 赛道</span>
          <h1>{track.name}</h1>
          <p>{track.subtitle} · 共 {levels.length} 关，难度逐级递进</p>
        </div>
        <div className="levels-score">
          <strong>{levels.reduce((sum, level) => sum + level.stars, 0)}<i>/15</i></strong>
          <span>赛道星数</span>
        </div>
      </header>

      <div className="levels-note">
        <span>规则</span>
        <p>通关后解锁下一关。目标价按本店实时价格校准，实际可执行；同一关可反复挑战刷新最佳成绩。</p>
      </div>

      <div className="level-list">
        {levels.map((level) => {
          const locked = !level.unlocked
          const cal = level.calibration
          return (
            <article className={`level-card ${locked ? 'level-locked' : ''}`} key={level.id}>
              <div className="level-index">
                <span>{level.label}</span>
                <small>难度：{level.difficulty}★</small>
              </div>
              <div className="level-main">
                <div className="level-title-row">
                  <h2>{level.name}</h2>
                  <StarRow stars={level.stars} />
                  <span className="difficulty">{DIFFICULTY[level.difficulty - 1]}</span>
                </div>
                <p className="level-tagline">{level.tagline}</p>
                {challengeTrack && <p className="level-explain">{level.tip || '提交后按真实字段返回 checks、extras、metrics 与不可用提示。'}</p>}
                <div className="level-chips">
                  {level.constraintText.map((text) => (
                    <span className="chip" key={text}>{text}</span>
                  ))}
                  {cal.adjusted && <span className="chip chip-blue">本店校准 ×{cal.factor}</span>}
                </div>
                <div className="level-goals">
                  <div>
                    <span>3★ 满分</span>
                    <strong>{level.star3Text}</strong>
                  </div>
                  <div>
                    <span>2★ 通关</span>
                    <strong>{level.budgetText}</strong>
                  </div>
                  <div>
                    <span>1★ 保底</span>
                    <strong>满足硬性要求，但价格超出或差 2 个隐藏条件</strong>
                  </div>
                  {level.bestPaid != null && (
                    <div>
                      <span>最佳实付</span>
                      <strong>{yuan(level.bestPaid)}</strong>
                    </div>
                  )}
                </div>
              </div>
              <div className="level-side">
                <button
                  className={`btn ${locked ? 'btn-locked' : 'btn-red'}`}
                  disabled={locked || loadingLevel}
                  onClick={() => onOpenLevel(level.id)}
                >
                  {locked ? '🔒 未解锁' : level.stars > 0 ? '再挑战' : '开始挑战'}
                </button>
                {cal.adjusted && (
                  <small className="level-base">
                    门店理论最低 ¥{cal.optimal} · 三星线 ¥{level.thresholds.star3}
                  </small>
                )}
              </div>
            </article>
          )
        })}
      </div>
    </div>
  )
}
