import { useEffect, useRef } from 'react'

/**
 * ConfirmModal – thay thế window.confirm()
 *
 * Props:
 *   open        boolean
 *   title       string
 *   message     string
 *   confirmText string  (mặc định "Xác nhận")
 *   cancelText  string  (mặc định "Hủy")
 *   danger      boolean – nút xác nhận màu đỏ
 *   onConfirm   () => void
 *   onCancel    () => void
 */
export function ConfirmModal({
  open,
  title = 'Xác nhận',
  message,
  confirmText = 'Xác nhận',
  cancelText = 'Hủy',
  danger = false,
  onConfirm,
  onCancel,
}) {
  const confirmRef = useRef(null)

  // Focus nút xác nhận khi mở
  useEffect(() => {
    if (open) setTimeout(() => confirmRef.current?.focus(), 50)
  }, [open])

  // Đóng khi nhấn Escape
  useEffect(() => {
    if (!open) return
    const handler = (e) => { if (e.key === 'Escape') onCancel?.() }
    document.addEventListener('keydown', handler)
    return () => document.removeEventListener('keydown', handler)
  }, [open, onCancel])

  if (!open) return null

  return (
    <>
      {/* Backdrop */}
      <div
        onClick={onCancel}
        style={{
          position: 'fixed',
          inset: 0,
          background: 'rgba(15,23,42,0.35)',
          backdropFilter: 'blur(2px)',
          zIndex: 10000,
          animation: 'toast-in 0.18s ease',
        }}
      />

      {/* Dialog */}
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="confirm-modal-title"
        style={{
          position: 'fixed',
          top: '50%',
          left: '50%',
          transform: 'translate(-50%, -50%)',
          zIndex: 10001,
          background: '#fff',
          border: '1px solid #e2e8f0',
          borderRadius: '10px',
          boxShadow: '0 20px 60px rgba(0,0,0,0.15)',
          padding: '24px',
          width: '360px',
          maxWidth: 'calc(100vw - 32px)',
          animation: 'toast-in 0.18s ease',
        }}
      >
        {/* Title */}
        <h2
          id="confirm-modal-title"
          style={{
            margin: '0 0 10px',
            fontSize: '15px',
            fontWeight: 600,
            color: '#0f172a',
          }}
        >
          {title}
        </h2>

        {/* Message */}
        {message && (
          <p
            style={{
              margin: '0 0 20px',
              fontSize: '13px',
              lineHeight: 1.6,
              color: '#475569',
            }}
          >
            {message}
          </p>
        )}

        {/* Actions */}
        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '8px' }}>
          <button
            onClick={onCancel}
            style={{
              padding: '7px 16px',
              fontSize: '13px',
              fontWeight: 500,
              background: '#fff',
              border: '1px solid #e2e8f0',
              borderRadius: '6px',
              cursor: 'pointer',
              color: '#475569',
              transition: 'background 0.15s',
            }}
            onMouseEnter={(e) => (e.currentTarget.style.background = '#f8fafc')}
            onMouseLeave={(e) => (e.currentTarget.style.background = '#fff')}
          >
            {cancelText}
          </button>
          <button
            ref={confirmRef}
            onClick={onConfirm}
            style={{
              padding: '7px 16px',
              fontSize: '13px',
              fontWeight: 500,
              background: danger ? '#ef4444' : '#1e293b',
              border: '1px solid transparent',
              borderRadius: '6px',
              cursor: 'pointer',
              color: '#fff',
              transition: 'background 0.15s',
            }}
            onMouseEnter={(e) =>
              (e.currentTarget.style.background = danger ? '#dc2626' : '#334155')
            }
            onMouseLeave={(e) =>
              (e.currentTarget.style.background = danger ? '#ef4444' : '#1e293b')
            }
          >
            {confirmText}
          </button>
        </div>
      </div>
    </>
  )
}
