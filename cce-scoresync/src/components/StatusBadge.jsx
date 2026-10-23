import { STATUS_COLORS, STATUS_LABELS } from '../constants'

/**
 * @param {{ status: string }} props
 */
export function StatusBadge({ status }) {
  const label = STATUS_LABELS[status] || status
  const cls = STATUS_COLORS[status] || 'badge'
  return <span className={`badge ${cls}`}>{label}</span>
}

