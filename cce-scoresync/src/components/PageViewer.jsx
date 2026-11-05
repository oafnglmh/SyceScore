import { ChevronLeft, ChevronRight, ZoomIn, ZoomOut } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'

const ZOOMS = [1, 1.6, 2.4]

export default function PageViewer({ src, title, rowY, onPrev, onNext }) {
  const [zoomIdx, setZoomIdx] = useState(0)
  const [loadedSrc, setLoadedSrc] = useState(null)
  const boxRef = useRef(null)
  const innerRef = useRef(null)
  const zoom = ZOOMS[zoomIdx]
  const loaded = loadedSrc === src

  // Cuộn tới dòng đang chọn.
  useEffect(() => {
    const box = boxRef.current
    const inner = innerRef.current
    if (!box || !inner || !loaded) return
    const h = inner.scrollHeight
    const top = rowY !== null && rowY !== undefined ? (rowY / 1000) * h - box.clientHeight / 2 : 0
    const left = zoom > 1 ? inner.scrollWidth * 0.55 - box.clientWidth / 2 : 0
    box.scrollTo({ top: Math.max(0, top), left: Math.max(0, left), behavior: 'smooth' })
  }, [rowY, zoom, src, loaded])

  return (
    <div className="flex h-full flex-col overflow-hidden rounded-2xl bg-white ring-1 ring-slate-200">
      <div className="flex items-center gap-1 border-b border-slate-100 px-3 py-2">
        <button onClick={onPrev} disabled={!onPrev} className="rounded-lg p-1.5 text-slate-500 hover:bg-slate-100 disabled:opacity-30">
          <ChevronLeft className="size-4" />
        </button>
        <div className="min-w-0 flex-1 truncate text-center text-xs font-medium text-slate-600">{title}</div>
        <button onClick={onNext} disabled={!onNext} className="rounded-lg p-1.5 text-slate-500 hover:bg-slate-100 disabled:opacity-30">
          <ChevronRight className="size-4" />
        </button>
        <div className="mx-1 h-4 w-px bg-slate-200" />
        <button
          onClick={() => setZoomIdx(Math.max(0, zoomIdx - 1))}
          disabled={zoomIdx === 0}
          className="rounded-lg p-1.5 text-slate-500 hover:bg-slate-100 disabled:opacity-30"
        >
          <ZoomOut className="size-4" />
        </button>
        <span className="w-9 text-center text-xs tabular-nums text-slate-500">{Math.round(zoom * 100)}%</span>
        <button
          onClick={() => setZoomIdx(Math.min(ZOOMS.length - 1, zoomIdx + 1))}
          disabled={zoomIdx === ZOOMS.length - 1}
          className="rounded-lg p-1.5 text-slate-500 hover:bg-slate-100 disabled:opacity-30"
        >
          <ZoomIn className="size-4" />
        </button>
      </div>
      <div ref={boxRef} className="relative flex-1 overflow-auto bg-slate-100">
        {src ? (
          <div ref={innerRef} className="relative" style={{ width: `${zoom * 100}%` }}>
            <img src={src} alt={title} className="block w-full select-none" draggable={false} onLoad={() => setLoadedSrc(src)} />
            {rowY !== null && rowY !== undefined && (
              <div
                className="pointer-events-none absolute inset-x-0 border-y-2 border-gold-500 bg-gold-300/25 transition-all"
                style={{ top: `calc(${rowY / 10}% - 1.4%)`, height: '2.8%' }}
              />
            )}
          </div>
        ) : (
          <div className="flex h-full items-center justify-center text-sm text-slate-400">Chọn một dòng để xem trang scan</div>
        )}
      </div>
    </div>
  )
}
