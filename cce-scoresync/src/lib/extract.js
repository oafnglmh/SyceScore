import { blobToBase64, EXTRACTION_PROMPT, focusPrompt } from './ai'
import { formatScore, isValidScore, parseDigits, parseWords, sameScore } from './score'

// ─── Helpers ─────────────────────────────────────────────────────────────────

const clean = (s) => String(s ?? '').replace(/\s+/g, ' ').trim()
const cleanId = (s) => String(s ?? '').replace(/\s+/g, '').toUpperCase()

function cleanDate(s) {
  const t = clean(s).replace(/[.\-\s]/g, '/')
  const m = t.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/)
  if (!m) return clean(s)
  return `${m[1].padStart(2, '0')}/${m[2].padStart(2, '0')}/${m[3]}`
}

export function isValidDate(s) {
  const m = String(s || '').match(/^(\d{2})\/(\d{2})\/(\d{4})$/)
  if (!m) return false
  const [d, mo, y] = [+m[1], +m[2], +m[3]]
  const dt = new Date(y, mo - 1, d)
  return dt.getFullYear() === y && dt.getMonth() === mo - 1 && dt.getDate() === d && y > 1900
}

export const ABSENT = 'VẮNG'

function normalizeRow(r) {
  const digits = parseDigits(r.diem_so)
  const wordsRaw = clean(r.diem_chu)
  const absent = !!r.vang || (!clean(r.diem_so) && !wordsRaw)
  let wordsValue = parseWords(wordsRaw)
  if (wordsValue === null && typeof r.diem_chu_so === 'number') wordsValue = r.diem_chu_so
  return {
    tt: Number.isInteger(r.tt) ? r.tt : parseInt(r.tt, 10) || null,
    ma_hv: cleanId(r.ma_hv),
    ho_dem: clean(r.ho_dem),
    ten: clean(r.ten),
    ngay_sinh: cleanDate(r.ngay_sinh),
    digitsRaw: clean(r.diem_so),
    digits,
    wordsRaw,
    wordsValue,
    absent,
    scoreKey: absent ? ABSENT : digits === null ? `?${clean(r.diem_so)}` : formatScore(digits),
    row_y: Number.isFinite(r.row_y) ? r.row_y : null,
  }
}

function normalizeResult(raw) {
  const header = raw?.header || {}
  const rows = (raw?.rows || []).map(normalizeRow)
  // Khóa căn dòng giữa các lần đọc: TT in sẵn (ổn định); nếu TT trùng/thiếu thì dùng thứ tự.
  const tts = rows.map((r) => r.tt)
  const ttUnique = tts.every((t) => t !== null) && new Set(tts).size === tts.length
  rows.forEach((r, i) => (r.key = ttUnique ? `tt${r.tt}` : `#${i}`))
  return {
    has_header: !!raw?.has_header && !!clean(header.lop || header.hoc_phan),
    header: {
      lop: cleanId(header.lop),
      nganh: clean(header.nganh),
      hoc_phan: clean(header.hoc_phan),
      ngay_gio_thi: clean(header.ngay_gio_thi),
      phong: clean(header.phong),
      dia_diem: clean(header.dia_diem),
      hoc_ky: clean(header.hoc_ky),
      khoa: clean(header.khoa),
    },
    footer: {
      so_hoc_vien_du_thi: clean(raw?.footer?.so_hoc_vien_du_thi).replace(/[^\d]/g, ''),
      so_bai_thi: clean(raw?.footer?.so_bai_thi).replace(/[^\d]/g, ''),
    },
    rows,
  }
}

/** Bỏ phiếu: trả về giá trị xuất hiện nhiều nhất cùng mức đồng thuận. */
function vote(values) {
  const counts = new Map()
  for (const v of values) counts.set(v, (counts.get(v) || 0) + 1)
  let best = values[0]
  let bestCount = 0
  for (const [v, c] of counts) {
    if (c > bestCount) {
      best = v
      bestCount = c
    }
  }
  return {
    value: best,
    count: bestCount,
    total: values.length,
    unanimous: counts.size === 1,
    strict: bestCount > values.length / 2,
    candidates: [...counts.entries()].map(([v, c]) => ({ value: v, count: c })).sort((a, b) => b.count - a.count),
  }
}

const MISSING = '∅'

function rowKeys(results) {
  const seen = new Map()
  for (const res of results) {
    for (const r of res.rows) if (!seen.has(r.key)) seen.set(r.key, r.tt ?? 9999)
  }
  return [...seen.entries()].sort((a, b) => a[1] - b[1]).map(([k]) => k)
}

