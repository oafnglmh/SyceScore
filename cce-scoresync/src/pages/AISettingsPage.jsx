import { aiApi } from '../services/api'
import { Spinner } from '../components/Spinner'
import { useToast } from '../components/Toast'
import { useAppContext } from '../store/AppContext'
import { Bot, Check, Eye, EyeOff, RefreshCw, Save } from 'lucide-react'
import { useEffect, useState } from 'react'
import { Alert } from '../components/Alert'

export default function AISettingsPage() {
  const { checkHealth } = useAppContext()
  const toast = useToast()
  const [settings, setSettings] = useState(null)
  const [models, setModels] = useState([])
  const [loadingModels, setLoadingModels] = useState(false)

  const [apiKey, setApiKey] = useState('')
  const [showKey, setShowKey] = useState(false)
  const [selectedModel, setSelectedModel] = useState('')
  const [baseUrl, setBaseUrl] = useState('')

  const [saving, setSaving] = useState(false)
  const [testing, setTesting] = useState(false)
  const [testResult, setTestResult] = useState(null)

  useEffect(() => {
    aiApi.getSettings().then((res) => {
      setSettings(res.data)
      setSelectedModel(res.data.model || '')
      setBaseUrl(res.data.base_url || '')
    })
    loadModels()
  }, [])

  const loadModels = () => {
    setLoadingModels(true)
    aiApi
      .getModels()
      .then((res) => setModels(res.data.models || []))
      .catch(() => setModels([]))
      .finally(() => setLoadingModels(false))
  }

  const handleSave = async () => {
    setSaving(true)
    setTestResult(null)
    try {
      const payload = { model: selectedModel, base_url: baseUrl.trim() }
      if (apiKey.trim()) payload.api_key = apiKey.trim()
      await aiApi.updateSettings(payload)
      toast.success('Cài đặt AI đã được lưu thành công.')
      setApiKey('')
      // Reload settings to get masked key
      const res = await aiApi.getSettings()
      setSettings(res.data)
      setBaseUrl(res.data.base_url || '')
      await checkHealth()
    } catch (e) {
      toast.error(`Lưu thất bại: ${e.message}`)
    } finally {
      setSaving(false)
    }
  }

  const handleTest = async () => {
    setTesting(true)
    setTestResult(null)
    try {
      const payload = { model: selectedModel, base_url: baseUrl.trim() }
      if (apiKey.trim()) payload.api_key = apiKey.trim()
      const res = await aiApi.testConnection(payload)
      setTestResult({ success: true, message: res.data.message, model: res.data.model })
      toast.success(`Kết nối thành công · Model: ${res.data.model}`)
    } catch (e) {
      setTestResult({ success: false, message: e.message })
      toast.error(`Kiểm tra kết nối thất bại: ${e.message}`)
    } finally {
      setTesting(false)
    }
  }

  return (
    <div className="px-8 py-8 max-w-2xl">
      <div className="flex items-center gap-3 mb-6">
        <div className="w-9 h-9 rounded-lg bg-slate-100 flex items-center justify-center">
          <Bot size={18} className="text-slate-600" />
        </div>
        <div>
          <h1 className="text-xl font-bold text-slate-800">Cài đặt AI</h1>
          <p className="text-sm text-slate-500">Cấu hình ChatGPT (OpenAI) hoặc Gemini API để phân tích tài liệu</p>
        </div>
      </div>



      {/* Current config info */}
      {settings && (
        <div className="panel panel-body mb-5">
          <h2 className="text-xs font-semibold text-slate-500 uppercase tracking-wide mb-3">
            Cấu hình hiện tại
          </h2>
          <dl className="space-y-2">
            <InfoRow
              label="API Key"
              value={
                settings.api_key_masked
                  ? <span className="font-mono text-sm text-slate-700">····{settings.api_key_masked}</span>
                  : <span className="text-slate-400">Chưa cấu hình</span>
              }
            />
            <InfoRow label="Model" value={settings.model || <span className="text-slate-400">Chưa chọn</span>} />
            <InfoRow
              label="Trạng thái"
              value={
                settings.is_configured ? (
                  <span className="badge badge-match">Đã cấu hình</span>
                ) : (
                  <span className="badge badge-mismatch">Chưa cấu hình</span>
                )
              }
            />
          </dl>
        </div>
      )}

      {/* Update form */}
      <div className="panel panel-body mb-5">
        <h2 className="text-xs font-semibold text-slate-500 uppercase tracking-wide mb-4">
          Cập nhật cấu hình
        </h2>

        {/* API Key field */}
        <div className="mb-4">
          <label className="block text-sm font-medium text-slate-700 mb-1.5" htmlFor="api-key-input">
            API Key (OpenAI ChatGPT hoặc Gemini)
          </label>
          <div className="relative">
            <input
              id="api-key-input"
              type={showKey ? 'text' : 'password'}
              className="input pr-10"
              placeholder={
                settings?.api_key_masked
                  ? `Giữ key hiện tại (····${settings.api_key_masked})`
                  : 'Nhập OpenAI API Key (sk-...) hoặc Gemini API Key (AIzaSy...)'
              }
              value={apiKey}
              onChange={(e) => setApiKey(e.target.value)}
              autoComplete="off"
            />
            <button
              type="button"
              className="absolute right-2.5 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600"
              onClick={() => setShowKey((v) => !v)}
              aria-label={showKey ? 'Ẩn key' : 'Hiển thị key'}
            >
              {showKey ? <EyeOff size={15} /> : <Eye size={15} />}
            </button>
          </div>
          <p className="text-xs text-slate-400 mt-1.5">
            Hỗ trợ OpenAI Key (<span className="font-mono">sk-...</span>) cho ChatGPT (GPT-4o/GPT-4o-mini/GPT-5.6) hoặc Gemini Key (<span className="font-mono">AIzaSy...</span>). Bỏ trống để giữ key hiện tại.
          </p>
        </div>

        {/* API Base URL field (Optional / Proxy / Gateway) */}
        <div className="mb-4">
          <label className="block text-sm font-medium text-slate-700 mb-1.5" htmlFor="base-url-input">
            API Base URL (Tùy chọn - Dành cho Proxy / Gateway / Bên thứ ba)
          </label>
          <input
            id="base-url-input"
            type="text"
            className="input text-sm"
            placeholder="Mặc định OpenAI (https://api.openai.com/v1) hoặc nhập URL của bên cung cấp..."
            value={baseUrl}
            onChange={(e) => setBaseUrl(e.target.value)}
          />
          <p className="text-xs text-slate-400 mt-1.5">
            Nếu bạn mua key từ dịch vụ trung gian / proxy, hãy điền Base URL do bên bán cung cấp. Nếu dùng OpenAI trực tiếp, hãy để trống.
          </p>
        </div>

        {/* Model selection */}
        <div className="mb-5">
          <div className="flex items-center justify-between mb-1.5">
            <label className="block text-sm font-medium text-slate-700" htmlFor="model-select">
              Model AI
            </label>
            <button
              type="button"
              className="btn btn-ghost btn-sm text-slate-500"
              onClick={loadModels}
              disabled={loadingModels}
              id="refresh-models-btn"
            >
              {loadingModels ? <Spinner size={12} /> : <RefreshCw size={12} />}
              Cập nhật danh sách
            </button>
          </div>
          <select
            id="model-select"
            className="input"
            value={selectedModel}
            onChange={(e) => setSelectedModel(e.target.value)}
          >
            <option value="">-- Chọn model --</option>
            {models.map((m) => (
              <option key={m.id} value={m.id}>
                {m.display_name || m.id}
                {m.supports_vision ? ' · hỗ trợ ảnh' : ''}
              </option>
            ))}
            {/* Fallback if list fails */}
            {models.length === 0 && selectedModel && (
              <option value={selectedModel}>{selectedModel}</option>
            )}
          </select>
          {models.length === 0 && !loadingModels && (
            <p className="text-xs text-amber-600 mt-1">
              Không tải được danh sách model. Nhập API key hợp lệ để tải danh sách.
            </p>
          )}
        </div>

        {/* Test result */}
        {testResult && (
          <div className="mb-4">
            <Alert
              type={testResult.success ? 'success' : 'error'}
              message={
                testResult.success
                  ? `Kết nối thành công · Model: ${testResult.model}`
                  : testResult.message
              }
            />
          </div>
        )}

        {/* Actions */}
        <div className="flex gap-3">
          <button
            type="button"
            id="test-connection-btn"
            className="btn btn-secondary"
            onClick={handleTest}
            disabled={testing || saving}
          >
            {testing ? <Spinner size={14} /> : <Check size={15} />}
            Kiểm tra kết nối
          </button>
          <button
            type="button"
            id="save-settings-btn"
            className="btn btn-primary"
            onClick={handleSave}
            disabled={saving || testing}
          >
            {saving ? <Spinner size={14} /> : <Save size={15} />}
            Lưu cài đặt
          </button>
        </div>
      </div>

      {/* Security note */}
      <div className="panel panel-body bg-slate-50">
        <h2 className="text-xs font-semibold text-slate-500 uppercase tracking-wide mb-2">
          Lưu ý bảo mật
        </h2>
        <ul className="text-xs text-slate-500 space-y-1 list-disc list-inside">
          <li>API key được lưu bảo mật phía máy chủ, không tiết lộ ra frontend.</li>
          <li>Key không được ghi vào log hoặc source code.</li>
          <li>Tài liệu sẽ được gửi trực tiếp đến OpenAI hoặc Google API để trích xuất dữ liệu.</li>
          <li>Không tải lên tài liệu chứa dữ liệu nhạy cảm nếu không được phép.</li>
        </ul>
      </div>
    </div>
  )
}

function InfoRow({ label, value }) {
  return (
    <div className="flex items-center justify-between py-1.5 border-b border-slate-50 last:border-0">
      <dt className="text-xs text-slate-500">{label}</dt>
      <dd className="text-sm">{value}</dd>
    </div>
  )
}
