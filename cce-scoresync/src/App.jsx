import { AppProvider } from './store/AppContext'
import { Layout } from './components/Layout'
import { ToastProvider } from './components/Toast'
import ServerWakeUp from './components/ServerWakeUp'
import AISettingsPage from './pages/AISettingsPage'
import DashboardPage from './pages/DashboardPage'
import HistoryPage from './pages/HistoryPage'
import NewReconciliationPage from './pages/NewReconciliationPage'
import PreviewPage from './pages/PreviewPage'
import ResultsPage from './pages/ResultsPage'
import { BrowserRouter, Navigate, Route, Routes } from 'react-router-dom'
import { useServerStatus } from './hooks/useServerStatus'
import { useState } from 'react'
import './index.css'

function AppRoutes() {
  return (
    <AppProvider>
      <ToastProvider>
        <Layout>
          <Routes>
            <Route path="/" element={<DashboardPage />} />
            <Route path="/reconcile/new" element={<NewReconciliationPage />} />
            <Route path="/reconcile/:id/preview" element={<PreviewPage />} />
            <Route path="/reconcile/:id/results" element={<ResultsPage />} />
            <Route path="/history" element={<HistoryPage />} />
            <Route path="/settings/ai" element={<AISettingsPage />} />
            <Route path="*" element={<Navigate to="/" replace />} />
          </Routes>
        </Layout>
      </ToastProvider>
    </AppProvider>
  )
}

function AppShell() {
  const serverStatus = useServerStatus()  // 'checking' | 'alive' | 'sleeping'
  const [dismissed, setDismissed] = useState(false)

  // Show the wake-up screen when:
  //  - Still probing (checking) — but only if it takes > 0 s (no flash on fast response)
  //  - Server confirmed sleeping
  // Hide when: alive, or user dismissed, or status is still 'checking' within grace period.
  const showWakeUp =
    !dismissed &&
    (serverStatus === 'sleeping')

  return (
    <>
      <AppRoutes />
      {showWakeUp && (
        <ServerWakeUp
          onReady={() => setDismissed(true)}
          onDismiss={() => setDismissed(true)}
        />
      )}
    </>
  )
}

export default function App() {
  return (
    <BrowserRouter>
      <AppShell />
    </BrowserRouter>
  )
}
