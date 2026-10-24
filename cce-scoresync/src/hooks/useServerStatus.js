/**
 * useServerStatus — lightweight hook that does ONE immediate health-check
 * on mount to decide whether the Render Free backend is alive.
 *
 * Returns:
 *   status  'checking' | 'alive' | 'sleeping'
 *
 * Used by App.jsx to decide whether to render ServerWakeUp.
 * Actual retry-polling lives inside ServerWakeUp itself; this hook
 * only does the first quick probe so we don't flash the overlay when
 * the backend is already running (e.g. in development).
 */
import { useEffect, useRef, useState } from 'react'
import { healthApi } from '../services/api'

// Timeout for the initial probe — keep short so the overlay appears quickly
// if the server doesn't respond (Render sleeps → connection hangs, not 5xx)
const PROBE_TIMEOUT_MS = 6_000

export function useServerStatus() {
  const [status, setStatus] = useState('checking')
  const doneRef = useRef(false)

  useEffect(() => {
    let cancelled = false

    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), PROBE_TIMEOUT_MS)

    ;(async () => {
      try {
        await healthApi.check()
        if (!cancelled && !doneRef.current) {
          doneRef.current = true
          setStatus('alive')
        }
      } catch {
        if (!cancelled && !doneRef.current) {
          doneRef.current = true
          setStatus('sleeping')
        }
      } finally {
        clearTimeout(timer)
      }
    })()

    return () => {
      cancelled = true
      clearTimeout(timer)
    }
  }, [])

  return status
}