/**
 * Những chỗ các lần đọc CHƯA có đa số rõ ràng → cần đọc thêm.
 * Với 2 lần đọc: bất kỳ khác biệt nào. Từ 3 lần: trường nào chưa có giá trị chiếm > 1/2 số lần đọc.
 * checkWords: thêm các dòng mà điểm đa số ở cột Số khác cột Chữ (đọc lại một lần để chắc chắn).
 */
function unresolved(results, { checkWords }) {
  const tts = []
  for (const key of rowKeys(results)) {
    const rows = results.map((res) => res.rows.find((r) => r.key === key))
    const tt = rows.find(Boolean).tt ?? key
    const fields = ['scoreKey', 'ma_hv', 'ho_dem', 'ten', 'ngay_sinh']
    const bad =
      !vote(rows.map((r) => (r ? 'có' : MISSING))).strict ||
      fields.some((f) => !vote(rows.map((r) => (r ? r[f] : MISSING))).strict)
    if (bad) {
      tts.push(tt)
      continue
    }
    if (checkWords) {
      const present = rows.filter(Boolean)
      const win = vote(present.map((r) => r.scoreKey)).value
      const winners = present.filter((r) => r.scoreKey === win)
      if (win !== ABSENT && winners[0].digits !== null) {
        const w = winners.map((r) => r.wordsValue).filter((x) => x !== null)
        if (w.length && !w.some((x) => sameScore(x, winners[0].digits))) tts.push(tt)
      }
    }
  }
  const header =
    !vote(results.map((r) => r.has_header)).strict ||
    ['lop', 'nganh', 'hoc_phan', 'ngay_gio_thi'].some((f) => !vote(results.map((r) => r.header[f])).strict)
  return { tts, header }
}

function mergeResults(results) {
  const n = results.length
  const header = {}
  const headerFlags = []
  for (const f of Object.keys(results[0].header)) {
    const v = vote(results.map((r) => r.header[f]))
    header[f] = v.value
    if (!v.strict && ['lop', 'nganh', 'hoc_phan', 'ngay_gio_thi'].includes(f)) headerFlags.push(f)
  }
  const footer = {}
  for (const f of ['so_hoc_vien_du_thi', 'so_bai_thi']) footer[f] = vote(results.map((r) => r.footer[f])).value

  const rows = []
  for (const key of rowKeys(results)) {
    const variants = results.map((res) => res.rows.find((r) => r.key === key) || null)
    const present = variants.filter(Boolean)
    const flags = []

    if (present.length < n) {
      flags.push({ level: present.length > n / 2 ? 'warn' : 'error', field: 'row', msg: `Dòng chỉ xuất hiện ở ${present.length}/${n} lần đọc – kiểm tra dòng này có thật trên giấy.` })
    }

    const pick = (field, label) => {
      const v = vote(variants.map((r) => (r ? r[field] : MISSING)).filter((x) => x !== MISSING))
      if (!v.unanimous && !v.strict) {
        flags.push({ level: 'error', field, msg: `Các lần đọc ${label} không thống nhất.`, candidates: v.candidates })
      }
      return v.value
    }

    const ma_hv = pick('ma_hv', 'Mã HV')
    const ho_dem = pick('ho_dem', 'Họ và')
    const ten = pick('ten', 'Tên')
    const ngay_sinh = pick('ngay_sinh', 'Ngày sinh')

    // ── Điểm: bỏ phiếu trên cột Số, đối chiếu với cột Chữ ──
    const sv = vote(present.map((r) => r.scoreKey))
    const winners = present.filter((r) => r.scoreKey === sv.value)
    const absent = sv.value === ABSENT
    const digits = absent ? null : winners[0].digits
    const wordsVote = vote(winners.map((r) => (r.wordsValue === null ? MISSING : formatScore(r.wordsValue))))
    const wordsValue = wordsVote.value === MISSING ? null : Number(wordsVote.value)
    const wordsRaw = winners[0].wordsRaw
    const scoreCandidates = sv.candidates.map((c) => ({ ...c, value: c.value.startsWith('?') ? `"${c.value.slice(1)}"` : c.value }))

    // Đa số (vd 2/3) chỉ được chấp nhận tự động khi cột Chữ xác nhận cùng giá trị (kiểm tra bên dưới).
    if (!sv.strict && n > 1) {
      flags.push({ level: 'error', field: 'score', msg: 'Các lần đọc cho điểm khác nhau.', candidates: scoreCandidates })
    }

    if (absent) {
      if (wordsValue !== null) {
        flags.push({ level: 'error', field: 'score', msg: `Cột Số để trống nhưng cột Chữ ghi “${wordsRaw}”.` })
      }
    } else if (digits === null) {
      flags.push({ level: 'error', field: 'score', msg: `Không đọc được điểm ở cột Số (“${winners[0].digitsRaw}”).` })
    } else if (wordsValue === null) {
      flags.push({
        level: sv.unanimous && n > 1 ? 'warn' : 'error',
        field: 'score',
        msg: `Không đọc được cột Chữ (“${wordsRaw}”) để đối chiếu.`,
        candidates: sv.unanimous ? undefined : scoreCandidates,
      })
    } else if (!sameScore(digits, wordsValue)) {
      flags.push({
        level: 'error',
        field: 'score',
        msg: `Cột Số đọc ${formatScore(digits)} nhưng cột Chữ “${wordsRaw}” = ${formatScore(wordsValue)}.`,
        candidates: [
          { value: formatScore(digits), count: 0, label: 'theo cột Số' },
          { value: formatScore(wordsValue), count: 0, label: 'theo cột Chữ' },
        ],
      })
    }

    const ys = present.map((r) => r.row_y).filter((y) => y !== null)
    rows.push({
      tt: present[0].tt,
      ma_hv,
      ho_dem,
      ten,
      ngay_sinh,
      score: digits,
      absent,
      wordsRaw,
      wordsValue,
      row_y: ys.length ? Math.round(ys.reduce((a, b) => a + b, 0) / ys.length) : null,
      flags,
    })
  }

  return {
    has_header: vote(results.map((r) => r.has_header)).value,
    header,
    headerFlags,
    footer,
    rows,
  }
}

