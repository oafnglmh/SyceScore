import { GitCompareArrows, KeyRound, LoaderCircle, ScanText } from 'lucide-react'
import { useCallback, useEffect, useReducer, useState } from 'react'
import KeyStatusDialog from './components/KeyStatusDialog'
import useHashRoute from './hooks/useHashRoute'
import { aiLabel, KeyPool, loadKeyConfig } from './lib/keys'
import DoDiemPage from './pages/DoDiemPage'
import SoHoaPage from './pages/SoHoaPage'

// Mỗi chức năng một route riêng; trang nào đã mở thì giữ nguyên trạng thái khi chuyển qua lại.
const ROUTES = [
  { path: '/', label: 'Số hóa điểm', title: 'Số hóa điểm thi viết tay', icon: ScanText, Page: SoHoaPage },
  { path: '/do-diem', label: 'Dò điểm', title: 'Dò điểm hệ thống ↔ viết tay', icon: GitCompareArrows, Page: DoDiemPage },
]

/** Theo dõi kho key để header/dialog cập nhật trạng thái (giới hạn ~4 lần/giây). */
function usePoolStats(pool) {
  const [, bump] = useReducer((x) => x + 1, 0)
  useEffect(() => {
    if (!pool) return
    let t = null
    const unsub = pool.subscribe(() => {
      if (!t) t = setTimeout(() => ((t = null), bump()), 250)
    })
    return () => {
      unsub()
      clearTimeout(t)
    }
  }, [pool])
  return pool ? pool.stats() : null
}

const toConfig = (cfg) => ({ ...cfg, pool: cfg.keys.length ? new KeyPool(cfg.keys) : null, error: null })

export default function App() {
  const [config, setConfig] = useState({ loading: true })
  const [keysOpen, setKeysOpen] = useState(false)
  const stats = usePoolStats(config.pool)
  const path = useHashRoute()
  const route = ROUTES.find((r) => r.path === path) || ROUTES[0]
  const [visited, setVisited] = useState(() => new Set([route.path]))
  if (!visited.has(route.path)) setVisited(new Set([...visited, route.path]))

  useEffect(() => {
    document.title = `CCE · ${route.title}`
  }, [route])

  const reloadKeys = useCallback(async () => {
    try {
      setConfig(toConfig(await loadKeyConfig()))
    } catch (e) {
      setConfig({ error: e.message, keys: [] })
    }
  }, [])

  useEffect(() => {
    let alive = true
    loadKeyConfig()
      .then((cfg) => alive && setConfig(toConfig(cfg)))
      .catch((e) => alive && setConfig({ error: e.message, keys: [] }))
    return () => {
      alive = false
    }
  }, [])

  const ready = !!config.pool && !!config.model
  const keyProblem = config.loading
    ? null
    : config.error || (!config.keys?.length ? 'File public/api-keys.json chưa có API key nào.' : null)
  const usable = stats ? stats.ready + stats.cooling : 0
  const openKeys = useCallback(() => setKeysOpen(true), [])

  return (
    <div className="flex min-h-screen flex-col">
      <header className="sticky top-0 z-30 bg-cce-700 text-white shadow-lg shadow-cce-900/20">
        <div className="cce-arcs flex h-14 items-center gap-3 px-4">
          <a href="#/" className="flex items-center gap-3">
            <img src="/cce-emblem-white.png" alt="CCE" className="h-9 w-auto" />
            <div className="hidden h-8 w-px bg-white/20 sm:block" />
            <div className="hidden text-left leading-tight md:block">
              <div className="text-[10.5px] font-semibold uppercase tracking-[0.14em] text-gold-300">
                Trung tâm Đào tạo Thường xuyên · ĐH Đà Nẵng
              </div>
              <div className="text-[15px] font-semibold">{route.title}</div>
            </div>
          </a>

          <nav className="ml-2 flex items-center gap-1 rounded-full bg-cce-900/40 p-1 ring-1 ring-white/10 sm:ml-4">
            {ROUTES.map((r) => {
              const active = r === route
              return (
                <a
                  key={r.path}
                  href={`#${r.path}`}
                  aria-current={active ? 'page' : undefined}
                  className={`flex items-center gap-1.5 rounded-full px-3 py-1.5 text-[13px] font-semibold transition ${
                    active ? 'bg-gold-400 text-cce-950 shadow' : 'text-white/80 hover:bg-white/10 hover:text-white'
                  }`}
                >
                  <r.icon className="size-4" />
                  {r.label}
                </a>
              )
            })}
          </nav>

          <button
            onClick={openKeys}
            className="ml-auto flex items-center gap-2 rounded-full bg-white/10 py-1.5 pl-2.5 pr-3 text-xs font-medium ring-1 ring-white/15 transition hover:bg-white/15"
            title="Trạng thái API key"
          >
            {config.loading ? (
              <LoaderCircle className="size-3.5 animate-spin" />
            ) : (
              <span className={`size-2 rounded-full ${keyProblem || !usable ? 'bg-rose-400' : 'bg-emerald-400'} ring-2 ring-white/20`} />
            )}
            <KeyRound className="size-3.5 text-gold-300" />
            {stats ? (
              <span>
                {usable}/{stats.total} key
              </span>
            ) : (
              <span>{config.loading ? 'Đang đọc file key' : 'Chưa có key'}</span>
            )}
            {config.model && <span className="hidden text-white/60 sm:inline">· {aiLabel(config.model)}</span>}
          </button>
        </div>
        <div className="h-[3px] bg-gradient-to-r from-gold-500 via-gold-300 to-gold-500" />
      </header>

      {ROUTES.filter((r) => visited.has(r.path)).map(({ path: p, Page }) => (
        <div key={p} className={p === route.path ? 'flex flex-1 flex-col' : 'hidden'}>
          <Page config={config} ready={ready} keyProblem={keyProblem} stats={stats} onOpenKeys={openKeys} />
        </div>
      ))}

      {keysOpen && (
        <KeyStatusDialog config={config} keyProblem={keyProblem} onReload={reloadKeys} onClose={() => setKeysOpen(false)} />
      )}
    </div>
  )
}
