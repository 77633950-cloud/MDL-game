import { yuan } from './api.js'

const W = 1080
const H = 1560

function roundRect(ctx, x, y, w, h, r) {
  ctx.beginPath()
  ctx.moveTo(x + r, y)
  ctx.arcTo(x + w, y, x + w, y + h, r)
  ctx.arcTo(x + w, y + h, x, y + h, r)
  ctx.arcTo(x, y + h, x, y, r)
  ctx.arcTo(x, y, x + w, y, r)
  ctx.closePath()
}

function wrapText(ctx, text, x, y, maxWidth, lineHeight) {
  const chars = [...text]
  let line = ''
  let cursorY = y
  for (const char of chars) {
    const test = line + char
    if (ctx.measureText(test).width > maxWidth && line) {
      ctx.fillText(line, x, cursorY)
      line = char
      cursorY += lineHeight
    } else {
      line = test
    }
  }
  if (line) ctx.fillText(line, x, cursorY)
  return cursorY + lineHeight
}

const C = {
  red: '#DA291C',
  redDark: '#8E1710',
  yellow: '#FFC72C',
  cream: '#FFF6E3',
  ink: '#1A0F0A',
  paper: '#FFFDF7'
}

const SLOGANS = {
  3: ['省钱之神实锤', '这账算得比收银机还快', '麦门精算师已上线'],
  2: ['省得漂亮，还能再压一压', '这一餐，稳', '距离满分只差一点点'],
  1: ['过关了，但还能更省', '能吃饱，就是胜利', '先通关，再优化'],
  0: ['别灰心，换个组合再来', '这单超了，下一单稳住', '省钱路上总要交点学费']
}

