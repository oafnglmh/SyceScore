import {
  CircleAlert,
  CircleCheck,
  CircleX,
  FileSpreadsheet,
  Link2Off,
  PenLine,
  RotateCcw,
  TriangleAlert,
  Undo2,
} from 'lucide-react'
import { useMemo, useState } from 'react'
import { columnName, scoreColumns } from '../lib/compare'
import { formatScore } from '../lib/score'
import { STATUS_LABEL } from '../lib/report'
import PageViewer from './PageViewer'
import { Badge, Button } from './ui'

const STATUS_TONE = { ok: 'green', warn: 'amber', error: 'red', unmatched: 'red' }
const STATUS_ICON = { ok: CircleCheck, warn: TriangleAlert, error: CircleX, unmatched: Link2Off }
const ICON_COLOR = { ok: 'text-emerald-600', warn: 'text-amber-500', error: 'text-rose-600', unmatched: 'text-rose-600' }
const ROW_BG = { ok: '', warn: 'bg-amber-50/70', error: 'bg-rose-50' }

// ─── Ô điểm sửa được ─────────────────────────────────────────────────────────

function ScoreInput({ text, edited, invalid, onCommit, onReset, title }) {
  // Remount theo `text` (key ở nơi gọi) nên draft luôn khởi tạo từ giá trị mới.
  const [draft, setDraft] = useState(text)
  return (
    <div className="flex items-center justify-center gap-1" onClick={(e) => e.stopPropagation()}>
      <input
        value={draft}
        title={title}
        onChange={(e) => setDraft(e.target.value)}
        onBlur={() => draft.trim() !== text && onCommit(draft.trim())}
        onKeyDown={(e) => e.key === 'Enter' && e.currentTarget.blur()}
        placeholder="—"
        className={`w-14 rounded-md border px-1.5 py-1 text-center text-[14px] font-semibold tabular-nums outline-none transition focus:border-cce-400 focus:ring-2 focus:ring-cce-100 ${
          invalid ? 'border-rose-300 bg-white text-rose-700' : edited ? 'border-cce-300 bg-cce-50 text-cce-800' : 'border-slate-200 bg-white text-slate-900'
        }`}
      />
      {edited && (
        <button onClick={onReset} title="Bỏ sửa – dùng lại giá trị AI đọc" className="rounded p-1 text-slate-400 hover:bg-slate-100 hover:text-slate-600">
          <Undo2 className="size-3.5" />
        </button>
      )}
    </div>
  )
}

const valueText = (score, absent) => (absent ? '' : score === null ? '' : formatScore(score))

// ─── Bảng dò từng dòng ───────────────────────────────────────────────────────

