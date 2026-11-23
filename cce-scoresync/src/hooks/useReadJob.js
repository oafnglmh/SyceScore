import { useCallback, useEffect, useReducer, useRef, useState } from 'react'
import { createClient } from '../lib/ai'
import { loadPages } from '../lib/pages'

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

let fileSeq = 0
const allDone = (job) => job.files.every((f) => f.pages.every((p) => p.status === 'done'))

/**
 * Hàng đợi đọc trang bằng AI CCE – dùng chung cho trang Số hóa điểm và trang Dò điểm.
 * read(page, { client, signal, onProgress }) → Promise<{ merged, passes }>
 * start()/retryFailed() trả về true khi mọi trang đã đọc xong (để trang gọi chuyển sang bước tiếp).
 */
export default function useReadJob({ config, read }) {
  // jobRef cho các hàm bất đồng bộ; `job` (state) cho render. Trang được cập nhật tại chỗ rồi rerender().
  const jobRef = useRef(null)
  const [job, setJob] = useState(null)
  const [, rerender] = useReducer((x) => x + 1, 0)

  const release = useCallback(() => {
    const job = jobRef.current
    if (!job) return
    job.controller.abort()
    for (const f of job.files) for (const p of f.pages) URL.revokeObjectURL(p.previewUrl)
    jobRef.current = null
    setJob(null)
  }, [])

  useEffect(() => release, [release])

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
        const { merged, passes } = await read(page, {
          client: job.client,
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
        page.passes = passes
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

  /** entries: [{ file, kind? }] – kind được gắn vào file và từng trang. */
  async function start(entries) {
    release()
    const job = {
      client: createClient({ pool: config.pool, model: config.model }),
      model: config.model,
      limit: createLimiter(config.concurrency),
      controller: new AbortController(),
      running: true,
      waitingMs: 0,
      fatal: null,
      files: entries.map(({ file, kind }) => ({
        id: `f${++fileSeq}`,
        kind,
        name: file.name,
        file,
        status: 'rendering',
        pageTotal: 0,
        pages: [],
      })),
    }
    jobRef.current = job
    setJob(job)

    const tasks = []
    for (const f of job.files) {
      if (job.controller.signal.aborted) break
      try {
        await loadPages(f.file, (entry, n, total) => {
          if (job.controller.signal.aborted) return
          const page = { ...entry, key: `${f.id}-${n}`, kind: f.kind, fileName: f.name, status: 'queued' }
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
    return jobRef.current === job && !job.fatal && allDone(job)
  }

  async function retryFailed() {
    const job = jobRef.current
    if (!job) return false
    job.controller = new AbortController()
    job.fatal = null
    job.client = createClient({ pool: config.pool, model: config.model })
    job.running = true
    rerender()
    const failed = job.files.flatMap((f) => f.pages.filter((p) => p.status === 'error'))
    await Promise.all(failed.map((p) => runPage(job, p)))
    job.running = false
    rerender()
    return jobRef.current === job && allDone(job)
  }

  function cancel() {
    jobRef.current?.controller.abort()
    rerender()
  }

  const getPage = useCallback((fileId, pageNumber) => {
    const f = jobRef.current?.files.find((x) => x.id === fileId)
    return f?.pages.find((p) => p.pageNumber === pageNumber) || null
  }, [])

  return { job, current: () => jobRef.current, start, retryFailed, cancel, release, getPage }
}

/** Cảnh báo khi đóng/tải lại trang giữa chừng. */
export function useLeaveGuard(active) {
  useEffect(() => {
    if (!active) return
    const handler = (e) => {
      e.preventDefault()
      e.returnValue = ''
    }
    window.addEventListener('beforeunload', handler)
    return () => window.removeEventListener('beforeunload', handler)
  }, [active])
}
