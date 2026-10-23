import { reconciliationApi } from '../services/api'
import { formatDateTime } from '../utils/helpers'
import { BarChart3, Clock, FileText, PlusCircle, TrendingUp } from 'lucide-react'
import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { LoadingOverlay } from '../components/Spinner'
import { StatusBadge } from '../components/StatusBadge'
import { useAppContext } from '../store/AppContext'
import { Alert } from '../components/Alert'

export default function DashboardPage() {
  const { systemStatus } = useAppContext()
  const [sessions, setSessions] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)

  useEffect(() => {
    reconciliationApi
      .list({ limit: 5 })
      .then((res) => setSessions(res.data.items || []))
      .catch((e) => setError(e.message))
      .finally(() => setLoading(false))
  }, [])

  // Aggregate stats from sessions
  const totalSessions = sessions.length
  const totalMismatch = sessions.reduce((s, r) => s + (r.stats?.mismatch_count || 0), 0)
  const avgMatchRate =
    sessions.length > 0
      ? (
          sessions.reduce((s, r) => s + (r.stats?.match_rate || 0), 0) /
          sessions.length
        ).toFixed(1)
      : null

  return (
    <div className="px-8 py-8 max-w-5xl">
      {/* Page title */}
      <div className="flex items-center justify-between mb-8">
        <div>
          <h1 className="text-xl font-bold text-slate-800">Tổng quan</h1>
          <p className="text-sm text-slate-500 mt-1">
            Theo dõi trạng thái đối soát điểm thi
          </p>
        </div>
        <Link to="/reconcile/new" className="btn btn-primary gap-2">
          <PlusCircle size={15} />
          Đối soát mới
        </Link>
      </div>

      {/* Status warnings */}
      {systemStatus.backend === 'error' && (
        <Alert
          type="error"
          message="Không kết nối được đến máy chủ. Vui lòng kiểm tra backend đang chạy."
          className="mb-6"
        />
      )}
      {systemStatus.ai === 'unconfigured' && (
        <Alert
          type="warning"
          message="Gemini AI chưa được cấu hình. Vào Cài đặt AI để thiết lập API key."
          className="mb-6"
        />
      )}

      {/* Stats row */}
      <div className="grid grid-cols-3 gap-4 mb-8">
        <StatCard
          icon={FileText}
          label="Phiên đối soát"
          value={totalSessions}
          sub="tổng số"
        />
        <StatCard
          icon={TrendingUp}
          label="Tỷ lệ khớp TB"
          value={avgMatchRate !== null ? `${avgMatchRate}%` : '—'}
          sub="các phiên gần đây"
        />
        <StatCard
          icon={BarChart3}
          label="Sai lệch phát hiện"
          value={totalMismatch}
          sub="tổng cộng"
        />
      </div>

      {/* Recent sessions */}
      <div className="panel">
        <div className="panel-header">
          <h2 className="text-sm font-semibold text-slate-700 flex items-center gap-2">
            <Clock size={14} />
            Phiên đối soát gần đây
          </h2>
          {sessions.length > 0 && (
            <Link
              to="/history"
              className="text-xs text-blue-600 hover:underline"
            >
              Xem tất cả
            </Link>
          )}
        </div>
        <div>
          {loading && <LoadingOverlay message="Đang tải dữ liệu..." />}
          {error && (
            <div className="p-5">
              <Alert type="error" message={error} />
            </div>
          )}
          {!loading && !error && sessions.length === 0 && (
            <div className="px-5 py-12 text-center text-slate-400 text-sm">
              Chưa có phiên đối soát nào.{' '}
              <Link to="/reconcile/new" className="text-blue-600 hover:underline">
                Tạo phiên mới
              </Link>
            </div>
          )}
          {!loading && sessions.length > 0 && (
            <table className="data-table">
              <thead>
                <tr>
                  <th>Đợt đối soát</th>
                  <th>Học phần</th>
                  <th>Lớp</th>
                  <th>Ngày tạo</th>
                  <th>Tỷ lệ khớp</th>
                  <th>Sai lệch</th>
                  <th>Trạng thái</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {sessions.map((s) => (
                  <tr key={s.id}>
                    <td>
                      <div className="flex flex-col">
                        <span className="font-semibold text-slate-800 text-xs">
                          {s.name || `Phiên ${s.id.slice(0, 8)}`}
                        </span>
                        {s.name && (
                          <span className="font-mono text-[10px] text-slate-400">
                            {s.id.slice(0, 8)}
                          </span>
                        )}
                      </div>
                    </td>
                    <td className="font-medium text-slate-800">
                      {s.metadata?.subject || '—'}
                    </td>
                    <td>{s.metadata?.class_name || '—'}</td>
                    <td className="text-slate-500">
                      {formatDateTime(s.created_at)}
                    </td>
                    <td>
                      {s.stats?.match_rate != null
                        ? `${Number(s.stats.match_rate).toFixed(1)}%`
                        : '—'}
                    </td>
                    <td>
                      {s.stats?.mismatch_count !== undefined
                        ? s.stats.mismatch_count
                        : '—'}
                    </td>
                    <td>
                      <SessionStatusBadge status={s.status} />
                    </td>
                    <td>
                      <Link
                        to={`/reconcile/${s.id}/results`}
                        className="text-xs text-blue-600 hover:underline"
                      >
                        Xem
                      </Link>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      </div>
    </div>
  )
}

function StatCard({ icon: Icon, label, value, sub }) {
  return (
    <div className="panel p-5">
      <div className="flex items-start justify-between">
        <div className="stat-item">
          <span className="stat-label">{label}</span>
          <span className="stat-value">{value}</span>
          <span className="text-xs text-slate-400">{sub}</span>
        </div>
        <div className="w-8 h-8 rounded-md bg-slate-100 flex items-center justify-center">
          <Icon size={16} className="text-slate-500" />
        </div>
      </div>
    </div>
  )
}

function SessionStatusBadge({ status }) {
  const map = {
    pending: { label: 'Đang chờ', cls: 'badge-review' },
    processing: { label: 'Đang xử lý', cls: 'badge-review' },
    completed: { label: 'Hoàn tất', cls: 'badge-match' },
    error: { label: 'Lỗi', cls: 'badge-mismatch' },
  }
  const info = map[status] || { label: status, cls: 'badge' }
  return <span className={`badge ${info.cls}`}>{info.label}</span>
}
