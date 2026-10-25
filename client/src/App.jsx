import { useCallback, useEffect, useRef, useState } from 'react'
import { api, clearToken, fallbackTrack, getToken, setToken } from './api.js'
import TopBar from './components/TopBar.jsx'
import StorePicker from './components/StorePicker.jsx'
import Home from './pages/Home.jsx'
import Levels from './pages/Levels.jsx'
import Game from './pages/Game.jsx'
import Auth from './pages/Auth.jsx'

export default function App() {
  const [boot, setBoot] = useState(null)
  const [authReady, setAuthReady] = useState(false)
  const [view, setView] = useState({ name: 'home', trackId: 'saving' })
  const [session, setSession] = useState(null)
  const [loadingLevel, setLoadingLevel] = useState(false)
  const [storePicker, setStorePicker] = useState(false)
  const [switching, setSwitching] = useState(false)
  const [located, setLocated] = useState(null)
  const [locateState, setLocateState] = useState('idle')
  const [geoDenied, setGeoDenied] = useState(false)
  const [searching, setSearching] = useState(false)
  const [toast, setToast] = useState(null)

  const notify = useCallback((text, tone = 'good') => {
    setToast({ id: Date.now(), text, tone })
  }, [])

  const load = useCallback(async () => {
    try {
      const data = await api.bootstrap()
      if (Array.isArray(data.tracks)) data.tracks = data.tracks.map(fallbackTrack)
      setBoot(data)
      return data
    } catch (error) {
      if (getToken()) notify(error.message, 'bad')
      return null
    }
  }, [notify])

  useEffect(() => {
    if (!getToken()) {
      setAuthReady(true)
      return
    }
    load().finally(() => setAuthReady(true))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  useEffect(() => {
    const onUnauthorized = () => {
      setBoot(null)
      setSession(null)
      setAuthReady(true)
      notify('登录已失效，请重新登录', 'bad')
    }
    window.addEventListener('mdl:unauthorized', onUnauthorized)
    return () => window.removeEventListener('mdl:unauthorized', onUnauthorized)
  }, [notify])

  // 定位：先问浏览器 GPS（高精度，允许多等几秒），拿不到就用自己的公网 IP 交给服务端做 IP 定位。
  // 这里必须挑国内可直连的取 IP 服务，api.ipify.org 在部分网络下会直接超时。
  // 上一次定位用的参数留在 ref 里，搜索门店时沿用同一份位置，保证距离口径一致。
  const positionRef = useRef(null)
  const locateRef = useRef(null)
  const locate = useCallback(async (searchKeyword = '') => {
    setLocateState('locating')
    const gpsFix = (highAccuracy) =>
      new Promise((resolve) => {
        if (!navigator.geolocation) return resolve(null)
        navigator.geolocation.getCurrentPosition(
          (position) => resolve({ lat: position.coords.latitude, lng: position.coords.longitude }),
          (error) => {
            // 用户拒绝了定位权限时，退到 IP 定位只会到城市级，界面要如实说明
            if (error?.code === 1) setGeoDenied(true)
            resolve(null)
          },
          { enableHighAccuracy: highAccuracy, timeout: highAccuracy ? 12000 : 8000, maximumAge: 0 }
        )
      })
    const publicIp = async () => {
      for (const url of ['https://myip.ipip.net/json', 'https://ip.3322.net', 'https://api64.ipify.org?format=json']) {
        try {
          const response = await fetch(url, { signal: AbortSignal.timeout(4000) })
          if (!response.ok) continue
          const text = await response.text()
          const data = text.trim().startsWith('{') ? JSON.parse(text) : null
          const ip = data?.data?.ip || data?.ip || text.trim()
          if (/^\d{1,3}(\.\d{1,3}){3}$/.test(ip)) return ip
        } catch {
          /* 换下一个服务 */
        }
      }
      return ''
    }
    try {
      let params = positionRef.current
      // 搜索门店时沿用上次的位置；还没定位过就先重新定位一次
      if (!params) {
        const gps = (await gpsFix(true)) || (await gpsFix(false))
        params = gps || { ip: await publicIp() }
        positionRef.current = params
      }
      const data = await api.location({ ...params, keyword: searchKeyword })
      setLocated(data)
      locateRef.current = data
      setLocateState(data?.origin ? 'ok' : 'failed')
    } catch {
      if (!searchKeyword) positionRef.current = null
      setLocateState('failed')
    }
  }, [])

  // 搜索门店：直接按关键词查，不因为「还没定好位」再让用户等一轮 GPS。
  // 位置优先用上次定位结果；连定位都没有时把城市名交给后端，仍能搜到门店。
  const searchStores = useCallback(async (keyword) => {
    if (!keyword) return false
    setSearching(true)
    try {
      const prev = locateRef.current
      const origin = prev?.origin
      const params =
        positionRef.current ||
        (Number.isFinite(origin?.lat) && Number.isFinite(origin?.lng) ? { lat: origin.lat, lng: origin.lng } : {})
      const city = prev?.reference?.city || boot?.storeLocation?.city || '温州'
      const data = await api.location({ ...params, city, keyword })
      const merged = { ...data, origin: data?.origin || origin || null }
      setLocated(merged)
      locateRef.current = merged
      if (data?.origin) setLocateState('ok')
      return true
    } catch {
      return false
    } finally {
      setSearching(false)
    }
  }, [boot?.storeLocation?.city])

  useEffect(() => {
    if (!boot?.profile?.id) return
    locate()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [boot?.profile?.id])

  useEffect(() => {
    if (!toast) return
    const timer = setTimeout(() => setToast(null), 2800)
    return () => clearTimeout(timer)
  }, [toast])

  useEffect(() => {
    window.scrollTo({ top: 0, behavior: 'smooth' })
  }, [view.name, view.levelId])

  const handleAuthed = async (token, profile) => {
    setToken(token)
    const data = await load()
    if (!data && profile) {
      // 登录接口本身已经返回了 profile，bootstrap 偶尔失败时也先进入首页
      setBoot(null)
      notify('已登录，但菜单加载失败，请刷新重试', 'bad')
      return
    }
    notify(`欢迎回来，${profile?.username || '麦门玩家'}`)
  }

  const logout = async () => {
    try {
      await api.auth.logout()
    } catch {
      /* token 可能已过期 */
    }
    clearToken()
    setBoot(null)
    setSession(null)
    setView({ name: 'home', trackId: 'saving' })
    notify('已退出登录')
  }

  const openLevel = async (levelId) => {
    setLoadingLevel(true)
    try {
      const { session: nextSession } = await api.createSession(levelId)
      setSession(nextSession)
      try {
        localStorage.setItem(`mdl:last-track:${boot.profile.id}`, nextSession.level.track || 'saving')
      } catch {
        // 浏览器禁用存储时不影响进入关卡。
      }
      setView({ name: 'game', levelId })
    } catch (error) {
      notify(error.message, 'bad')
    } finally {
      setLoadingLevel(false)
    }
  }

  const checkin = async () => {
    try {
      const { coinsEarned } = await api.checkin()
      notify(`签到成功，金币 +${coinsEarned}`)
      load()
    } catch (error) {
      notify(error.message, 'bad')
    }
  }

  const switchStore = async (storeCode) => {
    if (switching) return
    setSwitching(true)
    try {
      const data = await api.switchStore(storeCode)
      setSession(null)
      setView({ name: 'home' })
      if (data.stores) setLocated({ stores: data.stores, reference: data.storeLocation, origin: null })
      await load()
      setStorePicker(false)
      notify(`已切换到 ${data.store.shortName}，菜单价格与预算线已重新校准`)
    } catch (error) {
      notify(error.message, 'bad')
    } finally {
      setSwitching(false)
    }
  }

  if (!authReady) {
    return (
      <div className="splash">
        <img className="splash-arches" src="/mcd-logo.png" alt="麦当劳" />
        <p className="splash-title">麦门省钱大闯关</p>
        <p className="splash-sub">正在读取门店菜单…</p>
      </div>
    )
  }

  if (!boot) {
    return (
      <>
        <Auth onAuthed={handleAuthed} />
        {toast && (
          <div key={toast.id} className={`toast ${toast.tone === 'bad' ? 'toast-bad' : ''}`}>
            {toast.text}
          </div>
        )}
      </>
    )
  }

  return (
    <div className="app">
      <TopBar
        profile={boot.profile}
        store={boot.store}
        onCheckin={checkin}
        onOpenStore={() => setStorePicker(true)}
        onHome={() => setView({ name: 'home' })}
        onLogout={logout}
      />
      <main className="app-main">
        {view.name === 'home' && (
          <Home
            boot={boot}
            onOpenTrack={(trackId) => setView({ name: 'levels', trackId })}
            onOpenLevel={openLevel}
            onOpenStore={() => setStorePicker(true)}
            loadingLevel={loadingLevel}
          />
        )}
        {view.name === 'levels' && (
          <Levels
            boot={boot}
            trackId={view.trackId}
            onBack={() => setView({ name: 'home' })}
            onOpenLevel={openLevel}
            loadingLevel={loadingLevel}
          />
        )}
        {view.name === 'game' && session && (
          <Game
            key={session.id}
            session={session}
            profile={boot.profile}
            storeName={session.store?.name || boot.store.name}
            onExit={() => setView({ name: 'levels', trackId: session.level.track || 'saving' })}
            onRefresh={load}
            onNextLevel={(levelId) => openLevel(levelId)}
            notify={notify}
          />
        )}
      </main>

      <footer className="footer">
        <img src="/mcd-logo.png" alt="麦当劳" className="footer-logo" />
        <p>数据来自麦当劳官方 MCP · 菜单 / 价格 / 营养 / 可领券实时拉取</p>
        <p className="footer-dim">
          {boot.source.label} · {boot.store.name}
          {boot.source.itemCount
            ? ` · 在售 ${boot.source.itemCount} 项，营养已收录 ${boot.source.nutritionCount} 项`
            : ''}
        </p>
      </footer>

      <StorePicker
        open={storePicker}
        stores={located?.stores || boot.stores || []}
        current={boot.store}
        reference={located?.reference || boot.storeLocation || null}
        origin={located?.origin || null}
        locateState={locateState}
        geoDenied={geoDenied}
        busy={switching}
        searching={searching}
        searchedKeyword={located?.keyword || ''}
        onRelocate={() => {
          positionRef.current = null
          locate()
        }}
        onSearch={searchStores}
        onSelect={switchStore}
        onClose={() => setStorePicker(false)}
      />

      {toast && (
        <div key={toast.id} className={`toast ${toast.tone === 'bad' ? 'toast-bad' : ''}`}>
          {toast.text}
        </div>
      )}
    </div>
  )
}
