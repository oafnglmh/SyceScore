import { fullName } from './extract'

// Giữ nguyên định dạng mẫu của hệ thống (header nền xám đậm, chữ trắng, Calibri 10,
// căn giữa, viền dưới mảnh; mỗi Lớp + Ngành một file, nhiều lớp thì nén ZIP).
const HEADER_BG = 'FF1E293B'
const HEADER_FG = 'FFFFFFFF'
const BORDER = 'FFCBD5E1'

export const COLUMNS = [
  { header: 'STT', width: 8 },
  { header: 'Lớp', width: 16 },
  { header: 'Ngành', width: 18 },
  { header: 'Học phần thi', width: 23 },
  { header: 'Ngày giờ thi', width: 22 },
  { header: 'Mã HV', width: 22 },
  { header: 'Họ và tên', width: 26 },
  { header: 'Ngày sinh', width: 13 },
  { header: 'Điểm', width: 10 },
]

const safePart = (v) =>
  String(v || '')
    .replace(/[<>:"/\\|?*]+/g, '')
    .trim()
    .replace(/\.+$/, '')
    .replace(/\s+/g, '_') || 'Chua_xac_dinh'

export const fileNameFor = (lop, nganh) => `${safePart(lop)}_${safePart(nganh)}.xlsx`

/** Gom các biên bản theo (Lớp, Ngành) – giữ thứ tự xuất hiện. */
export function groupSheets(sheets) {
  const groups = new Map()
  for (const s of sheets) {
    const lop = s.header.lop || 'Lớp chưa xác định'
    const nganh = s.header.nganh || 'Ngành chưa xác định'
    const key = `${lop.toUpperCase()}|${nganh.toLowerCase()}`
    if (!groups.has(key)) groups.set(key, { key, lop, nganh, sheets: [] })
    groups.get(key).sheets.push(s)
  }
  return [...groups.values()]
}

export async function buildWorkbook(group) {
  const { default: ExcelJS } = await import('exceljs')
  const wb = new ExcelJS.Workbook()
  wb.creator = 'CCE ScoreSync'
  wb.created = new Date()
  const ws = wb.addWorksheet('DoiSoatDiem', { views: [{ state: 'frozen', ySplit: 1 }] })
  ws.columns = COLUMNS.map((c) => ({ header: c.header, width: c.width }))

  const headerRow = ws.getRow(1)
  headerRow.height = 22
  headerRow.eachCell((cell) => {
    cell.font = { name: 'Calibri', size: 10, bold: true, color: { argb: HEADER_FG } }
    cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: HEADER_BG } }
    cell.alignment = { horizontal: 'center', vertical: 'middle' }
  })

  let stt = 0
  for (const sheet of group.sheets) {
    const h = sheet.header
    for (const r of sheet.rows) {
      stt++
      const row = ws.addRow([
        stt,
        h.lop,
        h.nganh,
        h.hoc_phan,
        h.ngay_gio_thi,
        r.ma_hv,
        fullName(r),
        r.ngay_sinh,
        r.absent || r.score === null ? null : r.score,
      ])
      row.eachCell({ includeEmpty: true }, (cell, col) => {
        cell.font = { name: 'Calibri', size: 10 }
        cell.alignment = { horizontal: col === 7 ? 'left' : 'center', vertical: 'middle' }
        cell.border = { bottom: { style: 'thin', color: { argb: BORDER } } }
      })
      row.getCell(9).numFmt = '0.0#'
      row.getCell(8).numFmt = '@'
    }
  }
  return wb.xlsx.writeBuffer()
}

function download(data, filename, type) {
  const blob = data instanceof Blob ? data : new Blob([data], { type })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  document.body.appendChild(a)
  a.click()
  a.remove()
  setTimeout(() => URL.revokeObjectURL(url), 2000)
}

const XLSX_MIME = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'

export async function exportGroup(group) {
  download(await buildWorkbook(group), fileNameFor(group.lop, group.nganh), XLSX_MIME)
}

export async function exportAll(sheets) {
  const groups = groupSheets(sheets)
  if (groups.length === 1) return exportGroup(groups[0])
  const { default: JSZip } = await import('jszip')
  const zip = new JSZip()
  const used = new Set()
  for (const g of groups) {
    let name = fileNameFor(g.lop, g.nganh)
    for (let i = 2; used.has(name); i++) name = fileNameFor(g.lop, g.nganh).replace('.xlsx', `_${i}.xlsx`)
    used.add(name)
    zip.file(name, await buildWorkbook(g))
  }
  download(await zip.generateAsync({ type: 'blob' }), 'DoiSoatDiem.zip', 'application/zip')
}
