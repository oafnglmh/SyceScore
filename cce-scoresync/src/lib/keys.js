// Trạng thái API key của AI CCE.
// - Key THẬT chỉ nằm trên server (file .env → GEMINI_FREE_KEYS + GEMINI_API_KEY); trình duyệt gọi qua proxy /ai-api,
//   chỉ biết slot (f1, f2, …, p) + dạng che của key và chọn key bằng header X-CCE-Key.
// - Luôn dùng key FREE trước; key TRẢ PHÍ (slot p) chỉ dùng khi mọi key free đã hết quota hôm nay / không hợp lệ.
// - Cấu hình không bí mật (model, số trang đọc song song) đọc từ public/ai-config.json.
// - Key hết hạn mức NGÀY được ghi nhớ (localStorage) tới khi Google reset quota (0h giờ Thái Bình Dương).

// Tiền tố tên model theo quy ước của Google AI Studio – chỉ dùng nội bộ khi gọi API, không hiển thị.
const MODEL_PREFIX = 'gemini-'
export const DEFAULT_MODEL = '3.5-flash'

/** "models/<prefix>3.5-flash" → "3.5-flash" */
export const modelVersion = (model) => String(model || '').replace(/^models\//, '').replace(MODEL_PREFIX, '')

/** Tên hiển thị trên giao diện. */
export const aiLabel = (model) => `AI CCE ${modelVersion(model)}`.trim()
const STATE_KEY = 'cce_key_state_v1'
const CONFIG_URL = `${import.meta.env.BASE_URL}ai-config.json`
const STATUS_URL = `${import.meta.env.BASE_URL}ai-api/status`

// Quota miễn phí của Google AI Studio reset theo giờ Thái Bình Dương.
const quotaDay = () => new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Los_Angeles' }).format(new Date())

function hashKey(key) {
  let h = 0x811c9dc5
  for (let i = 0; i < key.length; i++) {
    h ^= key.charCodeAt(i)
    h = Math.imul(h, 0x01000193)
  }
  return (h >>> 0).toString(16)
}

function readState() {
  try {
    const s = JSON.parse(localStorage.getItem(STATE_KEY) || 'null')
    if (s && s.day === quotaDay()) return s
  } catch {
    // bỏ qua – bắt đầu trạng thái mới
  }
  return { day: quotaDay(), keys: {} }
}

function writeState(state) {
  try {
    localStorage.setItem(STATE_KEY, JSON.stringify(state))
  } catch {
    // trình duyệt chặn lưu trữ – trạng thái chỉ còn trong phiên
  }
}

// Thứ tự ưu tiên: hết key free dùng được mới sang key trả phí.
const TIERS = ['free', 'paid']

export class KeyPool {
  /** keys: [{ slot, hint, tier }] – slot + dạng che của key trên server, không phải key thật. */
  constructor(keys) {
    const saved = readState()
    this.entries = keys.map(({ slot, hint, tier }, index) => {
      const id = hashKey(`${slot}:${hint}`)
      const prev = saved.keys[id]
      return {
        id,
        index: index + 1,
        slot,
        tier: tier === 'paid' ? 'paid' : 'free',
        masked: hint,
        state: prev?.state || 'ready', // ready | exhausted | dead
        reason: prev?.reason || '',
        coolUntil: 0,
        inFlight: 0,
        success: 0,
      }
    })
    this.cursor = 0
    this.listeners = new Set()
  }

  get size() {
    return this.entries.length
  }

  subscribe(fn) {
    this.listeners.add(fn)
    return () => this.listeners.delete(fn)
  }

  emit() {
    for (const fn of this.listeners) fn()
  }

  persist() {
    const state = { day: quotaDay(), keys: {} }
    for (const e of this.entries) if (e.state !== 'ready') state.keys[e.id] = { state: e.state, reason: e.reason }
    writeState(state)
  }

  /** Tự mở lại các key khi đã sang ngày quota mới. */
  rollDay() {
    if (this.day === quotaDay()) return
    const firstCheck = this.day === undefined
    this.day = quotaDay()
    if (firstCheck) return
    for (const e of this.entries) {
      e.state = 'ready'
      e.reason = ''
    }
    this.persist()
  }

  /**
   * → { entry, waitMs: 0 } | { waitMs } (tất cả đang nghỉ) | null (không còn key dùng được)
   * Còn key free chưa hết quota ngày thì chỉ dùng key free (đang nghỉ/phút thì chờ), không đụng key trả phí.
   */
  acquire() {
    this.rollDay()
    const now = Date.now()
    const tier = TIERS.find((t) => this.entries.some((e) => e.tier === t && e.state === 'ready'))
    if (!tier) return null
    const usable = this.entries.filter((e) => e.tier === tier && e.state === 'ready')
    const idle = usable.filter((e) => e.coolUntil <= now)
    if (!idle.length) return { waitMs: Math.min(...usable.map((e) => e.coolUntil)) - now + 50 }
    // Key ít request đang chạy nhất; hòa thì xoay vòng.
    const minLoad = Math.min(...idle.map((e) => e.inFlight))
    const n = this.entries.length
    for (let i = 0; i < n; i++) {
      const e = this.entries[(this.cursor + i) % n]
      if (e.tier === tier && e.state === 'ready' && e.coolUntil <= now && e.inFlight === minLoad) {
        this.cursor = (this.cursor + i + 1) % n
        e.inFlight++
        this.emit()
        return { entry: e, waitMs: 0 }
      }
    }
    return null
  }

  release(e) {
    e.inFlight = Math.max(0, e.inFlight - 1)
    this.emit()
  }

  markSuccess(e) {
    e.success++
    this.emit()
  }

  cooldown(e, ms) {
    e.coolUntil = Date.now() + ms
    this.emit()
  }

  markExhausted(e, reason) {
    e.state = 'exhausted'
    e.reason = reason
    this.persist()
    this.emit()
  }

  markDead(e, reason) {
    e.state = 'dead'
    e.reason = reason
    this.persist()
    this.emit()
  }

  /** Bỏ mọi đánh dấu, thử lại toàn bộ key. */
  resetAll() {
    for (const e of this.entries) {
      e.state = 'ready'
      e.reason = ''
      e.coolUntil = 0
    }
    this.persist()
    this.emit()
  }

  stats() {
    const now = Date.now()
    const s = { total: this.size, ready: 0, cooling: 0, exhausted: 0, dead: 0, freeTotal: 0, freeUsable: 0, paidTotal: 0 }
    for (const e of this.entries) {
      if (e.tier === 'free') {
        s.freeTotal++
        if (e.state === 'ready') s.freeUsable++
      } else s.paidTotal++
      if (e.state !== 'ready') s[e.state]++
      else if (e.coolUntil > now) s.cooling++
      else s.ready++
    }
    // Đang phải dùng key trả phí: không còn key free nào dùng được hôm nay.
    s.usingPaid = s.paidTotal > 0 && s.freeUsable === 0
    return s
  }
}

async function fetchJson(url, what) {
  let res
  try {
    res = await fetch(`${url}?t=${Date.now()}`, { cache: 'no-store' })
  } catch (e) {
    throw new Error(`Không đọc được ${what}: ${e.message}`)
  }
  const text = await res.text()
  if (!res.ok || /^s*</.test(text)) throw Object.assign(new Error(`Không tìm thấy ${what}.`), { missing: true })
  try {
    return JSON.parse(text)
  } catch (e) {
    throw new Error(`${what} sai cú pháp JSON (${e.message}).`)
  }
}

/** Đọc public/ai-config.json + trạng thái key trên server → { model, concurrency, keys } */
export async function loadKeyConfig() {
  const [cfg, status] = await Promise.all([
    fetchJson(CONFIG_URL, 'file public/ai-config.json').catch((e) => {
      if (e.missing) return {}
      throw e
    }),
    fetchJson(STATUS_URL, 'trạng thái API key của server').catch((e) => {
      if (e.missing) {
        throw new Error('Server không có proxy AI. Chạy app bằng "npm run dev" hoặc "npm run preview" (không mở thẳng thư mục dist).')
      }
      throw e
    }),
  ])
  // Cho phép ghi ngắn "3.5-flash" (khuyến nghị) hoặc tên đầy đủ.
  const version = modelVersion(String(cfg.model || DEFAULT_MODEL).trim())
  return {
    model: `models/${MODEL_PREFIX}${version}`,
    concurrency: Math.max(1, Math.min(16, parseInt(cfg.concurrency, 10) || 4)),
    // Server cũ chỉ có 1 key (không có danh sách) → coi là key trả phí ở slot p.
    keys: Array.isArray(status.keys) && status.keys.length
      ? status.keys
      : status.configured
        ? [{ slot: 'p', hint: status.hint || 'Key server', tier: 'paid' }]
        : [],
  }
}
