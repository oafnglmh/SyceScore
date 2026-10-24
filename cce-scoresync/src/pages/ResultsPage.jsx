import { reconciliationApi } from '../services/api'
import { useToast } from '../components/Toast'
import { ClassMismatchAssistant } from '../components/ClassMismatchAssistant'
import { StatusBadge, ConfidenceBadge } from '../components/StatusBadge'
import { LoadingOverlay, Spinner } from '../components/Spinner'
import { downloadBlob, formatScore, getStatusRowClass } from '../utils/helpers'
import { STATUS_LABELS } from '../constants'
import {
  AlertTriangle,
  BookOpen,
  CheckCircle2,
  ChevronDown,
  ChevronUp,
  ChevronsUpDown,
  Download,
  ExternalLink,
  Filter,
  Layers,
  School,
  Search,
  Users,
  X,
} from 'lucide-react'
import { useEffect, useMemo, useState } from 'react'
import { useParams } from 'react-router-dom'

/**
 * Normalizes course section list from either backend `subject_groups`
 * or fallback by grouping `items` (comparison rows) by (subject, class_name).
 */
function buildCourseSections(subjectGroups = [], items = [], defaultMeta = {}) {
  // If backend provided populated subject_groups, flatten into a list of course sections
  if (subjectGroups && subjectGroups.length > 0) {
    const sections = []
    subjectGroups.forEach((sg) => {
      const subjectName = sg.subject_name || defaultMeta.subject || 'Chưa xác định môn'
      const classes = sg.classes || []
      if (classes.length > 0) {
        classes.forEach((cg) => {
          sections.push({
            id: `${subjectName}:::${cg.class_name}`,
            subject: subjectName,
            subject_b: sg.subject_b_name,
            class_name: cg.class_name || defaultMeta.class_name || 'Chưa xác định lớp',
            rows: cg.comparison_rows || [],
            stats: cg.stats || {},
          })
        })
      } else {
        // Subject without explicit class group
        sections.push({
          id: `${subjectName}:::default`,
          subject: subjectName,
          subject_b: sg.subject_b_name,
          class_name: defaultMeta.class_name || 'Mặc định',
          rows: [],
          stats: sg.stats || {},
        })
      }
    })
    if (sections.length > 0 && sections.some((s) => s.rows.length > 0)) {
      return sections
    }
  }

  // Fallback: group flat comparison rows by (subject, class_name)
  const groupMap = new Map()
  const sections = []

  items.forEach((row) => {
    const subject = (row.subject || defaultMeta.subject || 'Chưa xác định môn').trim()
    const className = (row.class_name || defaultMeta.class_name || 'Chưa xác định lớp').trim()
    const key = `${subject.toLowerCase()}:::${className.toLowerCase()}`

    if (!groupMap.has(key)) {
      const sectionObj = {
        id: key,
        subject,
        class_name: className,
        rows: [],
        stats: {},
      }
      groupMap.set(key, sectionObj)
      sections.push(sectionObj)
    }

    groupMap.get(key).rows.push(row)
  })

  // Calculate quick stats for fallback sections
  sections.forEach((sec) => {
    const total = sec.rows.length
    const matched = sec.rows.filter((r) => r.status === 'MATCH').length
    const mismatched = sec.rows.filter((r) => r.status === 'MISMATCH').length
    const needsReview = sec.rows.filter((r) => r.status === 'NEEDS_REVIEW').length
    const missingA = sec.rows.filter((r) => r.status === 'MISSING_SOURCE_A').length
    const missingB = sec.rows.filter((r) => r.status === 'MISSING_SOURCE_B').length
    const comparable = matched + mismatched
    sec.stats = {
      matched_count: matched,
      mismatch_count: mismatched,
      needs_review_count: needsReview,
      missing_a: missingA,
      missing_b: missingB,
      comparable_count: comparable,
      match_rate: comparable > 0 ? (matched / comparable) * 100 : 0,
      total_rows: total,
    }
  })

  return sections
}

