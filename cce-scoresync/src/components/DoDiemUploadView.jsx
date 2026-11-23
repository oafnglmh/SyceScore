import {
  ArrowRight,
  CircleAlert,
  FileSearch,
  FileSpreadsheet,
  FileText,
  GitCompareArrows,
  KeyRound,
  PenLine,
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
  { icon: Upload, title: 'Tải 2 bộ file', desc: 'Bảng điểm in từ hệ thống và biên bản chấm có điểm viết tay (PDF scan hoặc ảnh).' },
  { icon: ScanSearch, title: 'AI CCE đọc chéo', desc: 'Mỗi trang đọc 2 lần độc lập, lệch thì đọc thêm (tối đa 5 lần) và lấy đa số.' },
  { icon: GitCompareArrows, title: 'Ghép & dò điểm', desc: 'Ghép theo MÔN THI, so từng học viên theo Mã HV, tự chọn cột điểm (Ktra1…).' },
  { icon: FileSpreadsheet, title: 'Báo dòng sai', desc: 'Lệch điểm, thiếu học viên, Số ≠ Chữ… tô đỏ kèm ảnh gốc. Xuất Excel danh sách lỗi.' },
]

function DropZone({ icon: Icon, title, hint, files, setFiles, tone }) {
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

  const accent = tone === 'gold' ? 'bg-gold-400 text-cce-950 shadow-gold-500/30' : 'bg-cce-700 text-gold-300 shadow-cce-700/30'

  return (
    <div className="flex flex-col">
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
        className={`group relative cursor-pointer rounded-2xl border-2 border-dashed px-5 py-8 text-center transition ${
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
        <div className={`mx-auto mb-3 flex size-14 items-center justify-center rounded-2xl shadow-lg transition group-hover:-translate-y-1 ${accent}`}>
          <Icon className="size-6" />
        </div>
        <div className="text-[15px] font-semibold text-cce-900">{title}</div>
        <div className="mt-1 text-[13px] text-slate-500">{hint}</div>
        <div className="mt-2 text-xs text-slate-400">
          Kéo thả hoặc <span className="font-medium text-cce-600 underline underline-offset-2">chọn từ máy</span> · PDF, JPG, PNG
        </div>
      </div>

      {files.length > 0 && (
        <ul className="mt-3 space-y-2">
          {files.map((f, i) => (
            <li key={f.name + f.size} className="flex items-center gap-3 rounded-xl bg-slate-50 px-3 py-2 ring-1 ring-slate-200">
              <FileText className="size-4 shrink-0 text-cce-600" />
              <div className="min-w-0 flex-1">
                <div className="truncate text-sm font-medium text-slate-800">{f.name}</div>
                <div className="text-xs text-slate-500">{fmtSize(f.size)}</div>
              </div>
              <button
                onClick={() => setFiles(files.filter((_, j) => j !== i))}
                className="rounded-lg p-1.5 text-slate-400 hover:bg-rose-50 hover:text-rose-600"
                title="Bỏ file"
              >
                <Trash2 className="size-4" />
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}

export default function UploadView({ ready, keyProblem, onOpenKeys, onStart }) {
  const [systemFiles, setSystemFiles] = useState([])
  const [handFiles, setHandFiles] = useState([])
  const canStart = systemFiles.length > 0 && handFiles.length > 0 && ready

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
            Dò điểm <span className="text-gold-400">hệ thống</span> với biên bản <span className="text-gold-400">viết tay</span>
          </h1>
          <p className="mt-4 max-w-xl text-[15px] leading-relaxed text-cce-100">
            Tải bảng điểm in từ hệ thống và biên bản chấm viết tay. AI CCE đọc cả hai, ghép đúng môn thi, so từng học viên
            và chỉ ra chính xác dòng nào sai.
          </p>
          <div className="mt-6 flex flex-wrap gap-2 text-xs font-medium">
            {['Ghép theo môn thi', 'So theo Mã HV', 'Đối chiếu Số ↔ Chữ', 'Báo dòng sai + Excel'].map((t) => (
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

          <div className="grid gap-5 md:grid-cols-2">
            <DropZone
              icon={FileSearch}
              title="1 · Bảng điểm hệ thống"
              hint="PDF in từ phần mềm (có thể nhiều học phần: Ngữ pháp, Ngữ âm, Pháp luật…)"
              files={systemFiles}
              setFiles={setSystemFiles}
            />
            <DropZone
              icon={PenLine}
              title="2 · Biên bản chấm viết tay"
              hint="“Kết quả chấm bài kiểm tra…” có điểm viết tay – một hoặc nhiều biên bản"
              files={handFiles}
              setFiles={setHandFiles}
              tone="gold"
            />
          </div>

          <div className="mt-6 flex flex-wrap items-center justify-between gap-3">
            <p className="text-xs text-slate-500">
              {!systemFiles.length || !handFiles.length
                ? 'Cần chọn file ở CẢ HAI ô'
                : `${systemFiles.length} file hệ thống · ${handFiles.length} file viết tay`}{' '}
              · ảnh trang scan chỉ gửi tới AI CCE để đọc
            </p>
            <Button variant="gold" size="lg" icon={ArrowRight} disabled={!canStart} onClick={() => onStart(systemFiles, handFiles)}>
              Bắt đầu dò điểm
            </Button>
          </div>
        </div>

        {/* ── Steps ── */}
        <div className="mb-12 mt-10 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          {STEPS.map((s, i) => (
            <div
              key={s.title}
              className="relative rounded-2xl bg-white p-5 ring-1 ring-slate-200 transition hover:-translate-y-0.5 hover:shadow-lg hover:shadow-cce-900/5"
            >
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