function CompareTable({ cmp, selectedId, onSelect, setEdit }) {
  const [filter, setFilter] = useState(cmp.counts.error + cmp.counts.warn ? 'bad' : 'all')
  const rows = cmp.rows.filter((r) => (filter === 'all' ? true : filter === 'error' ? r.status === 'error' : r.status !== 'ok'))
  const colLabel = columnName(cmp.section, cmp.column) || 'Hệ thống'

  const tabs = [
    { id: 'bad', label: 'Cần xử lý', n: cmp.counts.error + cmp.counts.warn },
    { id: 'error', label: 'Dòng sai', n: cmp.counts.error },
    { id: 'all', label: 'Tất cả', n: cmp.counts.total },
  ]

  return (
    <div className="overflow-hidden rounded-2xl bg-white ring-1 ring-slate-200">
      <div className="flex flex-wrap items-center gap-1 border-b border-slate-100 px-3 py-2">
        {tabs.map((t) => (
          <button
            key={t.id}
            onClick={() => setFilter(t.id)}
            className={`rounded-lg px-3 py-1.5 text-[13px] font-medium transition ${
              filter === t.id ? 'bg-cce-700 text-white' : 'text-slate-600 hover:bg-slate-100'
            }`}
          >
            {t.label} <span className="ml-1 opacity-70">{t.n}</span>
          </button>
        ))}
        <span className="ml-auto text-xs text-slate-500">Bấm vào dòng để xem ảnh gốc · sửa ô điểm nếu AI đọc sai</span>
      </div>
      <div className="overflow-x-auto">
        <table className="w-full text-[13px]">
          <thead className="bg-slate-50 text-xs uppercase tracking-wide text-slate-500">
            <tr>
              <th className="px-3 py-2 text-center font-semibold">TT</th>
              <th className="px-3 py-2 text-left font-semibold">Mã HV</th>
              <th className="px-3 py-2 text-left font-semibold">Họ và tên</th>
              <th className="px-3 py-2 text-center font-semibold">Ngày sinh</th>
              <th className="px-3 py-2 text-center font-semibold">Viết tay</th>
              <th className="px-3 py-2 text-center font-semibold normal-case">{colLabel}</th>
              <th className="px-3 py-2 text-left font-semibold">Kết quả</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => {
              const Icon = STATUS_ICON[r.status]
              const h = r.hand
              const s = r.sys
              const sel = selectedId === r.id
              const hText = h ? valueText(r.handScore, r.handAbsent) : ''
              const sText = r.sysScore !== null ? formatScore(r.sysScore) : r.sysRaw
              const scoreErr = r.issues.some((i) => i.kind === 'score' || i.kind === 'missing')
              return (
                <tr
                  key={r.id}
                  onClick={() => onSelect(r.id)}
                  className={`cursor-pointer border-t border-slate-100 align-top transition ${ROW_BG[r.status]} ${
                    sel ? 'outline outline-2 -outline-offset-2 outline-gold-400' : 'hover:bg-slate-50'
                  }`}
                >
                  <td className="px-3 py-2 text-center tabular-nums text-slate-500">
                    {h?.tt ?? '–'}
                    {s && h && s.tt !== h.tt && <div className="text-[10px] text-slate-400">HT {s.tt}</div>}
                    {!h && s && <div className="text-[10px] text-slate-400">HT {s.tt}</div>}
                  </td>
                  <td className="px-3 py-2 font-mono text-[12px] text-slate-700">{h?.ma || s?.ma}</td>
                  <td className="px-3 py-2 font-medium text-slate-800">{h?.ho_ten || s?.ho_ten}</td>
                  <td className="px-3 py-2 text-center tabular-nums text-slate-600">{h?.ngay_sinh || s?.ngay_sinh}</td>
                  <td className="px-3 py-2 text-center">
                    {h ? (
                      <>
                        <ScoreInput
                          key={`h${hText}${r.handEdited}`}
                          text={hText}
                          edited={r.handEdited}
                          invalid={scoreErr}
                          title="Điểm viết tay (AI đọc) – sửa nếu đọc sai, để trống = vắng"
                          onCommit={(v) => setEdit(`h:${h.id}`, v)}
                          onReset={() => setEdit(`h:${h.id}`, undefined)}
                        />
                        <div className="mt-0.5 truncate text-[11px] italic text-slate-500" title={`Số: “${h.digitsRaw}” · Chữ: “${h.wordsRaw}”`}>
                          {h.absent && !r.handEdited ? 'vắng / trống' : h.wordsRaw || '–'}
                        </div>
                      </>
                    ) : (
                      <span className="text-xs font-medium text-rose-600">không có</span>
                    )}
                  </td>
                  <td className="px-3 py-2 text-center">
                    {s && cmp.column !== null ? (
                      <ScoreInput
                        key={`s${sText}${r.sysEdited}`}
                        text={sText}
                        edited={r.sysEdited}
                        invalid={scoreErr}
                        title={`Điểm hệ thống cột ${colLabel} (AI đọc) – sửa nếu đọc sai`}
                        onCommit={(v) => setEdit(`s:${s.id}:${cmp.column}`, v)}
                        onReset={() => setEdit(`s:${s.id}:${cmp.column}`, undefined)}
                      />
                    ) : (
                      <span className="text-xs font-medium text-rose-600">{s ? '' : 'không có'}</span>
                    )}
                  </td>
                  <td className="min-w-[260px] px-3 py-2">
                    <div className={`flex items-center gap-1.5 font-semibold ${ICON_COLOR[r.status]}`}>
                      <Icon className="size-4 shrink-0" /> {STATUS_LABEL[r.status]}
                    </div>
                    {r.issues.length > 0 && (
                      <ul className="mt-1 space-y-0.5 text-[12px] leading-snug">
                        {r.issues.map((i, k) => (
                          <li key={k} className={i.level === 'error' ? 'text-rose-700' : 'text-amber-800'}>
                            • {i.msg}
                          </li>
                        ))}
                      </ul>
                    )}
                  </td>
                </tr>
              )
            })}
            {!rows.length && (
              <tr>
                <td colSpan={7} className="px-3 py-10 text-center text-sm text-emerald-700">
                  <CircleCheck className="mx-auto mb-2 size-6" />
                  Không có dòng nào trong mục này.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  )
}

