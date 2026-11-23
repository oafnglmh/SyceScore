// Chuẩn hóa chữ, mã, tên học phần để so khớp giữa bảng điểm hệ thống và biên bản viết tay.

export const clean = (s) => String(s ?? '').replace(/\s+/g, ' ').trim()
export const cleanId = (s) => String(s ?? '').replace(/\s+/g, '').toUpperCase()

export function cleanDate(s) {
  const t = clean(s).replace(/[.\-\s]/g, '/')
  const m = t.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/)
  if (!m) return clean(s)
  return `${m[1].padStart(2, '0')}/${m[2].padStart(2, '0')}/${m[3]}`
}

/** Bỏ dấu, chữ thường, chỉ giữ chữ + số: "NGỮ PHÁP Tiếng Anh căn bản 2" → "ngu phap tieng anh can ban 2". */
export function fold(s) {
  return String(s ?? '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/đ/g, 'd')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim()
}

const CONFUSABLE = { I: '1', L: '1', O: '0', Q: '0' }
export const deconfuse = (s) => String(s ?? '').replace(/[ILOQ]/g, (c) => CONFUSABLE[c])

/** Khóa so khớp Mã HV: bỏ khoảng trắng, chữ hoa, gộp các ký tự dễ nhầm (I/1, O/0). */
export const idKey = (id) => deconfuse(cleanId(id))

/** "AV33.1B2TGID004" → "AV33.1B2TGI" (mã lớp = Mã HV bỏ 1 chữ cái + 3 chữ số cuối). */
export function classFromId(id) {
  const s = cleanId(id)
  const m = s.match(/^(.+?)[A-Z]\d{3}$/)
  return m ? m[1] : ''
}

/** Giá trị xuất hiện nhiều nhất (bỏ chuỗi rỗng). */
export function majority(values) {
  const counts = new Map()
  for (const v of values) if (v) counts.set(v, (counts.get(v) || 0) + 1)
  let best = ''
  let n = 0
  for (const [v, c] of counts) if (c > n) [best, n] = [v, c]
  return best
}

/** Mã lớp suy ra từ đa số Mã HV của danh sách. */
export const classFromRows = (rows, field = 'ma') => majority(rows.map((r) => classFromId(r[field])))

export const sameClass = (a, b) => !!a && !!b && deconfuse(cleanId(a)) === deconfuse(cleanId(b))

/** Tên học phần dùng để so: bỏ phần "- Bài KT…" phía sau. */
export const courseKey = (s) =>
  fold(String(s ?? '').split(/\s[-–—]\s|\s*[-–—]\s*bài\b/i)[0])
    .replace(/^(mon thi|hoc phan thi|hoc phan|mon)\s+/, '')
    .trim()

function bigrams(s) {
  const t = s.replace(/\s+/g, '')
  const out = new Map()
  for (let i = 0; i < t.length - 1; i++) {
    const g = t.slice(i, i + 2)
    out.set(g, (out.get(g) || 0) + 1)
  }
  return out
}

/**
 * Độ giống tên học phần 0–1 (Dice trên cặp ký tự, không dấu).
 * Khác số hiệu (… căn bản 1 vs … căn bản 2) thì coi như khác học phần.
 */
export function courseSimilarity(a, b) {
  const x = courseKey(a)
  const y = courseKey(b)
  if (!x || !y) return 0
  if (x === y) return 1
  const nums = (s) => (s.match(/\d+/g) || []).join(',')
  const ga = bigrams(x)
  const gb = bigrams(y)
  let inter = 0
  let total = 0
  for (const [g, c] of ga) {
    inter += Math.min(c, gb.get(g) || 0)
    total += c
  }
  for (const c of gb.values()) total += c
  const dice = total ? (2 * inter) / total : 0
  return nums(x) === nums(y) ? dice : dice * 0.5
}

export const sameName = (a, b) => fold(a) === fold(b)
