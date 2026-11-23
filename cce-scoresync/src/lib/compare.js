import { formatScore, parseHandDigits, parseSystemScore, sameScore } from './score'
import { cleanDate, courseSimilarity, fold, idKey, sameName } from './text'

/** Ngưỡng coi hai tên học phần là một (đã bỏ dấu, chịu được lỗi đọc vài ký tự). */
export const COURSE_MATCH = 0.8

const courseOf = (sheet) => sheet.header.mon || sheet.header.bai

// ─── Chọn cột điểm ──────────────────────────────────────────────────────────

/** Các cột điểm của bảng hệ thống: cột mà đa số ô là điểm 0–10 (loại cột ngày như "Ktra1NgayEdit"). */
export function scoreColumns(section) {
  return section.columns
    .map((name, index) => {
      const vals = section.rows.map((r) => r.values[index]).filter(Boolean)
      const nums = vals.filter((v) => parseSystemScore(v) !== null).length
      const isScore = vals.length ? nums / vals.length >= 0.6 : !/ngay|date|edit/.test(fold(name))
      return { name, index, isScore }
    })
    .filter((c) => c.isScore)
}

/** Tự chọn cột cần so: biên bản giữa kỳ/kiểm tra → cột Ktra (ưu tiên số 1), thi kết thúc → cột Thi. */
export function pickColumn(sheet, section) {
  const cols = scoreColumns(section)
  if (!cols.length) return null
  const text = fold(`${sheet.header.tieu_de} ${sheet.header.bai}`)
  const isFinal = /ket thuc|cuoi ky|thi hoc phan/.test(text)
  const num = (text.match(/\b(?:kt|ktra|kiem tra|bai kt)\s*(\d)\b/) || [])[1]
  let best = cols[0]
  let bestScore = -1
  for (const c of cols) {
    const name = fold(c.name)
    let s = 0
    if (isFinal ? /thi|ck|cuoi|kthp/.test(name) : /k ?tra|kt|kiem tra|gk|giua/.test(name)) s += 2
    if (num ? name.includes(num) : /1/.test(name)) s += 1
    if (s > bestScore) [best, bestScore] = [c, s]
  }
  return best.index
}

// ─── Ghép biên bản viết tay ↔ học phần hệ thống ─────────────────────────────

const listOf = (arr) => [...new Set(arr.filter(Boolean))].join(', ')

/**
 * Tìm học phần cùng TÊN MÔN THI trong file hệ thống (không xét lớp).
 * Nhiều học phần trùng tên → ưu tiên bảng có nhiều Mã HV trùng với biên bản nhất.
 * Trả về { sectionId, sim, reason } – sectionId null kèm lý do khi không có cặp hợp lệ.
 */
export function pairSheet(sheet, sections) {
  const course = courseOf(sheet)
  const ids = new Set(sheet.rows.map((r) => idKey(r.ma)))
  const best = sections
    .map((sec) => ({
      sec,
      sim: Math.max(courseSimilarity(course, sec.title), courseSimilarity(sheet.header.bai, sec.title)),
      overlap: sec.rows.filter((r) => ids.has(idKey(r.ma))).length,
    }))
    .filter((c) => c.sim >= COURSE_MATCH)
    .sort((a, b) => b.overlap - a.overlap || b.sim - a.sim)[0]
  if (best) return { sectionId: best.sec.id, sim: best.sim }

  const reason = !sections.length
    ? 'File hệ thống không đọc được bảng điểm nào.'
    : !course
      ? 'Không đọc được tên môn thi trên biên bản viết tay – chọn bảng hệ thống bằng tay.'
      : `File hệ thống không có môn “${course}” – chỉ có: ${listOf(sections.map((s) => s.title)) || '(không rõ)'}.`
  return { sectionId: null, sim: 0, reason }
}

// ─── So từng dòng ───────────────────────────────────────────────────────────

const fmt = (n) => (n === null ? '' : formatScore(n))

function handValue(h, edits) {
  const key = `h:${h.id}`
  if (key in edits) {
    const raw = edits[key]
    return { value: parseHandDigits(raw), absent: !String(raw).trim(), edited: true, raw }
  }
  return { value: h.score, absent: h.absent, edited: false }
}

function sysValue(s, col, edits) {
  const key = `s:${s.id}:${col}`
  const raw = key in edits ? edits[key] : (s.values[col] ?? '')
  return { value: parseSystemScore(raw), raw: String(raw).trim(), edited: key in edits }
}