// ─── Chi tiết một biên bản ───────────────────────────────────────────────────

function InfoLine({ label, value }) {
  return (
    <div className="flex gap-2 text-[13px]">
      <span className="w-20 shrink-0 text-slate-500">{label}</span>
      <span className="min-w-0 font-medium text-slate-800">{value || <span className="text-slate-400">—</span>}</span>
    </div>
  )
}

function ComparisonDetail({ cmp, sections, setOverride, selectedId, onSelect, setEdit }) {
  const h = cmp.sheet.header
  const sec = cmp.section
  const autoCols = sec ? new Set(scoreColumns(sec).map((c) => c.index)) : new Set()

  return (
    <div className="space-y-4">
      <div className="grid gap-4 md:grid-cols-2">
        <div className="rounded-2xl bg-white p-4 ring-1 ring-slate-200">
          <div className="mb-2 flex items-center gap-2 text-xs font-semibold uppercase tracking-wide text-gold-600">
            <PenLine className="size-3.5" /> Biên bản viết tay
          </div>
          <div className="space-y-1">
            <InfoLine label="Biên bản" value={h.tieu_de} />
            <InfoLine label="Lớp" value={h.lop || cmp.sheet.classFromIds} />
            <InfoLine label="Môn thi" value={h.mon} />
            <InfoLine label="Bài" value={h.bai} />
            <InfoLine label="File" value={`${cmp.sheet.fileName} · trang ${cmp.sheet.pageNumbers.join(', ')} · ${cmp.sheet.rows.length} HV`} />
          </div>
        </div>
        <div className="rounded-2xl bg-white p-4 ring-1 ring-slate-200">
          <div className="mb-2 flex items-center gap-2 text-xs font-semibold uppercase tracking-wide text-cce-600">
            <FileSpreadsheet className="size-3.5" /> Bảng điểm hệ thống
          </div>
          <div className="space-y-2">
            <select
              value={sec?.id || ''}
              onChange={(e) => setOverride(cmp.sheet.id, { sectionId: e.target.value || null })}
              className="w-full rounded-lg border border-slate-200 bg-white px-2.5 py-1.5 text-[13px] font-medium text-slate-800 outline-none focus:border-cce-400 focus:ring-2 focus:ring-cce-100"
            >
              <option value="">— Không ghép —</option>
              {sections.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.title || '(không rõ tên)'} · {s.lop || '?'} · {s.rows.length} HV
                  {s.id === cmp.auto.sectionId ? ' (tự ghép)' : ''}
                </option>
              ))}
            </select>
            {sec && (
              <>
                <InfoLine label="Lớp" value={sec.lop} />
                <div className="flex items-center gap-2 text-[13px]">
                  <span className="w-20 shrink-0 text-slate-500">Cột so</span>
                  <select
                    value={cmp.column ?? ''}
                    onChange={(e) => setOverride(cmp.sheet.id, { sectionId: sec.id, column: e.target.value === '' ? null : +e.target.value })}
                    className="rounded-lg border border-slate-200 bg-white px-2 py-1 text-[13px] font-semibold text-cce-800 outline-none focus:border-cce-400"
                  >
                    {sec.columns.map((c, i) => (
                      <option key={i} value={i}>
                        {c}
                        {autoCols.has(i) ? '' : ' (không phải cột điểm)'}
                      </option>
                    ))}
                  </select>
                </div>
                <InfoLine label="File" value={`${sec.fileName} · trang ${sec.pageNumbers.join(', ')} · ${sec.rows.length} HV`} />
              </>
            )}
          </div>
        </div>
      </div>

      {cmp.issues.length > 0 && (
        <ul className="space-y-1.5">
          {cmp.issues.map((i, k) => (
            <li
              key={k}
              className={`flex gap-2 rounded-xl px-3.5 py-2.5 text-[13px] ring-1 ${
                i.level === 'error' ? 'bg-rose-50 font-medium text-rose-800 ring-rose-200' : 'bg-amber-50 text-amber-900 ring-amber-200'
              }`}
            >
              {i.level === 'error' ? <CircleX className="mt-0.5 size-4 shrink-0" /> : <TriangleAlert className="mt-0.5 size-4 shrink-0" />}
              {i.msg}
            </li>
          ))}
        </ul>
      )}

      {sec ? (
        <CompareTable key={`${cmp.id}|${sec.id}|${cmp.column}`} cmp={cmp} selectedId={selectedId} onSelect={onSelect} setEdit={setEdit} />
      ) : (
        <div className="rounded-2xl bg-white p-8 text-center text-sm text-slate-500 ring-1 ring-slate-200">
          <Link2Off className="mx-auto mb-2 size-6 text-rose-500" />
          Biên bản này chưa được ghép với bảng điểm hệ thống nào. Nếu AI đọc sai tên lớp/học phần, chọn bảng đúng ở ô phía trên.
        </div>
      )}
    </div>
  )
}

