import { KeyRound, LoaderCircle } from 'lucide-react'
import { useCallback, useEffect, useReducer, useRef, useState } from 'react'
import KeyStatusDialog from './components/KeyStatusDialog'
import ProcessingView from './components/ProcessingView'
import ReviewView from './components/ReviewView'
import UploadView from './components/UploadView'
import { buildSheets, readPage } from './lib/extract'
import { createClient } from './lib/ai'
import { aiLabel, KeyPool, loadKeyConfig } from './lib/keys'
import { loadPages } from './lib/pages'

function createLimiter(max) {
  let active = 0
  const queue = []
  const next = () => {
    if (active >= max || !queue.length) return
    active++
    const { fn, resolve, reject } = queue.shift()
    fn()
      .then(resolve, reject)
      .finally(() => {
        active--
        next()
      })
  }
  return (fn) =>
    new Promise((resolve, reject) => {
      queue.push({ fn, resolve, reject })
      next()
    })
}

/** Theo dõi kho key để header/dialog cập nhật trạng thái (giới hạn ~4 lần/giây). */
function usePoolStats(pool) {
  const [, bump] = useReducer((x) => x + 1, 0)
  useEffect(() => {
    if (!pool) return
    let t = null
    const unsub = pool.subscribe(() => {
      if (!t) t = setTimeout(() => ((t = null), bump()), 250)
    })
    return () => {
      unsub()
      clearTimeout(t)
    }
  }, [pool])
  return pool ? pool.stats() : null
}

let fileSeq = 0

