import { reconciliationApi } from '../services/api'
import { useToast } from '../components/Toast'
import { ClassMismatchAssistant } from '../components/ClassMismatchAssistant'
import { LoadingOverlay, Spinner } from '../components/Spinner'
import { ConfidenceBadge } from '../components/StatusBadge'
import {
  AlertTriangle,
  BookOpen,
  Check,
  ChevronDown,
  ChevronUp,
  Edit2,
  FileSpreadsheet,
  FileText,
  Layers,
  RotateCcw,
  School,
  Users,
  X,
} from 'lucide-react'
import { useEffect, useMemo, useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'

/**
 * Helper to group students by course section (Lớp học phần = Subject + Class)
 * Preserves originalIndex so edits map back to data.source_*.students[originalIndex]
 */
function groupStudentsByCourseSection(students = [], defaultMeta = {}) {
  const groups = []
  const groupMap = new Map()

  students.forEach((student, originalIndex) => {
    const subject = (student.subject || defaultMeta.subject || 'Chưa xác định môn').trim()
    const className = (student.class_name || defaultMeta.class_name || 'Chưa xác định lớp').trim()
    const key = `${subject.toLowerCase()}:::${className.toLowerCase()}`

    if (!groupMap.has(key)) {
      const groupObj = {
        key,
        subject,
        class_name: className,
        students: [],
      }
      groupMap.set(key, groupObj)
      groups.push(groupObj)
    }

    groupMap.get(key).students.push({
      ...student,
      originalIndex,
    })
  })

  return groups
}

export default function PreviewPage() {
  const { id } = useParams()
  const navigate = useNavigate()
  const toast = useToast()
  const [data, setData] = useState(null)
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [comparing, setComparing] = useState(false)
  const [editCell, setEditCell] = useState(null) // { source, studentIdx, field }
  const [editValue, setEditValue] = useState('')
  const [activeTab, setActiveTab] = useState('all') // 'all' | 'A' | 'B'

  useEffect(() => {
    reconciliationApi
      .getExtractedData(id)
      .then((res) => setData(res.data))
      .catch((e) => toast.error(`Không tải được dữ liệu: ${e.message}`))
      .finally(() => setLoading(false))
  }, [id])

  const handleEdit = (source, studentIdx, field, currentVal) => {
    setEditCell({ source, studentIdx, field })
    setEditValue(String(currentVal ?? ''))
  }

  const commitEdit = () => {
    if (!editCell) return
    const { source, studentIdx, field } = editCell
    setData((prev) => {
      const updated = { ...prev }
      const key = source === 'A' ? 'source_a' : 'source_b'
      updated[key] = { ...updated[key] }
      updated[key].students = updated[key].students.map((s, i) => {
        if (i !== studentIdx) return s
        return {
          ...s,
          [field]: editValue,
          _edited: { ...s._edited, [field]: { original: s[field], corrected: editValue } },
        }
      })
      return updated
    })
    setEditCell(null)
  }

  const cancelEdit = () => setEditCell(null)

  const handleConfirmAndCompare = async () => {
    setSaving(true)
    try {
      await reconciliationApi.updateExtractedData(id, data)
      setComparing(true)
      await reconciliationApi.compare(id)
      navigate(`/reconcile/${id}/results`)
    } catch (e) {
      toast.error(`Đối soát thất bại: ${e.message}`)
      setSaving(false)
      setComparing(false)
    }
  }

  const studentsA = data?.source_a?.students || []
  const studentsB = data?.source_b?.students || []
  const metaA = data?.source_a?.exam_metadata || {}
  const metaB = data?.source_b?.exam_metadata || {}

  const groupsA = useMemo(() => groupStudentsByCourseSection(studentsA, metaA), [studentsA, metaA])
  const groupsB = useMemo(() => groupStudentsByCourseSection(studentsB, metaB), [studentsB, metaB])

  if (loading) {
    return (
      <div className="px-8 py-8">
        <LoadingOverlay message="Đang tải dữ liệu trích xuất..." />
      </div>
    )
  }

  return (
    <div className="px-8 py-8 max-w-7xl mx-auto space-y-6">
      {/* Top Header */}
      <div className="flex flex-wrap items-center justify-between gap-4 pb-4 border-b border-slate-200">
        <div>
          <div className="flex items-center gap-2">
            <h1 className="text-xl font-bold text-slate-800">Xem trước dữ liệu trích xuất</h1>
            <span className="badge badge-info text-xs">
              Mỗi lớp học phần là 1 bảng riêng biệt
            </span>
          </div>
          <p className="text-sm text-slate-500 mt-1">
            Kiểm tra từng lớp học phần của Nguồn A và Nguồn B trước khi tiến hành đối soát điểm số.
          </p>
        </div>

        <button
          type="button"
          className="btn btn-primary shadow-sm hover:shadow"
          onClick={handleConfirmAndCompare}
          disabled={saving || comparing}
        >
          {comparing ? <Spinner size={15} /> : <Check size={16} />}
          {comparing ? 'Đang đối soát...' : 'Xác nhận & Tiến hành đối soát'}
        </button>
      </div>

      {/* Discarded or Mismatched classes assistant if available */}
      {data?.discarded_classes && data.discarded_classes.length > 0 && (
        <ClassMismatchAssistant discardedClasses={data.discarded_classes} />
      )}

      {/* Exam metadata */}
      {data?.source_a?.exam_metadata && (
        <MetadataPanel meta={data.source_a.exam_metadata} title="Thông tin kỳ thi nhận diện từ bìa/tiêu đề" />
      )}

      {/* Source navigation tabs */}
      <div className="flex items-center gap-2 border-b border-slate-200 pb-2">
        <button
          type="button"
          onClick={() => setActiveTab('all')}
          className={`px-3 py-1.5 rounded-lg text-xs font-semibold flex items-center gap-1.5 transition-colors ${
            activeTab === 'all'
              ? 'bg-slate-800 text-white'
              : 'text-slate-600 hover:bg-slate-100'
          }`}
        >
          <Layers size={14} />
          Tất cả nguồn ({groupsA.length + groupsB.length} bảng)
        </button>

        <button
          type="button"
          onClick={() => setActiveTab('A')}
          className={`px-3 py-1.5 rounded-lg text-xs font-semibold flex items-center gap-1.5 transition-colors ${
            activeTab === 'A'
              ? 'bg-indigo-600 text-white'
              : 'text-slate-600 hover:bg-indigo-50 hover:text-indigo-700'
          }`}
        >
          <FileText size={14} />
          Nguồn A – Viết tay ({studentsA.length} HV · {groupsA.length} lớp học phần)
        </button>

        <button
          type="button"
          onClick={() => setActiveTab('B')}
          className={`px-3 py-1.5 rounded-lg text-xs font-semibold flex items-center gap-1.5 transition-colors ${
            activeTab === 'B'
              ? 'bg-emerald-600 text-white'
              : 'text-slate-600 hover:bg-emerald-50 hover:text-emerald-700'
          }`}
        >
          <FileSpreadsheet size={14} />
          Nguồn B – Hệ thống ({studentsB.length} HV · {groupsB.length} lớp học phần)
        </button>
      </div>

      {/* Main Content Area */}
      {data && (
        <div className="space-y-8">
          {/* SOURCE A SECTION */}
          {(activeTab === 'all' || activeTab === 'A') && (
            <div className="space-y-4">
              <div className="flex items-center justify-between bg-indigo-50/80 px-4 py-2.5 rounded-xl border border-indigo-100">
                <div className="flex items-center gap-2">
                  <span className="w-6 h-6 rounded bg-indigo-600 text-white flex items-center justify-center font-bold text-xs">
                    A
                  </span>
                  <h2 className="text-sm font-bold text-indigo-900">
                    Nguồn A – Biên bản điểm viết tay
                  </h2>
                  <span className="text-xs text-indigo-700 bg-indigo-100 px-2 py-0.5 rounded-full font-medium">
                    {groupsA.length} lớp học phần ({studentsA.length} học viên)
                  </span>
                </div>
                <span className="text-xs text-slate-500">
                  Click vào ô điểm/thông tin để chỉnh sửa trực tiếp
                </span>
              </div>

              {groupsA.length === 0 ? (
                <div className="panel p-8 text-center text-slate-400">
                  Không có dữ liệu học viên trong Nguồn A
                </div>
              ) : (
                <div className="space-y-4">
                  {groupsA.map((group, gIdx) => (
                    <CourseSectionTable
                      key={`A_${group.key}_${gIdx}`}
                      groupIndex={gIdx + 1}
                      source="A"
                      subject={group.subject}
                      className={group.class_name}
                      students={group.students}
                      editCell={editCell}
                      editValue={editValue}
                      onEdit={handleEdit}
                      onEditChange={setEditValue}
                      onCommit={commitEdit}
                      onCancel={cancelEdit}
                    />
                  ))}
                </div>
              )}
            </div>
          )}

          {/* SOURCE B SECTION */}
          {(activeTab === 'all' || activeTab === 'B') && (
            <div className="space-y-4">
              <div className="flex items-center justify-between bg-emerald-50/80 px-4 py-2.5 rounded-xl border border-emerald-100">
                <div className="flex items-center gap-2">
                  <span className="w-6 h-6 rounded bg-emerald-600 text-white flex items-center justify-center font-bold text-xs">
                    B
                  </span>
                  <h2 className="text-sm font-bold text-emerald-900">
                    Nguồn B – Điểm hệ thống CCE
                  </h2>
                  <span className="text-xs text-emerald-700 bg-emerald-100 px-2 py-0.5 rounded-full font-medium">
                    {groupsB.length} lớp học phần ({studentsB.length} học viên)
                  </span>
                </div>
                <span className="text-xs text-slate-500">
                  Click vào ô điểm/thông tin để chỉnh sửa trực tiếp
                </span>
              </div>

              {groupsB.length === 0 ? (
                <div className="panel p-8 text-center text-slate-400">
                  Không có dữ liệu học viên trong Nguồn B
                </div>
              ) : (
                <div className="space-y-4">
                  {groupsB.map((group, gIdx) => (
                    <CourseSectionTable
                      key={`B_${group.key}_${gIdx}`}
                      groupIndex={gIdx + 1}
                      source="B"
                      subject={group.subject}
                      className={group.class_name}
                      students={group.students}
                      editCell={editCell}
                      editValue={editValue}
                      onEdit={handleEdit}
                      onEditChange={setEditValue}
                      onCommit={commitEdit}
                      onCancel={cancelEdit}
                    />
                  ))}
                </div>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  )
}

function MetadataPanel({ meta, title }) {
  const fields = [
    ['Học kỳ', meta.semester],
    ['Học phần thi', meta.subject],
    ['Khóa', meta.course],
    ['Ngày giờ thi', meta.exam_datetime],
    ['Lớp', meta.class_name],
    ['Ngành', meta.major],
    ['Địa điểm thi', meta.exam_location],
    ['Phòng thi', meta.room],
  ]

  return (
    <div className="panel">
      <div className="panel-header bg-slate-50/50">
        <h2 className="text-xs font-semibold uppercase tracking-wider text-slate-600">{title}</h2>
      </div>
      <div className="panel-body py-3">
        <dl className="grid grid-cols-2 md:grid-cols-4 gap-x-6 gap-y-2.5">
          {fields.map(([label, value]) => (
            <div key={label}>
              <dt className="text-xs text-slate-400">{label}</dt>
              <dd className="text-sm font-medium text-slate-700 mt-0.5">
                {value || <span className="text-slate-300">—</span>}
              </dd>
            </div>
          ))}
        </dl>
      </div>
    </div>
  )
}

function CourseSectionTable({
  groupIndex,
  source,
  subject,
  className,
  students,
  editCell,
  editValue,
  onEdit,
  onEditChange,
  onCommit,
  onCancel,
}) {
  const [isCollapsed, setIsCollapsed] = useState(false)
  const EDITABLE_FIELDS = ['student_id', 'full_name', 'date_of_birth', 'score']
  const reviewCount = students.filter((s) => s.needs_review).length

  return (
    <div className="panel border border-slate-200/90 shadow-xs overflow-hidden">
      {/* Course section title bar */}
      <div className="panel-header bg-slate-50/80 px-4 py-3 flex flex-wrap items-center justify-between gap-3 border-b border-slate-200">
        <div className="flex flex-wrap items-center gap-2.5">
          <span className="font-mono text-xs font-bold text-slate-500 bg-slate-200/70 px-2 py-0.5 rounded">
            #{groupIndex}
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

        <div className="flex items-center gap-3">
          <span className="text-xs font-medium text-slate-600 bg-white px-2.5 py-1 rounded border border-slate-200 flex items-center gap-1.5">
            <Users size={13} className="text-slate-400" />
            <strong>{students.length}</strong> học viên
          </span>

          {reviewCount > 0 && (
            <span className="badge badge-review flex items-center gap-1 text-xs">
              <AlertTriangle size={12} />
              {reviewCount} cần kiểm tra
            </span>
          )}

          <button
            type="button"
            onClick={() => setIsCollapsed(!isCollapsed)}
            className="btn btn-ghost btn-sm p-1 text-slate-500 hover:text-slate-700"
            title={isCollapsed ? 'Mở rộng bảng' : 'Thu gọn bảng'}
          >
            {isCollapsed ? <ChevronDown size={16} /> : <ChevronUp size={16} />}
          </button>
        </div>
      </div>

      {/* Table content */}
      {!isCollapsed && (
        <div className="overflow-x-auto">
          <table className="data-table">
            <thead>
              <tr>
                <th className="w-12 text-center">STT</th>
                <th>Mã HV</th>
                <th>Họ và tên</th>
                <th>Ngày sinh</th>
                <th>Điểm số</th>
                <th>Độ tin cậy</th>
                <th>Ghi chú</th>
                <th>Trang nguồn</th>
              </tr>
            </thead>
            <tbody>
              {students.map((s, idx) => {
                const targetIdx = s.originalIndex ?? idx
                return (
                  <tr key={idx} className={s.needs_review ? 'row-review' : ''}>
                    <td className="text-slate-400 text-center font-mono text-xs">
                      {s.stt ?? idx + 1}
                    </td>

                    {EDITABLE_FIELDS.map((field) => {
                      const isEditing =
                        editCell?.source === source &&
                        editCell?.studentIdx === targetIdx &&
                        editCell?.field === field
                      const wasEdited = s._edited?.[field]

                      return (
                        <td key={field}>
                          {isEditing ? (
                            <div className="flex items-center gap-1">
                              <input
                                className="input py-0.5 px-1.5 text-xs w-28 font-mono"
                                value={editValue}
                                onChange={(e) => onEditChange(e.target.value)}
                                onKeyDown={(e) => {
                                  if (e.key === 'Enter') onCommit()
                                  if (e.key === 'Escape') onCancel()
                                }}
                                autoFocus
                              />
                              <button
                                type="button"
                                className="btn btn-ghost p-1 text-emerald-600 hover:bg-emerald-50"
                                onClick={onCommit}
                              >
                                <Check size={13} />
                              </button>
                              <button
                                type="button"
                                className="btn btn-ghost p-1 text-red-500 hover:bg-red-50"
                                onClick={onCancel}
                              >
                                <X size={13} />
                              </button>
                            </div>
                          ) : (
                            <div
                              className="flex items-center gap-1 group cursor-pointer"
                              onClick={() => onEdit(source, targetIdx, field, s[field])}
                              title="Click để chỉnh sửa"
                            >
                              <span
                                className={`font-mono ${
                                  s[field] === null || s[field] === undefined
                                    ? 'text-slate-300'
                                    : wasEdited
                                    ? 'text-blue-700 font-semibold'
                                    : field === 'score'
                                    ? 'font-bold text-slate-800'
                                    : ''
                                }`}
                              >
                                {s[field] !== null && s[field] !== undefined ? String(s[field]) : '—'}
                              </span>
                              <Edit2
                                size={11}
                                className="opacity-0 group-hover:opacity-40 text-slate-500 shrink-0 transition-opacity"
                              />
                              {wasEdited && (
                                <span className="text-[11px] text-slate-400 line-through ml-1 font-mono">
                                  {String(wasEdited.original ?? '')}
                                </span>
                              )}
                            </div>
                          )}
                        </td>
                      )
                    })}

                    <td>
                      {s.cross_confidence !== null && s.cross_confidence !== undefined ? (
                        <ConfidenceBadge
                          value={s.cross_confidence}
                          detail={s.cross_validation_detail || s.review_reason}
                        />
                      ) : s.confidence?.score !== undefined ? (
                        <ConfidenceBar value={s.confidence.score} />
                      ) : (
                        '—'
                      )}
                    </td>

                    <td className="max-w-56 truncate text-slate-400 text-xs" title={s.review_reason || ''}>
                      {s.needs_review && s.review_reason ? s.review_reason : ''}
                    </td>

                    <td className="text-xs text-slate-400 font-mono">
                      {s.source_file ? `${s.source_file.split(/[/\\]/).pop()} tr.${s.page_number}` : '—'}
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}

function ConfidenceBar({ value }) {
  const pct = Math.round((value || 0) * 100)
  const color =
    pct >= 80 ? 'bg-emerald-400' : pct >= 50 ? 'bg-amber-400' : 'bg-red-400'
  return (
    <div className="flex items-center gap-2">
      <div className="h-1.5 w-16 bg-slate-100 rounded-full overflow-hidden">
        <div className={`h-full ${color} rounded-full`} style={{ width: `${pct}%` }} />
      </div>
      <span className="text-xs text-slate-500">{pct}%</span>
    </div>
  )
}
