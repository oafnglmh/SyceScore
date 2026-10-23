import { AlertCircle, CheckCircle, Info, XCircle } from 'lucide-react'

const icons = {
  success: CheckCircle,
  error: XCircle,
  warning: AlertCircle,
  info: Info,
}

const styles = {
  success: 'bg-emerald-50 border-emerald-200 text-emerald-800',
  error: 'bg-red-50 border-red-200 text-red-800',
  warning: 'bg-amber-50 border-amber-200 text-amber-800',
  info: 'bg-blue-50 border-blue-200 text-blue-800',
}

const iconStyles = {
  success: 'text-emerald-500',
  error: 'text-red-500',
  warning: 'text-amber-500',
  info: 'text-blue-500',
}

/**
 * @param {{ type: 'success'|'error'|'warning'|'info', message: string, className?: string }} props
 */
export function Alert({ type = 'info', message, className = '' }) {
  const Icon = icons[type]
  return (
    <div
      className={`flex items-start gap-3 px-4 py-3 border rounded-md text-sm ${styles[type]} ${className}`}
    >
      <Icon size={16} className={`mt-0.5 shrink-0 ${iconStyles[type]}`} />
      <span>{message}</span>
    </div>
  )
}