export function buildShareCard({ level, result, storeName }) {
  const canvas = document.createElement('canvas')
  canvas.width = W
  canvas.height = H
  const ctx = canvas.getContext('2d')
  const stars = result.stars

  ctx.fillStyle = C.red
  ctx.fillRect(0, 0, W, H)

  // 背景圆点与斜纹
  ctx.fillStyle = 'rgba(255,199,44,0.18)'
  for (let y = 60; y < H; y += 90) {
    for (let x = 40 + ((y / 90) % 2) * 45; x < W; x += 90) {
      ctx.beginPath()
      ctx.arc(x, y, 7, 0, Math.PI * 2)
      ctx.fill()
    }
  }
  ctx.save()
  ctx.globalAlpha = 0.08
  ctx.strokeStyle = C.cream
  ctx.lineWidth = 26
  for (let x = -H; x < W; x += 180) {
    ctx.beginPath()
    ctx.moveTo(x, H)
    ctx.lineTo(x + H, 0)
    ctx.stroke()
  }
  ctx.restore()

  // 顶部标题
  ctx.fillStyle = C.yellow
  ctx.font = '900 44px "Microsoft YaHei", "PingFang SC", sans-serif'
  ctx.fillText('麦门省钱大闯关', 80, 120)
  ctx.fillStyle = C.cream
  ctx.font = '700 26px "Microsoft YaHei", "PingFang SC", sans-serif'
  ctx.fillText('MCD SAVING QUEST · 真实门店战绩', 80, 165)

  // 小票
  const PX = 70
  const PY = 220
  const PW = W - 140
  const PH = 1000
  ctx.save()
  ctx.shadowColor = 'rgba(0,0,0,0.35)'
  ctx.shadowBlur = 0
  ctx.shadowOffsetY = 18
  ctx.fillStyle = C.paper
  roundRect(ctx, PX, PY, PW, PH, 26)
  ctx.fill()
  ctx.restore()

  ctx.fillStyle = C.ink
  ctx.font = '900 34px "Microsoft YaHei", "PingFang SC", sans-serif'
  ctx.fillText(`${level.label || level.id} · ${level.name}`, PX + 56, PY + 78)
  ctx.strokeStyle = C.ink
  ctx.lineWidth = 3
  ctx.setLineDash([12, 10])
  ctx.beginPath()
  ctx.moveTo(PX + 40, PY + 112)
  ctx.lineTo(PX + PW - 40, PY + 112)
  ctx.stroke()
  ctx.setLineDash([])

  // 星级
  const starSize = 92
  ctx.font = `900 ${starSize}px "Arial Black", "Microsoft YaHei", sans-serif`
  const starY = PY + 220
  for (let i = 0; i < 3; i++) {
    ctx.fillStyle = i < stars ? C.yellow : '#E4DCC8'
    ctx.fillText('★', PX + 56 + i * 108, starY)
  }
  if (stars > 0) {
    ctx.fillStyle = C.red
    ctx.font = '900 30px "Microsoft YaHei", "PingFang SC", sans-serif'
    ctx.fillText(stars === 3 ? '完美通关' : stars === 2 ? '良好通关' : '成功通关', PX + PW - 260, starY - 20)
  } else {
    ctx.fillStyle = C.red
    ctx.font = '900 32px "Microsoft YaHei", "PingFang SC", sans-serif'
    ctx.fillText('挑战失败', PX + PW - 230, starY - 20)
  }

  // 关键数据
  const metrics = [
    ['实付', yuan(result.paid)],
    ['原价', yuan(result.subtotal)],
    ['优惠', result.discount > 0 ? `-${yuan(result.discount)}` : '¥0.0'],
    ['件数', `${result.itemCount} 件`]
  ]
  const cellW = (PW - 112) / 4
  metrics.forEach(([label, value], index) => {
    const x = PX + 56 + index * cellW
    ctx.fillStyle = '#8A7A6A'
    ctx.font = '700 22px "Microsoft YaHei", "PingFang SC", sans-serif'
    ctx.fillText(label, x, starY + 70)
    ctx.fillStyle = C.ink
    ctx.font = '900 42px "Arial Black", "Microsoft YaHei", sans-serif'
    ctx.fillText(value, x, starY + 124)
  })

  ctx.strokeStyle = 'rgba(26,15,10,0.2)'
  ctx.lineWidth = 2
  ctx.beginPath()
  ctx.moveTo(PX + 40, starY + 170)
  ctx.lineTo(PX + PW - 40, starY + 170)
  ctx.stroke()

  // 单品清单
  ctx.fillStyle = C.ink
  ctx.font = '900 24px "Microsoft YaHei", "PingFang SC", sans-serif'
  ctx.fillText('本单组合', PX + 56, starY + 220)
  ctx.font = '500 26px "Microsoft YaHei", "PingFang SC", sans-serif'
  let y = starY + 272
  result.lines.slice(0, 8).forEach((line) => {
    ctx.fillStyle = C.ink
    ctx.fillText(`${line.name}  ×${line.qty}`, PX + 56, y)
    ctx.textAlign = 'right'
    ctx.fillStyle = '#7A6858'
    ctx.fillText(yuan(line.subtotal), PX + PW - 56, y)
    ctx.textAlign = 'left'
    y += 46
  })
  if (result.lines.length > 8) {
    ctx.fillStyle = '#8A7A6A'
    ctx.fillText(`…还有 ${result.lines.length - 8} 项`, PX + 56, y)
  }

  // 梗文案
  const slogan = SLOGANS[stars][Math.floor(Math.random() * SLOGANS[stars].length)]
  ctx.fillStyle = C.ink
  roundRect(ctx, PX + 44, PY + PH - 170, PW - 88, 110, 16)
  ctx.fillStyle = C.yellow
  ctx.fill()
  ctx.fillStyle = C.ink
  ctx.textAlign = 'center'
  ctx.font = '900 34px "Microsoft YaHei", "PingFang SC", sans-serif'
  ctx.fillText(`「${slogan}」`, PX + PW / 2, PY + PH - 100)
  ctx.textAlign = 'left'

  // 底部
  ctx.fillStyle = C.cream
  ctx.font = '700 24px "Microsoft YaHei", "PingFang SC", sans-serif'
  ctx.fillText(`${storeName}`, 80, PY + PH + 90)
  ctx.fillText('扫码 / 打开小程序，挑战同一关', 80, PY + PH + 130)

  ctx.textAlign = 'right'
  ctx.fillStyle = C.yellow
  ctx.font = '900 30px "Microsoft YaHei", "PingFang SC", sans-serif'
  ctx.fillText('￥ MCD SAVING QUEST', W - 80, PY + PH + 130)
  ctx.textAlign = 'left'

  return canvas
}

export function downloadShareCard(options, filename = 'mcd-saving-card.png') {
  const canvas = buildShareCard(options)
  const link = document.createElement('a')
  link.download = filename
  link.href = canvas.toDataURL('image/png')
  link.click()
}

export function shareText({ level, result }) {
  const stars = result.stars ? `${'★'.repeat(result.stars)}${'☆'.repeat(3 - result.stars)}` : '☆☆☆'
  return `我在「麦门省钱大闯关」${level.label || level.id} ${level.name} 拿到 ${stars}，实付 ${yuan(result.paid)} 吃 ${result.itemCount} 件，原价 ${yuan(result.subtotal)}。来挑战同一关！`
}
