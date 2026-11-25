import { modelVersion } from './keys'

// Gọi qua proxy của server (vite.config.js) – server tự gắn API key, trình duyệt không biết key.
const API_ROOT = `${import.meta.env.BASE_URL}ai-api/v1beta`

// ─── Prompt ──────────────────────────────────────────────────────────────────

export const EXTRACTION_PROMPT = `Bạn là chuyên gia số hóa biên bản "KẾT QUẢ THI KẾT THÚC HỌC PHẦN" của Trung tâm Đào tạo Thường xuyên – Đại học Đà Nẵng.
Ảnh đính kèm là MỘT trang scan. Nhiệm vụ: chép lại CHÍNH XÁC TUYỆT ĐỐI dữ liệu trên trang theo JSON schema.

CẤU TRÚC BIÊN BẢN
- Trang đầu của mỗi biên bản có phần đầu in sẵn: "Học kỳ", "Khóa", "Lớp: …", "Học phần thi: …", "Ngành: …", "Địa điểm thi: …", "Tại phòng: …", "Ngày giờ thi: …".
- Một file có nhiều biên bản (mỗi phòng thi một biên bản). Trang tiếp theo của cùng biên bản KHÔNG có phần đầu: chỉ có bảng nối tiếp (TT tiếp tục 26, 27, …) và phần chữ ký.
- Bảng gồm các cột: TT | Mã HV | Họ và | Tên | Ngày sinh | Số tờ giấy thi | Điểm: Số | Điểm: Chữ | Chữ ký | Ghi chú.
- TT, Mã HV, Họ và, Tên, Ngày sinh là chữ IN. Điểm "Số" và Điểm "Chữ" là chữ VIẾT TAY.
- Cuối biên bản (viết tay): "Số học viên dự thi: …", "Số bài thi: …".

QUY TẮC BẮT BUỘC
1. Liệt kê MỌI dòng học viên của bảng, đúng thứ tự từ trên xuống, mỗi dòng in đúng một phần tử trong "rows". Không bỏ sót, không thêm, không lặp, không đoán dòng không có.
2. Chép nguyên văn chữ in, giữ đủ dấu tiếng Việt và kiểu chữ hoa/thường như trên giấy:
   - ma_hv: giữ nguyên chữ hoa, dấu chấm. Phân biệt kỹ số 1 với chữ I, số 0 với chữ O. Mã HV thường = mã lớp + 1 chữ cái (D hoặc S) + 3 chữ số, ví dụ "AV32.1B2CCE1D001".
   - ho_dem: nội dung cột "Họ và"; ten: nội dung cột "Tên".
   - ngay_sinh: dạng dd/mm/yyyy đúng như in.
3. diem_so: chép đúng ký tự viết tay trong cột "Số" (ví dụ "9.3", "8,5", "10", "7.0"). Dấu phẩy và dấu chấm đều là dấu thập phân. Đọc từng chữ số thật cẩn thận; nét viết tay có thể lấn ra ngoài ô.
   Nếu ô trống, có gạch ngang, gạch chéo, hoặc ghi "V", "Vắng", "Vắng thi" thì diem_so = "" và vang = true. Ngược lại vang = false.
4. diem_chu: chép chữ viết tay trong cột "Chữ" (ví dụ "chín ba", "tám tám", "chín chẵn", "sáu", "mười"); bỏ phần chữ ký lấn sang. diem_chu_so: giá trị số mà diem_chu biểu diễn ("chín ba" → 9.3; "chín chẵn" hoặc "chín" → 9; "mười" → 10); null nếu không đọc được.
5. Đọc cột "Số" và cột "Chữ" ĐỘC LẬP với nhau. Nếu hai cột không khớp, TUYỆT ĐỐI KHÔNG sửa cho khớp – trả về đúng như nhìn thấy.
6. row_y: vị trí dọc của tâm dòng trên trang theo thang 0–1000 (0 = mép trên ảnh, 1000 = mép dưới).
7. Phần đầu trang: has_header = true nếu trang có phần đầu biên bản. Chép nguyên văn phần giá trị sau dấu hai chấm (ví dụ lop = "AV32.1B2CCE1", nganh = "Ngôn ngữ Anh", hoc_phan = "Tiếng Pháp 2", ngay_gio_thi = "13h30 ngày 04/04/2026", phong = "C603"). Bỏ qua con dấu đỏ đè lên chữ. Trang không có phần đầu thì để các trường header là chuỗi rỗng.
8. footer: chép số viết tay sau "Số học viên dự thi" và "Số bài thi" nếu có trên trang này (bỏ dấu chấm), ngược lại để chuỗi rỗng.
9. Trang không phải bảng điểm (trang trắng, bìa…) thì rows = [] và has_header = false.`

