import { useState } from 'react'
import { api } from '../api.js'

const FEATURES = [
  ['🍔', '真实菜单', '100+ 款在售商品，含 50+ 组套餐'],
  ['🧾', '套餐拆解', '套餐里的主食 / 小食 / 饮品照样计入关卡'],
  ['🎟️', '券包叠加', '门店可领券 + 模拟券，最多叠 3 张冲三星'],
  ['🏅', '从零开始', '注册后金币 0、星级 0，全靠闯关赚']
]

export default function Auth({ onAuthed }) {
  const [mode, setMode] = useState('login')
  const [username, setUsername] = useState('')
  const [password, setPassword] = useState('')
  const [confirm, setConfirm] = useState('')
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)

  const switchMode = (next) => {
    setMode(next)
    setError('')
  }

  const submit = async (event) => {
    event.preventDefault()
    setError('')
    const name = username.trim()
    if (name.length < 2) {
      setError('用户名至少 2 位')
      return
    }
    if (password.length < 6) {
      setError('密码至少 6 位')
      return
    }
    if (mode === 'register' && password !== confirm) {
      setError('两次输入的密码不一致')
      return
    }
    setBusy(true)
    try {
      const result = mode === 'login'
        ? await api.auth.login(name, password)
        : await api.auth.register(name, password)
      onAuthed(result.token, result.profile)
    } catch (err) {
      setError(err.message)
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="auth-page">
      <div className="auth-shell">
        <section className="auth-pitch">
          <div className="auth-brand">
            <img src="/mcd-logo.png" alt="麦当劳" className="auth-logo" />
            <span className="sticker sticker-yellow">麦当劳 MCP 官方数据</span>
          </div>
          <h1>
            麦门
            <span>省钱</span>
            大闯关
          </h1>
          <p className="auth-lede">
            用今天的真实门店价格点餐，在预算里凑出能吃饱的组合。
            注册后从 0 金币、0 星开始，通关赚金币、刷新星级。
          </p>
          <ul className="auth-features">
            {FEATURES.map(([emoji, title, desc]) => (
              <li key={title}>
                <span aria-hidden="true">{emoji}</span>
                <div>
                  <strong>{title}</strong>
                  <p>{desc}</p>
                </div>
              </li>
            ))}
          </ul>
          <img className="auth-arches" src="/mcd-logo.png" alt="" aria-hidden="true" />
        </section>

        <section className="auth-card">
          <div className="auth-tabs">
            <button className={mode === 'login' ? 'on' : ''} onClick={() => switchMode('login')}>登录</button>
            <button className={mode === 'register' ? 'on' : ''} onClick={() => switchMode('register')}>注册</button>
          </div>

          <h2>{mode === 'login' ? '欢迎回店' : '开一张新餐卡'}</h2>
          <p className="auth-sub">
            {mode === 'login' ? '登录后继续你的省钱进度' : '初始金币 0 · 星级 0，第一关马上可玩'}
          </p>

          <form onSubmit={submit}>
            <label className="auth-field">
              <span>用户名</span>
              <input
                value={username}
                onChange={(event) => setUsername(event.target.value)}
                placeholder="2-20 位，支持中文 / 字母 / 数字"
                autoComplete="username"
              />
            </label>
            <label className="auth-field">
              <span>密码</span>
              <input
                type="password"
                value={password}
                onChange={(event) => setPassword(event.target.value)}
                placeholder="至少 6 位"
                autoComplete={mode === 'login' ? 'current-password' : 'new-password'}
              />
            </label>
            {mode === 'register' && (
              <label className="auth-field">
                <span>确认密码</span>
                <input
                  type="password"
                  value={confirm}
                  onChange={(event) => setConfirm(event.target.value)}
                  placeholder="再输一次"
                  autoComplete="new-password"
                />
              </label>
            )}

            {error && <p className="auth-error">{error}</p>}

            <button className="btn btn-red auth-submit" type="submit" disabled={busy}>
              {busy ? '处理中…' : mode === 'login' ? '登录并进店' : '注册并开始闯关'}
            </button>
          </form>

          <p className="auth-switch">
            {mode === 'login' ? '还没有账号？' : '已经有账号了？'}
            <button onClick={() => switchMode(mode === 'login' ? 'register' : 'login')}>
              {mode === 'login' ? '立即注册' : '去登录'}
            </button>
          </p>
        </section>
      </div>
    </div>
  )
}
