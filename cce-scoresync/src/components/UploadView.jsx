import {
  ArrowRight,
  CircleAlert,
  FileCheck2,
  FileSpreadsheet,
  FileText,
  KeyRound,
  ScanSearch,
  ShieldCheck,
  Trash2,
  Upload,
} from 'lucide-react'
import { useRef, useState } from 'react'
import { Button } from './ui'

const ACCEPT = '.pdf,.jpg,.jpeg,.png,application/pdf,image/jpeg,image/png'
const isAccepted = (f) => /\.(pdf|jpe?g|png)$/i.test(f.name)
const fmtSize = (b) => (b > 1024 * 1024 ? `${(b / 1024 / 1024).toFixed(1)} MB` : `${Math.ceil(b / 1024)} KB`)

const STEPS = [
  { icon: Upload, title: 'Tải biên bản scan', desc: 'PDF nhiều trang hoặc ảnh. Mỗi phòng thi được tách thành một biên bản.' },
  { icon: ScanSearch, title: 'AI CCE đọc chéo', desc: 'Mỗi trang đọc 2 lần độc lập, lệch thì đọc thêm (tối đa 5 lần) và lấy đa số.' },
  { icon: FileCheck2, title: 'Đối chiếu & soát', desc: 'Số ↔ Chữ, TT, sĩ số, Mã HV. Chỗ chưa chắc được tô màu kèm ảnh gốc.' },
  { icon: FileSpreadsheet, title: 'Xuất Excel', desc: 'Đúng mẫu hệ thống: mỗi Lớp + Ngành một file, nhiều lớp nén ZIP.' },
]

