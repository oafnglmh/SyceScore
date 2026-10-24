import { STATUS_COLORS, STATUS_LABELS } from '../constants'

/**
 * @param {{ status: string }} props
 */
export function StatusBadge({ status }) {
  const label = STATUS_LABELS[status] || status
  const cls = STATUS_COLORS[status] || 'badge'
  return <span className={`badge ${cls}`}>{label}</span>
}

/**
 * @param {{ value: number | null | undefined, detail?: any }} props
 */
export function ConfidenceBadge({ value, detail }) {
  if (value === null || value === undefined) {
    return <span className="text-slate-300 text-xs">—</span>
  }
  const pct = Math.round(value * 100)
  let cls = 'bg-red-50 text-red-700 border-red-200 ring-1 ring-red-100'
  let label = 'Cần kiểm tra'
  let dot = '🔴'

  if (value >= 0.9) {
    cls = 'bg-emerald-50 text-emerald-700 border-emerald-200 ring-1 ring-emerald-100'
    label = 'Tin cậy cao'
    dot = '🟢'
  } else if (value >= 0.7) {
    cls = 'bg-amber-50 text-amber-700 border-amber-200 ring-1 ring-amber-100'
    label = 'Xem lại'
    dot = '🟡'
  }

  const tooltip = detail ? (typeof detail === 'object' ? JSON.stringify(detail) : String(detail)) : `${label} (${pct}%)`

  return (
    <span
      className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[11px] font-medium border ${cls} whitespace-nowrap`}
      title={tooltip}
    >
      <span className="text-[10px]">{dot}</span>
      <span className="font-semibold">{pct}%</span>
      <span className="hidden sm:inline font-normal text-[10px] opacity-90">{label}</span>
    </span>
  )
}