export default function ResultsPage() {
  const { id } = useParams()
  const toast = useToast()
  const [session, setSession] = useState(null)
  const [resultsData, setResultsData] = useState(null)
  const [loading, setLoading] = useState(true)
  const [exporting, setExporting] = useState(false)

  // Filters
  const [search, setSearch] = useState('')
  const [statusFilter, setStatusFilter] = useState('')
  const [onlyMismatch, setOnlyMismatch] = useState(false)
  const [onlyReview, setOnlyReview] = useState(false)
  const [selectedSectionId, setSelectedSectionId] = useState('ALL') // 'ALL' or specific section id

  // Sorting
  const [sortField, setSortField] = useState('student_id')
  const [sortDir, setSortDir] = useState('asc')

  useEffect(() => {
    Promise.all([
      reconciliationApi.get(id),
      reconciliationApi.getResults(id),
    ])
      .then(([sessionRes, resultsRes]) => {
        setSession(sessionRes.data)
        setResultsData(resultsRes.data)
      })
      .catch((e) => toast.error(`Không tải được kết quả: ${e.message}`))
      .finally(() => setLoading(false))
  }, [id])

  // Extract sections
  const sections = useMemo(() => {
    const rawSubjectGroups =
      resultsData?.subject_groups?.length > 0
        ? resultsData.subject_groups
        : session?.subject_groups || []
    const flatItems = resultsData?.items || session?.comparison_results || []
    const meta = session?.metadata || {}

    return buildCourseSections(rawSubjectGroups, flatItems, meta)
  }, [resultsData, session])

  const discardedClasses =
    resultsData?.discarded_classes?.length > 0
      ? resultsData.discarded_classes
      : session?.discarded_classes || []

  const stats = session?.stats || resultsData?.stats || {}

  const handleExport = async (subjectFilter = null) => {
    setExporting(true)
    try {
      const res = await reconciliationApi.exportExcel(id, subjectFilter)
      const now = new Date()
      const ts = now.toISOString().slice(0, 16).replace(/[-T:]/g, '').replace('', '_')
      const filenameSuffix = subjectFilter ? `_${subjectFilter}` : ''
      downloadBlob(res.data, `CCE_ScoreSync_DoiSoat${filenameSuffix}_${ts}.xlsx`)
      toast.success('Xuất Excel thành công.')
    } catch (e) {
      toast.error(`Xuất Excel thất bại: ${e.message}`)
    } finally {
      setExporting(false)
    }
  }

  const handleSort = (field) => {
    if (sortField === field) {
      setSortDir((d) => (d === 'asc' ? 'desc' : 'asc'))
    } else {
      setSortField(field)
      setSortDir('asc')
    }
  }

  if (loading) {
    return (
      <div className="px-8 py-8">
        <LoadingOverlay message="Đang tải kết quả đối soát..." />
      </div>
    )
  }

  // Filter sections if user selected a single section
  const visibleSections =
    selectedSectionId === 'ALL'
      ? sections
      : sections.filter((s) => s.id === selectedSectionId)

  return (
    <div className="px-8 py-8 max-w-full space-y-6">
      {/* Header bar */}
      <div className="flex flex-wrap items-center justify-between gap-4 pb-4 border-b border-slate-200">
        <div>
          <div className="flex items-center gap-2">
            <h1 className="text-xl font-bold text-slate-800">Kết quả đối soát điểm thi</h1>
            <span className="badge badge-info text-xs">
              {sections.length} lớp học phần được đối soát riêng biệt
            </span>
          </div>
          <p className="text-sm text-slate-500 mt-1">
            {session?.metadata?.subject
              ? `${session.metadata.subject} · ${session.metadata.class_name || ''}`
              : `Phiên đối soát ${id?.slice(0, 8)}`}
          </p>
        </div>

        <button
          type="button"
          className="btn btn-secondary shadow-xs hover:shadow"
          onClick={() => handleExport()}
          disabled={exporting}
        >
          {exporting ? <Spinner size={14} /> : <Download size={15} />}
          Xuất toàn bộ Excel
        </button>
      </div>

      {/* Discarded/Unmatched class assistant if any */}
      {discardedClasses.length > 0 && (
        <ClassMismatchAssistant discardedClasses={discardedClasses} />
      )}

      {/* Stats summary panel */}
      <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
        <SummaryStat label="Nguồn A (Viết tay)" value={stats.total_source_a ?? '—'} />
        <SummaryStat label="Nguồn B (Hệ thống)" value={stats.total_source_b ?? '—'} />
        <SummaryStat
          label="Tỷ lệ khớp tổng thể"
          value={
            stats.match_rate !== undefined
              ? `${stats.matched_count}/${stats.comparable_count} = ${stats.match_rate?.toFixed(1)}%`
              : '—'
          }
          highlight
        />
        <SummaryStat
          label="Sai lệch điểm"
          value={stats.mismatch_count ?? '—'}
          danger={stats.mismatch_count > 0}
        />
        <SummaryStat label="Cần xác minh" value={stats.needs_review_count ?? '—'} />
      </div>

      {/* Extra stats */}
      <div className="flex flex-wrap gap-4 text-xs text-slate-500 bg-slate-50 px-4 py-2 rounded-lg border border-slate-200">
        {stats.missing_a !== undefined && (
          <span>
            Thiếu nguồn A: <strong className="text-slate-800">{stats.missing_a}</strong>
          </span>
        )}
        {stats.missing_b !== undefined && (
          <span>
            Thiếu nguồn B: <strong className="text-slate-800">{stats.missing_b}</strong>
          </span>
        )}
        {stats.duplicate_count !== undefined && (
          <span>
            Trùng lặp: <strong className="text-slate-800">{stats.duplicate_count}</strong>
          </span>
        )}
        {stats.matched_count !== undefined && (
          <span>
            Đã so khớp: <strong className="text-slate-800">{stats.matched_count}</strong>
          </span>
        )}
      </div>

      {/* Filter & Jump Toolbar */}
      <div className="panel p-4 bg-white space-y-3">
        <div className="flex flex-wrap items-center justify-between gap-3">
          {/* Quick jump between Course Sections */}
          <div className="flex items-center gap-2 overflow-x-auto max-w-full pb-1">
            <span className="text-xs font-semibold text-slate-500 shrink-0 flex items-center gap-1">
              <Layers size={13} /> Lớp học phần:
            </span>
            <button
              type="button"
              onClick={() => setSelectedSectionId('ALL')}
              className={`px-2.5 py-1 rounded-md text-xs font-semibold whitespace-nowrap transition-colors ${
                selectedSectionId === 'ALL'
                  ? 'bg-slate-800 text-white shadow-xs'
                  : 'bg-slate-100 text-slate-600 hover:bg-slate-200'
              }`}
            >
              Tất cả ({sections.length} lớp)
            </button>
            {sections.map((sec, idx) => {
              const isSelected = selectedSectionId === sec.id
              return (
                <button
                  key={sec.id || idx}
                  type="button"
                  onClick={() => setSelectedSectionId(sec.id)}
                  className={`px-2.5 py-1 rounded-md text-xs font-medium whitespace-nowrap transition-colors flex items-center gap-1.5 ${
                    isSelected
                      ? 'bg-blue-600 text-white shadow-xs'
                      : 'bg-blue-50 text-blue-800 border border-blue-200 hover:bg-blue-100'
                  }`}
                >
                  <span>{sec.subject}</span>
                  <span className="font-mono font-bold bg-white/20 px-1 rounded text-[11px]">
                    {sec.class_name}
                  </span>
                  <span className="text-[11px] opacity-80">({sec.rows.length} SV)</span>
                </button>
              )
            })}
          </div>
        </div>

        {/* Global search & status filters */}
        <div className="flex flex-wrap items-center gap-3 pt-2 border-t border-slate-100">
          <div className="relative">
            <Search size={14} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-slate-400" />
            <input
              type="text"
              className="input pl-8 pr-3 py-1.5 w-60 text-xs"
              placeholder="Tìm Mã HV hoặc họ tên..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              id="results-search"
            />
          </div>

          <select
            className="input py-1.5 w-44 text-xs"
            value={statusFilter}
            onChange={(e) => {
              setStatusFilter(e.target.value)
              setOnlyMismatch(false)
              setOnlyReview(false)
            }}
            id="results-status-filter"
          >
            <option value="">Tất cả trạng thái</option>
            {Object.entries(STATUS_LABELS).map(([k, v]) => (
              <option key={k} value={k}>
                {v}
              </option>
            ))}
          </select>

          <button
            type="button"
            className={`btn btn-sm text-xs ${onlyMismatch ? 'btn-primary' : 'btn-secondary'}`}
            onClick={() => {
              setOnlyMismatch(!onlyMismatch)
              setOnlyReview(false)
              setStatusFilter('')
            }}
            id="filter-mismatch-btn"
          >
            Chỉ sai lệch
          </button>

          <button
            type="button"
            className={`btn btn-sm text-xs ${onlyReview ? 'btn-primary' : 'btn-secondary'}`}
            onClick={() => {
              setOnlyReview(!onlyReview)
              setOnlyMismatch(false)
              setStatusFilter('')
            }}
            id="filter-review-btn"
          >
            Cần xác minh
          </button>

          {(search || statusFilter || onlyMismatch || onlyReview) && (
            <button
              type="button"
              className="btn btn-ghost btn-sm text-xs text-slate-500 hover:text-slate-700 flex items-center gap-1"
              onClick={() => {
                setSearch('')
                setStatusFilter('')
                setOnlyMismatch(false)
                setOnlyReview(false)
              }}
            >
              <X size={12} /> Xóa bộ lọc
            </button>
          )}
        </div>
      </div>

      {/* Render Dedicated Table for Each Course Section */}
      <div className="space-y-6">
        {visibleSections.length === 0 ? (
          <div className="panel p-10 text-center text-slate-400">
            Không tìm thấy lớp học phần phù hợp
          </div>
        ) : (
          visibleSections.map((sec, idx) => (
            <CourseSectionResultsTable
              key={sec.id || idx}
              sectionIndex={idx + 1}
              subject={sec.subject}
              className={sec.class_name}
              rows={sec.rows}
              stats={sec.stats}
              search={search}
              statusFilter={statusFilter}
              onlyMismatch={onlyMismatch}
              onlyReview={onlyReview}
              sortField={sortField}
              sortDir={sortDir}
              onSort={handleSort}
              onExportExcel={() => handleExport(sec.subject)}
            />
          ))
        )}
      </div>
    </div>
  )
}

