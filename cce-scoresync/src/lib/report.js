import { columnName } from './compare'
import { formatScore } from './score'

const HEADER_BG = 'FF1E293B'
const HEADER_FG = 'FFFFFFFF'
const BORDER = 'FFCBD5E1'
const FILL = { error: 'FFFFE4E6', warn: 'FFFEF3C7', ok: 'FFECFDF5', unmatched: 'FFFFE4E6' }
export const STATUS_LABEL = { ok: 'Khớp', warn: 'Cần xem lại', error: 'Sai', unmatched: 'Không ghép được' }

const fmt = (n) => (n === null || n === undefined ? '' : formatScore(n))
const pages = (sheet) => `${sheet.fileName} · tr. ${sheet.pageNumbers.join(', ')}`

export function handScoreText(row) {
  if (!row.hand) return ''
  if (row.handEdited) return row.handAbsent ? 'Vắng (đã sửa)' : `${fmt(row.handScore)} (đã sửa)`
  if (row.handAbsent) return 'Vắng / trống'
  return fmt(row.handScore) || `“${row.hand.digitsRaw}”`
}

export function sysScoreText(row) {
  if (!row.sys) return ''
  const v = row.sysScore !== null ? fmt(row.sysScore) : row.sysRaw ? `“${row.sysRaw}”` : 'Trống'
  return row.sysEdited ? `${v} (đã sửa)` : v
}

function sheetTitle(c) {
  const h = c.sheet.header
  return `${h.lop || c.sheet.classFromIds || '?'} · ${h.mon || h.bai || 'Chưa rõ học phần'}`
}

function addTable(wb, name, columns, rows, statusOf) {
  const ws = wb.addWorksheet(name, { views: [{ state: 'frozen', ySplit: 1 }] })
  ws.columns = columns.map((c) => ({ header: c.header, width: c.width }))
  const head = ws.getRow(1)
  head.height = 22
  head.eachCell((cell) => {
    cell.font = { name: 'Calibri', size: 10, bold: true, color: { argb: HEADER_FG } }
    cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: HEADER_BG } }
    cell.alignment = { horizontal: 'center', vertical: 'middle', wrapText: true }
  })
  for (const r of rows) {
    const row = ws.addRow(r.values)
    const fill = FILL[statusOf(r)]
    row.eachCell({ includeEmpty: true }, (cell, i) => {
      cell.font = { name: 'Calibri', size: 10, bold: i === 1 && statusOf(r) === 'error' }
      cell.alignment = { vertical: 'top', wrapText: true, horizontal: columns[i - 1]?.align || 'left' }
      cell.border = { bottom: { style: 'thin', color: { argb: BORDER } } }
      if (fill && statusOf(r) !== 'ok') cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: fill } }
    })
  }
  ws.autoFilter = { from: { row: 1, column: 1 }, to: { row: 1, column: columns.length } }
  return ws
}

export async function buildReport(result) {
  const { default: ExcelJS } = await import('exceljs')
  const wb = new ExcelJS.Workbook()
  wb.creator = 'CCE ScoreSync – Dò điểm'
  wb.created = new Date()
  const { comparisons, unusedSections } = result

  // ── Tổng hợp ──
  const summary = comparisons.map((c, i) => ({
    status: c.status,
    values: [
      i + 1,
      STATUS_LABEL[c.status],
      c.sheet.header.lop || c.sheet.classFromIds,
      c.sheet.header.mon || c.sheet.header.bai,
      pages(c.sheet),
      c.section ? c.section.title : '',
      c.section ? c.section.lop : '',
      columnName(c.section, c.column),
      c.sheet.rows.length,
      c.section ? c.section.rows.length : '',
      c.counts.ok,
      c.counts.error,
      c.counts.warn,
      c.issues.map((x) => x.msg).join('\n'),
    ],
  }))
  for (const s of unusedSections) {
    summary.push({
      status: 'warn',
      values: ['', 'Chưa có biên bản viết tay', '', '', '', s.title, s.lop, '', '', s.rows.length, '', '', '', 'Học phần này trong file hệ thống không có biên bản viết tay tương ứng.'],
    })
  }
  addTable(
    wb,
    'Tổng hợp',
    [
      { header: 'STT', width: 6, align: 'center' },
      { header: 'Kết luận', width: 16 },
      { header: 'Lớp (viết tay)', width: 16 },
      { header: 'Học phần (viết tay)', width: 30 },
      { header: 'File · trang', width: 24 },
      { header: 'Học phần (hệ thống)', width: 30 },
      { header: 'Lớp (hệ thống)', width: 16 },
      { header: 'Cột điểm so', width: 12, align: 'center' },
      { header: 'Số HV viết tay', width: 10, align: 'center' },
      { header: 'Số HV hệ thống', width: 10, align: 'center' },
      { header: 'Dòng khớp', width: 9, align: 'center' },
      { header: 'Dòng sai', width: 9, align: 'center' },
      { header: 'Cần xem', width: 9, align: 'center' },
      { header: 'Ghi chú', width: 60 },
    ],
    summary,
    (r) => r.status,
  )

  // ── Dòng sai + Chi tiết ──
  const detailCols = [
    { header: 'STT', width: 6, align: 'center' },
    { header: 'Kết quả', width: 13 },
    { header: 'Lớp · Học phần', width: 34 },
    { header: 'TT viết tay', width: 9, align: 'center' },
    { header: 'TT hệ thống', width: 9, align: 'center' },
    { header: 'Mã HV', width: 20 },
    { header: 'Họ và tên', width: 24 },
    { header: 'Ngày sinh', width: 12, align: 'center' },
    { header: 'Điểm viết tay', width: 13, align: 'center' },
    { header: 'Chữ (viết tay)', width: 14 },
    { header: 'Điểm hệ thống', width: 13, align: 'center' },
    { header: 'Lỗi / ghi chú', width: 60 },
    { header: 'Trang viết tay', width: 12, align: 'center' },
  ]
  const toRow = (c, r, i) => ({
    status: r.status,
    values: [
      i + 1,
      STATUS_LABEL[r.status],
      sheetTitle(c),
      r.hand?.tt ?? '',
      r.sys?.tt ?? '',
      r.hand?.ma || r.sys?.ma,
      r.hand?.ho_ten || r.sys?.ho_ten,
      r.hand?.ngay_sinh || r.sys?.ngay_sinh,
      handScoreText(r),
      r.hand?.wordsRaw || '',
      sysScoreText(r),
      r.issues.map((x) => x.msg).join('\n'),
      r.hand ? r.hand.pageNumber : '',
    ],
  })
  const all = comparisons.flatMap((c) => c.rows.map((r) => [c, r]))
  const bad = all.filter(([, r]) => r.status !== 'ok')
  addTable(wb, 'Dòng sai', detailCols, bad.map(([c, r], i) => toRow(c, r, i)), (r) => r.status)
  addTable(wb, 'Chi tiết', detailCols, all.map(([c, r], i) => toRow(c, r, i)), (r) => r.status)

  return wb.xlsx.writeBuffer()
}

export async function exportReport(result) {
  const data = await buildReport(result)
  const d = new Date()
  const stamp = `${d.getFullYear()}${String(d.getMonth() + 1).padStart(2, '0')}${String(d.getDate()).padStart(2, '0')}_${String(d.getHours()).padStart(2, '0')}${String(d.getMinutes()).padStart(2, '0')}`
  const blob = new Blob([data], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = `DoDiem_${stamp}.xlsx`
  document.body.appendChild(a)
  a.click()
  a.remove()
  setTimeout(() => URL.revokeObjectURL(url), 2000)
}
