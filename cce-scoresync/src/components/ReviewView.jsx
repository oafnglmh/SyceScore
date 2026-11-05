import {
  Check,
  CheckCheck,
  CircleAlert,
  Download,
  FileSpreadsheet,
  ListChecks,
  RotateCcw,
  TriangleAlert,
  UserX,
} from 'lucide-react'
import { useMemo, useState } from 'react'
import { duplicateIds, fullName, HEADER_LABELS, rowIssues, sheetIssues } from '../lib/extract'
import { exportAll, exportGroup, groupSheets } from '../lib/excel'
import { formatScore, parseDigits } from '../lib/score'
import PageViewer from './PageViewer'
import { Badge, Button, Dialog } from './ui'

const FIELD_OF = { ho_dem: 'name', ten: 'name', ma_hv: 'ma_hv', ngay_sinh: 'ngay_sinh', score: 'score', row: 'row' }

function analyse(sheet) {
  const dup = duplicateIds(sheet)
  const rows = new Map()
  let rowsWithIssues = 0
  for (const r of sheet.rows) {
    const issues = rowIssues(r, sheet, dup)
    rows.set(r.id, issues)
    if (issues.length) rowsWithIssues++
  }
  const sheetLevel = sheet.acknowledged ? [] : sheetIssues(sheet)
  return { rows, rowsWithIssues, sheetLevel, total: rowsWithIssues + sheetLevel.length }
}

// ─── Cells ───────────────────────────────────────────────────────────────────

function TextCell({ value, onChange, flagged, className = '', mono }) {
  return (
    <input
      value={value}
      onChange={(e) => onChange(e.target.value)}
      spellCheck={false}
      className={`w-full rounded-md border border-transparent bg-transparent px-2 py-1 outline-none transition hover:border-slate-200 focus:border-cce-400 focus:bg-white focus:ring-2 focus:ring-cce-100 ${
        flagged ? 'bg-amber-100/70' : ''
      } ${mono ? 'font-mono text-[12.5px]' : ''} ${className}`}
    />
  )
}

function scoreText(row) {
  if (row.absent) return 'Vắng'
  return row.score === null ? '' : formatScore(row.score)
}

function ScoreCell({ row, flagged, onCommit }) {
  // Ô được remount (key) mỗi khi điểm đã lưu thay đổi, nên draft luôn khởi tạo từ giá trị mới.
  const [draft, setDraft] = useState(scoreText(row))

  function commit(text) {
    const t = text.trim().toLowerCase()
    if (['v', 'vắng', 'vang', 'vắng thi'].includes(t)) return onCommit({ absent: true, score: null })
    onCommit({ absent: false, score: parseDigits(t) })
  }

  return (
    <input
      value={draft}
      onChange={(e) => setDraft(e.target.value)}
      onBlur={() => draft !== scoreText(row) && commit(draft)}
      onKeyDown={(e) => e.key === 'Enter' && e.currentTarget.blur()}
      className={`w-16 rounded-md border px-2 py-1 text-center text-[15px] font-semibold tabular-nums outline-none transition focus:border-cce-400 focus:ring-2 focus:ring-cce-100 ${
        row.absent
          ? 'border-slate-200 bg-slate-50 text-xs font-medium text-slate-500'
          : flagged
            ? 'border-amber-300 bg-amber-100 text-amber-900'
            : 'border-slate-200 bg-white text-slate-900'
      }`}
    />
  )
}

// ─── Main view ───────────────────────────────────────────────────────────────

