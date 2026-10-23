import { reconciliationApi } from '../services/api'
import { LoadingOverlay } from '../components/Spinner'
import { ConfirmModal } from '../components/ConfirmModal'
import { useToast } from '../components/Toast'
import { formatDateTime } from '../utils/helpers'
import { Check, Edit2, Trash2, X } from 'lucide-react'
import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'

const STATUS_LABELS = {
  completed: { label: 'Hoàn thành', cls: 'badge-match' },
  processing: { label: 'Đang xử lý', cls: 'badge-review' },
  error: { label: 'Lỗi', cls: 'badge-mismatch' },
  pending: { label: 'Chờ xử lý', cls: 'badge-review' },
}

function SessionBadge({ status }) {
  const cfg = STATUS_LABELS[status] || { label: status || 'N/A', cls: 'badge' }
  return <span className={`badge ${cfg.cls}`}>{cfg.label}</span>
}

export default function HistoryPage() {
  const toast = useToast()
  const [sessions, setSessions] = useState([])
  const [loading, setLoading] = useState(true)
  const [editingId, setEditingId] = useState(null)
  const [editingName, setEditingName] = useState('')
  const [confirmDelete, setConfirmDelete] = useState(null) // session id cần xóa

  const load = () => {
    setLoading(true)
    reconciliationApi
      .list()
      .then((res) => setSessions(res.data.items || []))
      .catch((e) => toast.error(`Không tải được danh sách: ${e.message}`))
      .finally(() => setLoading(false))
  }

  useEffect(load, [])

  const handleDeleteConfirmed = async () => {
    const id = confirmDelete
    setConfirmDelete(null)
    try {
      await reconciliationApi.delete(id)
      setSessions((prev) => prev.filter((s) => s.id !== id))
      toast.success('Đã xóa phiên đối soát thành công.')
    } catch (e) {
      toast.error(`Xóa thất bại: ${e.message}`)
    }
  }

  const handleStartEdit = (session) => {
    setEditingId(session.id)
    setEditingName(session.name || '')
  }

  const handleCancelEdit = () => {
    setEditingId(null)
    setEditingName('')
  }

  const handleSaveName = async (id) => {
    try {
      const res = await reconciliationApi.updateName(id, editingName.trim())
      setSessions((prev) =>
        prev.map((s) => (s.id === id ? { ...s, name: res.data.name } : s))
      )
      setEditingId(null)
      toast.success('Đã cập nhật tên đợt đối soát.')
    } catch (e) {
      toast.error(`Lỗi cập nhật tên: ${e.message}`)
    }
  }

  return (
    <div className="px-8 py-8 max-w-5xl">
      <h1 className="text-xl font-bold text-slate-800 mb-1">Lịch sử đối soát</h1>
      <p className="text-sm text-slate-500 mb-6">Tất cả phiên đối soát đã thực hiện</p>

      <div className="panel">
        {loading && <LoadingOverlay message="Đang tải..." />}
        {!loading && sessions.length === 0 && (
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
                <th style={{ minWidth: '180px' }}>Đợt đối soát</th>
                <th>Học phần</th>
                <th>Lớp</th>
                <th>Ngày tạo</th>
                <th>Nguồn A</th>
                <th>Nguồn B</th>
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
                    {editingId === s.id ? (
                      <div className="flex items-center gap-1.5">
                        <input
                          type="text"
                          className="input input-sm text-xs py-0.5 px-2 w-full"
                          value={editingName}
                          placeholder="Nhập tên đợt..."
                          autoFocus
                          onChange={(e) => setEditingName(e.target.value)}
                          onKeyDown={(e) => {
                            if (e.key === 'Enter') handleSaveName(s.id)
                            if (e.key === 'Escape') handleCancelEdit()
                          }}
                        />
                        <button
                          type="button"
                          className="btn btn-ghost btn-sm p-1 text-emerald-600 hover:bg-emerald-50"
                          onClick={() => handleSaveName(s.id)}
                          title="Lưu tên"
                        >
                          <Check size={14} />
                        </button>
                        <button
                          type="button"
                          className="btn btn-ghost btn-sm p-1 text-slate-400 hover:text-slate-600"
                          onClick={handleCancelEdit}
                          title="Hủy"
                        >
                          <X size={14} />
                        </button>
                      </div>
                    ) : (
                      <div className="flex flex-col group">
                        <div className="flex items-center gap-1.5">
                          <span className="font-semibold text-slate-800 text-xs">
                            {s.name || `Phiên ${s.id.slice(0, 8)}`}
                          </span>
                          <button
                            type="button"
                            className="opacity-0 group-hover:opacity-100 transition-opacity p-0.5 text-slate-400 hover:text-blue-600"
                            onClick={() => handleStartEdit(s)}
                            title="Đặt/Đổi tên đợt đối soát"
                          >
                            <Edit2 size={12} />
                          </button>
                        </div>
                        {s.name && (
                          <span className="font-mono text-[10px] text-slate-400">
                            {s.id.slice(0, 8)}
                          </span>
                        )}
                      </div>
                    )}
                  </td>
                  <td className="font-medium">{s.metadata?.subject || '—'}</td>
                  <td>{s.metadata?.class_name || '—'}</td>
                  <td className="text-slate-500">{formatDateTime(s.created_at)}</td>
                  <td className="text-xs text-slate-500">
                    {s.file_count_a ?? '?'} file
                  </td>
                  <td className="text-xs text-slate-500">
                    {s.file_count_b ?? '?'} file
                  </td>
                  <td>
                    {s.stats?.match_rate != null
                      ? `${s.stats.match_count ?? s.stats.matched_count ?? 0}/${s.stats.comparable_count ?? 0} = ${Number(s.stats.match_rate).toFixed(1)}%`
                      : '—'}
                  </td>
                  <td className={s.stats?.mismatch_count > 0 ? 'text-red-600 font-medium' : ''}>
                    {s.stats?.mismatch_count ?? '—'}
                  </td>
                  <td>
                    <SessionBadge status={s.status} />
                  </td>
                  <td>
                    <div className="flex items-center gap-2">
                      {s.status === 'completed' && (
                        <Link
                          to={`/reconcile/${s.id}/results`}
                          className="text-xs text-blue-600 hover:underline"
                        >
                          Xem
                        </Link>
                      )}
                      <button
                        type="button"
                        className="btn btn-ghost btn-sm p-1 text-slate-400 hover:text-red-500"
                        onClick={() => setConfirmDelete(s.id)}
                        aria-label="Xóa phiên"
                      >
                        <Trash2 size={13} />
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      {/* Confirm delete modal */}
      <ConfirmModal
        open={!!confirmDelete}
        title="Xóa phiên đối soát"
        message="Phiên đối soát này sẽ bị xóa vĩnh viễn và không thể khôi phục. Bạn có chắc chắn muốn tiếp tục?"
        confirmText="Xóa"
        cancelText="Hủy"
        danger
        onConfirm={handleDeleteConfirmed}
        onCancel={() => setConfirmDelete(null)}
      />
    </div>
  )
}