export function focusPrompt(tts) {
  return `${EXTRACTION_PROMPT}

LƯU Ý ĐẶC BIỆT: Các lần đọc trước cho kết quả KHÁC NHAU ở các dòng TT: ${tts.join(', ')}.
Hãy phóng to và đọc lại thật chậm, từng chữ số một, ô "Số" và ô "Chữ" của những dòng đó. Vẫn trả về toàn bộ trang.`
}

// ─── Response schema (structured output dạng OpenAPI subset) ──────────────────

const STR = { type: 'STRING' }

export const RESPONSE_SCHEMA = {
  type: 'OBJECT',
  properties: {
    has_header: { type: 'BOOLEAN' },
    header: {
      type: 'OBJECT',
      properties: {
        hoc_ky: STR,
        khoa: STR,
        lop: STR,
        nganh: STR,
        hoc_phan: STR,
        ngay_gio_thi: STR,
        dia_diem: STR,
        phong: STR,
      },
      required: ['lop', 'nganh', 'hoc_phan', 'ngay_gio_thi', 'phong'],
      propertyOrdering: ['hoc_ky', 'khoa', 'lop', 'hoc_phan', 'nganh', 'dia_diem', 'phong', 'ngay_gio_thi'],
    },
    rows: {
      type: 'ARRAY',
      items: {
        type: 'OBJECT',
        properties: {
          tt: { type: 'INTEGER' },
          ma_hv: STR,
          ho_dem: STR,
          ten: STR,
          ngay_sinh: STR,
          diem_so: STR,
          diem_chu: STR,
          diem_chu_so: { type: 'NUMBER', nullable: true },
          vang: { type: 'BOOLEAN' },
          row_y: { type: 'INTEGER' },
        },
        required: ['tt', 'ma_hv', 'ho_dem', 'ten', 'ngay_sinh', 'diem_so', 'diem_chu', 'vang'],
        propertyOrdering: ['tt', 'ma_hv', 'ho_dem', 'ten', 'ngay_sinh', 'diem_so', 'diem_chu', 'diem_chu_so', 'vang', 'row_y'],
      },
    },
    footer: {
      type: 'OBJECT',
      properties: {
        so_hoc_vien_du_thi: STR,
        so_bai_thi: STR,
      },
    },
  },
  required: ['has_header', 'header', 'rows', 'footer'],
  propertyOrdering: ['has_header', 'header', 'rows', 'footer'],
}

// ─── Errors ──────────────────────────────────────────────────────────────────

export class AIError extends Error {
  constructor(message, { status, fatal } = {}) {
    super(message)
    this.status = status
    this.fatal = fatal
  }
}

const sleep = (ms, signal) =>
  new Promise((resolve, reject) => {
    if (signal?.aborted) return reject(new DOMException('Aborted', 'AbortError'))
    const t = setTimeout(resolve, ms)
    signal?.addEventListener('abort', () => {
      clearTimeout(t)
      reject(new DOMException('Aborted', 'AbortError'))
    })
  })

function retryDelayMs(body) {
  for (const d of body?.error?.details || []) {
    if (d['@type']?.includes('RetryInfo') && d.retryDelay) {
      const secs = parseFloat(String(d.retryDelay))
      if (!Number.isNaN(secs)) return secs * 1000
    }
  }
  return null
}

/** 429 do hết hạn mức NGÀY (không phải giới hạn mỗi phút). */
function isDailyQuota(body) {
  const text = JSON.stringify(body?.error || {})
  return /PerDay|per day|daily/i.test(text)
}

// Model thế hệ 3.x khuyến nghị giữ temperature mặc định; model cũ hơn dùng 0 để ổn định.
const isV3Plus = (model) => parseFloat(modelVersion(model)) >= 3

// ─── Client ──────────────────────────────────────────────────────────────────

/**
 * pool: KeyPool (lib/keys.js) – dùng chung cho cả phiên để biết key nào đã hết quota.
 * generate({ prompt, schema, … }): schema mặc định là biên bản thi (Số hóa điểm); trang Dò điểm truyền schema riêng – xem lib/prompts.js.
 */
