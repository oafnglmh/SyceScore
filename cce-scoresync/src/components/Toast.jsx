import { createContext, useCallback, useContext, useEffect, useRef, useState } from 'react'
import { X } from 'lucide-react'

/* ─────────────────────────── Context ─────────────────────────── */
const ToastContext = createContext(null)

let _id = 0
const nextId = () => ++_id

/* ─────────────────────────── Provider ─────────────────────────── */
export function ToastProvider({ children }) {
  const [toasts, setToasts] = useState([])

  const dismiss = useCallback((id) => {
    setToasts((prev) => prev.map((t) => (t.id === id ? { ...t, leaving: true } : t)))
    setTimeout(() => setToasts((prev) => prev.filter((t) => t.id !== id)), 300)
  }, [])

  const push = useCallback(
    (type, message, duration = type === 'error' ? 8000 : 4000) => {
      const id = nextId()
      setToasts((prev) => [...prev, { id, type, message, leaving: false }])
      if (duration > 0) setTimeout(() => dismiss(id), duration)
      return id
    },
    [dismiss]
  )

  const toast = {
    success: (msg, dur) => push('success', msg, dur),
    error: (msg, dur) => push('error', msg, dur),
    info: (msg, dur) => push('info', msg, dur),
    warning: (msg, dur) => push('warning', msg, dur),
    dismiss,
  }

  return (
    <ToastContext.Provider value={toast}>
      {children}
      <ToastContainer toasts={toasts} onDismiss={dismiss} />
    </ToastContext.Provider>
  )
}

/* ─────────────────────────── Hook ─────────────────────────── */
export function useToast() {
  const ctx = useContext(ToastContext)
  if (!ctx) throw new Error('useToast must be used inside ToastProvider')
  return ctx
}

/* ─────────────────────────── Container ─────────────────────────── */
function ToastContainer({ toasts, onDismiss }) {
  if (toasts.length === 0) return null
  return (
    <div
      aria-live="polite"
      style={{
        position: 'fixed',
        bottom: '24px',
        right: '24px',
        zIndex: 9999,
        display: 'flex',
        flexDirection: 'column',
        gap: '10px',
        maxWidth: '420px',
        width: '100%',
        pointerEvents: 'none',
      }}
    >
      {toasts.map((t) => (
        <ToastItem key={t.id} toast={t} onDismiss={onDismiss} />
      ))}
    </div>
  )
}

/* ─────────────────────────── Item ─────────────────────────── */
const STYLES = {
  success: {
    border: '#bbf7d0',
    bg: '#f0fdf4',
    bar: '#22c55e',
    label: '#15803d',
    text: '#166534',
    tag: 'Thành công',
  },
  error: {
    border: '#fecaca',
    bg: '#fff5f5',
    bar: '#ef4444',
    label: '#b91c1c',
    text: '#7f1d1d',
    tag: 'Lỗi',
  },
  warning: {
    border: '#fed7aa',
    bg: '#fffbeb',
    bar: '#f59e0b',
    label: '#b45309',
    text: '#78350f',
    tag: 'Cảnh báo',
  },
  info: {
    border: '#bfdbfe',
    bg: '#eff6ff',
    bar: '#3b82f6',
    label: '#1d4ed8',
    text: '#1e3a5f',
    tag: 'Thông báo',
  },
}

function ToastItem({ toast, onDismiss }) {
  const s = STYLES[toast.type] || STYLES.info
  const ref = useRef(null)

  return (
    <div
      ref={ref}
      role="alert"
      style={{
        pointerEvents: 'all',
        background: s.bg,
        border: `1px solid ${s.border}`,
        borderLeft: `4px solid ${s.bar}`,
        borderRadius: '8px',
        boxShadow: '0 4px 16px rgba(0,0,0,0.10)',
        padding: '12px 14px',
        display: 'flex',
        flexDirection: 'column',
        gap: '4px',
        animation: toast.leaving
          ? 'toast-out 0.28s ease forwards'
          : 'toast-in 0.28s ease forwards',
        minWidth: '280px',
        maxWidth: '420px',
        width: '100%',
      }}
    >
      {/* Header row */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '8px' }}>
        <span
          style={{
            fontSize: '11px',
            fontWeight: 600,
            letterSpacing: '0.04em',
            textTransform: 'uppercase',
            color: s.label,
          }}
        >
          {s.tag}
        </span>
        <button
          onClick={() => onDismiss(toast.id)}
          style={{
            background: 'none',
            border: 'none',
            cursor: 'pointer',
            color: s.label,
            padding: '2px',
            display: 'flex',
            alignItems: 'center',
            opacity: 0.7,
            flexShrink: 0,
          }}
          aria-label="Đóng thông báo"
        >
          <X size={14} />
        </button>
      </div>

      {/* Message */}
      <p
        style={{
          margin: 0,
          fontSize: '13px',
          lineHeight: 1.55,
          color: s.text,
          wordBreak: 'break-word',
          whiteSpace: 'pre-wrap',
        }}
      >
        {toast.message}
      </p>
    </div>
  )
}
