// Danh sách API key phía SERVER (dùng chung cho vite.config.js và deploy/make-package.mjs).
// - GEMINI_FREE_KEYS: các key free, cách nhau bởi dấu phẩy / khoảng trắng → slot f1, f2, …
// - GEMINI_API_KEY:   key trả phí → slot p, chỉ dùng khi mọi key free đã hết hạn mức / hỏng.
// Trình duyệt chỉ biết slot + dạng che của key, gửi header X-CCE-Key: <slot> để chọn key.

export const KEY_HEADER = 'x-cce-key'

export const maskKey = (k) => (k.length > 12 ? `${k.slice(0, 4)}…${k.slice(-4)}` : '••••')

const splitKeys = (s) =>
  String(s || '')
    .split(/[\s,;]+/)
    .map((k) => k.trim())
    .filter(Boolean)

/** env → [{ slot, key, hint, tier }] – free trước, trả phí sau cùng. */
export function loadServerKeys(env) {
  const paid = String(env.GEMINI_API_KEY || '').trim()
  const free = [...new Set(splitKeys(env.GEMINI_FREE_KEYS))].filter((k) => k !== paid)
  const slots = free.map((key, i) => ({ slot: `f${i + 1}`, key, hint: maskKey(key), tier: 'free' }))
  if (paid) slots.push({ slot: 'p', key: paid, hint: maskKey(paid), tier: 'paid' })
  return slots
}

/** Nội dung /ai-api/status (không chứa key thật). */
export function statusJson(slots) {
  const paid = slots.find((s) => s.tier === 'paid')
  return JSON.stringify({
    configured: slots.length > 0,
    hint: paid?.hint || slots[0]?.hint || '',
    keys: slots.map(({ slot, hint, tier }) => ({ slot, hint, tier })),
  })
}