const asIssue = (f, who) => ({
  // Lệch giữa các lần đọc của AI chỉ là "cần xem lại", lỗi trên chính biên bản (Số ≠ Chữ) là lỗi thật.
  level: f.source === 'sheet' ? 'error' : 'warn',
  kind: f.source === 'sheet' ? 'sheet' : 'read',
  msg: `${who}: ${f.msg}`,
})

function compareRow(h, s, col, edits, matchedBy) {
  const issues = []
  const hv = h ? handValue(h, edits) : null
  const sv = s && col !== null ? sysValue(s, col, edits) : null

  if (!s) {
    issues.push({ level: 'error', kind: 'missing', msg: 'Có trong biên bản viết tay nhưng KHÔNG có trong bảng điểm hệ thống.' })
  } else if (!h) {
    issues.push({ level: 'error', kind: 'missing', msg: 'Có trong bảng điểm hệ thống nhưng KHÔNG có trong biên bản viết tay.' })
  } else {
    if (matchedBy === 'name') {
      issues.push({ level: 'warn', kind: 'info', msg: `Mã HV khác nhau: viết tay ${h.ma}, hệ thống ${s.ma} (khớp theo họ tên + ngày sinh).` })
    }
    if (!sameName(h.ho_ten, s.ho_ten)) {
      issues.push({ level: 'warn', kind: 'info', msg: `Họ tên khác: viết tay “${h.ho_ten}”, hệ thống “${s.ho_ten}”.` })
    }
    if (h.ngay_sinh && s.ngay_sinh && cleanDate(h.ngay_sinh) !== cleanDate(s.ngay_sinh)) {
      issues.push({ level: 'warn', kind: 'info', msg: `Ngày sinh khác: viết tay ${h.ngay_sinh}, hệ thống ${s.ngay_sinh}.` })
    }
    if (sv) {
      if (hv.value === null && !hv.absent) {
        issues.push({ level: 'error', kind: 'score', msg: 'Không đọc được điểm viết tay – xem ảnh gốc và nhập điểm.' })
      } else if (hv.value === null && sv.value === null) {
        if (sv.raw) issues.push({ level: 'error', kind: 'score', msg: `Ô điểm hệ thống “${sv.raw}” không phải điểm hợp lệ.` })
      } else if (hv.value === null) {
        issues.push({ level: 'error', kind: 'score', msg: `Viết tay không có điểm (vắng/để trống) nhưng hệ thống có ${fmt(sv.value)}.` })
      } else if (sv.value === null) {
        issues.push({
          level: 'error',
          kind: 'score',
          msg: sv.raw ? `Ô điểm hệ thống “${sv.raw}” không phải điểm hợp lệ.` : `Hệ thống chưa có điểm, viết tay ghi ${fmt(hv.value)}.`,
        })
      } else if (!sameScore(hv.value, sv.value)) {
        issues.push({ level: 'error', kind: 'score', msg: `LỆCH ĐIỂM: viết tay ${fmt(hv.value)} ≠ hệ thống ${fmt(sv.value)}.` })
      }
    }
  }

  if (h) for (const f of h.flags) if (!(hv.edited && f.field === 'score')) issues.push(asIssue(f, 'Viết tay'))
  if (s) {
    for (const f of s.flags) {
      const otherColumn = /^v\d+$/.test(f.field || '') && f.field !== `v${col}`
      if (!otherColumn && !(sv?.edited && f.field === `v${col}`)) issues.push(asIssue(f, 'Hệ thống'))
    }
  }

  const status = issues.some((i) => i.level === 'error') ? 'error' : issues.length ? 'warn' : 'ok'
  return {
    id: h?.id || s.id,
    status,
    hand: h,
    sys: s,
    matchedBy,
    handScore: hv?.value ?? null,
    handAbsent: hv?.absent ?? false,
    handEdited: hv?.edited ?? false,
    sysScore: sv?.value ?? null,
    sysRaw: sv?.raw ?? '',
    sysEdited: sv?.edited ?? false,
    issues,
  }
}

/**
 * So một biên bản viết tay với một học phần hệ thống.
 * otherKeys: Mã HV đã có trong biên bản viết tay KHÁC cùng ghép vào học phần này (nhiều phòng) – không báo thiếu.
 */