export default function App() {
  const [config, setConfig] = useState({ loading: true })
  const [keysOpen, setKeysOpen] = useState(false)
  const [stage, setStage] = useState('upload') // upload | processing | review
  const [sheets, setSheets] = useState([])
  const jobRef = useRef(null)
  const [, rerender] = useReducer((x) => x + 1, 0)
  const stats = usePoolStats(config.pool)

  const reloadKeys = useCallback(async () => {
    try {
      const cfg = await loadKeyConfig()
      setConfig({ ...cfg, pool: cfg.keys.length ? new KeyPool(cfg.keys) : null, error: null })
    } catch (e) {
      setConfig({ error: e.message, keys: [] })
    }
  }, [])

  useEffect(() => {
    let alive = true
    loadKeyConfig()
      .then((cfg) => alive && setConfig({ ...cfg, pool: cfg.keys.length ? new KeyPool(cfg.keys) : null, error: null }))
      .catch((e) => alive && setConfig({ error: e.message, keys: [] }))
    return () => {
      alive = false
    }
  }, [])

  const ready = !!config.pool && !!config.model
  const keyProblem = config.loading
    ? null
    : config.error || (!config.keys?.length ? 'File public/api-keys.json chưa có API key nào.' : null)

  // Cảnh báo khi rời trang giữa chừng.
  useEffect(() => {
    if (stage === 'upload') return
    const handler = (e) => {
      e.preventDefault()
      e.returnValue = ''
    }
    window.addEventListener('beforeunload', handler)
    return () => window.removeEventListener('beforeunload', handler)
  }, [stage])

  const releaseJob = useCallback(() => {
    const job = jobRef.current
    if (!job) return
    job.controller.abort()
    for (const f of job.files) for (const p of f.pages) URL.revokeObjectURL(p.previewUrl)
    jobRef.current = null
  }, [])

  function runPage(job, page) {
    page.status = 'queued'
    page.error = null
    page.label = ''
    page.passes = 0
    return job
      .limit(async () => {
        if (job.controller.signal.aborted) throw new DOMException('Aborted', 'AbortError')
        page.status = 'reading'
        rerender()
        const { merged, results } = await readPage({
          client: job.client,
          page,
          signal: job.controller.signal,
          onProgress: ({ label, passes, waitingMs }) => {
            if (label) page.label = label
            if (passes) page.passes = passes
            if (waitingMs !== undefined) {
              job.waitingMs = waitingMs
              setTimeout(() => {
                job.waitingMs = 0
                rerender()
              }, waitingMs)
            }
            rerender()
          },
        })
        page.merged = merged
        page.passes = results.length
        page.status = 'done'
      })
      .catch((e) => {
        page.status = 'error'
        page.error = e.name === 'AbortError' ? 'Đã dừng' : e.message
        if (e.fatal && !job.fatal) {
          job.fatal = e.message
          job.controller.abort()
        }
      })
      .finally(rerender)
  }

  async function start(files) {
    if (!ready) return setKeysOpen(true)
    releaseJob()
    const job = {
      client: createClient({ pool: config.pool, model: config.model }),
      model: config.model,
      limit: createLimiter(config.concurrency),
      controller: new AbortController(),
      running: true,
      waitingMs: 0,
      fatal: null,
      files: files.map((file) => ({ id: `f${++fileSeq}`, name: file.name, file, status: 'rendering', pageTotal: 0, pages: [] })),
    }
    jobRef.current = job
    setSheets([])
    setStage('processing')

    const tasks = []
    for (const f of job.files) {
      if (job.controller.signal.aborted) break
      try {
        await loadPages(f.file, (entry, n, total) => {
          if (job.controller.signal.aborted) return
          const page = { ...entry, key: `${f.id}-${n}`, fileName: f.name, status: 'queued' }
          f.pages.push(page)
          f.pageTotal = total
          tasks.push(runPage(job, page))
          rerender()
        })
        f.status = 'ready'
      } catch (e) {
        f.status = 'error'
        f.error = `Không mở được file: ${e.message}`
      }
      rerender()
    }
    await Promise.all(tasks)
    job.running = false
    rerender()
    if (jobRef.current === job && !job.fatal && job.files.every((f) => f.pages.every((p) => p.status === 'done'))) finish(job)
  }

  async function retryFailed() {
    const job = jobRef.current
    if (!job || !ready) return
    job.controller = new AbortController()
    job.fatal = null
    job.client = createClient({ pool: config.pool, model: config.model })
    job.running = true
    rerender()
    const failed = job.files.flatMap((f) => f.pages.filter((p) => p.status === 'error'))
    await Promise.all(failed.map((p) => runPage(job, p)))
    job.running = false
    rerender()
    if (job.files.every((f) => f.pages.every((p) => p.status === 'done'))) finish(job)
  }

  function finish(job) {
    setSheets(buildSheets(job.files.map((f) => ({ id: f.id, name: f.name, pages: f.pages }))))
    setStage('review')
  }

  function restart() {
    if (stage === 'review' && !window.confirm('Bỏ kết quả hiện tại và làm file khác?')) return
    releaseJob()
    setSheets([])
    setStage('upload')
  }

  const getPage = useCallback((fileId, pageNumber) => {
    const f = jobRef.current?.files.find((x) => x.id === fileId)
    return f?.pages.find((p) => p.pageNumber === pageNumber) || null
  }, [])

  const usable = stats ? stats.ready + stats.cooling : 0

  return (
    <div className="flex min-h-screen flex-col">
      <header className="sticky top-0 z-30 bg-cce-700 text-white shadow-lg shadow-cce-900/20">
        <div className="cce-arcs flex h-14 items-center gap-3 px-4">
          <button onClick={() => stage !== 'processing' && restart()} className="flex items-center gap-3">
            <img src="/cce-emblem-white.png" alt="CCE" className="h-9 w-auto" />
            <div className="hidden h-8 w-px bg-white/20 sm:block" />
            <div className="text-left leading-tight">
              <div className="text-[10.5px] font-semibold uppercase tracking-[0.14em] text-gold-300">
                Trung tâm Đào tạo Thường xuyên · ĐH Đà Nẵng
              </div>
              <div className="text-[15px] font-semibold">Số hóa điểm thi viết tay</div>
            </div>
          </button>
          <button
            onClick={() => setKeysOpen(true)}
            className="ml-auto flex items-center gap-2 rounded-full bg-white/10 py-1.5 pl-2.5 pr-3 text-xs font-medium ring-1 ring-white/15 transition hover:bg-white/15"
            title="Trạng thái API key"
          >
            {config.loading ? (
              <LoaderCircle className="size-3.5 animate-spin" />
            ) : (
              <span className={`size-2 rounded-full ${keyProblem || !usable ? 'bg-rose-400' : 'bg-emerald-400'} ring-2 ring-white/20`} />
            )}
            <KeyRound className="size-3.5 text-gold-300" />
            {stats ? (
              <span>
                {usable}/{stats.total} key
              </span>
            ) : (
              <span>{config.loading ? 'Đang đọc file key' : 'Chưa có key'}</span>
            )}
            {config.model && (
              <span className="hidden text-white/60 sm:inline">· {aiLabel(config.model)}</span>
            )}
          </button>
        </div>
        <div className="h-[3px] bg-gradient-to-r from-gold-500 via-gold-300 to-gold-500" />
      </header>

      <div className="flex-1">
        {stage === 'upload' && (
          <UploadView ready={ready} keyProblem={keyProblem} onOpenKeys={() => setKeysOpen(true)} onStart={start} />
        )}
        {stage === 'processing' && jobRef.current && (
          <ProcessingView
            job={jobRef.current}
            stats={stats}
            onCancel={() => {
              jobRef.current.controller.abort()
              rerender()
            }}
            onRetry={retryFailed}
            onContinue={() => finish(jobRef.current)}
          />
        )}
        {stage === 'review' && <ReviewView sheets={sheets} setSheets={setSheets} getPage={getPage} onRestart={restart} />}
      </div>

      {stage !== 'review' && (
        <footer className="border-t border-slate-200 bg-white py-5 text-center text-xs text-slate-500">
          © {new Date().getFullYear()} Trung tâm Đào tạo Thường xuyên – Đại học Đà Nẵng · 41 Lê Duẩn, TP. Đà Nẵng
        </footer>
      )}

      {keysOpen && (
        <KeyStatusDialog config={config} keyProblem={keyProblem} onReload={reloadKeys} onClose={() => setKeysOpen(false)} />
      )}
    </div>
  )
}