// ─── Đọc một trang ───────────────────────────────────────────────────────────

export const MAX_PASSES = 5

/**
 * Kiểm tra chéo: luôn đọc 2 lần độc lập (ảnh màu + ảnh xám tương phản cao) song song.
 * Còn chỗ lệch thì đọc thêm có trọng tâm (tối đa MAX_PASSES lần) tới khi mọi trường có đa số rõ ràng.
 */
export async function readPage({ client, page, signal, onProgress }) {
  const call = async (variant, prompt) =>
    normalizeResult(
      await client.generate({
        prompt,
        imageBase64: await blobToBase64(page.images[variant]),
        mimeType: 'image/jpeg',
        signal,
        onWait: (ms) => onProgress?.({ waitingMs: ms }),
      }),
    )

  let done = 0
  const tick = () => onProgress?.({ passes: ++done })

  onProgress?.({ label: 'Đọc chéo lần 1 + 2' })
  const results = await Promise.all([
    call('A', EXTRACTION_PROMPT).then((r) => (tick(), r)),
    call('B', EXTRACTION_PROMPT).then((r) => (tick(), r)),
  ])

  while (results.length < MAX_PASSES) {
    const u = unresolved(results, { checkWords: results.length < 3 })
    if (!u.tts.length && !u.header) break
    const n = results.length + 1
    onProgress?.({ label: `Đọc lần ${n} để phân xử ${u.tts.length ? `TT ${u.tts.join(', ')}` : 'phần đầu trang'}` })
    results.push(await call(n % 2 ? 'A' : 'B', u.tts.length ? focusPrompt(u.tts) : EXTRACTION_PROMPT))
    tick()
  }
  return { results, merged: mergeResults(results) }
}

// ─── Ghép trang thành biên bản ───────────────────────────────────────────────

const CONFUSABLE = { I: '1', L: '1', O: '0', Q: '0' }
const deconfuse = (s) => s.replace(/[ILOQ]/g, (c) => CONFUSABLE[c])

/** Nếu Mã HV lệch mã lớp chỉ vì ký tự dễ nhầm (I/1, O/0) thì sửa phần tiền tố theo mã lớp. */
function fixIdPrefix(id, lop) {
  if (!id || !lop || id.startsWith(lop)) return id
  const head = id.slice(0, lop.length)
  return deconfuse(head) === deconfuse(lop) ? lop + id.slice(lop.length) : id
}

let seq = 0
const uid = (p) => `${p}${++seq}`

/**
 * files: [{ id, name, pages: [{ pageNumber, previewUrl, merged }] }]
 * → danh sách biên bản: [{ id, fileId, fileName, header, footer, rows, pageNumbers }]
 */