export default function ReviewView({ sheets, setSheets, getPage, onRestart }) {
  const [sheetId, setSheetId] = useState(sheets[0]?.id)
  const [rowId, setRowId] = useState(null)
  const [viewPage, setViewPage] = useState(null)
  const [onlyIssues, setOnlyIssues] = useState(false)
  const [confirmExport, setConfirmExport] = useState(false)
  const [exporting, setExporting] = useState(false)

  const analysis = useMemo(() => new Map(sheets.map((s) => [s.id, analyse(s)])), [sheets])
  const groups = useMemo(() => groupSheets(sheets), [sheets])
  const sheet = sheets.find((s) => s.id === sheetId) || sheets[0]
  const info = sheet ? analysis.get(sheet.id) : null
  const totalIssues = [...analysis.values()].reduce((a, x) => a + x.total, 0)
  const totalRows = sheets.reduce((a, s) => a + s.rows.length, 0)
  const absentCount = sheets.reduce((a, s) => a + s.rows.filter((r) => r.absent).length, 0)
  const row = sheet?.rows.find((r) => r.id === rowId)
  const pageNumber = viewPage ?? row?.pageNumber ?? sheet?.pageNumbers[0]
  const page = sheet && pageNumber ? getPage(sheet.fileId, pageNumber) : null

  // ── Mutations ──
  const patchSheet = (id, fn) => setSheets((all) => all.map((s) => (s.id === id ? fn(s) : s)))
  const patchRow = (rid, patch, clear = []) =>
    patchSheet(sheet.id, (s) => ({
      ...s,
      rows: s.rows.map((r) =>
        r.id === rid
          ? { ...r, ...patch, edited: true, flags: r.flags.filter((f) => !clear.includes(FIELD_OF[f.field])) }
          : r,
      ),
    }))
  const setConfirmed = (rid, confirmed) =>
    patchSheet(sheet.id, (s) => ({ ...s, rows: s.rows.map((r) => (r.id === rid ? { ...r, confirmed } : r)) }))
  const patchHeader = (field, value) =>
    patchSheet(sheet.id, (s) => ({
      ...s,
      header: { ...s.header, [field]: field === 'lop' ? value.toUpperCase().replace(/\s/g, '') : value },
      headerFlags: s.headerFlags.filter((f) => f !== field),
    }))

  function selectRow(r) {
    setRowId(r.id)
    setViewPage(null)
  }

  function nextIssue() {
    const order = groups.flatMap((g) => g.sheets)
    const start = Math.max(0, order.findIndex((s) => s.id === sheet.id))
    for (let k = 0; k < order.length; k++) {
      const s = order[(start + k) % order.length]
      const a = analysis.get(s.id)
      const rows = s.rows
      const from = k === 0 && rowId ? rows.findIndex((r) => r.id === rowId) + 1 : 0
      const hit = rows.slice(from).find((r) => a.rows.get(r.id).length)
      if (hit) {
        setSheetId(s.id)
        selectRow(hit)
        requestAnimationFrame(() => document.getElementById(`row-${hit.id}`)?.scrollIntoView({ block: 'center', behavior: 'smooth' }))
        return
      }
      if (k > 0 && a.sheetLevel.length) {
        setSheetId(s.id)
        setRowId(null)
        return
      }
    }
  }

  async function doExport(fn) {
    setExporting(true)
    try {
      await fn()
    } finally {
      setExporting(false)
      setConfirmExport(false)
    }
  }

  if (!sheet) {
    return (
      <div className="mx-auto max-w-xl px-4 py-20 text-center">
        <CircleAlert className="mx-auto mb-3 size-8 text-amber-500" />
        <h2 className="text-lg font-semibold text-slate-800">Không tìm thấy bảng điểm nào</h2>
        <p className="mt-1 text-sm text-slate-500">File có thể không phải biên bản kết quả thi, hoặc ảnh quá mờ.</p>
        <Button className="mt-6" icon={RotateCcw} onClick={onRestart}>
          Làm lại
        </Button>
      </div>
    )
  }

  const visibleRows = onlyIssues ? sheet.rows.filter((r) => info.rows.get(r.id).length) : sheet.rows
  const pageIdx = sheet.pageNumbers.indexOf(pageNumber)

  return (
    <div className="flex h-[calc(100vh-59px)] flex-col">
      {/* ── Toolbar ── */}
      <div className="flex flex-wrap items-center gap-3 border-b border-slate-200 bg-white px-4 py-3">
        <div className="flex flex-wrap items-center gap-2 text-sm">
          <Badge tone="cce">{sheets.length} biên bản</Badge>
          <Badge>{totalRows} học viên</Badge>
          {absentCount > 0 && (
            <Badge>
              <UserX className="size-3" /> {absentCount} vắng
            </Badge>
          )}
          {totalIssues > 0 ? (
            <Badge tone="amber">
              <TriangleAlert className="size-3" /> {totalIssues} mục cần kiểm tra
            </Badge>
          ) : (
            <Badge tone="green">
              <CheckCheck className="size-3" /> Đã kiểm tra hết
            </Badge>
          )}
        </div>
        <div className="ml-auto flex flex-wrap gap-2">
          {totalIssues > 0 && (
            <Button size="sm" icon={ListChecks} onClick={nextIssue}>
              Mục cần kiểm tra tiếp theo
            </Button>
          )}
          <Button size="sm" variant="ghost" icon={RotateCcw} onClick={onRestart}>
            Làm file khác
          </Button>
          <Button
            size="sm"
            variant="success"
            icon={Download}
            loading={exporting}
            onClick={() => (totalIssues ? setConfirmExport(true) : doExport(() => exportAll(sheets)))}
          >
            Xuất Excel {groups.length > 1 ? `(${groups.length} lớp · ZIP)` : ''}
          </Button>
        </div>
      </div>

      <div className="flex min-h-0 flex-1">
        {/* ── Sidebar: lớp / biên bản ── */}
        <aside className="hidden w-60 shrink-0 overflow-y-auto border-r border-slate-200 bg-white p-3 lg:block">
          {groups.map((g) => (
            <div key={g.key} className="mb-4">
              <div className="flex items-center gap-2 px-2 pb-1.5">
                <div className="min-w-0 flex-1">
                  <div className="truncate text-[13px] font-bold text-cce-800">{g.lop}</div>
                  <div className="truncate text-xs text-slate-500">{g.nganh}</div>
                </div>
                <button
                  title="Tải Excel của lớp này"
                  onClick={() => doExport(() => exportGroup(g))}
                  className="rounded-lg p-1.5 text-slate-400 hover:bg-emerald-50 hover:text-emerald-600"
                >
                  <FileSpreadsheet className="size-4" />
                </button>
              </div>
              <div className="space-y-1">
                {g.sheets.map((s) => {
                  const a = analysis.get(s.id)
                  const active = s.id === sheet.id
                  return (
                    <button
                      key={s.id}
                      onClick={() => {
                        setSheetId(s.id)
                        setRowId(null)
                        setViewPage(null)
                      }}
                      className={`w-full rounded-xl px-3 py-2 text-left transition ${
                        active ? 'bg-cce-700 shadow-md shadow-cce-700/20' : 'hover:bg-cce-50'
                      }`}
                    >
                      <div className="flex items-center gap-2">
                        <span className={`truncate text-[13px] font-medium ${active ? 'text-white' : 'text-slate-700'}`}>
                          {s.header.phong ? `Phòng ${s.header.phong}` : 'Biên bản'}
                        </span>
                        <span className="ml-auto">
                          {a.total ? (
                            <span className="rounded-full bg-gold-400 px-1.5 text-[11px] font-bold text-cce-950">{a.total}</span>
                          ) : (
                            <Check className={`size-3.5 ${active ? 'text-emerald-300' : 'text-emerald-500'}`} />
                          )}
                        </span>
                      </div>
                      <div className={`mt-0.5 truncate text-xs ${active ? 'text-cce-100' : 'text-slate-500'}`}>
                        {s.header.hoc_phan || '—'} · {s.rows.length} HV
                      </div>
                      <div className={`truncate text-[11px] ${active ? 'text-cce-200' : 'text-slate-400'}`}>
                        {s.fileName} · tr. {s.pageNumbers[0]}
                        {s.pageNumbers.length > 1 ? `–${s.pageNumbers.at(-1)}` : ''}
                      </div>
                    </button>
                  )
                })}
              </div>
            </div>
          ))}
        </aside>

        {/* ── Main ── */}
        <main className="min-w-0 flex-1 overflow-y-auto p-4">
          <div className="rounded-2xl bg-white p-4 ring-1 ring-slate-200">
            <div className="grid gap-3 sm:grid-cols-2 2xl:grid-cols-4">
              {['lop', 'nganh', 'hoc_phan', 'ngay_gio_thi'].map((f) => {
                const flagged = !sheet.headerConfirmed && sheet.headerFlags.includes(f)
                return (
                  <label key={f} className="block">
                    <span className="mb-1 block text-[11px] font-medium uppercase tracking-wide text-slate-400">{HEADER_LABELS[f]}</span>
                    <input
                      value={sheet.header[f] || ''}
                      onChange={(e) => patchHeader(f, e.target.value)}
                      className={`h-9 w-full rounded-lg border px-2.5 text-sm font-medium text-slate-800 outline-none focus:border-cce-400 focus:ring-2 focus:ring-cce-100 ${
                        flagged || !sheet.header[f] ? 'border-amber-300 bg-amber-50' : 'border-slate-200'
                      }`}
                    />
                  </label>
                )
              })}
            </div>
            <div className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-slate-500">
              {sheet.header.phong && <span>Phòng: <b className="text-slate-700">{sheet.header.phong}</b></span>}
              <span>
                Số HV dự thi (giấy): <b className="text-slate-700">{sheet.footer.so_hoc_vien_du_thi || '—'}</b>
              </span>
              <span>
                Số bài thi (giấy): <b className="text-slate-700">{sheet.footer.so_bai_thi || '—'}</b>
              </span>
              <span>
                Đọc được: <b className="text-slate-700">{sheet.rows.length}</b> dòng,{' '}
                <b className="text-slate-700">{sheet.rows.filter((r) => !r.absent).length}</b> có điểm
              </span>
            </div>

            {info.sheetLevel.length > 0 && (
              <div className="mt-3 rounded-xl bg-amber-50 p-3 ring-1 ring-amber-200">
                <ul className="space-y-1 text-[13px] text-amber-900">
                  {info.sheetLevel.map((m) => (
                    <li key={m} className="flex gap-2">
                      <TriangleAlert className="mt-0.5 size-3.5 shrink-0" /> {m}
                    </li>
                  ))}
                </ul>
                <Button
                  size="sm"
                  className="mt-2"
                  icon={Check}
                  onClick={() => patchSheet(sheet.id, (s) => ({ ...s, acknowledged: true, headerConfirmed: true }))}
                >
                  Đã kiểm tra với bản giấy
                </Button>
              </div>
            )}
          </div>

          <div className="mt-4 flex items-center justify-between">
            <label className="inline-flex cursor-pointer items-center gap-2 text-sm text-slate-600">
              <input
                type="checkbox"
                checked={onlyIssues}
                onChange={(e) => setOnlyIssues(e.target.checked)}
                className="size-4 rounded accent-cce-600"
              />
              Chỉ hiện dòng cần kiểm tra ({info.rowsWithIssues})
            </label>
            <span className="text-xs text-slate-400">Bấm vào dòng để xem trên bản scan · sửa trực tiếp trong ô</span>
          </div>

          <div className="mt-2 overflow-hidden rounded-2xl bg-white ring-1 ring-slate-200">
            <table className="w-full table-fixed border-collapse text-sm">
              <thead>
                <tr className="bg-cce-700 text-left text-[11px] font-semibold uppercase tracking-wide text-white">
                  <th className="w-12 px-2 py-2.5 text-center">TT</th>
                  <th className="w-[164px] px-3 py-2.5">Mã HV</th>
                  <th className="px-3 py-2.5">Họ và tên</th>
                  <th className="w-[104px] px-3 py-2.5">Ngày sinh</th>
                  <th className="w-[78px] px-2 py-2.5 text-center">Điểm</th>
                  <th className="hidden w-24 px-2 py-2.5 xl:table-cell">Cột chữ</th>
                </tr>
              </thead>
              <tbody>
                {visibleRows.map((r) => {
                  const issues = info.rows.get(r.id)
                  const fields = new Set(issues.map((i) => FIELD_OF[i.field]))
                  const hasError = issues.some((i) => i.level === 'error')
                  const selected = r.id === rowId
                  const confirmable = issues.length > 0 && !issues.some((i) => i.blocking)
                  const scoreCands = issues.flatMap((i) => (i.field === 'score' && i.candidates) || [])
                  return [
                    <tr
                      key={r.id}
                      id={`row-${r.id}`}
                      onClick={() => selectRow(r)}
                      className={`cursor-pointer border-t border-slate-100 transition ${
                        selected ? 'bg-gold-100/70' : issues.length ? 'bg-amber-50/40 hover:bg-amber-50' : 'hover:bg-slate-50'
                      }`}
                    >
                      <td
                        className={`border-l-[3px] px-3 py-1.5 text-center text-xs tabular-nums text-slate-500 ${
                          issues.length ? (hasError ? 'border-l-rose-400' : 'border-l-amber-400') : 'border-l-transparent'
                        }`}
                      >
                        <div className="flex items-center justify-center gap-0.5">
                          {r.tt ?? '?'}
                          {r.confirmed && !issues.length && (
                            <button
                              title="Đã xác nhận – bấm để bỏ xác nhận"
                              onClick={(e) => {
                                e.stopPropagation()
                                setConfirmed(r.id, false)
                              }}
                            >
                              <CheckCheck className="size-3 text-emerald-500" />
                            </button>
                          )}
                          {r.edited && !r.confirmed && !issues.length && (
                            <span title="Đã sửa tay" className="size-1.5 rounded-full bg-cce-500" />
                          )}
                        </div>
                      </td>
                      <td className="px-1 py-1.5">
                        <TextCell
                          mono
                          value={r.ma_hv}
                          flagged={fields.has('ma_hv')}
                          onChange={(v) => patchRow(r.id, { ma_hv: v.toUpperCase().replace(/\s/g, '') }, ['ma_hv'])}
                        />
                      </td>
                      <td className="px-1 py-1.5">
                        <TextCell
                          value={fullName(r)}
                          flagged={fields.has('name')}
                          onChange={(v) => patchRow(r.id, { ho_ten: v }, ['name'])}
                        />
                      </td>
                      <td className="px-1 py-1.5">
                        <TextCell
                          value={r.ngay_sinh}
                          flagged={fields.has('ngay_sinh')}
                          className="tabular-nums"
                          onChange={(v) => patchRow(r.id, { ngay_sinh: v.trim() }, ['ngay_sinh'])}
                        />
                      </td>
                      <td className="px-1 py-1.5 text-center" onClick={(e) => e.stopPropagation()}>
                        <div onFocus={() => selectRow(r)}>
                          <ScoreCell key={`${r.score}|${r.absent}`} row={r} flagged={fields.has('score')} onCommit={(p) => patchRow(r.id, p, ['score'])} />
                        </div>
                      </td>
                      <td className="hidden truncate px-2 py-1.5 text-xs italic text-slate-500 xl:table-cell" title={r.wordsRaw}>{r.wordsRaw || '—'}</td>
                    </tr>,
                    issues.length > 0 && (
                      <tr key={`${r.id}-i`} className={selected ? 'bg-gold-100/70' : 'bg-amber-50/40'} onClick={() => selectRow(r)}>
                        <td className={`border-l-[3px] ${hasError ? 'border-l-rose-400' : 'border-l-amber-400'}`} />
                        <td colSpan={5} className="px-3 pb-2 pt-0">
                          <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
                            {issues.map((i, k) => (
                              <span
                                key={k}
                                className={`inline-flex items-center gap-1 text-xs ${i.level === 'error' ? 'text-rose-700' : 'text-amber-800'}`}
                              >
                                <CircleAlert className="size-3" /> {i.msg}
                                {i.field !== 'score' && i.candidates && (
                                  <span className="text-slate-500">({i.candidates.map((c) => c.value).join(' / ')})</span>
                                )}
                              </span>
                            ))}
                            {scoreCands.length > 0 && (
                              <span className="inline-flex items-center gap-1" onClick={(e) => e.stopPropagation()}>
                                <span className="text-xs text-slate-500">Chọn điểm:</span>
                                {[...new Map(scoreCands.map((c) => [c.value, c])).values()].map((c) => (
                                  <button
                                    key={c.value}
                                    onClick={() =>
                                      patchRow(
                                        r.id,
                                        c.value === 'VẮNG' ? { absent: true, score: null } : { absent: false, score: parseDigits(c.value) },
                                        ['score'],
                                      )
                                    }
                                    className="rounded-md bg-white px-2 py-0.5 text-xs font-semibold text-slate-800 ring-1 ring-slate-300 hover:bg-cce-50 hover:ring-cce-300"
                                  >
                                    {c.value === 'VẮNG' ? 'Vắng' : c.value}
                                    {c.label ? <span className="ml-1 font-normal text-slate-500">{c.label}</span> : null}
                                    {c.count ? <span className="ml-1 font-normal text-slate-400">×{c.count}</span> : null}
                                  </button>
                                ))}
                              </span>
                            )}
                            {confirmable && (
                              <span className="ml-auto" onClick={(e) => e.stopPropagation()}>
                                <Button size="sm" variant="secondary" icon={Check} onClick={() => setConfirmed(r.id, true)}>
                                  Đã đối chiếu – đúng
                                </Button>
                              </span>
                            )}
                          </div>
                        </td>
                      </tr>
                    ),
                  ]
                })}
                {!visibleRows.length && (
                  <tr>
                    <td colSpan={6} className="px-3 py-10 text-center text-sm text-slate-400">
                      Không còn dòng nào cần kiểm tra trong biên bản này.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </main>

        {/* ── Page viewer ── */}
        <section className="hidden w-[36%] max-w-[720px] shrink-0 p-4 pl-0 md:block">
          <PageViewer
            src={page?.previewUrl}
            title={`${sheet.fileName} · trang ${pageNumber}${row ? ` · TT ${row.tt}` : ''}`}
            rowY={row && row.pageNumber === pageNumber ? row.row_y : null}
            onPrev={pageIdx > 0 ? () => setViewPage(sheet.pageNumbers[pageIdx - 1]) : null}
            onNext={pageIdx < sheet.pageNumbers.length - 1 ? () => setViewPage(sheet.pageNumbers[pageIdx + 1]) : null}
          />
        </section>
      </div>

      <Dialog
        open={confirmExport}
        onClose={() => setConfirmExport(false)}
        title="Vẫn còn mục chưa kiểm tra"
        footer={
          <>
            <Button
              onClick={() => {
                setConfirmExport(false)
                nextIssue()
              }}
            >
              Quay lại kiểm tra
            </Button>
            <Button variant="success" icon={Download} loading={exporting} onClick={() => doExport(() => exportAll(sheets))}>
              Vẫn xuất Excel
            </Button>
          </>
        }
      >
        <p className="text-sm leading-relaxed text-slate-600">
          Còn <b className="text-amber-700">{totalIssues}</b> mục được đánh dấu cần kiểm tra (điểm đọc không thống nhất, cột Số
          khác cột Chữ, sĩ số không khớp…). Nên đối chiếu với bản scan trước khi xuất để đảm bảo dữ liệu chính xác.
        </p>
      </Dialog>
    </div>
  )
}