function CourseSectionResultsTable({
  sectionIndex,
  subject,
  className,
  rows = [],
  stats = {},
  search,
  statusFilter,
  onlyMismatch,
  onlyReview,
  sortField,
  sortDir,
  onSort,
  onExportExcel,
}) {
  const [isCollapsed, setIsCollapsed] = useState(false)

  // Filter & sort rows for this specific section
  const filteredRows = useMemo(() => {
    let r = rows

    if (onlyMismatch) r = r.filter((item) => item.status === 'MISMATCH')
    else if (onlyReview) r = r.filter((item) => item.status === 'NEEDS_REVIEW')
    else if (statusFilter) r = r.filter((item) => item.status === statusFilter)

    if (search.trim()) {
      const q = search.trim().toLowerCase()
      r = r.filter(
        (item) =>
          item.student_id?.toLowerCase().includes(q) ||
          item.full_name?.toLowerCase().includes(q)
      )
    }

    r = [...r].sort((a, b) => {
      const av = a[sortField] ?? ''
      const bv = b[sortField] ?? ''
      const cmp = String(av).localeCompare(String(bv), 'vi', { numeric: true })
      return sortDir === 'asc' ? cmp : -cmp
    })

    return r
  }, [rows, search, statusFilter, onlyMismatch, onlyReview, sortField, sortDir])

  const matchRate = stats.match_rate ?? 0
  const mismatchCount = stats.mismatch_count ?? 0
  const needsReviewCount = stats.needs_review_count ?? 0
  const matchedCount = stats.matched_count ?? 0
  const comparableCount = stats.comparable_count ?? rows.length

  return (
    <div className="panel border border-slate-200/90 shadow-xs overflow-hidden">
      {/* Table Card Header with course section info and stats */}
      <div className="panel-header bg-slate-50/90 px-4 py-3 flex flex-wrap items-center justify-between gap-3 border-b border-slate-200">
        <div className="flex flex-wrap items-center gap-2.5">
          <span className="font-mono text-xs font-bold text-slate-500 bg-slate-200/70 px-2 py-0.5 rounded">
            #{sectionIndex}
          </span>

          <div className="flex items-center gap-1.5 bg-blue-50 text-blue-900 border border-blue-200 px-2.5 py-1 rounded-md text-xs font-semibold">
            <BookOpen size={13} className="text-blue-600 shrink-0" />
            <span>Học phần: <strong>{subject}</strong></span>
          </div>

          <div className="flex items-center gap-1.5 bg-emerald-50 text-emerald-900 border border-emerald-200 px-2.5 py-1 rounded-md text-xs font-semibold font-mono">
            <School size={13} className="text-emerald-600 shrink-0" />
            <span>Lớp: <strong>{className}</strong></span>
          </div>
        </div>

        {/* Section Stats Badges */}
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-xs font-medium text-slate-600 bg-white px-2 py-0.5 rounded border border-slate-200">
            {rows.length} SV
          </span>

          <span
            className={`text-xs font-semibold px-2.5 py-0.5 rounded-full border ${
              matchRate >= 95
                ? 'bg-emerald-50 text-emerald-700 border-emerald-200'
                : matchRate >= 80
                ? 'bg-amber-50 text-amber-700 border-amber-200'
                : 'bg-red-50 text-red-700 border-red-200'
            }`}
          >
            Khớp: {matchRate.toFixed(1)}% ({matchedCount}/{comparableCount})
          </span>

          {mismatchCount > 0 && (
            <span className="badge badge-danger text-xs font-semibold">
              {mismatchCount} lệch điểm
            </span>
          )}

          {needsReviewCount > 0 && (
            <span className="badge badge-review text-xs font-semibold">
              {needsReviewCount} cần xác minh
            </span>
          )}

          <button
            type="button"
            onClick={() => setIsCollapsed(!isCollapsed)}
            className="btn btn-ghost btn-sm p-1 text-slate-500 hover:text-slate-700 ml-1"
            title={isCollapsed ? 'Mở rộng bảng' : 'Thu gọn bảng'}
          >
            {isCollapsed ? <ChevronDown size={16} /> : <ChevronUp size={16} />}
          </button>
        </div>
      </div>

      {/* Table Content */}
      {!isCollapsed && (
        <div className="overflow-x-auto">
          <table className="data-table">
            <thead>
              <tr>
                <th className="w-12 text-center">STT</th>
                <SortableHeader
                  field="student_id"
                  label="Mã HV"
                  sortField={sortField}
                  sortDir={sortDir}
                  onSort={onSort}
                />
                <SortableHeader
                  field="full_name"
                  label="Họ và tên"
                  sortField={sortField}
                  sortDir={sortDir}
                  onSort={onSort}
                />
                <th>Ngày sinh</th>
                <SortableHeader
                  field="score_a"
                  label="Điểm VT (A)"
                  sortField={sortField}
                  sortDir={sortDir}
                  onSort={onSort}
                />
                <SortableHeader
                  field="score_b"
                  label="Điểm CCE (B)"
                  sortField={sortField}
                  sortDir={sortDir}
                  onSort={onSort}
                />
                <SortableHeader
                  field="diff"
                  label="Chênh lệch"
                  sortField={sortField}
                  sortDir={sortDir}
                  onSort={onSort}
                />
                <th>Trạng thái</th>
                <th>Độ tin cậy</th>
                <th>Lý do</th>
                <th>Nguồn</th>
                <th className="w-10" />
              </tr>
            </thead>
            <tbody>
              {filteredRows.length === 0 ? (
                <tr>
                  <td colSpan={12} className="text-center py-8 text-slate-400">
                    Không có học viên nào phù hợp với bộ lọc trong lớp học phần này
                  </td>
                </tr>
              ) : (
                filteredRows.map((row, idx) => (
                  <tr key={row.id || idx} className={getStatusRowClass(row.status)}>
                    <td className="text-slate-400 text-center font-mono text-xs">
                      {idx + 1}
                    </td>
                    <td className="font-mono text-xs font-semibold text-slate-800">
                      {row.student_id || '—'}
                    </td>
                    <td className="font-medium text-slate-800">{row.full_name || '—'}</td>
                    <td className="text-slate-500 text-xs">{row.date_of_birth || '—'}</td>
                    <td className="font-mono font-bold text-slate-800">
                      {formatScore(row.score_a)}
                    </td>
                    <td className="font-mono font-bold text-slate-800">
                      {formatScore(row.score_b)}
                    </td>
                    <td
                      className={`font-mono text-xs ${
                        row.diff && Math.abs(row.diff) > 0
                          ? 'text-red-600 font-bold'
                          : 'text-slate-400'
                      }`}
                    >
                      {row.diff !== null && row.diff !== undefined
                        ? (row.diff > 0 ? '+' : '') + row.diff.toFixed(1)
                        : '—'}
                    </td>
                    <td>
                      <StatusBadge status={row.status} />
                    </td>
                    <td>
                      <ConfidenceBadge
                        value={row.cross_confidence}
                        detail={row.reason}
                      />
                    </td>
                    <td
                      className="text-xs text-slate-400 max-w-44 truncate"
                      title={row.reason || ''}
                    >
                      {row.reason || ''}
                    </td>
                    <td className="text-xs text-slate-400 font-mono">
                      <span title={`A: ${row.source_file_a} tr.${row.source_page_a}`}>
                        {row.source_file_a
                          ? `${row.source_file_a.split(/[/\\]/).pop()} p${row.source_page_a}`
                          : ''}
                      </span>
                    </td>
                    <td>
                      {row.source_file_a && (
                        <button
                          type="button"
                          className="btn btn-ghost btn-sm p-1 text-slate-400 hover:text-slate-600"
                          title="Xem chi tiết nguồn"
                        >
                          <ExternalLink size={13} />
                        </button>
                      )}
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}

function SummaryStat({ label, value, highlight, danger }) {
  return (
    <div className={`panel px-4 py-3 ${highlight ? 'border-emerald-200' : ''}`}>
      <p className="text-xs text-slate-500 mb-0.5">{label}</p>
      <p
        className={`font-semibold text-base ${
          danger ? 'text-red-600' : highlight ? 'text-emerald-700' : 'text-slate-800'
        }`}
      >
        {value}
      </p>
    </div>
  )
}

function SortableHeader({ field, label, sortField, sortDir, onSort }) {
  const active = sortField === field
  return (
    <th
      className="cursor-pointer select-none hover:bg-slate-100 transition-colors"
      onClick={() => onSort(field)}
    >
      <div className="flex items-center gap-1">
        {label}
        {active ? (
          sortDir === 'asc' ? (
            <ChevronUp size={12} className="text-blue-600" />
          ) : (
            <ChevronDown size={12} className="text-blue-600" />
          )
        ) : (
          <ChevronsUpDown size={12} className="opacity-30" />
        )}
      </div>
    </th>
  )
}
