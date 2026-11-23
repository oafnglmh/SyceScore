import { ArrowRight, Check, CircleAlert, FileText, KeyRound, LoaderCircle, RotateCcw, Square } from 'lucide-react'
import { aiLabel } from '../lib/keys'
import { Badge, Button } from './ui'

const KIND_LABEL = { system: 'Bảng điểm hệ thống', hand: 'Biên bản viết tay' }

const TILE = {
  queued: 'bg-slate-50 text-slate-400 ring-slate-200',
  reading: 'bg-cce-50 text-cce-700 ring-cce-300',
  done: 'bg-emerald-50 text-emerald-700 ring-emerald-200',
  error: 'bg-rose-50 text-rose-700 ring-rose-300',
}

export default function ProcessingView({
  job,
  stats,
  onCancel,
  onRetry,
  onContinue,
  title = 'AI CCE đang đọc chéo biên bản…',
  continueLabel = 'Soát & xuất Excel',
}) {
  const pages = job.files.flatMap((f) => f.pages)
  const done = pages.filter((p) => p.status === 'done').length
  const failed = pages.filter((p) => p.status === 'error').length
  const rendering = job.files.some((f) => f.status === 'rendering')
  const total = Math.max(pages.length, job.files.reduce((a, f) => a + (f.pageTotal || 0), 0))
  const finished = !rendering && !job.running
  const active = pages.filter((p) => p.status === 'reading')
  const pct = total ? Math.round((done / total) * 100) : 0
  const reads = pages.reduce((a, p) => a + (p.passes || 0), 0)
  const extra = pages.filter((p) => p.status === 'done' && p.passes > 2).length

  return (
    <div className="mx-auto max-w-5xl px-4 py-8">
      <div className="relative overflow-hidden rounded-3xl bg-gradient-to-br from-cce-900 via-cce-700 to-cce-600 p-6 text-white shadow-xl shadow-cce-900/15 sm:p-8">
        <div className="cce-arcs absolute inset-0" />
        <img src="/cce-emblem-white.png" alt="" className="absolute -right-4 -top-6 h-48 w-auto opacity-10" />
        <div className="relative flex flex-wrap items-center gap-6">
          {/* Vòng tiến độ */}
          <div className="relative size-24 shrink-0">
            <svg viewBox="0 0 36 36" className="size-24 -rotate-90">
              <circle cx="18" cy="18" r="15.5" fill="none" stroke="rgb(255 255 255 / 0.15)" strokeWidth="3" />
              <circle
                cx="18"
                cy="18"
                r="15.5"
                fill="none"
                stroke={failed ? '#fb7185' : '#f0cc46'}
                strokeWidth="3"
                strokeLinecap="round"
                strokeDasharray={`${(pct / 100) * 97.4} 97.4`}
                className="transition-all duration-700"
              />
            </svg>
            <div className="absolute inset-0 flex flex-col items-center justify-center">
              <span className="text-xl font-bold">{pct}%</span>
              <span className="text-[10px] text-cce-100">
                {done}/{total || '…'} trang
              </span>
            </div>
          </div>

          <div className="min-w-0 flex-1">
            <h2 className="text-xl font-semibold">
              {finished ? (failed ? 'Đã đọc xong – còn trang lỗi' : 'Đã đọc xong') : title}
            </h2>
            <div className="mt-2 flex flex-wrap gap-2 text-xs">
              <span className="rounded-full bg-white/10 px-2.5 py-1 ring-1 ring-white/15">{aiLabel(job.model)}</span>
              <span className="rounded-full bg-white/10 px-2.5 py-1 ring-1 ring-white/15">{reads} lượt đọc</span>
              {extra > 0 && (
                <span className="rounded-full bg-gold-400/20 px-2.5 py-1 text-gold-200 ring-1 ring-gold-300/30">
                  {extra} trang đã đọc thêm để phân xử
                </span>
              )}
              {stats && (
                <span className="inline-flex items-center gap-1 rounded-full bg-white/10 px-2.5 py-1 ring-1 ring-white/15">
                  <KeyRound className="size-3 text-gold-300" /> {stats.ready + stats.cooling}/{stats.total} key dùng được
                </span>
              )}
            </div>
          </div>

          <div className="flex gap-2">
            {!finished && (
              <Button icon={Square} onClick={onCancel}>
                Dừng
              </Button>
            )}
            {finished && failed > 0 && (
              <Button icon={RotateCcw} onClick={onRetry}>
                Đọc lại {failed} trang lỗi
              </Button>
            )}
            {finished && done > 0 && (
              <Button variant="gold" icon={ArrowRight} onClick={onContinue}>
                {continueLabel}
              </Button>
            )}
          </div>
        </div>

        {active.length > 0 && (
          <div className="relative mt-6 space-y-1.5 rounded-2xl bg-cce-950/30 p-3.5 ring-1 ring-white/10">
            {active.map((p) => (
              <div key={p.key} className="flex items-center gap-2 text-[13px]">
                <LoaderCircle className="size-3.5 shrink-0 animate-spin text-gold-300" />
                <span className="font-medium">
                  {p.fileName} · trang {p.pageNumber}
                </span>
                <span className="truncate text-cce-200">— {p.label || 'Đang gửi tới AI CCE'}</span>
              </div>
            ))}
          </div>
        )}
      </div>

      {job.fatal && (
        <div className="mt-5 flex gap-3 rounded-2xl bg-rose-50 p-4 text-sm text-rose-800 ring-1 ring-rose-200">
          <CircleAlert className="mt-0.5 size-4 shrink-0" />
          <div>
            <div className="font-semibold">Đã dừng</div>
            <div className="mt-0.5">{job.fatal}</div>
          </div>
        </div>
      )}

      {job.waitingMs > 0 && !finished && (
        <div className="mt-5 rounded-2xl bg-gold-100 p-3.5 text-sm text-cce-950 ring-1 ring-gold-300">
          Tất cả key đang chạm giới hạn mỗi phút – tự chờ {Math.ceil(job.waitingMs / 1000)} giây rồi tiếp tục.
        </div>
      )}

      <div className="mt-5 space-y-4">
        {job.files.map((f) => (
          <div key={f.id} className="rounded-2xl bg-white p-5 ring-1 ring-slate-200">
            <div className="mb-3 flex flex-wrap items-center gap-2">
              <FileText className="size-4 text-cce-500" />
              {f.kind && <Badge tone={f.kind === 'hand' ? 'amber' : 'cce'}>{KIND_LABEL[f.kind]}</Badge>}
              <span className="text-sm font-semibold text-cce-900">{f.name}</span>
              {f.status === 'rendering' && (
                <Badge tone="cce">
                  Đang tách trang {f.pages.length}/{f.pageTotal || '?'}
                </Badge>
              )}
              {f.status === 'error' && <Badge tone="red">{f.error}</Badge>}
            </div>
            <div className="flex flex-wrap gap-1.5">
              {f.pages.map((p) => (
                <div
                  key={p.key}
                  title={p.error || p.label || ''}
                  className={`relative flex size-10 items-center justify-center overflow-hidden rounded-xl text-xs font-semibold ring-1 ring-inset ${TILE[p.status]}`}
                >
                  {p.status === 'reading' && <div className="shimmer absolute inset-0" />}
                  {p.status === 'done' ? <Check className="size-4" /> : <span className="relative">{p.pageNumber}</span>}
                  {p.passes > 0 && (
                    <span
                      className={`absolute bottom-0.5 right-1 text-[9px] font-bold ${p.passes > 2 ? 'text-gold-600' : 'opacity-60'}`}
                      title={`${p.passes} lần đọc`}
                    >
                      ×{p.passes}
                    </span>
                  )}
                </div>
              ))}
            </div>
            {f.pages.some((p) => p.status === 'error') && (
              <ul className="mt-3 space-y-1 text-xs text-rose-700">
                {f.pages
                  .filter((p) => p.status === 'error')
                  .map((p) => (
                    <li key={p.key}>
                      Trang {p.pageNumber}: {p.error}
                    </li>
                  ))}
              </ul>
            )}
          </div>
        ))}
      </div>
    </div>
  )
}
