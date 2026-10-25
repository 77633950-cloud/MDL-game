import { useEffect, useRef, useState } from 'react'
import { api, CATEGORY_META, yuan } from '../api.js'
import { buildShareCard, downloadShareCard, shareText } from '../shareCard.js'

const STAR_TITLES = { 3: '完美通关', 2: '良好通关', 1: '成功通关', 0: '挑战失败' }
const SCORE_EMOJI = { price: '💰', nutrition: '🥗', compliance: '✅', challenge: '🏁' }
const STAR_QUIPS = {
  3: '预算压到底，隐藏条件也凑齐了。',
  2: '省得漂亮，再抠一点就是三星。',
  1: '过关了，但这条路线还能再优化。',
  0: '硬约束或预算没过，看一眼账单再战。'
}

export default function ResultModal({ data, level, storeName, onRetry, onNext, onClose, onExit }) {
  const { result, coinsEarned = 0, newAchievements = [], nextLevel, profile } = data
  const [preview, setPreview] = useState('')
  const [shared, setShared] = useState(false)
  const [shareNote, setShareNote] = useState('')
  const modalRef = useRef(null)

  const passed = result.stars > 0
  const failedChecks = [...(result.checks || []), ...(result.extras || [])]
    .filter((check) => check.available !== false && !check.advisory && !check.ok)

  useEffect(() => {
    const canvas = buildShareCard({ level, result, storeName: storeName || '麦当劳门店' })
    setPreview(canvas.toDataURL('image/png'))
  }, [level, result, storeName])

  useEffect(() => {
    const onKey = (event) => {
      if (event.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', onKey)
    document.body.style.overflow = 'hidden'
    return () => {
      window.removeEventListener('keydown', onKey)
      document.body.style.overflow = ''
    }
  }, [onClose])

  const rewardShare = async () => {
    if (shared) return
    try {
      const response = await api.share()
      setShared(true)
      setShareNote(`分享奖励 +${response.coinsEarned} 金币`)
    } catch (error) {
      setShared(true)
      setShareNote(error.message)
    }
  }

  const handleDownload = async () => {
    downloadShareCard({ level, result, storeName: storeName || '麦当劳门店' }, `${level.label || level.id}-${result.stars}star.png`)
    await rewardShare()
  }

  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(shareText({ level, result }))
      setShareNote('文案已复制，去群里整活吧')
    } catch {
      setShareNote('浏览器不允许复制，手动截图也行')
    }
    await rewardShare()
  }

  return (
    <div className="modal-mask" role="dialog" aria-modal="true" onClick={onClose}>
      <div className="result-modal" ref={modalRef} onClick={(event) => event.stopPropagation()}>
        <button className="modal-close" onClick={onClose} aria-label="关闭">×</button>

        <div className={`result-stars result-stars-${result.stars}`}>
          {[0, 1, 2].map((index) => (
            <span
              key={index}
              className={`result-star ${index < result.stars ? 'on' : ''}`}
              style={{ animationDelay: `${index * 120}ms` }}
            >
              ★
            </span>
          ))}
        </div>

        <h2 className="result-title">{STAR_TITLES[result.stars]}</h2>
        <p className="result-quip">
          {result.revived ? '免死金牌生效，虽然超了预算但算你过关。' : STAR_QUIPS[result.stars]}
        </p>

        {passed && (
          <div className="result-reward">
            <span>金币 +{coinsEarned}</span>
            {result.reward > 0 && <em>本关基础奖励 {result.reward}</em>}
            {newAchievements.map((item) => (
              <span className="result-badge" key={item.id}>🏅 {item.title} +{item.bonus}</span>
            ))}
          </div>
        )}

        <div className="result-data">
          <div>
            <span>实付</span>
            <strong>{yuan(result.paid)}</strong>
          </div>
          <div>
            <span>原价</span>
            <strong>{yuan(result.subtotal)}</strong>
          </div>
          <div>
            <span>优惠</span>
            <strong className="discount">{result.discount > 0 ? `-${yuan(result.discount)}` : '¥0.0'}</strong>
          </div>
          <div>
            <span>件数</span>
            <strong>{result.itemCount} 件</strong>
          </div>
        </div>

        {level.id === 'S05' && (
          <p className="result-rate">优惠比例 {(result.discountRate * 100).toFixed(1)}%</p>
        )}

        {result.scores && (
          <div className="result-scores">
            {Object.entries(result.scores).map(([key, score]) => {
              const value = Number(score?.value ?? 0)
              const isTen = score?.max === 10
              return (
                <article className={`score-card score-${key}`} key={key}>
                  <div className="score-head">
                    <span>{SCORE_EMOJI[key] || '🎯'} {score?.label || key}</span>
                    <strong>
                      {isTen ? value.toFixed(1) : (Number.isFinite(value) ? value : '—')}
                      {isTen && <em>/10</em>}
                    </strong>
                  </div>
                  {isTen && (
                    <div className="score-bar">
                      <span style={{ width: `${Math.max(0, Math.min(100, value * 10))}%` }} />
                    </div>
                  )}
                  <p>{score?.note || '暂无评分说明'}</p>
                </article>
              )
            })}
          </div>
        )}

        <div className="result-body">
          <div className="result-block">
            <h3>这单吃了什么</h3>
            <ul className="result-lines">
              {(result.lines || []).map((line) => (
                <li key={line.code}>
                  <span className="result-line-name">
                    {line.name}
                    {line.contents?.length > 0 && (
                      <em className="result-line-contents">
                        含 {line.contents.map((part) => `${CATEGORY_META[part.category]?.label || part.category}×${part.qty}`).join(' · ')}
                      </em>
                    )}
                  </span>
                  <span className="result-line-qty">×{line.qty}</span>
                  <span className="result-line-price">{yuan(line.subtotal)}</span>
                </li>
              ))}
            </ul>
            {result.coupons?.applied?.length > 0 && (
              <div className="result-coupons">
                {result.coupons.applied.map((coupon) => (
                  <span key={coupon.couponId} className="result-coupon">
                    {coupon.title} -¥{coupon.saved}
                  </span>
                ))}
              </div>
            )}
          </div>

          <div className="result-block">
            <h3>{passed ? '达标情况' : '还差什么'}</h3>
            <ul className="result-checks">
              {(result.checks || []).map((check) => (
                <li
                  key={check.key || check.label}
                  className={`${check.ok ? 'ok' : 'no'}${check.available === false ? ' na' : ''}`}
                >
                  <span>{check.ok ? '✓' : check.available === false ? '!' : '×'}</span>
                  <span className="result-check-label">{check.label}</span>
                  <span className="result-check-detail">{check.detail}</span>
                </li>
              ))}
              {(result.extras || []).map((extra) => (
                <li
                  key={extra.key || extra.label}
                  className={`${extra.ok ? 'ok' : 'no'}${extra.advisory ? ' advisory' : ''}`}
                >
                  <span>{extra.ok ? '★' : extra.advisory ? 'i' : '☆'}</span>
                  <span className="result-check-label">{extra.label}</span>
                  <span className="result-check-detail">{extra.detail}</span>
                </li>
              ))}
            </ul>

            {!passed && result.suggestions?.length > 0 && (
              <div className="result-suggest">
                <h4>优化建议</h4>
                <ul>
                  {result.suggestions.map((text) => (
                    <li key={text}>{text}</li>
                  ))}
                </ul>
              </div>
            )}
            {passed && failedChecks.length > 0 && (
              <p className="result-hint">想冲三星：{failedChecks.map((check) => check.label).join('、')}</p>
            )}
            {passed && failedChecks.length === 0 && result.stars === 3 && (
              <p className="result-hint">隐藏条件全部达成，这关已经没有更优解了。</p>
            )}
            {result.optimal != null && (
              <p className="result-hint">本店理论最低价：{yuan(result.optimal)}</p>
            )}
          </div>
        </div>

        <div className="result-share">
          <div className="share-preview">
            {preview ? <img src={preview} alt="战绩卡预览" /> : <div className="share-loading">正在生成战绩卡…</div>}
          </div>
          <div className="share-actions">
            <h3>战绩卡</h3>
            <p>包含关卡、星级、实付和完整组合，可直接发群。</p>
            <button className="btn btn-yellow" onClick={handleDownload}>下载战绩卡</button>
            <button className="btn btn-paper" onClick={handleCopy}>复制分享文案</button>
            {shareNote && <span className="share-note">{shareNote}</span>}
          </div>
        </div>

        <div className="result-actions">
          <button className="btn btn-paper" onClick={onRetry}>再来一次</button>
          {passed && nextLevel && (
            <button className="btn btn-yellow" onClick={onNext}>
              下一关 {nextLevel.label || nextLevel.id}
            </button>
          )}
          <button className="btn btn-ghost" onClick={onExit}>回到关卡列表</button>
        </div>
        {profile && <span className="result-foot">当前金币 {profile.coins} · 已收集 {profile.totalStars}/{profile.maxStars} 星</span>}
      </div>
    </div>
  )
}
