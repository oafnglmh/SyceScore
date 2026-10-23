import { reconciliationApi } from '../services/api'
import { useToast } from '../components/Toast'
import { ClassMismatchAssistant } from '../components/ClassMismatchAssistant'
import { StatusBadge } from '../components/StatusBadge'
import { LoadingOverlay, Spinner } from '../components/Spinner'
import { downloadBlob, formatDateTime, formatScore, getStatusRowClass } from '../utils/helpers'
import { STATUS_LABELS } from '../constants'
import {
  ChevronDown,
  ChevronUp,
  ChevronsUpDown,
  Download,
  ExternalLink,
  Filter,
  Search,
  X,
} from 'lucide-react'
import { useEffect, useMemo, useRef, useState } from 'react'
import { useParams } from 'react-router-dom'

const PAGE_SIZE = 50

export default function ResultsPage() {
  const { id } = useParams()
  const toast = useToast()
  const [session, setSession] = useState(null)
  const [results, setResults] = useState([])
  const [loading, setLoading] = useState(true)
  const [exporting, setExporting] = useState(false)

  // Filters
  const [search, setSearch] = useState('')
  const [statusFilter, setStatusFilter] = useState('')
  const [onlyMismatch, setOnlyMismatch] = useState(false)
  const [onlyReview, setOnlyReview] = useState(false)

  // Sorting
  const [sortField, setSortField] = useState('student_id')
  const [sortDir, setSortDir] = useState('asc')

  // Pagination
  const [page, setPage] = useState(1)

  useEffect(() => {
    Promise.all([
      reconciliationApi.get(id),
      reconciliationApi.getResults(id),
    ])
      .then(([sessionRes, resultsRes]) => {
        setSession(sessionRes.data)
        setResults(resultsRes.data.items || [])
      })
      .catch((e) => toast.error(`Không tải được kết quả: ${e.message}`))
      .finally(() => setLoading(false))
  }, [id])

  // Filtering + sorting
  const filtered = useMemo(() => {
    let rows = results

    if (onlyMismatch) rows = rows.filter((r) => r.status === 'MISMATCH')
    else if (onlyReview) rows = rows.filter((r) => r.status === 'NEEDS_REVIEW')
    else if (statusFilter) rows = rows.filter((r) => r.status === statusFilter)

    if (search.trim()) {
      const q = search.trim().toLowerCase()
      rows = rows.filter(
        (r) =>
          r.student_id?.toLowerCase().includes(q) ||
          r.full_name?.toLowerCase().includes(q)
      )
    }

    rows = [...rows].sort((a, b) => {
      const av = a[sortField] ?? ''
      const bv = b[sortField] ?? ''
      const cmp = String(av).localeCompare(String(bv), 'vi', { numeric: true })
      return sortDir === 'asc' ? cmp : -cmp
    })

    return rows
  }, [results, search, statusFilter, onlyMismatch, onlyReview, sortField, sortDir])

  const paginated = useMemo(
    () => filtered.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE),
    [filtered, page]
  )
  const totalPages = Math.ceil(filtered.length / PAGE_SIZE)

  const handleSort = (field) => {
    if (sortField === field) {
      setSortDir((d) => (d === 'asc' ? 'desc' : 'asc'))
    } else {
      setSortField(field)
      setSortDir('asc')
    }
    setPage(1)
  }

  const handleExport = async () => {
    setExporting(true)
    try {
      const res = await reconciliationApi.exportExcel(id)
      const now = new Date()
      const ts = now.toISOString().slice(0, 16).replace(/[-T:]/g, '').replace('', '_')
      downloadBlob(res.data, `CCE_ScoreSync_DoiSoat_${ts}.xlsx`)
      toast.success('Xuất Excel thành công.')
    } catch (e) {
      toast.error(`Xuất Excel thất bại: ${e.message}`)
    } finally {
      setExporting(false)
    }
  }

  if (loading) return <div className="px-8 py-8"><LoadingOverlay message="Đang tải kết quả..." /></div>

  const stats = session?.stats || {}

  return (
    <div className="px-8 py-8 max-w-full">
      {/* Header */}
      <div className="flex items-start justify-between mb-6">
        <div>
          <h1 className="text-xl font-bold text-slate-800">Kết quả đối soát</h1>
          <p className="text-sm text-slate-500 mt-1">
            {session?.metadata?.subject
              ? `${session.metadata.subject} · ${session.metadata.class_name || ''}`
              : `Phiên ${id?.slice(0, 8)}`}
          </p>
        </div>
        <button
          type="button"
          className="btn btn-secondary"
          onClick={handleExport}
          disabled={exporting}
        >
          {exporting ? <Spinner size={14} /> : <Download size={15} />}
          Xuất Excel
        </button>
      </div>


      {/* Stats summary */}
      <div className="grid grid-cols-5 gap-3 mb-6">
        <SummaryStat label="Nguồn A" value={stats.total_source_a ?? '—'} />
        <SummaryStat label="Nguồn B" value={stats.total_source_b ?? '—'} />
        <SummaryStat
          label="Tỷ lệ khớp"
          value={
            stats.match_rate !== undefined
              ? `${stats.matched_count}/${stats.comparable_count} = ${stats.match_rate?.toFixed(1)}%`
              : '—'
          }
          highlight
        />
        <SummaryStat label="Sai lệch" value={stats.mismatch_count ?? '—'} danger={stats.mismatch_count > 0} />
        <SummaryStat label="Cần xác minh" value={stats.needs_review_count ?? '—'} />
      </div>

      {/* Additional stats row */}
      <div className="flex gap-6 mb-6 text-sm text-slate-500">
        {stats.missing_a !== undefined && <span>Thiếu nguồn A: <strong className="text-slate-700">{stats.missing_a}</strong></span>}
        {stats.missing_b !== undefined && <span>Thiếu nguồn B: <strong className="text-slate-700">{stats.missing_b}</strong></span>}
        {stats.duplicate_count !== undefined && <span>Trùng lặp: <strong className="text-slate-700">{stats.duplicate_count}</strong></span>}
        {stats.matched_count !== undefined && <span>Đã ghép: <strong className="text-slate-700">{stats.matched_count}</strong></span>}
      </div>

      {/* Filters */}
      <div className="flex items-center gap-3 mb-4">
        <div className="relative">
          <Search size={14} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-slate-400" />
          <input
            type="text"
            className="input pl-8 pr-3 py-1.5 w-64 text-sm"
            placeholder="Tìm Mã HV hoặc họ tên..."
            value={search}
            onChange={(e) => { setSearch(e.target.value); setPage(1) }}
            id="results-search"
          />
        </div>

        <select
          className="input py-1.5 w-44 text-sm"
          value={statusFilter}
          onChange={(e) => { setStatusFilter(e.target.value); setOnlyMismatch(false); setOnlyReview(false); setPage(1) }}
          id="results-status-filter"
        >
          <option value="">Tất cả trạng thái</option>
          {Object.entries(STATUS_LABELS).map(([k, v]) => (
            <option key={k} value={k}>{v}</option>
          ))}
        </select>

        <button
          type="button"
          className={`btn btn-sm ${onlyMismatch ? 'btn-primary' : 'btn-secondary'}`}
          onClick={() => { setOnlyMismatch(!onlyMismatch); setOnlyReview(false); setStatusFilter(''); setPage(1) }}
          id="filter-mismatch-btn"
        >
          Chỉ sai lệch
        </button>
        <button
          type="button"
          className={`btn btn-sm ${onlyReview ? 'btn-primary' : 'btn-secondary'}`}
          onClick={() => { setOnlyReview(!onlyReview); setOnlyMismatch(false); setStatusFilter(''); setPage(1) }}
          id="filter-review-btn"
        >
          Cần xác minh
        </button>

        <span className="ml-auto text-xs text-slate-400">
          {filtered.length} dòng
        </span>
      </div>

      {/* Results table */}
      <div className="panel overflow-hidden mb-4">
        <div className="overflow-x-auto">
          <table className="data-table">
            <thead>
              <tr>
                <th className="w-10">STT</th>
                <SortableHeader field="student_id" label="Mã HV" sortField={sortField} sortDir={sortDir} onSort={handleSort} />
                <SortableHeader field="full_name" label="Họ và tên" sortField={sortField} sortDir={sortDir} onSort={handleSort} />
                <th>Ngày sinh</th>
                <SortableHeader field="score_a" label="Điểm VT" sortField={sortField} sortDir={sortDir} onSort={handleSort} />
                <SortableHeader field="score_b" label="Điểm CCE" sortField={sortField} sortDir={sortDir} onSort={handleSort} />
                <SortableHeader field="diff" label="Chênh lệch" sortField={sortField} sortDir={sortDir} onSort={handleSort} />
                <th>Trạng thái</th>
                <th>Lý do</th>
                <th>Nguồn</th>
                <th className="w-10" />
              </tr>
            </thead>
            <tbody>
              {paginated.length === 0 && (
                <tr>
                  <td colSpan={11} className="text-center py-10 text-slate-400">
                    Không có dữ liệu phù hợp
                  </td>
                </tr>
              )}
              {paginated.map((row, idx) => (
                <tr key={row.id || idx} className={getStatusRowClass(row.status)}>
                  <td className="text-slate-400">{(page - 1) * PAGE_SIZE + idx + 1}</td>
                  <td className="font-mono text-xs">{row.student_id || '—'}</td>
                  <td className="font-medium">{row.full_name || '—'}</td>
                  <td className="text-slate-500">{row.date_of_birth || '—'}</td>
                  <td className="font-medium">{formatScore(row.score_a)}</td>
                  <td className="font-medium">{formatScore(row.score_b)}</td>
                  <td className={row.diff && Math.abs(row.diff) > 0 ? 'text-red-600 font-medium' : 'text-slate-400'}>
                    {row.diff !== null && row.diff !== undefined
                      ? (row.diff > 0 ? '+' : '') + row.diff.toFixed(1)
                      : '—'}
                  </td>
                  <td><StatusBadge status={row.status} /></td>
                  <td className="text-xs text-slate-400 max-w-40 truncate" title={row.reason}>
                    {row.reason || ''}
                  </td>
                  <td className="text-xs text-slate-400">
                    <span title={`A: ${row.source_file_a} tr.${row.source_page_a}`}>
                      {row.source_file_a ? `${row.source_file_a?.split('/').pop()} p${row.source_page_a}` : ''}
                    </span>
                  </td>
                  <td>
                    {row.source_file_a && (
                      <button
                        type="button"
                        className="btn btn-ghost btn-sm p-1 text-slate-400"
                        title="Xem nguồn"
                        onClick={() => {/* detail modal */}}
                      >
                        <ExternalLink size={13} />
                      </button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {/* Pagination */}
      {totalPages > 1 && (
        <div className="flex items-center justify-between text-sm text-slate-500">
          <span>
            Trang {page}/{totalPages} ({filtered.length} dòng)
          </span>
          <div className="flex gap-2">
            <button
              className="btn btn-secondary btn-sm"
              disabled={page === 1}
              onClick={() => setPage((p) => p - 1)}
            >
              Trước
            </button>
            <button
              className="btn btn-secondary btn-sm"
              disabled={page === totalPages}
              onClick={() => setPage((p) => p + 1)}
            >
              Sau
            </button>
          </div>
        </div>
      )}
    </div>
  )
}

function SummaryStat({ label, value, highlight, danger }) {
  return (
    <div className={`panel px-4 py-3 ${highlight ? 'border-emerald-200' : ''}`}>
      <p className="text-xs text-slate-500 mb-0.5">{label}</p>
      <p className={`font-semibold text-base ${danger ? 'text-red-600' : highlight ? 'text-emerald-700' : 'text-slate-800'}`}>
        {value}
      </p>
    </div>
  )
}

function SortableHeader({ field, label, sortField, sortDir, onSort }) {
  const active = sortField === field
  return (
    <th
      className="cursor-pointer select-none hover:bg-slate-100"
      onClick={() => onSort(field)}
    >
      <div className="flex items-center gap-1">
        {label}
        {active ? (
          sortDir === 'asc' ? <ChevronUp size={12} /> : <ChevronDown size={12} />
        ) : (
          <ChevronsUpDown size={12} className="opacity-30" />
        )}
      </div>
    </th>
  )
}