export function compareSheet(sheet, section, col, edits, otherKeys = new Set()) {
  const issues = []
  const sim = Math.max(courseSimilarity(courseOf(sheet), section.title), courseSimilarity(sheet.header.bai, section.title))
  if (sim < COURSE_MATCH) {
    issues.push({ level: 'error', msg: `KHÁC HỌC PHẦN: viết tay “${courseOf(sheet) || '(không rõ)'}”, hệ thống “${section.title || '(không rõ)'}”.` })
  }
  if (col === null) issues.push({ level: 'error', msg: 'Bảng hệ thống không có cột điểm nào để so.' })
  for (const msg of sheet.issues) issues.push({ level: 'warn', msg: `Viết tay: ${msg}` })
  for (const msg of section.issues) issues.push({ level: 'warn', msg: `Hệ thống: ${msg}` })

  // Ghép dòng: theo Mã HV (bỏ qua nhầm I/1, O/0); còn sót thì theo họ tên + ngày sinh.
  const sysByKey = new Map()
  for (const s of section.rows) if (!sysByKey.has(idKey(s.ma))) sysByKey.set(idKey(s.ma), s)
  const handKeys = new Set(sheet.rows.map((h) => idKey(h.ma)))
  const used = new Set()
  const rows = []
  for (const h of sheet.rows) {
    let s = sysByKey.get(idKey(h.ma))
    let by = 'id'
    if (s && used.has(s.id)) s = null
    if (!s) {
      s = section.rows.find(
        (r) =>
          !used.has(r.id) &&
          !handKeys.has(idKey(r.ma)) &&
          sameName(r.ho_ten, h.ho_ten) &&
          (!r.ngay_sinh || !h.ngay_sinh || cleanDate(r.ngay_sinh) === cleanDate(h.ngay_sinh)),
      )
      by = 'name'
    }
    if (s) used.add(s.id)
    rows.push(compareRow(h, s || null, col, edits, s ? by : null))
  }
  for (const s of section.rows) {
    if (used.has(s.id) || otherKeys.has(idKey(s.ma))) continue
    rows.push(compareRow(null, s, col, edits, null))
  }

  const taken = sheet.rows.filter((r) => !r.absent).length
  const papers = +sheet.footer.so_bai_thi
  if (papers && papers !== taken) issues.push({ level: 'warn', msg: `Biên bản ghi “Số bài thi: ${papers}” nhưng có ${taken} học viên có điểm.` })

  return { issues, rows, sim }
}

// ─── Toàn bộ ────────────────────────────────────────────────────────────────

/**
 * overrides: { [sheetId]: { sectionId?, column? } } – người dùng chọn lại cặp/cột.
 * edits: { "h:<rowId>": "9.8", "s:<rowId>:<col>": "9.3" } – người dùng sửa điểm AI đọc sai.
 */
export function compareAll(sheets, sections, overrides, edits) {
  const assigned = sheets.map((sheet) => {
    const auto = pairSheet(sheet, sections)
    const ov = overrides[sheet.id] || {}
    const sectionId = 'sectionId' in ov ? ov.sectionId : auto.sectionId
    return { sheet, auto, section: sections.find((s) => s.id === sectionId) || null, manual: 'sectionId' in ov }
  })

  const comparisons = assigned.map(({ sheet, auto, section, manual }) => {
    const base = { id: sheet.id, sheet, section, auto, manual }
    if (!section) {
      return {
        ...base,
        column: null,
        status: 'unmatched',
        issues: [{ level: 'error', msg: auto.reason || 'Chưa chọn bảng hệ thống để đối chiếu.' }],
        rows: [],
        counts: { total: sheet.rows.length, ok: 0, error: 0, warn: 0 },
      }
    }
    const ov = overrides[sheet.id] || {}
    const column = ov.column ?? pickColumn(sheet, section)
    const otherKeys = new Set(
      assigned.filter((a) => a.section === section && a.sheet !== sheet).flatMap((a) => a.sheet.rows.map((r) => idKey(r.ma))),
    )
    const { issues, rows } = compareSheet(sheet, section, column, edits, otherKeys)
    const counts = {
      total: rows.length,
      ok: rows.filter((r) => r.status === 'ok').length,
      error: rows.filter((r) => r.status === 'error').length,
      warn: rows.filter((r) => r.status === 'warn').length,
    }
    const status = issues.some((i) => i.level === 'error') || counts.error ? 'error' : issues.length || counts.warn ? 'warn' : 'ok'
    return { ...base, column, status, issues, rows, counts }
  })

  const usedSections = new Set(comparisons.map((c) => c.section?.id).filter(Boolean))
  return { comparisons, unusedSections: sections.filter((s) => !usedSections.has(s.id)) }
}

export const columnName = (section, col) => (section && col !== null ? section.columns[col] : '')
