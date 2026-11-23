import { LoaderCircle, X } from 'lucide-react'
import { useEffect } from 'react'

const VARIANTS = {
  primary:
    'bg-cce-700 text-white hover:bg-cce-600 shadow-sm shadow-cce-700/25 disabled:bg-cce-300 disabled:shadow-none',
  gold: 'bg-gold-400 text-cce-950 font-semibold hover:bg-gold-300 shadow-lg shadow-gold-500/30 disabled:bg-slate-200 disabled:text-slate-400 disabled:shadow-none',
  secondary: 'bg-white text-slate-700 ring-1 ring-slate-200 hover:bg-slate-50 hover:ring-slate-300 disabled:text-slate-400',
  ghost: 'text-slate-600 hover:bg-slate-100 hover:text-slate-900 disabled:text-slate-300',
  success: 'bg-emerald-600 text-white hover:bg-emerald-500 shadow-sm shadow-emerald-600/20 disabled:bg-emerald-300',
  danger: 'bg-rose-600 text-white hover:bg-rose-500 disabled:bg-rose-300',
}

export function Button({ variant = 'secondary', size = 'md', loading, icon: Icon, children, className = '', ...props }) {
  const sizes = {
    sm: 'h-8 px-3 text-[13px] gap-1.5 rounded-lg',
    md: 'h-10 px-4 text-sm gap-2 rounded-xl',
    lg: 'h-12 px-6 text-[15px] gap-2 rounded-xl',
  }
  return (
    <button
      type="button"
      className={`inline-flex shrink-0 items-center justify-center font-medium transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-cce-500 disabled:cursor-not-allowed ${VARIANTS[variant]} ${sizes[size]} ${className}`}
      disabled={loading || props.disabled}
      {...props}
    >
      {loading ? <LoaderCircle className="size-4 animate-spin" /> : Icon ? <Icon className="size-4" /> : null}
      {children}
    </button>
  )
}

export function Badge({ tone = 'slate', children, className = '' }) {
  const tones = {
    slate: 'bg-slate-100 text-slate-600',
    cce: 'bg-cce-50 text-cce-700 ring-1 ring-inset ring-cce-200',
    green: 'bg-emerald-50 text-emerald-700 ring-1 ring-inset ring-emerald-200',
    amber: 'bg-amber-50 text-amber-800 ring-1 ring-inset ring-amber-200',
    red: 'bg-rose-50 text-rose-700 ring-1 ring-inset ring-rose-200',
  }
  return (
    <span className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-medium ${tones[tone]} ${className}`}>
      {children}
    </span>
  )
}

export function Dialog({ open, onClose, title, children, footer, width = 'max-w-lg' }) {
  useEffect(() => {
    if (!open) return
    const onKey = (e) => e.key === 'Escape' && onClose?.()
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [open, onClose])

  if (!open) return null
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-slate-900/40 backdrop-blur-sm" onClick={onClose} />
      <div className={`relative w-full ${width} rounded-2xl bg-white shadow-2xl ring-1 ring-slate-200`}>
        <div className="flex items-center justify-between border-b border-slate-100 px-6 py-4">
          <h2 className="text-base font-semibold text-slate-900">{title}</h2>
          <button onClick={onClose} className="rounded-lg p-1.5 text-slate-400 hover:bg-slate-100 hover:text-slate-600">
            <X className="size-4" />
          </button>
        </div>
        <div className="max-h-[70vh] overflow-y-auto px-6 py-5">{children}</div>
        {footer && <div className="flex justify-end gap-2 border-t border-slate-100 px-6 py-4">{footer}</div>}
      </div>
    </div>
  )
}

export function Progress({ value, tone = 'cce' }) {
  const color = tone === 'green' ? 'bg-emerald-500' : tone === 'red' ? 'bg-rose-500' : 'bg-cce-500'
  return (
    <div className="h-1.5 w-full overflow-hidden rounded-full bg-slate-100">
      <div className={`h-full rounded-full transition-all duration-500 ${color}`} style={{ width: `${Math.round(value * 100)}%` }} />
    </div>
  )
}

const YEAR = new Date().getFullYear()

export function Footer() {
  return (
    <footer className="mt-auto border-t border-slate-200 bg-white py-5 text-center text-xs text-slate-500">
      © {YEAR} Trung tâm Đào tạo Thường xuyên – Đại học Đà Nẵng · 41 Lê Duẩn, TP. Đà Nẵng
    </footer>
  )
}