export function createClient({ pool, model }) {
  if (!pool || !pool.size) throw new AIError('Server chưa cấu hình API key (GEMINI_API_KEY trong file .env).', { fatal: true })
  if (!model) throw new AIError('Chưa khai báo model trong file public/ai-config.json.', { fatal: true })
  let useMediaResolution = true

  async function generate({ prompt, schema = RESPONSE_SCHEMA, imageBase64, mimeType, signal, onWait }) {
    let lastErr
    let transient = 0
    // Chỉ giới hạn lỗi mạng/máy chủ liên tiếp; 429/phút thì chờ rồi thử lại.
    while (transient < 6) {
      const pick = pool.acquire()
      if (!pick) {
        throw new AIError(
          'API key của server đã hết hạn mức hôm nay hoặc không hợp lệ. Sửa GEMINI_API_KEY trong file .env rồi bấm “Kiểm tra lại”.',
          { fatal: true },
        )
      }
      if (pick.waitMs > 0) {
        onWait?.(pick.waitMs)
        await sleep(pick.waitMs, signal)
        continue
      }
      const entry = pick.entry

      const generationConfig = { responseMimeType: 'application/json', responseSchema: schema }
      if (!isV3Plus(model)) generationConfig.temperature = 0
      if (useMediaResolution) generationConfig.mediaResolution = 'MEDIA_RESOLUTION_HIGH'

      let res
      try {
        res = await fetch(`${API_ROOT}/${model}:generateContent`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            contents: [{ role: 'user', parts: [{ inline_data: { mime_type: mimeType, data: imageBase64 } }, { text: prompt }] }],
            generationConfig,
          }),
          signal,
        })
      } catch (e) {
        if (e.name === 'AbortError') throw e
        lastErr = new AIError(`Lỗi mạng: ${e.message}`)
        transient++
        await sleep(2000 * transient, signal)
        continue
      } finally {
        pool.release(entry)
      }

      const json = await res.json().catch(() => null)
      const message = json?.error?.message || ''

      if (res.ok) {
        const cand = json?.candidates?.[0]
        const text = cand?.content?.parts?.map((p) => (p.thought ? '' : p.text || '')).join('') || ''
        pool.markSuccess(entry)
        if (!text) {
          lastErr = new AIError(`AI CCE không trả về nội dung (${cand?.finishReason || 'không rõ lý do'}).`)
          transient++
          continue
        }
        try {
          return JSON.parse(text.replace(/^```(?:json)?\s*|\s*```$/g, ''))
        } catch {
          lastErr = new AIError('AI CCE trả về dữ liệu không hợp lệ.')
          transient++
          continue
        }
      }

      const status = res.status
      if (status === 400 && useMediaResolution && /media_?resolution/i.test(message)) {
        useMediaResolution = false
        continue
      }
      if (status === 404) {
        throw new AIError(`Không tìm thấy phiên bản “${modelVersion(model)}”. Kiểm tra trường "model" trong public/ai-config.json.`, {
          status,
          fatal: true,
        })
      }
      if ((status === 400 && /api key|API_KEY/i.test(message)) || status === 401 || status === 403) {
        pool.markDead(entry, status === 403 ? 'Không có quyền / key bị khóa (403)' : 'Key không hợp lệ')
        lastErr = new AIError(message || `Key bị từ chối (${status})`, { status })
        continue
      }
      if (status === 429) {
        if (isDailyQuota(json)) pool.markExhausted(entry, 'Hết hạn mức trong ngày')
        else pool.cooldown(entry, retryDelayMs(json) ?? 30000)
        lastErr = new AIError('Hết hạn mức (429).', { status })
        continue
      }
      if (status >= 500 || status === 408) {
        lastErr = new AIError(`Máy chủ AI CCE quá tải (${status}).`, { status })
        transient++
        await sleep(Math.min(30000, 2000 * 2 ** transient), signal)
        continue
      }
      throw new AIError(message || `Lỗi AI CCE (${status})`, { status, fatal: status === 400 })
    }
    throw lastErr || new AIError('AI CCE thất bại sau nhiều lần thử.')
  }

  return { generate }
}

export function blobToBase64(blob) {
  return new Promise((resolve, reject) => {
    const r = new FileReader()
    r.onload = () => resolve(String(r.result).split(',')[1])
    r.onerror = () => reject(r.error)
    r.readAsDataURL(blob)
  })
}
