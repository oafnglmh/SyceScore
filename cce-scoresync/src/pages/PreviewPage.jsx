import { reconciliationApi } from '../services/api'
import { useToast } from '../components/Toast'
import { ClassMismatchAssistant } from '../components/ClassMismatchAssistant'
import { LoadingOverlay, Spinner } from '../components/Spinner'
import { Check, ChevronDown, ChevronUp, Edit2, RotateCcw, X } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'

export default function PreviewPage() {
  const { id } = useParams()
  const navigate = useNavigate()
  const toast = useToast()
  const [data, setData] = useState(null)
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [comparing, setComparing] = useState(false)
  const [error, setError] = useState(null)
  const [editCell, setEditCell] = useState(null) // { source, studentIdx, field }
  const [editValue, setEditValue] = useState('')

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

  if (loading) return <div className="px-8 py-8"><LoadingOverlay message="Đang tải dữ liệu trích xuất..." /></div>

  return (
    <div className="px-8 py-8 max-w-6xl">
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-xl font-bold text-slate-800">Xem trước dữ liệu trích xuất</h1>
          <p className="text-sm text-slate-500 mt-1">
            Kiểm tra và chỉnh sửa dữ liệu trước khi đối soát
          </p>
        </div>
        <button
          type="button"
          className="btn btn-primary"
          onClick={handleConfirmAndCompare}
          disabled={saving || comparing}
        >
          {comparing ? <Spinner size={14} /> : <Check size={15} />}
          {comparing ? 'Đang đối soát...' : 'Xác nhận & Đối soát'}
        </button>
      </div>


      {data && (
        <div className="flex flex-col gap-6">
          {/* Exam metadata */}
          {data.source_a?.exam_metadata && (
            <MetadataPanel meta={data.source_a.exam_metadata} title="Thông tin kỳ thi (Nguồn A)" />
          )}

          {/* Source A students */}
          <StudentTable
            title="Nguồn A – Biên bản điểm viết tay"
            source="A"
            students={data.source_a?.students || []}
            editCell={editCell}
            editValue={editValue}
            onEdit={handleEdit}
            onEditChange={setEditValue}
            onCommit={commitEdit}
            onCancel={cancelEdit}
          />

          {/* Source B students */}
          <StudentTable
            title="Nguồn B – Điểm hệ thống CCE"
            source="B"
            students={data.source_b?.students || []}
            editCell={editCell}
            editValue={editValue}
            onEdit={handleEdit}
            onEditChange={setEditValue}
            onCommit={commitEdit}
            onCancel={cancelEdit}
          />
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
      <div className="panel-header">
        <h2 className="text-sm font-semibold text-slate-700">{title}</h2>
      </div>
      <div className="panel-body">
        <dl className="grid grid-cols-4 gap-x-6 gap-y-3">
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

function StudentTable({ title, source, students, editCell, editValue, onEdit, onEditChange, onCommit, onCancel }) {
  const EDITABLE_FIELDS = ['student_id', 'full_name', 'date_of_birth', 'score']
  const FIELD_LABELS = {
    student_id: 'Mã HV',
    full_name: 'Họ và tên',
    date_of_birth: 'Ngày sinh',
    score: 'Điểm số',
  }

  const reviewCount = students.filter((s) => s.needs_review).length

  return (
    <div className="panel">
      <div className="panel-header">
        <h2 className="text-sm font-semibold text-slate-700">{title}</h2>
        <div className="flex items-center gap-3 text-xs text-slate-500">
          <span>{students.length} học viên</span>
          {reviewCount > 0 && (
            <span className="badge badge-review">{reviewCount} cần kiểm tra</span>
          )}
        </div>
      </div>
      <div className="overflow-x-auto">
        <table className="data-table">
          <thead>
            <tr>
              <th>STT</th>
              <th>Mã HV</th>
              <th>Họ và tên</th>
              <th>Ngày sinh</th>
              <th>Điểm số</th>
              <th>Độ tin cậy</th>
              <th>Ghi chú</th>
              <th>Nguồn</th>
            </tr>
          </thead>
          <tbody>
            {students.map((s, idx) => (
              <tr key={idx} className={s.needs_review ? 'row-review' : ''}>
                <td className="text-slate-400">{s.stt ?? idx + 1}</td>
                {EDITABLE_FIELDS.map((field) => {
                  const isEditing =
                    editCell?.source === source &&
                    editCell?.studentIdx === idx &&
                    editCell?.field === field
                  const wasEdited = s._edited?.[field]
                  return (
                    <td key={field}>
                      {isEditing ? (
                        <div className="flex items-center gap-1">
                          <input
                            className="input py-0.5 px-1 text-xs w-28"
                            value={editValue}
                            onChange={(e) => onEditChange(e.target.value)}
                            onKeyDown={(e) => {
                              if (e.key === 'Enter') onCommit()
                              if (e.key === 'Escape') onCancel()
                            }}
                            autoFocus
                          />
                          <button className="btn btn-ghost p-1" onClick={onCommit}><Check size={12} /></button>
                          <button className="btn btn-ghost p-1" onClick={onCancel}><X size={12} /></button>
                        </div>
                      ) : (
                        <div
                          className="flex items-center gap-1 group cursor-pointer"
                          onClick={() => onEdit(source, idx, field, s[field])}
                        >
                          <span className={s[field] === null ? 'text-slate-300' : wasEdited ? 'text-blue-700 font-medium' : ''}>
                            {s[field] !== null && s[field] !== undefined ? String(s[field]) : '—'}
                          </span>
                          <Edit2 size={11} className="opacity-0 group-hover:opacity-40 text-slate-500 shrink-0" />
                          {wasEdited && (
                            <span className="text-xs text-slate-400 line-through ml-1">
                              {String(wasEdited.original ?? '')}
                            </span>
                          )}
                        </div>
                      )}
                    </td>
                  )
                })}
                <td>
                  {s.confidence?.score !== undefined ? (
                    <ConfidenceBar value={s.confidence.score} />
                  ) : '—'}
                </td>
                <td className="max-w-48 truncate text-slate-400 text-xs">
                  {s.needs_review && s.review_reason ? s.review_reason : ''}
                </td>
                <td className="text-xs text-slate-400">
                  {s.source_file ? `${s.source_file} p.${s.page_number}` : '—'}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
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

