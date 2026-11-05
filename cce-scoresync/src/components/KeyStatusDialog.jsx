import { CircleAlert, FileJson, RefreshCw, RotateCcw } from 'lucide-react'
import { useEffect, useReducer, useState } from 'react'
import { aiLabel } from '../lib/keys'
import { Button, Dialog } from './ui'

const STATE_UI = {
  ready: { dot: 'bg-emerald-500', label: 'Sẵn sàng', tone: 'text-emerald-700' },
  cooling: { dot: 'bg-gold-400', label: 'Tạm nghỉ (giới hạn/phút)', tone: 'text-gold-600' },
  exhausted: { dot: 'bg-slate-400', label: 'Hết quota hôm nay', tone: 'text-slate-500' },
  dead: { dot: 'bg-rose-500', label: 'Không hợp lệ', tone: 'text-rose-700' },
}

export default function KeyStatusDialog({ config, keyProblem, onReload, onClose }) {
  const [, bump] = useReducer((x) => x + 1, 0)
  const [reloading, setReloading] = useState(false)
  const [now, setNow] = useState(() => Date.now())
  const pool = config.pool

  useEffect(() => {
    if (!pool) return
    const unsub = pool.subscribe(bump)
    const t = setInterval(() => setNow(Date.now()), 1000) // cập nhật đếm ngược nghỉ
    return () => {
      unsub()
      clearInterval(t)
    }
  }, [pool])

  const stats = pool?.stats()

  return (
    <Dialog
      open
      onClose={onClose}
      width="max-w-2xl"
      title="API key · AI CCE"
      footer={
        <>
          {pool && (
            <Button icon={RotateCcw} onClick={() => pool.resetAll()}>
              Thử lại tất cả key
            </Button>
          )}
          <Button
            variant="primary"
            icon={RefreshCw}
            loading={reloading}
            onClick={async () => {
              setReloading(true)
              await onReload()
              setReloading(false)
            }}
          >
            Tải lại file key
          </Button>
        </>
      }
    >
      <div className="flex gap-3 rounded-xl bg-cce-50 p-3.5 text-[13px] leading-relaxed text-cce-900 ring-1 ring-cce-100">
        <FileJson className="mt-0.5 size-4 shrink-0 text-cce-600" />
        <div>
          Key được đọc từ file <code className="rounded bg-white px-1 font-semibold">cce-scoresync/public/api-keys.json</code>. Dán mỗi key
          vào một ô trong mảng <code className="rounded bg-white px-1">"keys"</code>, lưu file rồi bấm <b>Tải lại file key</b>. Hệ thống xoay
          vòng giữa các key; key hết quota trong ngày sẽ tự bỏ qua tới khi Google reset quota.
        </div>
      </div>

      {keyProblem && (
        <div className="mt-4 flex gap-3 rounded-xl bg-rose-50 p-3.5 text-[13px] text-rose-800 ring-1 ring-rose-200">
          <CircleAlert className="mt-0.5 size-4 shrink-0" />
          {keyProblem}
        </div>
      )}

      {pool && (
        <>
          <div className="mt-4 grid grid-cols-2 gap-2 sm:grid-cols-4">
            {[
              ['Bộ máy AI', aiLabel(config.model)],
              ['Tổng số key', stats.total],
              ['Đang dùng được', stats.ready + stats.cooling],
              ['Đọc song song', `${config.concurrency} trang`],
            ].map(([label, value]) => (
              <div key={label} className="rounded-xl bg-slate-50 px-3 py-2.5 ring-1 ring-slate-200">
                <div className="text-[11px] font-medium uppercase tracking-wide text-slate-400">{label}</div>
                <div className="mt-0.5 truncate text-sm font-semibold text-slate-800">{value}</div>
              </div>
            ))}
          </div>

          <div className="mt-4 grid gap-1.5 sm:grid-cols-2">
            {pool.entries.map((e) => {
              const state = e.state === 'ready' && e.coolUntil > now ? 'cooling' : e.state
              const ui = STATE_UI[state]
              return (
                <div key={e.id} className="flex items-center gap-2.5 rounded-lg px-2.5 py-1.5 ring-1 ring-slate-100" title={e.reason}>
                  <span className="w-6 text-right text-[11px] tabular-nums text-slate-400">#{e.index}</span>
                  <span className={`size-2 shrink-0 rounded-full ${ui.dot}`} />
                  <code className="text-[12px] text-slate-700">{e.masked}</code>
                  <span className={`ml-auto truncate text-[11px] ${ui.tone}`}>
                    {state === 'cooling' ? `Nghỉ ${Math.ceil((e.coolUntil - now) / 1000)}s` : ui.label}
                    {e.success > 0 && <span className="text-slate-400"> · {e.success} lượt</span>}
                  </span>
                </div>
              )
            })}
          </div>
        </>
      )}
    </Dialog>
  )
}
