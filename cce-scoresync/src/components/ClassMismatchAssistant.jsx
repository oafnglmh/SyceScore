import React, { useState } from 'react'
import {
  AlertTriangle,
  Bot,
  ChevronDown,
  ChevronUp,
  FileSearch,
  FileSpreadsheet,
  FileText,
  HelpCircle,
  Info,
  Sparkles,
  Users,
  XCircle,
} from 'lucide-react'

export function ClassMismatchAssistant({
  discardedClasses = [],
  className = '',
  defaultOpen = true,
}) {
  const [isOpen, setIsOpen] = useState(defaultOpen)
  const [expandedClassId, setExpandedClassId] = useState(null)

  if (!discardedClasses || discardedClasses.length === 0) {
    return null
  }

  const totalStudents = discardedClasses.reduce(
    (sum, item) => sum + (item.student_count || item.students?.length || 0),
    0
  )

  const sourceBCount = discardedClasses.filter(
    (c) => c.source === 'source_b'
  ).length
  const sourceACount = discardedClasses.filter(
    (c) => c.source === 'source_a'
  ).length

  const toggleStudentList = (id) => {
    setExpandedClassId((prev) => (prev === id ? null : id))
  }

  return (
    <div
      className={`rounded-xl border border-amber-300 bg-linear-to-r from-amber-50/90 via-orange-50/70 to-amber-50/90 shadow-sm overflow-hidden mb-6 ${className}`}
    >
      {/* Header bar */}
      <div className="px-4 py-3.5 flex flex-wrap items-center justify-between gap-3 border-b border-amber-200/80 bg-white/60 backdrop-blur-xs">
        <div className="flex items-center gap-2.5">
          <div className="w-8 h-8 rounded-lg bg-gradient-to-tr from-amber-500 to-orange-500 flex items-center justify-center text-white shadow-xs">
            <Bot size={18} className="animate-pulse" />
          </div>
          <div>
            <div className="flex items-center gap-2">
              <h3 className="text-sm font-semibold text-slate-800">
                Trợ lý đối soát: Báo cáo lớp học không khớp
              </h3>
              <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-semibold bg-amber-100 text-amber-800 border border-amber-300">
                <AlertTriangle size={12} />
                {discardedClasses.length} lớp bị bỏ ({totalStudents} học viên)
              </span>
            </div>
            <p className="text-xs text-slate-600 mt-0.5">
              Hệ thống phát hiện có sự lệch tên lớp giữa File A (Bảng điểm quét)
              và File B (Điểm hệ thống). Dưới đây là danh sách chi tiết để bạn
              kiểm tra lại file.
            </p>
          </div>
        </div>

        <button
          type="button"
          onClick={() => setIsOpen(!isOpen)}
          className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-amber-900 bg-amber-100/80 hover:bg-amber-200 rounded-lg transition-colors"
        >
          {isOpen ? (
            <>
              Thu gọn <ChevronUp size={14} />
            </>
          ) : (
            <>
              Xem chi tiết ({discardedClasses.length} lớp){' '}
              <ChevronDown size={14} />
            </>
          )}
        </button>
      </div>

      {/* Body content */}
      {isOpen && (
        <div className="p-4 space-y-4">
          {/* Quick Guidance Alert */}
          <div className="p-3 bg-white/80 rounded-lg border border-amber-200 text-xs text-slate-700 flex items-start gap-2.5">
            <Info size={16} className="text-amber-600 shrink-0 mt-0.5" />
            <div className="space-y-1">
              <p className="font-medium text-amber-900">
                Tại sao các lớp này bị bỏ qua?
              </p>
              <p className="leading-relaxed">
                Để đảm bảo điểm thi không bị ghép nhầm lẫn giữa các lớp khác
                nhau, hệ thống chỉ đối chiếu các lớp có tên trùng khớp ở cả 2
                file. Các lớp không tìm thấy đối ứng đã được tách riêng để bạn dễ
                dàng kiểm tra xem file gốc có viết sai chính tả (dấu chấm, khoảng
                trắng) hoặc xuất dư lớp không.
              </p>
            </div>
          </div>

          {/* Cards for each discarded class */}
          <div className="grid grid-cols-1 gap-3">
            {discardedClasses.map((item, idx) => {
              const isSourceB = item.source === 'source_b'
              const isExpanded = expandedClassId === (item.id || idx)
              const students = item.students || []

              return (
                <div
                  key={item.id || idx}
                  className="bg-white rounded-lg border border-slate-200/90 shadow-xs overflow-hidden transition-all hover:border-amber-300"
                >
                  <div className="p-3.5">
                    <div className="flex flex-wrap items-start justify-between gap-2 mb-2">
                      <div className="flex items-center gap-2">
                        <span className="font-mono text-sm font-bold text-slate-900 bg-slate-100 px-2 py-0.5 rounded border border-slate-300">
                          {item.class_name || 'Lớp chưa xác định'}
                        </span>

                        {isSourceB ? (
                          <span className="inline-flex items-center gap-1 text-[11px] font-medium px-2 py-0.5 rounded bg-orange-100 text-orange-800 border border-orange-200">
                            <FileSpreadsheet size={11} />
                            File B thừa lớp (Đã lọc bỏ)
                          </span>
                        ) : (
                          <span className="inline-flex items-center gap-1 text-[11px] font-medium px-2 py-0.5 rounded bg-indigo-100 text-indigo-800 border border-indigo-200">
                            <FileText size={11} />
                            File A có lớp nhưng File B thiếu
                          </span>
                        )}

                        {item.subject && (
                          <span className="text-xs text-slate-600 bg-slate-50 px-2 py-0.5 rounded border border-slate-200">
                            Học phần: <strong>{item.subject}</strong>
                          </span>
                        )}
                      </div>

                      <span className="text-xs font-semibold text-slate-700 bg-amber-50 px-2 py-0.5 rounded-full border border-amber-200">
                        {item.student_count || students.length} học viên
                      </span>
                    </div>

                    {/* Reason description */}
                    <div className="text-xs text-slate-700 mt-2 bg-slate-50 p-2.5 rounded-md border border-slate-100 space-y-1.5">
                      <p>
                        <strong className="text-slate-800">Lý do: </strong>
                        {item.reason}
                      </p>

                      {item.available_classes_in_counterpart &&
                        item.available_classes_in_counterpart.length > 0 && (
                          <p className="text-slate-600">
                            <strong>Các lớp có ở file đối ứng: </strong>
                            <span className="font-mono text-amber-900 font-medium">
                              {item.available_classes_in_counterpart.join(', ')}
                            </span>
                          </p>
                        )}

                      {item.suggested_action && (
                        <p className="text-amber-800 font-medium flex items-center gap-1 pt-1 border-t border-slate-200/60">
                          <Sparkles size={12} className="text-amber-600 shrink-0" />
                          <span>Gợi ý kiểm tra: {item.suggested_action}</span>
                        </p>
                      )}
                    </div>

                    {/* Student toggle button */}
                    {students.length > 0 && (
                      <div className="mt-3 flex justify-between items-center pt-2 border-t border-slate-100">
                        <button
                          type="button"
                          onClick={() => toggleStudentList(item.id || idx)}
                          className="inline-flex items-center gap-1 text-xs font-medium text-slate-600 hover:text-amber-700 transition-colors"
                        >
                          <Users size={13} />
                          {isExpanded
                            ? 'Ẩn danh sách học viên'
                            : `Xem danh sách ${students.length} học viên của lớp này`}
                          {isExpanded ? (
                            <ChevronUp size={13} />
                          ) : (
                            <ChevronDown size={13} />
                          )}
                        </button>

                        {item.source_file && (
                          <span className="text-[11px] text-slate-400 font-mono truncate max-w-xs">
                            Nguồn: {item.source_file}
                          </span>
                        )}
                      </div>
                    )}
                  </div>

                  {/* Expanded Student List Table */}
                  {isExpanded && students.length > 0 && (
                    <div className="bg-slate-50 border-t border-slate-200 p-3 max-h-60 overflow-y-auto">
                      <table className="w-full text-xs text-left">
                        <thead>
                          <tr className="text-slate-500 border-b border-slate-200">
                            <th className="py-1 px-2 font-medium w-10">STT</th>
                            <th className="py-1 px-2 font-medium w-28">Mã HV</th>
                            <th className="py-1 px-2 font-medium">Họ và tên</th>
                            <th className="py-1 px-2 font-medium text-center w-16">
                              Điểm
                            </th>
                            <th className="py-1 px-2 font-medium">File nguồn</th>
                            <th className="py-1 px-2 font-medium text-center w-16">
                              Trang
                            </th>
                          </tr>
                        </thead>
                        <tbody className="divide-y divide-slate-200/60 bg-white">
                          {students.map((st, sIdx) => (
                            <tr key={sIdx} className="hover:bg-slate-50">
                              <td className="py-1 px-2 text-slate-400">
                                {sIdx + 1}
                              </td>
                              <td className="py-1 px-2 font-mono font-medium text-slate-800">
                                {st.student_id || '—'}
                              </td>
                              <td className="py-1 px-2 text-slate-700 font-medium">
                                {st.full_name || '—'}
                              </td>
                              <td className="py-1 px-2 text-center font-mono font-semibold text-slate-800">
                                {st.score != null ? String(st.score) : '—'}
                              </td>
                              <td
                                className="py-1 px-2 text-slate-500 truncate max-w-[150px]"
                                title={st.source_file || ''}
                              >
                                {st.source_file || '—'}
                              </td>
                              <td className="py-1 px-2 text-center text-slate-500">
                                {st.page_number != null ? st.page_number : '—'}
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  )}
                </div>
              )
            })}
          </div>
        </div>
      )}
    </div>
  )
}