export default function UploadView({ ready, keyProblem, onOpenKeys, onStart }) {
  const [files, setFiles] = useState([])
  const [drag, setDrag] = useState(false)
  const inputRef = useRef(null)

  function add(list) {
    const incoming = [...list].filter(isAccepted)
    setFiles((prev) => {
      const seen = new Set(prev.map((f) => f.name + f.size))
      return [...prev, ...incoming.filter((f) => !seen.has(f.name + f.size))].sort((a, b) =>
        a.name.localeCompare(b.name, 'vi', { numeric: true }),
      )
    })
  }

  return (
    <div>
      {/* ── Hero ── */}
      <section className="relative overflow-hidden bg-gradient-to-br from-cce-900 via-cce-700 to-cce-600 pb-28 pt-12 text-white">
        <div className="cce-arcs absolute inset-0" />
        <div className="absolute -right-10 top-1/2 hidden -translate-y-1/2 md:block">
          <img src="/cce-logo-white.png" alt="" className="h-[340px] w-auto animate-float opacity-[0.13]" />
        </div>
        <div className="relative mx-auto max-w-5xl px-4">
          <div className="inline-flex items-center gap-2 rounded-full bg-white/10 px-3 py-1 text-xs font-medium text-gold-200 ring-1 ring-white/15">
            <ShieldCheck className="size-3.5" /> Đại học Đà Nẵng · Trung tâm Đào tạo Thường xuyên
          </div>
          <h1 className="mt-5 max-w-2xl text-3xl font-bold leading-tight tracking-tight sm:text-[42px]">
            Số hóa bảng điểm <span className="text-gold-400">viết tay</span> thành Excel trong vài phút
          </h1>
          <p className="mt-4 max-w-xl text-[15px] leading-relaxed text-cce-100">
            Tải lên biên bản “Kết quả thi kết thúc học phần” đã scan. AI CCE đọc chéo từng trang, đối chiếu điểm cột Số với cột
            Chữ, để bạn chỉ cần soát những ô được đánh dấu.
          </p>
          <div className="mt-6 flex flex-wrap gap-2 text-xs font-medium">
            {['Đọc chéo 2–5 lần', 'Đối chiếu Số ↔ Chữ', 'Kiểm tra sĩ số & TT', 'Excel đúng mẫu'].map((t) => (
              <span key={t} className="rounded-full bg-white/10 px-3 py-1 ring-1 ring-white/15">
                {t}
              </span>
            ))}
          </div>
        </div>
      </section>

      {/* ── Upload card ── */}
      <div className="relative mx-auto -mt-20 max-w-5xl px-4">
        <div className="rounded-3xl bg-white p-5 shadow-xl shadow-cce-900/10 ring-1 ring-slate-200 sm:p-7">
          {keyProblem && (
            <div className="mb-5 flex flex-wrap items-center gap-3 rounded-2xl bg-gold-100 p-4 text-[13px] text-cce-950 ring-1 ring-gold-300">
              <CircleAlert className="size-5 shrink-0 text-gold-600" />
              <div className="min-w-0 flex-1">
                <div className="font-semibold">Chưa sẵn sàng API key</div>
                <div className="mt-0.5 text-cce-900/80">{keyProblem}</div>
              </div>
              <Button size="sm" variant="primary" icon={KeyRound} onClick={onOpenKeys}>
                Xem hướng dẫn
              </Button>
            </div>
          )}

          <div
            onDragOver={(e) => {
              e.preventDefault()
              setDrag(true)
            }}
            onDragLeave={() => setDrag(false)}
            onDrop={(e) => {
              e.preventDefault()
              setDrag(false)
              add(e.dataTransfer.files)
            }}
            onClick={() => inputRef.current?.click()}
            className={`group relative cursor-pointer overflow-hidden rounded-2xl border-2 border-dashed px-6 py-10 text-center transition ${
              drag ? 'border-gold-400 bg-gold-100/60' : 'border-cce-200 bg-cce-50/50 hover:border-cce-400 hover:bg-cce-50'
            }`}
          >
            <input
              ref={inputRef}
              type="file"
              multiple
              accept={ACCEPT}
              className="hidden"
              onChange={(e) => {
                add(e.target.files)
                e.target.value = ''
              }}
            />
            <div className="mx-auto mb-4 flex size-16 items-center justify-center rounded-2xl bg-cce-700 text-gold-300 shadow-lg shadow-cce-700/30 transition group-hover:-translate-y-1">
              <Upload className="size-7" />
            </div>
            <div className="text-base font-semibold text-cce-900">Kéo thả file scan vào đây</div>
            <div className="mt-1 text-sm text-slate-500">
              hoặc <span className="font-medium text-cce-600 underline underline-offset-2">chọn từ máy</span> · PDF, JPG, PNG · nhiều file
              cùng lúc
            </div>
          </div>

          {files.length > 0 && (
            <ul className="mt-5 grid gap-2 sm:grid-cols-2">
              {files.map((f, i) => (
                <li key={f.name + f.size} className="flex items-center gap-3 rounded-xl bg-slate-50 px-3 py-2.5 ring-1 ring-slate-200">
                  <div className="flex size-9 shrink-0 items-center justify-center rounded-lg bg-white text-cce-600 ring-1 ring-slate-200">
                    <FileText className="size-4" />
                  </div>
                  <div className="min-w-0 flex-1">
                    <div className="truncate text-sm font-medium text-slate-800">{f.name}</div>
                    <div className="text-xs text-slate-500">{fmtSize(f.size)}</div>
                  </div>
                  <button
                    onClick={() => setFiles(files.filter((_, j) => j !== i))}
                    className="rounded-lg p-2 text-slate-400 hover:bg-rose-50 hover:text-rose-600"
                    title="Bỏ file"
                  >
                    <Trash2 className="size-4" />
                  </button>
                </li>
              ))}
            </ul>
          )}

          <div className="mt-6 flex flex-wrap items-center justify-between gap-3">
            <p className="text-xs text-slate-500">
              {files.length ? `${files.length} file đã chọn` : 'Chưa chọn file nào'} · ảnh trang scan chỉ gửi tới AI CCE để đọc
            </p>
            <Button variant="gold" size="lg" icon={ArrowRight} disabled={!files.length || !ready} onClick={() => onStart(files)}>
              Bắt đầu đọc điểm
            </Button>
          </div>
        </div>

        {/* ── Steps ── */}
        <div className="mt-10 mb-12 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          {STEPS.map((s, i) => (
            <div key={s.title} className="relative rounded-2xl bg-white p-5 ring-1 ring-slate-200 transition hover:-translate-y-0.5 hover:shadow-lg hover:shadow-cce-900/5">
              <div className="flex items-center gap-3">
                <div className="flex size-10 items-center justify-center rounded-xl bg-cce-50 text-cce-700 ring-1 ring-cce-100">
                  <s.icon className="size-5" />
                </div>
                <span className="text-3xl font-extrabold text-cce-100">0{i + 1}</span>
              </div>
              <div className="mt-3 text-sm font-semibold text-cce-900">{s.title}</div>
              <div className="mt-1 text-xs leading-relaxed text-slate-500">{s.desc}</div>
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}
