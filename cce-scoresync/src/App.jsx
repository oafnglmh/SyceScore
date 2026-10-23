import { AppProvider } from './store/AppContext'
import { Layout } from './components/Layout'
import { ToastProvider } from './components/Toast'
import AISettingsPage from './pages/AISettingsPage'
import DashboardPage from './pages/DashboardPage'
import HistoryPage from './pages/HistoryPage'
import NewReconciliationPage from './pages/NewReconciliationPage'
import PreviewPage from './pages/PreviewPage'
import ResultsPage from './pages/ResultsPage'
import { BrowserRouter, Navigate, Route, Routes } from 'react-router-dom'
import './index.css'

export default function App() {
  return (
    <BrowserRouter>
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
    </BrowserRouter>
  )
}