export function buildSheets(files) {
  const sheets = []
  for (const file of files) {
    let current = null
    for (const page of file.pages) {
      const m = page.merged
      if (!m) continue
      if (m.has_header) {
        current = {
          id: uid('s'),
          fileId: file.id,
          fileName: file.name,
          header: { ...m.header },
          headerFlags: [...m.headerFlags],
          headerConfirmed: false,
          footer: { so_hoc_vien_du_thi: '', so_bai_thi: '' },
          rows: [],
          pageNumbers: [],
        }
        sheets.push(current)
      } else if (!m.rows.length) {
        continue
      } else if (!current) {
        current = {
          id: uid('s'),
          fileId: file.id,
          fileName: file.name,
          header: { lop: '', nganh: '', hoc_phan: '', ngay_gio_thi: '', phong: '' },
          headerFlags: ['lop', 'nganh', 'hoc_phan', 'ngay_gio_thi'],
          headerConfirmed: false,
          footer: { so_hoc_vien_du_thi: '', so_bai_thi: '' },
          rows: [],
          pageNumbers: [],
        }
        sheets.push(current)
      }
      current.pageNumbers.push(page.pageNumber)
      if (m.footer.so_hoc_vien_du_thi) current.footer.so_hoc_vien_du_thi = m.footer.so_hoc_vien_du_thi
      if (m.footer.so_bai_thi) current.footer.so_bai_thi = m.footer.so_bai_thi
      for (const r of m.rows) {
        current.rows.push({
          ...r,
          id: uid('r'),
          ma_hv: fixIdPrefix(r.ma_hv, current.header.lop),
          fileId: file.id,
          pageNumber: page.pageNumber,
          confirmed: false,
          edited: false,
        })
      }
    }
  }
  return sheets
}

// ─── Kiểm tra (chạy lại sau mỗi lần sửa) ────────────────────────────────────

export function fullName(r) {
  return clean(r.ho_ten ?? `${r.ho_dem} ${r.ten}`)
}

/** Vấn đề của một dòng. blocking = phải sửa, không thể chỉ "xác nhận". */
export function rowIssues(row, sheet, dupIds) {
  const out = []
  if (!row.confirmed) out.push(...row.flags)
  if (!row.ma_hv) out.push({ level: 'error', field: 'ma_hv', msg: 'Thiếu Mã HV.', blocking: true })
  if (!row.absent && !isValidScore(row.score)) {
    out.push({ level: 'error', field: 'score', msg: 'Điểm trống hoặc ngoài khoảng 0–10.', blocking: true })
  }
  if (!row.confirmed) {
    const lop = sheet.header.lop
    if (row.ma_hv && lop && !row.ma_hv.startsWith(lop)) {
      out.push({ level: 'warn', field: 'ma_hv', msg: `Mã HV không bắt đầu bằng mã lớp ${lop}.` })
    }
    if (row.ngay_sinh && !isValidDate(row.ngay_sinh)) {
      out.push({ level: 'warn', field: 'ngay_sinh', msg: 'Ngày sinh không đúng dạng dd/mm/yyyy.' })
    }
    if (dupIds?.has(row.ma_hv)) out.push({ level: 'warn', field: 'ma_hv', msg: 'Mã HV bị trùng trong biên bản.' })
  }
  return out
}

export function sheetIssues(sheet) {
  const out = []
  const rows = sheet.rows
  rows.forEach((r, i) => {
    if (r.tt !== i + 1) out.push(`TT không liên tục ở dòng ${i + 1} (đọc được TT ${r.tt ?? '?'}) – có thể sót hoặc thừa dòng.`)
  })
  const total = +sheet.footer.so_hoc_vien_du_thi
  if (total && total !== rows.length) {
    out.push(`Biên bản ghi ${total} học viên dự thi nhưng đọc được ${rows.length} dòng.`)
  }
  const papers = +sheet.footer.so_bai_thi
  const taken = rows.filter((r) => !r.absent).length
  if (papers && papers !== taken) {
    out.push(`Biên bản ghi ${papers} bài thi nhưng có ${taken} học viên có điểm.`)
  }
  if (!sheet.headerConfirmed) {
    for (const f of sheet.headerFlags) out.push(`Phần đầu biên bản: trường “${HEADER_LABELS[f]}” cần kiểm tra.`)
  }
  for (const f of ['lop', 'nganh', 'hoc_phan', 'ngay_gio_thi']) {
    if (!sheet.header[f]) out.push(`Phần đầu biên bản thiếu “${HEADER_LABELS[f]}”.`)
  }
  return [...new Set(out)]
}

export const HEADER_LABELS = {
  lop: 'Lớp',
  nganh: 'Ngành',
  hoc_phan: 'Học phần thi',
  ngay_gio_thi: 'Ngày giờ thi',
  phong: 'Phòng',
}

export function duplicateIds(sheet) {
  const seen = new Set()
  const dup = new Set()
  for (const r of sheet.rows) {
    if (!r.ma_hv) continue
    if (seen.has(r.ma_hv)) dup.add(r.ma_hv)
    seen.add(r.ma_hv)
  }
  return dup
}
