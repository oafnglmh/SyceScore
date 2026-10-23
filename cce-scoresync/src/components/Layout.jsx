import { useAppContext } from '../store/AppContext'
import {
  BarChart3,
  Bot,
  History,
  PlusCircle,
} from 'lucide-react'
import { NavLink } from 'react-router-dom'

const NAV_ITEMS = [
  { to: '/', label: 'Tổng quan', icon: BarChart3, end: true },
  { to: '/reconcile/new', label: 'Đối soát mới', icon: PlusCircle },
  { to: '/history', label: 'Lịch sử đối soát', icon: History },
  { to: '/settings/ai', label: 'Cài đặt AI', icon: Bot },
]

export function Layout({ children }) {
  const { systemStatus } = useAppContext()

  return (
    <div className="flex h-screen overflow-hidden bg-slate-50">
      {/* Sidebar */}
      <aside className="w-56 shrink-0 flex flex-col bg-white border-r border-slate-200">
        {/* Brand */}
        <div className="px-5 py-5 border-b border-slate-100">
          <h1 className="text-sm font-bold text-slate-800 tracking-tight">
            CCE ScoreSync
          </h1>
          <p className="text-xs text-slate-400 mt-0.5">Đối soát điểm thi</p>
        </div>

        {/* Nav */}
        <nav className="flex-1 px-3 py-4 flex flex-col gap-0.5">
          {NAV_ITEMS.map(({ to, label, icon: Icon, end }) => (
            <NavLink
              key={to}
              to={to}
              end={end}
              className={({ isActive }) =>
                `flex items-center gap-2.5 px-3 py-2 rounded-md text-sm transition-colors
                 ${isActive
                   ? 'bg-slate-100 text-slate-800 font-semibold'
                   : 'text-slate-500 hover:bg-slate-50 hover:text-slate-700'
                 }`
              }
            >
              <Icon size={15} strokeWidth={1.75} />
              {label}
            </NavLink>
          ))}
        </nav>

        {/* System status */}
        <div className="px-4 py-4 border-t border-slate-100">
          <div className="flex items-center gap-2 text-xs text-slate-400">
            <StatusDot status={systemStatus.backend} />
            <span>
              {systemStatus.backend === 'ok'
                ? 'Máy chủ hoạt động'
                : systemStatus.backend === 'checking'
                ? 'Đang kiểm tra...'
                : 'Không kết nối được'}
            </span>
          </div>
          {systemStatus.ai !== 'unknown' && (
            <div className="flex items-center gap-2 text-xs text-slate-400 mt-1.5">
              <StatusDot
                status={systemStatus.ai === 'configured' ? 'ok' : 'error'}
              />
              <span>
                {systemStatus.ai === 'configured'
                  ? 'AI đã cấu hình'
                  : 'AI chưa cấu hình'}
              </span>
            </div>
          )}
        </div>
      </aside>

      {/* Main content */}
      <main className="flex-1 overflow-y-auto">
        {children}
      </main>
    </div>
  )
}

function StatusDot({ status }) {
  const colors = {
    ok: 'bg-emerald-400',
    error: 'bg-red-400',
    checking: 'bg-amber-400',
    unknown: 'bg-slate-300',
  }
  return (
    <span
      className={`inline-block w-1.5 h-1.5 rounded-full ${colors[status] || colors.unknown}`}
    />
  )
}
