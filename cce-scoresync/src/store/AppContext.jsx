import { createContext, useCallback, useContext, useEffect, useState } from 'react'
import { healthApi } from '../services/api'

const AppContext = createContext(null)

export function AppProvider({ children }) {
  const [systemStatus, setSystemStatus] = useState({
    backend: 'checking', // 'ok' | 'error' | 'checking'
    ai: 'unknown', // 'configured' | 'unconfigured' | 'error' | 'unknown'
  })

  const checkHealth = useCallback(async () => {
    try {
      const res = await healthApi.check()
      setSystemStatus({
        backend: 'ok',
        ai: res.data.ai_configured ? 'configured' : 'unconfigured',
      })
    } catch {
      setSystemStatus((s) => ({ ...s, backend: 'error', ai: 'unknown' }))
    }
  }, [])

  useEffect(() => {
    checkHealth()
    const interval = setInterval(checkHealth, 30000)
    return () => clearInterval(interval)
  }, [checkHealth])

  return (
    <AppContext.Provider value={{ systemStatus, checkHealth }}>
      {children}
    </AppContext.Provider>
  )
}

export function useAppContext() {
  const ctx = useContext(AppContext)
  if (!ctx) throw new Error('useAppContext must be inside AppProvider')
  return ctx
}
