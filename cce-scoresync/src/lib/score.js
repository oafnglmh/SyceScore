// Chuẩn hóa và đối chiếu điểm viết tay: cột "Số" và cột "Chữ".

/** "9,3" | "9.3" | " 9 . 3 " | "10" → number (hoặc null nếu không hợp lệ). */
export function parseDigits(raw) {
  if (raw === null || raw === undefined) return null
  const s = String(raw).trim().replace(/\s+/g, '').replace(',', '.')
  if (!s) return null
  if (!/^\d{1,2}(\.\d{1,2})?$/.test(s)) return null
  const n = Number(s)
  return Number.isFinite(n) ? n : null
}

export const isValidScore = (n) => typeof n === 'number' && n >= 0 && n <= 10

const strip = (s) =>
  s
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/đ/g, 'd')

const DIGIT_WORDS = {
  khong: 0,
  mot: 1,
  mott: 1,
  hai: 2,
  ba: 3,
  bon: 4,
  tu: 4,
  nam: 5,
  lam: 5,
  sau: 6,
  bay: 7,
  tam: 8,
  chin: 9,
}

/** "chín ba" → 9.3, "chín chẵn" → 9, "mười" → 10, "tám phẩy năm" → 8.5, "bảy rưỡi" → 7.5 */
export function parseWords(raw) {
  if (!raw) return null
  const tokens = strip(String(raw))
    .replace(/[^a-z\s]/g, ' ')
    .split(/\s+/)
    .filter(Boolean)
  if (!tokens.length) return null

  let i = 0
  let intPart
  if (tokens[0] === 'muoi') {
    intPart = 10
    i = 1
  } else if (tokens[0] in DIGIT_WORDS) {
    intPart = DIGIT_WORDS[tokens[0]]
    i = 1
  } else {
    return null
  }

  let decimals = ''
  for (; i < tokens.length; i++) {
    const t = tokens[i]
    if (t === 'phay' || t === 'cham' || t === 'diem') continue
    if (t === 'chan' || t === 'tron') continue
    if (t === 'ruoi') {
      decimals += '5'
      continue
    }
    if (t === 'linh' || t === 'le') {
      decimals += '0'
      continue
    }
    if (t in DIGIT_WORDS) {
      decimals += String(DIGIT_WORDS[t])
      continue
    }
    // Từ không nhận diện được (thường là chữ ký lấn sang) → dừng.
    break
  }
  if (decimals.length > 2) return null
  const n = Number(`${intPart}${decimals ? '.' + decimals : ''}`)
  return Number.isFinite(n) ? n : null
}

export const sameScore = (a, b) => a !== null && b !== null && Math.abs(a - b) < 0.001

export function formatScore(n) {
  if (n === null || n === undefined || n === '') return ''
  const num = Number(n)
  if (!Number.isFinite(num)) return String(n)
  return Number.isInteger(num * 10) ? num.toFixed(1) : String(num)
}