// ─── Màn hình kết quả ────────────────────────────────────────────────────────

export default function ResultView({ result, sections, getPage, setOverride, setEdit, onExport, onRestart }) {
  const { comparisons, unusedSections } = result
  const [activeId, setActiveId] = useState(() => (comparisons.find((c) => c.status !== 'ok') || comparisons[0])?.id)
  const [selectedId, setSelectedId] = useState(null)
  const [exporting, setExporting] = useState(false)

  const cmp = comparisons.find((c) => c.id === activeId) || comparisons[0]
  const row = cmp?.rows.find((r) => r.id === selectedId) || null

  const totals = useMemo(
    () => ({
      sheets: comparisons.length,
      okSheets: comparisons.filter((c) => c.status === 'ok').length,
      errorRows: comparisons.reduce((a, c) => a + c.counts.error, 0),
      warnRows: comparisons.reduce((a, c) => a + c.counts.warn, 0),
      unmatched: comparisons.filter((c) => c.status === 'unmatched').length,
    }),
    [comparisons],
  )

  // Ảnh trang: dòng đang chọn → trang chứa dòng đó; chưa chọn → trang đầu của biên bản / bảng.
  const handRef = row?.hand || (cmp && { fileId: cmp.sheet.fileId, pageNumber: cmp.sheet.pageNumbers[0], row_y: null })
  const sysRef = row?.sys || (cmp?.section && { fileId: cmp.section.fileId, pageNumber: cmp.section.pageNumbers[0], row_y: null })
  const handPage = handRef ? getPage(handRef.fileId, handRef.pageNumber) : null
  const sysPage = sysRef ? getPage(sysRef.fileId, sysRef.pageNumber) : null

  async function doExport() {
    setExporting(true)
    try {
      await onExport()
    } finally {
      setExporting(false)
    }
  }

  return (
    <div className="mx-auto max-w-[1700px] px-4 py-5">
      {/* ── Tổng kết ── */}
      <div className="mb-5 flex flex-wrap items-center gap-3 rounded-2xl bg-white p-4 ring-1 ring-slate-200">
        <div className="mr-2">
          <div className="text-lg font-semibold text-cce-900">Kết quả dò điểm</div>
          <div className="text-xs text-slate-500">
            {totals.sheets} biên bản viết tay · {sections.length} bảng hệ thống
          </div>
        </div>
        <Badge tone="green">
          <CircleCheck className="size-3.5" /> {totals.okSheets}/{totals.sheets} biên bản khớp hoàn toàn
        </Badge>
        <Badge tone={totals.errorRows ? 'red' : 'slate'}>
          <CircleX className="size-3.5" /> {totals.errorRows} dòng sai
        </Badge>
        <Badge tone={totals.warnRows ? 'amber' : 'slate'}>
          <TriangleAlert className="size-3.5" /> {totals.warnRows} dòng cần xem lại
        </Badge>
        {totals.unmatched > 0 && (
          <Badge tone="red">
            <Link2Off className="size-3.5" /> {totals.unmatched} biên bản không ghép được
          </Badge>
        )}
        <div className="ml-auto flex gap-2">
          <Button icon={RotateCcw} onClick={onRestart}>
            Dò bộ khác
          </Button>
          <Button variant="primary" icon={FileSpreadsheet} loading={exporting} onClick={doExport}>
            Xuất Excel
          </Button>
        </div>
      </div>

      {!comparisons.length && (
        <div className="flex gap-3 rounded-2xl bg-rose-50 p-4 text-sm text-rose-800 ring-1 ring-rose-200">
          <CircleAlert className="mt-0.5 size-4 shrink-0" />
          Không đọc được biên bản viết tay nào trong file đã tải lên.
        </div>
      )}

      {cmp && (
        <div className="grid gap-5 xl:grid-cols-[270px_minmax(0,1fr)_440px]">
          {/* ── Danh sách biên bản ── */}
          <aside className="space-y-2">
            <div className="px-1 text-xs font-semibold uppercase tracking-wide text-slate-500">Biên bản viết tay</div>
            {comparisons.map((c) => {
              const Icon = STATUS_ICON[c.status]
              return (
                <button
                  key={c.id}
                  onClick={() => {
                    setActiveId(c.id)
                    setSelectedId(null)
                  }}
                  className={`w-full rounded-xl p-3 text-left ring-1 transition ${
                    c.id === cmp.id ? 'bg-cce-50 ring-cce-300' : 'bg-white ring-slate-200 hover:ring-slate-300'
                  }`}
                >
                  <div className="flex items-start gap-2">
                    <Icon className={`mt-0.5 size-4 shrink-0 ${ICON_COLOR[c.status]}`} />
                    <div className="min-w-0 flex-1">
                      <div className="font-mono text-[11px] text-slate-500">{c.sheet.header.lop || c.sheet.classFromIds || 'Lớp ?'}</div>
                      <div className="text-[13px] font-semibold leading-snug text-cce-900">
                        {c.sheet.header.mon || c.sheet.header.bai || 'Chưa rõ học phần'}
                      </div>
                      <div className="mt-1 flex flex-wrap gap-1">
                        <Badge tone={STATUS_TONE[c.status]}>{STATUS_LABEL[c.status]}</Badge>
                        {c.counts.error > 0 && <Badge tone="red">{c.counts.error} sai</Badge>}
                        {c.counts.warn > 0 && <Badge tone="amber">{c.counts.warn} xem lại</Badge>}
                        {c.section && <Badge tone="slate">{columnName(c.section, c.column)}</Badge>}
                      </div>
                    </div>
                  </div>
                </button>
              )
            })}
            {unusedSections.length > 0 && (
              <>
                <div className="px-1 pt-3 text-xs font-semibold uppercase tracking-wide text-slate-500">Học phần hệ thống chưa có biên bản</div>
                {unusedSections.map((s) => (
                  <div key={s.id} className="rounded-xl bg-slate-50 p-2.5 text-[12px] text-slate-600 ring-1 ring-slate-200">
                    <div className="font-medium text-slate-700">{s.title || '(không rõ tên)'}</div>
                    <div className="text-slate-500">
                      {s.lop} · {s.rows.length} HV
                    </div>
                  </div>
                ))}
              </>
            )}
          </aside>

          {/* ── Bảng dò ── */}
          <main className="min-w-0">
            <ComparisonDetail
              key={cmp.id}
              cmp={cmp}
              sections={sections}
              setOverride={setOverride}
              selectedId={selectedId}
              onSelect={setSelectedId}
              setEdit={setEdit}
            />
          </main>

          {/* ── Ảnh gốc ── */}
          <div className="xl:sticky xl:top-[76px] xl:h-[calc(100vh-96px)]">
            <div className="flex h-[80vh] flex-col gap-3 xl:h-full">
              <div className="min-h-0 flex-1">
                <PageViewer
                  src={handPage?.previewUrl}
                  title={handRef ? `Viết tay · ${handPage?.fileName || ''} · trang ${handRef.pageNumber}` : 'Viết tay'}
                  rowY={handRef?.row_y ?? null}
                />
              </div>
              <div className="min-h-0 flex-1">
                <PageViewer
                  src={sysPage?.previewUrl}
                  title={sysRef ? `Hệ thống · ${sysPage?.fileName || ''} · trang ${sysRef.pageNumber}` : 'Hệ thống'}
                  rowY={sysRef?.row_y ?? null}
                />
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
