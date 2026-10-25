/**
 * ServerWakeUp — Render Free cold-start loading screen.
 *
 * Polls /api/health with exponential back-off until the backend
 * responds 2xx, then calls onReady() so the parent can reveal the app.
 *
 * Props:
 *   onReady   () => void  — called once backend is confirmed alive
 *   onDismiss () => void  — called when user hits "Ẩn màn hình chờ"
 */
import { useCallback, useEffect, useRef, useState } from 'react'
import { healthApi } from '../services/api'

// ─── Timing constants ─────────────────────────────────────────────────────────
const INITIAL_DELAY_MS = 3_000   // first ping after 3 s (give Vite time to render)
const MIN_INTERVAL_MS  = 4_000   // fastest retry cadence
const MAX_INTERVAL_MS  = 12_000  // slowest retry cadence (after many failures)
const BACKOFF_FACTOR   = 1.4     // grow interval on consecutive failures
const LONG_WAIT_SEC    = 25      // switch to "hơi ngái ngủ" message

// ─── Sub-message rotation ─────────────────────────────────────────────────────
const MESSAGES = [
  { text: 'Vui lòng liên hệ LÊ MINH HOÀNG để bật lại server nhé', min: 0 },
]

function getSubMessage(elapsed) {
  let msg = MESSAGES[0]
  for (const m of MESSAGES) {
    if (elapsed >= m.min) msg = m
  }
  return msg.text
}

// ─── Floating particles config ────────────────────────────────────────────────
const PARTICLES = [
  { emoji: '💤', top: '12%',  left: '8%',  dur: '6s',   delay: '0s'   },
  { emoji: '⭐', top: '20%',  left: '80%', dur: '8s',   delay: '1.2s' },
  { emoji: '☁️', top: '65%',  left: '6%',  dur: '10s',  delay: '0.5s' },
  { emoji: '💤', top: '75%',  left: '85%', dur: '7s',   delay: '2s'   },
  { emoji: '✨', top: '40%',  left: '92%', dur: '9s',   delay: '0.8s' },
  { emoji: '🌙', top: '8%',   left: '45%', dur: '11s',  delay: '3s'   },
  { emoji: '⭐', top: '85%',  left: '35%', dur: '7.5s', delay: '1.5s' },
]

// ─── Inline keyframes (injected once) ────────────────────────────────────────
const KEYFRAMES = `
  @keyframes swu-float {
    0%, 100% { transform: translateY(0px)   rotate(0deg);   opacity: .7; }
    50%       { transform: translateY(-18px) rotate(6deg);   opacity: 1;  }
  }
  @keyframes swu-spin    { to { transform: rotate(360deg);  } }
  @keyframes swu-spin-r  { to { transform: rotate(-360deg); } }
  @keyframes swu-bounce {
    0%, 80%, 100% { transform: translateY(0);    opacity: .4; }
    40%            { transform: translateY(-10px); opacity: 1;  }
  }
  @keyframes swu-shake {
    0%, 100% { transform: translateX(0);                      }
    20%       { transform: translateX(-4px) rotate(-2deg);    }
    40%       { transform: translateX(4px)  rotate(2deg);     }
    60%       { transform: translateX(-3px);                  }
    80%       { transform: translateX(3px);                   }
  }
  @keyframes swu-fadein {
    from { opacity: 0; transform: translateY(16px); }
    to   { opacity: 1; transform: translateY(0);    }
  }
  @keyframes swu-pulse-ring {
    0%   { transform: scale(1);    opacity: .65; }
    100% { transform: scale(1.6);  opacity: 0;   }
  }
  @keyframes swu-progress {
    0%   { left: -45%; width: 40%; }
    50%  { left: 40%;  width: 55%; }
    100% { left: 110%; width: 30%; }
  }
  @keyframes swu-msg-in {
    from { opacity: 0; transform: translateY(8px) scale(.97); }
    to   { opacity: 1; transform: translateY(0)   scale(1);   }
  }
  @keyframes swu-success {
    0%   { transform: scale(1);    }
    30%  { transform: scale(1.25); }
    55%  { transform: scale(0.9);  }
    75%  { transform: scale(1.1);  }
    100% { transform: scale(1);    }
  }
  @media (prefers-reduced-motion: reduce) {
    [data-swu] { animation: none !important; transition: none !important; }
  }
`

