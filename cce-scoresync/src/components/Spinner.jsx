import { Loader2 } from 'lucide-react'

export function Spinner({ size = 16, className = '' }) {
  return (
    <Loader2
      size={size}
      className={`animate-spin text-slate-400 ${className}`}
    />
  )
}

export function LoadingOverlay({ message = 'Đang xử lý...' }) {
  return (
    <div className="flex flex-col items-center justify-center gap-3 py-16 text-slate-500">
      <Spinner size={28} />
      <span className="text-sm">{message}</span>
    </div>
  )
}