// ─── Component ────────────────────────────────────────────────────────────────
export default function ServerWakeUp({ onReady, onDismiss }) {
  const [elapsed,  setElapsed]  = useState(0)
  const [attempts, setAttempts] = useState(0)
  const [awake,    setAwake]    = useState(false)
  const [checking, setChecking] = useState(false)

  const timerRef    = useRef(null)
  const pollRef     = useRef(null)
  const intervalRef = useRef(MIN_INTERVAL_MS)
  const mountedRef  = useRef(true)
  const readyFired  = useRef(false)

  const fmtElapsed = (s) =>
    s < 60 ? `${s} giây` : `${Math.floor(s / 60)} phút ${s % 60} giây`

  // ── Ping backend ────────────────────────────────────────────────────────
  const ping = useCallback(async (manual = false) => {
    if (!mountedRef.current) return
    if (manual) setChecking(true)

    try {
      await healthApi.check()
      if (!mountedRef.current || readyFired.current) return
      readyFired.current = true
      setAwake(true)
      // 1.4 s for the success animation, then hand off
      setTimeout(() => { if (mountedRef.current) onReady() }, 1400)
    } catch {
      if (!mountedRef.current) return
      setAttempts((a) => a + 1)
      intervalRef.current = Math.min(intervalRef.current * BACKOFF_FACTOR, MAX_INTERVAL_MS)
      pollRef.current = setTimeout(() => ping(), intervalRef.current)
    } finally {
      if (mountedRef.current) setChecking(false)
    }
  }, [onReady])

  // ── Boot ────────────────────────────────────────────────────────────────
  useEffect(() => {
    mountedRef.current = true
    timerRef.current = setInterval(() => {
      if (mountedRef.current) setElapsed((e) => e + 1)
    }, 1000)
    pollRef.current = setTimeout(() => ping(), INITIAL_DELAY_MS)

    return () => {
      mountedRef.current = false
      clearInterval(timerRef.current)
      clearTimeout(pollRef.current)
    }
  }, [ping])

  const subMsg    = getSubMessage(elapsed)
  const isLong    = elapsed >= LONG_WAIT_SEC
  const accent    = isLong ? '#f59e0b' : '#3b82f6'
  const accentBg  = isLong ? 'linear-gradient(135deg,#fef3c7,#fde68a)' : 'linear-gradient(135deg,#eff6ff,#dbeafe)'
  const successBg = 'linear-gradient(135deg,#dcfce7,#bbf7d0)'

  return (
    <>
      <style>{KEYFRAMES}</style>

      {/* ── Full-screen overlay ─────────────────────────────────────────── */}
      <div
        data-swu
        style={{
          position: 'fixed', inset: 0,
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          background: 'linear-gradient(135deg, #f8fafc 0%, #eff6ff 55%, #f0fdf4 100%)',
          zIndex: 9999,
          padding: '1rem',
          animation: 'swu-fadein .4s ease both',
        }}
      >
        {/* Floating particles */}
        {PARTICLES.map((p, i) => (
          <div
            key={i}
            data-swu
            style={{
              position: 'absolute',
              top: p.top, left: p.left,
              fontSize: '1.45rem',
              pointerEvents: 'none', userSelect: 'none',
              animation: `swu-float ${p.dur} ease-in-out ${p.delay} infinite`,
            }}
          >
            {p.emoji}
          </div>
        ))}

        {/* ── White card ─────────────────────────────────────────────── */}
        <div
          data-swu
          style={{
            background: 'white',
            borderRadius: '1.5rem',
            boxShadow: '0 8px 40px rgba(0,0,0,.07), 0 2px 8px rgba(0,0,0,.04)',
            border: '1px solid #e2e8f0',
            padding: '2.5rem 2rem 2rem',
            maxWidth: '420px', width: '100%',
            textAlign: 'center',
            animation: 'swu-fadein .5s .12s ease both',
            position: 'relative',
          }}
        >
          {/* Dismiss ✕ */}
          <button
            onClick={onDismiss}
            title="Ẩn màn hình chờ"
            style={{
              position: 'absolute', top: '1rem', right: '1rem',
              background: 'none', border: 'none', cursor: 'pointer',
              color: '#94a3b8', fontSize: '1rem', padding: '.25rem',
              borderRadius: '.375rem', lineHeight: 1,
              transition: 'color .15s',
            }}
            onMouseEnter={(e) => (e.currentTarget.style.color = '#475569')}
            onMouseLeave={(e) => (e.currentTarget.style.color = '#94a3b8')}
          >
            ✕
          </button>

          {/* ── Icon + spinner rings ───────────────────────────────────── */}
          <div style={{ position: 'relative', display: 'inline-block', marginBottom: '1.75rem' }}>
            {/* Pulse ring */}
            {!awake && (
              <div
                data-swu
                style={{
                  position: 'absolute', inset: '-10px',
                  borderRadius: '50%',
                  border: `2px solid ${accent}`,
                  animation: 'swu-pulse-ring 1.9s ease-out infinite',
                }}
              />
            )}
            {/* Outer rotating ring */}
            {!awake && (
              <div
                data-swu
                style={{
                  position: 'absolute', inset: '-22px',
                  borderRadius: '50%',
                  border: '2.5px solid transparent',
                  borderTopColor: accent,
                  borderRightColor: isLong ? '#fcd34d' : '#93c5fd',
                  animation: 'swu-spin 1.1s linear infinite',
                }}
              />
            )}
            {/* Dashed counter-spin */}
            {!awake && (
              <div
                data-swu
                style={{
                  position: 'absolute', inset: '-13px',
                  borderRadius: '50%',
                  border: '1.5px dashed #cbd5e1',
                  animation: 'swu-spin-r 3s linear infinite',
                }}
              />
            )}

            {/* Emoji bubble */}
            <div
              data-swu
              style={{
                fontSize: '3rem',
                display: 'flex', alignItems: 'center', justifyContent: 'center',
                width: '76px', height: '76px',
                background: awake ? successBg : accentBg,
                borderRadius: '50%',
                transition: 'background .6s ease',
                animation: awake ? 'swu-success .65s ease' : 'swu-shake 2.6s ease-in-out infinite',
              }}
            >
              {awake ? '🚀' : '🖥️'}
            </div>
          </div>

          {/* ── Heading ────────────────────────────────────────────────── */}
          <h1
            style={{
              fontSize: '1.175rem', fontWeight: 700, lineHeight: 1.3,
              color: awake ? '#15803d' : '#1e293b',
              margin: '0 0 .5rem', transition: 'color .4s',
            }}
          >
            {awake
              ? 'Dậy rồi nè! Vào hệ thống thôi 🚀'
              : 'Server hiện chưa hoạt động'}
          </h1>

          {/* ── Sub-message ────────────────────────────────────────────── */}
          {!awake && (
            <p
              key={subMsg}
              data-swu
              style={{
                fontSize: '.875rem', color: '#64748b',
                margin: '0 0 1.5rem',
                animation: 'swu-msg-in .35s ease both',
              }}
            >
              {subMsg}
            </p>
          )}
          {awake && (
            <p style={{ fontSize: '.875rem', color: '#16a34a', margin: '0 0 1.5rem' }}>
              Đang chuyển hướng vào ứng dụng...
            </p>
          )}

          {/* ── Indeterminate progress bar ─────────────────────────────── */}
          {!awake && (
            <div
              style={{
                position: 'relative', height: '4px',
                background: '#f1f5f9', borderRadius: '9999px',
                overflow: 'hidden', marginBottom: '1.25rem',
              }}
            >
              <div
                data-swu
                style={{
                  position: 'absolute', top: 0, bottom: 0,
                  background: `linear-gradient(90deg, ${accent}, ${isLong ? '#fbbf24' : '#60a5fa'})`,
                  borderRadius: '9999px',
                  animation: 'swu-progress 1.8s ease-in-out infinite',
                }}
              />
            </div>
          )}

          {/* ── Bounce dots ────────────────────────────────────────────── */}
          {!awake && (
            <div style={{ display: 'flex', gap: '.5rem', justifyContent: 'center', marginBottom: '1.5rem' }}>
              {[0, 1, 2, 3].map((i) => (
                <div
                  key={i}
                  data-swu
                  style={{
                    width: '8px', height: '8px', borderRadius: '50%',
                    background: accent,
                    animation: `swu-bounce 1.2s ease-in-out ${i * 0.18}s infinite`,
                  }}
                />
              ))}
            </div>
          )}

          {/* ── Elapsed / attempt info ─────────────────────────────────── */}
          {!awake && (
            <p style={{ fontSize: '.75rem', color: '#94a3b8', margin: '0 0 1.25rem' }}>
              Đã chờ&nbsp;
              <strong style={{ color: '#64748b' }}>{fmtElapsed(elapsed)}</strong>
              {attempts > 0 && (
                <>&nbsp;·&nbsp;thử kết nối&nbsp;
                  <strong style={{ color: '#64748b' }}>{attempts}</strong> lần
                </>
              )}
            </p>
          )}

          {/* ── Action buttons ─────────────────────────────────────────── */}
          {!awake && (
            <div style={{ display: 'flex', gap: '.625rem', justifyContent: 'center', flexWrap: 'wrap' }}>
              {/* Primary: retry */}
              <button
                onClick={() => {
                  clearTimeout(pollRef.current)
                  intervalRef.current = MIN_INTERVAL_MS
                  ping(true)
                }}
                disabled={checking}
                style={{
                  display: 'inline-flex', alignItems: 'center', gap: '.375rem',
                  padding: '.5rem 1.125rem',
                  fontSize: '.8125rem', fontWeight: 600,
                  background: isLong ? '#f59e0b' : '#1e293b',
                  color: 'white',
                  border: 'none', borderRadius: '.5rem',
                  cursor: checking ? 'not-allowed' : 'pointer',
                  opacity: checking ? .6 : 1,
                  transition: 'opacity .15s, background .3s',
                }}
              >
                {checking ? (
                  <span
                    data-swu
                    style={{
                      width: '12px', height: '12px', display: 'inline-block',
                      borderRadius: '50%',
                      border: '2px solid rgba(255,255,255,.35)',
                      borderTopColor: 'white',
                      animation: 'swu-spin .7s linear infinite',
                    }}
                  />
                ) : '🔄'}
                {checking ? 'Đang kết nối...' : 'Thử kết nối lại'}
              </button>

              {/* Secondary: dismiss */}
              <button
                onClick={onDismiss}
                style={{
                  display: 'inline-flex', alignItems: 'center', gap: '.375rem',
                  padding: '.5rem 1rem',
                  fontSize: '.8125rem', fontWeight: 500,
                  background: 'white', color: '#64748b',
                  border: '1px solid #e2e8f0',
                  borderRadius: '.5rem', cursor: 'pointer',
                  transition: 'background .15s',
                }}
                onMouseEnter={(e) => (e.currentTarget.style.background = '#f8fafc')}
                onMouseLeave={(e) => (e.currentTarget.style.background = 'white')}
              >
                Ẩn màn hình chờ
              </button>
            </div>
          )}
        </div>
      </div>
    </>
  )
}
