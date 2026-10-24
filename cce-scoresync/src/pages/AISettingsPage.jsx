import { aiApi } from '../services/api'
import { Spinner } from '../components/Spinner'
import { useToast } from '../components/Toast'
import { useAppContext } from '../store/AppContext'
import {
  AlertCircle,
  AlertTriangle,
  Bot,
  Check,
  CheckCircle,
  Cloud,
  Cpu,
  Eye,
  EyeOff,
  Key,
  Layers,
  Plus,
  RefreshCw,
  RotateCcw,
  Save,
  Server,
  ShieldCheck,
  Sparkles,
  Trash2,
  XCircle,
} from 'lucide-react'
import { useEffect, useState } from 'react'
import { Alert } from '../components/Alert'

export default function AISettingsPage() {
  const { checkHealth } = useAppContext()
  const toast = useToast()
  const [settings, setSettings] = useState(null)
  const [models, setModels] = useState([])
  const [loadingModels, setLoadingModels] = useState(false)

  // Provider
  const [ocrProvider, setOcrProvider] = useState('paddle_ollama') // 'paddle_ollama' | 'gemini' | 'ollama'

  // Gemini / Cloud AI
  const [apiKey, setApiKey] = useState('')
  const [showKey, setShowKey] = useState(false)
  const [selectedModel, setSelectedModel] = useState('')
  const [baseUrl, setBaseUrl] = useState('')

  // Key Pool states
  const [bulkKeysInput, setBulkKeysInput] = useState('')
  const [addingKeys, setAddingKeys] = useState(false)
  const [testingAllKeys, setTestingAllKeys] = useState(false)
  const [testedKeyResults, setTestedKeyResults] = useState({})

  // Ollama / Local AI
  const [ollamaModel, setOllamaModel] = useState('qwen2.5:3b')
  const [enableCrossValidation, setEnableCrossValidation] = useState(true)
  const [ollamaModels, setOllamaModels] = useState([])
  const [loadingOllamaModels, setLoadingOllamaModels] = useState(false)
  const [ollamaStatus, setOllamaStatus] = useState(null)
  const [checkingOllama, setCheckingOllama] = useState(false)

  const [saving, setSaving] = useState(false)
  const [testing, setTesting] = useState(false)
  const [testResult, setTestResult] = useState(null)

  useEffect(() => {
    loadSettings()
    loadModels()
    checkOllamaStatus()
    loadOllamaModels()
  }, [])

  const loadSettings = () => {
    aiApi.getSettings().then((res) => {
      setSettings(res.data)
      setSelectedModel(res.data.model || '')
      setBaseUrl(res.data.base_url || '')
      if (res.data.ocr_provider) setOcrProvider(res.data.ocr_provider)
      if (res.data.ollama_model) setOllamaModel(res.data.ollama_model)
      if (res.data.enable_cross_validation !== undefined) {
        setEnableCrossValidation(Boolean(res.data.enable_cross_validation))
      }
    })
  }

  const loadModels = () => {
    setLoadingModels(true)
    aiApi
      .getModels()
      .then((res) => setModels(res.data.models || []))
      .catch(() => setModels([]))
      .finally(() => setLoadingModels(false))
  }

  const checkOllamaStatus = () => {
    setCheckingOllama(true)
    aiApi
      .getOllamaStatus()
      .then((res) => setOllamaStatus(res.data))
      .catch((err) =>
        setOllamaStatus({
          available: false,
          success: false,
          message: err.message || 'Không kết nối được tới Ollama',
        })
      )
      .finally(() => setCheckingOllama(false))
  }

  const loadOllamaModels = () => {
    setLoadingOllamaModels(true)
    aiApi
      .getOllamaModels()
      .then((res) => setOllamaModels(res.data.models || []))
      .catch(() => setOllamaModels([]))
      .finally(() => setLoadingOllamaModels(false))
  }

  // Key Pool actions
  const handleAddBulkKeys = async () => {
    if (!bulkKeysInput.trim()) return
    setAddingKeys(true)
    try {
      const res = await aiApi.addKeys(bulkKeysInput.trim())
      setSettings(res.data)
      setBulkKeysInput('')
      toast.success('Đã thêm thành công API Key mới vào kho.')
    } catch (e) {
      toast.error(`Thêm key thất bại: ${e.message}`)
    } finally {
      setAddingKeys(false)
    }
  }

  const handleDeleteKey = async (index) => {
    if (!window.confirm(`Bạn có chắc muốn xóa API Key #${index + 1} khỏi kho?`)) return
    try {
      const res = await aiApi.deleteKey(index)
      setSettings(res.data)
      toast.success(`Đã xóa API Key #${index + 1}`)
    } catch (e) {
      toast.error(`Xóa key thất bại: ${e.message}`)
    }
  }

  const handleResetKeys = async (keyIndex = null) => {
    try {
      const res = await aiApi.resetKeys(keyIndex)
      setSettings(res.data)
      setTestedKeyResults({})
      toast.success(
        keyIndex !== null
          ? `Đã khôi phục API Key #${keyIndex + 1} về trạng thái Sẵn sàng`
          : 'Đã khôi phục tất cả API Key về trạng thái Sẵn sàng'
      )
    } catch (e) {
      toast.error(`Khôi phục key thất bại: ${e.message}`)
    }
  }

  const handleTestAllKeys = async () => {
    setTestingAllKeys(true)
    setTestedKeyResults({})
    try {
      const res = await aiApi.testAllKeys()
      setSettings(res.data.settings)
      const resultsMap = {}
      ;(res.data.results || []).forEach((r) => {
        resultsMap[r.index] = r
      })
      setTestedKeyResults(resultsMap)
      toast.success('Đã kiểm tra xong toàn bộ các API Key trong kho.')
    } catch (e) {
      toast.error(`Kiểm tra thất bại: ${e.message}`)
    } finally {
      setTestingAllKeys(false)
    }
  }

  const handleSave = async () => {
    setSaving(true)
    setTestResult(null)
    try {
      const payload = {
        ocr_provider: ocrProvider,
        ollama_model: ollamaModel,
        enable_cross_validation: enableCrossValidation,
        model: selectedModel,
        base_url: baseUrl.trim(),
      }
      if (apiKey.trim()) payload.api_key = apiKey.trim()

      const res = await aiApi.updateSettings(payload)
      setSettings(res.data)
      toast.success('Cài đặt AI đã được lưu thành công.')
      setApiKey('')
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
      if (ocrProvider === 'ollama' || ocrProvider === 'paddle_ollama') {
        const res = await aiApi.getOllamaStatus()
        setOllamaStatus(res.data)
        if (res.data.success) {
          setTestResult({
            success: true,
            message: res.data.message || 'Ollama đang hoạt động tốt',
            model: res.data.model || ollamaModel,
          })
          toast.success(res.data.message || 'Kết nối Ollama thành công')
        } else {
          setTestResult({
            success: false,
            message: res.data.message || 'Ollama chưa sẵn sàng',
          })
          toast.error(res.data.message || 'Ollama chưa sẵn sàng')
        }
      } else {
        const payload = { model: selectedModel, base_url: baseUrl.trim() }
        if (apiKey.trim()) payload.api_key = apiKey.trim()
        const res = await aiApi.testConnection(payload)
        setTestResult({
          success: true,
          message: res.data.message,
          model: res.data.model,
        })
        toast.success(`Kết nối thành công · Model: ${res.data.model}`)
      }
    } catch (e) {
      setTestResult({ success: false, message: e.message })
      toast.error(`Kiểm tra kết nối thất bại: ${e.message}`)
    } finally {
      setTesting(false)
    }
  }

  const apiKeys = settings?.api_keys || []
  const totalKeys = settings?.total_keys || apiKeys.length
  const activeKeys = settings?.active_keys ?? apiKeys.filter((k) => k.status === 'active').length
  const exhaustedKeys = settings?.exhausted_keys ?? apiKeys.filter((k) => k.status === 'exhausted').length
  const estimatedPages = settings?.estimated_pages_remaining ?? activeKeys * 20

  return (
    <div className="px-8 py-8 max-w-4xl mx-auto space-y-6">
      {/* Page Title */}
      <div className="flex items-center gap-3 pb-2 border-b border-slate-200">
        <div className="w-10 h-10 rounded-xl bg-slate-100 flex items-center justify-center text-slate-700 shadow-sm border border-slate-200">
          <Bot size={20} />
        </div>
        <div>
          <h1 className="text-xl font-bold text-slate-800">Cài đặt AI & OCR</h1>
          <p className="text-sm text-slate-500">
            Tùy chọn engine nhận diện tài liệu: Cloud AI (Gemini Multi-Key) hoặc Local Dual-Engine (Ollama + PaddleOCR)
          </p>
        </div>
      </div>

      {/* Engine Provider Selection Card */}
      <div className="panel panel-body border-slate-200 shadow-sm">
        <label className="text-xs font-bold text-slate-500 uppercase tracking-wider block mb-3">
          Lựa chọn Engine OCR chính
        </label>
        <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
          {/* PaddleOCR + Ollama Option (Recommended) */}
          <div
            onClick={() => setOcrProvider('paddle_ollama')}
            className={`p-4 rounded-xl border-2 cursor-pointer transition-all flex flex-col justify-between ${
              ocrProvider === 'paddle_ollama'
                ? 'border-emerald-500 bg-emerald-50/40 shadow-sm ring-1 ring-emerald-500'
                : 'border-slate-200 hover:border-slate-300 bg-white'
            }`}
          >
            <div className="flex items-start gap-3">
              <div
                className={`p-2.5 rounded-lg ${
                  ocrProvider === 'paddle_ollama' ? 'bg-emerald-600 text-white' : 'bg-slate-100 text-slate-600'
                }`}
              >
                <Layers size={20} />
              </div>
              <div className="flex-1">
                <div className="flex items-center justify-between">
                  <h3 className="font-semibold text-slate-900 text-sm">PaddleOCR + Ollama Text</h3>
                  {ocrProvider === 'paddle_ollama' && (
                    <span className="w-2.5 h-2.5 rounded-full bg-emerald-600 ring-4 ring-emerald-100" />
                  )}
                </div>
                <p className="text-xs text-slate-500 mt-1 leading-relaxed">
                  Bố cục có cấu trúc: PaddleOCR đọc tọa độ & bảng → Ollama trích xuất JSON. Không lo thiếu dòng, lệch cột.
                </p>
              </div>
            </div>
            <div className="mt-3 pt-2.5 border-t border-slate-100 flex items-center justify-between text-[11px] text-slate-500">
              <span className="font-semibold text-emerald-600 flex items-center gap-1">
                <Sparkles size={12} /> Khuyên dùng
              </span>
              <span className="font-medium text-emerald-700 flex items-center gap-1">
                <ShieldCheck size={13} /> 100% Offline
              </span>
            </div>
          </div>

          {/* Gemini Option */}
          <div
            onClick={() => setOcrProvider('gemini')}
            className={`p-4 rounded-xl border-2 cursor-pointer transition-all flex flex-col justify-between ${
              ocrProvider === 'gemini'
                ? 'border-blue-500 bg-blue-50/40 shadow-sm ring-1 ring-blue-500'
                : 'border-slate-200 hover:border-slate-300 bg-white'
            }`}
          >
            <div className="flex items-start gap-3">
              <div
                className={`p-2.5 rounded-lg ${
                  ocrProvider === 'gemini' ? 'bg-blue-600 text-white' : 'bg-slate-100 text-slate-600'
                }`}
              >
                <Cloud size={20} />
              </div>
              <div className="flex-1">
                <div className="flex items-center justify-between">
                  <h3 className="font-semibold text-slate-900 text-sm">Gemini Cloud (Multi-Key)</h3>
                  {ocrProvider === 'gemini' && (
                    <span className="w-2.5 h-2.5 rounded-full bg-blue-600 ring-4 ring-blue-100" />
                  )}
                </div>
                <p className="text-xs text-slate-500 mt-1 leading-relaxed">
                  Gemini AI Vision qua API. Hỗ trợ kho nhiều API Key tự động xoay vòng khi hết quota.
                </p>
              </div>
            </div>
            <div className="mt-3 pt-2.5 border-t border-slate-100 flex items-center justify-between text-[11px] text-slate-500">
              <span className="font-semibold text-blue-600 flex items-center gap-1">
                <Key size={12} /> Auto-Rotation
              </span>
              <span className="font-medium text-slate-600">Độ chính xác cao</span>
            </div>
          </div>

          {/* Ollama Vision Direct Option */}
          <div
            onClick={() => setOcrProvider('ollama')}
            className={`p-4 rounded-xl border-2 cursor-pointer transition-all flex flex-col justify-between ${
              ocrProvider === 'ollama'
                ? 'border-indigo-500 bg-indigo-50/40 shadow-sm ring-1 ring-indigo-500'
                : 'border-slate-200 hover:border-slate-300 bg-white'
            }`}
          >
            <div className="flex items-start gap-3">
              <div
                className={`p-2.5 rounded-lg ${
                  ocrProvider === 'ollama' ? 'bg-indigo-600 text-white' : 'bg-slate-100 text-slate-600'
                }`}
              >
                <Cpu size={20} />
              </div>
              <div className="flex-1">
                <div className="flex items-center justify-between">
                  <h3 className="font-semibold text-slate-900 text-sm">LLaVA:7b Vision Direct</h3>
                  {ocrProvider === 'ollama' && (
                    <span className="w-2.5 h-2.5 rounded-full bg-indigo-600 ring-4 ring-indigo-100" />
                  )}
                </div>
                <p className="text-xs text-slate-500 mt-1 leading-relaxed">
                  Gửi ảnh trực tiếp đến LLaVA:7b trên Ollama local.
                </p>
              </div>
            </div>
            <div className="mt-3 pt-2.5 border-t border-slate-100 flex items-center justify-between text-[11px] text-slate-500">
              <span className="font-medium text-slate-600">Chạy cục bộ</span>
              <span className="font-medium text-slate-600">Yêu cầu GPU &gt;=6GB</span>
            </div>
          </div>
        </div>
      </div>

      {/* GEMINI KEY POOL & ROTATION SECTION (Shown for all, highly prominent for Gemini) */}
      <div className="panel panel-body border-blue-200 bg-white shadow-sm space-y-4">
        <div className="flex flex-wrap items-center justify-between gap-3 pb-3 border-b border-slate-100">
          <div className="flex items-center gap-2.5">
            <div className="p-2 rounded-lg bg-blue-50 text-blue-700 border border-blue-200">
              <Key size={18} />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <h2 className="text-sm font-bold text-slate-800">
                  Kho API Key Gemini & Tự Động Xoay Vòng (Key Pool)
                </h2>
                <span className="badge bg-blue-100 text-blue-800 font-semibold text-[11px]">
                  Auto-Failover
                </span>
              </div>
              <p className="text-xs text-slate-500 mt-0.5">
                Tự động chuyển key khi key hiện tại chạm giới hạn 429. Dán nhiều key để tăng dung lượng đọc mỗi ngày.
              </p>
            </div>
          </div>

          <div className="flex items-center gap-2">
            <button
              type="button"
              className="btn btn-secondary btn-sm text-xs flex items-center gap-1.5"
              onClick={handleTestAllKeys}
              disabled={testingAllKeys || apiKeys.length === 0}
            >
              {testingAllKeys ? <Spinner size={12} /> : <RefreshCw size={12} />}
              {testingAllKeys ? 'Đang test...' : 'Kiểm tra tất cả Key'}
            </button>

            <button
              type="button"
              className="btn btn-secondary btn-sm text-xs flex items-center gap-1.5 text-slate-600"
              onClick={() => handleResetKeys()}
              title="Khôi phục tất cả key về trạng thái Sẵn sàng"
            >
              <RotateCcw size={12} />
              Khôi phục tất cả
            </button>
          </div>
        </div>

        {/* Capacity Estimation Banner */}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-2.5">
          <div className="bg-slate-50 p-3 rounded-lg border border-slate-200 text-center">
            <span className="text-[11px] text-slate-400 block uppercase font-medium">Tổng số Key</span>
            <span className="text-lg font-bold text-slate-800">{totalKeys}</span>
          </div>

          <div className="bg-emerald-50 p-3 rounded-lg border border-emerald-200 text-center">
            <span className="text-[11px] text-emerald-600 block uppercase font-medium">Sẵn sàng (Active)</span>
            <span className="text-lg font-bold text-emerald-700">{activeKeys}</span>
          </div>

          <div className="bg-amber-50 p-3 rounded-lg border border-amber-200 text-center">
            <span className="text-[11px] text-amber-700 block uppercase font-medium">Đã cạn Quota (429)</span>
            <span className="text-lg font-bold text-amber-800">{exhaustedKeys}</span>
          </div>

          <div className="bg-blue-50 p-3 rounded-lg border border-blue-200 text-center">
            <span className="text-[11px] text-blue-700 block uppercase font-medium">Ước tính lượt đọc</span>
            <span className="text-lg font-bold text-blue-800">~{estimatedPages} trang</span>
          </div>
        </div>

        {/* Warning if all keys exhausted */}
        {totalKeys > 0 && activeKeys === 0 && (
          <div className="p-3.5 rounded-lg bg-red-50 border border-red-200 text-xs text-red-800 flex items-start gap-2.5">
            <AlertTriangle size={17} className="text-red-600 shrink-0 mt-0.5" />
            <div className="space-y-1">
              <p className="font-semibold text-red-900">
                Tất cả các API Key Gemini trong kho đều đã chạm hạn mức hôm nay (429 Quota Limit)!
              </p>
              <p className="text-red-700 leading-relaxed">
                Bạn có thể <strong>dán thêm API Key mới</strong> vào ô bên dưới, hoặc hệ thống sẽ tự động kích hoạt{' '}
                <strong>PaddleOCR + Ollama local</strong> để hoàn tất tài liệu mà không bị gián đoạn.
              </p>
            </div>
          </div>
        )}

        {/* Key Pool Table */}
        <div className="border border-slate-200 rounded-lg overflow-hidden">
          <table className="w-full text-xs text-left">
            <thead className="bg-slate-50 border-b border-slate-200 text-slate-500">
              <tr>
                <th className="py-2.5 px-3 font-semibold w-12 text-center">STT</th>
                <th className="py-2.5 px-3 font-semibold">Mã API Key</th>
                <th className="py-2.5 px-3 font-semibold text-center">Trạng thái</th>
                <th className="py-2.5 px-3 font-semibold text-center">Đã trích xuất</th>
                <th className="py-2.5 px-3 font-semibold text-right">Thao tác</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {apiKeys.length === 0 ? (
                <tr>
                  <td colSpan={5} className="py-6 text-center text-slate-400">
                    Chưa có API key nào trong kho. Hãy dán key vào ô bên dưới để thêm.
                  </td>
                </tr>
              ) : (
                apiKeys.map((item, idx) => {
                  const testRes = testedKeyResults[item.index]
                  return (
                    <tr key={idx} className="hover:bg-slate-50/60 transition-colors">
                      <td className="py-2 px-3 text-center font-mono text-slate-400 font-medium">
                        #{idx + 1}
                      </td>

                      <td className="py-2 px-3">
                        <div className="flex items-center gap-2">
                          <span className="font-mono font-bold text-slate-800 bg-slate-100 px-2 py-0.5 rounded border border-slate-200">
                            AIza...{item.masked_key?.replace(/^\.\.\./, '')}
                          </span>
                          {idx === 0 && (
                            <span className="text-[10px] bg-slate-200 text-slate-700 px-1.5 py-0.2 rounded font-medium">
                              Ưu tiên 1
                            </span>
                          )}
                        </div>
                        {item.error_message && (
                          <p className="text-[11px] text-amber-700 mt-0.5 truncate max-w-sm" title={item.error_message}>
                            {item.error_message}
                          </p>
                        )}
                      </td>

                      <td className="py-2 px-3 text-center">
                        {item.status === 'active' ? (
                          <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[11px] font-semibold bg-emerald-100 text-emerald-800 border border-emerald-200">
                            <CheckCircle size={11} /> Sẵn sàng
                          </span>
                        ) : item.status === 'exhausted' ? (
                          <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[11px] font-semibold bg-amber-100 text-amber-800 border border-amber-300" title={item.exhausted_at || ''}>
                            <AlertCircle size={11} /> Hết Quota (429)
                          </span>
                        ) : (
                          <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[11px] font-semibold bg-red-100 text-red-800 border border-red-200">
                            <XCircle size={11} /> Lỗi
                          </span>
                        )}
                        {testRes && (
                          <span className="block text-[10px] text-slate-500 mt-0.5">
                            {testRes.message}
                          </span>
                        )}
                      </td>

                      <td className="py-2 px-3 text-center font-mono font-medium text-slate-600">
                        {item.requests_count || 0} lượt
                      </td>

                      <td className="py-2 px-3 text-right">
                        <div className="flex items-center justify-end gap-1.5">
                          {item.status === 'exhausted' && (
                            <button
                              type="button"
                              className="btn btn-ghost btn-sm p-1 text-amber-700 hover:bg-amber-50"
                              onClick={() => handleResetKeys(item.index)}
                              title="Khôi phục trạng thái Sẵn sàng cho key này"
                            >
                              <RotateCcw size={13} />
                            </button>
                          )}
                          <button
                            type="button"
                            className="btn btn-ghost btn-sm p-1 text-red-500 hover:bg-red-50 hover:text-red-700"
                            onClick={() => handleDeleteKey(item.index)}
                            title="Xóa key này khỏi kho"
                          >
                            <Trash2 size={13} />
                          </button>
                        </div>
                      </td>
                    </tr>
                  )
                })
              )}
            </tbody>
          </table>
        </div>

        {/* Bulk Add Keys Form */}
        <div className="bg-slate-50/80 p-3.5 rounded-lg border border-slate-200 space-y-2">
          <div className="flex items-center justify-between">
            <label className="text-xs font-semibold text-slate-700 flex items-center gap-1.5">
              <Plus size={14} className="text-blue-600" />
              Thêm một hoặc nhiều API Key vào kho
            </label>
            <span className="text-[11px] text-slate-400">
              Dán mỗi dòng 1 key hoặc cách nhau bằng dấu phẩy
            </span>
          </div>

          <textarea
            className="input font-mono text-xs w-full py-2 px-3 h-20"
            placeholder="AIzaSyA123456789...&#10;AIzaSyB987654321..."
            value={bulkKeysInput}
            onChange={(e) => setBulkKeysInput(e.target.value)}
          />

          <div className="flex items-center justify-between pt-1">
            <span className="text-[11px] text-slate-500">
              💡 Mỗi Google Account / Project cấp 1 key miễn phí. Thêm 3–5 key sẽ giúp bạn quét thoải mái các file 30+ trang.
            </span>
            <button
              type="button"
              className="btn btn-primary btn-sm text-xs flex items-center gap-1.5 shadow-xs"
              onClick={handleAddBulkKeys}
              disabled={addingKeys || !bulkKeysInput.trim()}
            >
              {addingKeys ? <Spinner size={12} /> : <Plus size={13} />}
              {addingKeys ? 'Đang thêm...' : 'Thêm vào kho Key'}
            </button>
          </div>
        </div>
      </div>

      {/* Ollama Configuration Panel */}
      {(ocrProvider === 'ollama' || ocrProvider === 'paddle_ollama') && (
        <div className="panel panel-body border-indigo-100 bg-white shadow-sm space-y-4">
          <div className="flex items-center justify-between pb-3 border-b border-slate-100">
            <div className="flex items-center gap-2">
              <Server size={17} className="text-indigo-600" />
              <h2 className="text-xs font-bold text-slate-700 uppercase tracking-wider">
                Cấu hình Ollama & Dual Validation
              </h2>
            </div>
            <div className="flex items-center gap-2">
              {checkingOllama ? (
                <span className="badge flex items-center gap-1 text-slate-500">
                  <Spinner size={12} /> Đang kiểm tra...
                </span>
              ) : ollamaStatus?.available ? (
                <span className="badge badge-match flex items-center gap-1">
                  <CheckCircle size={12} /> Ollama đang chạy
                </span>
              ) : (
                <span className="badge badge-mismatch flex items-center gap-1">
                  <XCircle size={12} /> Ollama chưa chạy
                </span>
              )}
              <button
                type="button"
                className="btn btn-ghost btn-sm p-1 text-slate-400 hover:text-slate-600"
                onClick={() => {
                  checkOllamaStatus()
                  loadOllamaModels()
                }}
                title="Kiểm tra lại trạng thái Ollama"
              >
                <RefreshCw size={13} />
              </button>
            </div>
          </div>

          {!ollamaStatus?.available && (
            <div className="p-3 rounded-lg bg-amber-50 border border-amber-200 text-xs text-amber-800 space-y-1">
              <p className="font-semibold flex items-center gap-1.5">
                ⚠️ Không tìm thấy Ollama đang chạy trên localhost:11434
              </p>
              <p className="text-slate-600">
                Hãy mở terminal và khởi động Ollama bằng lệnh:{' '}
                <code className="bg-amber-100 px-1 py-0.5 rounded font-mono text-amber-900 font-bold">
                  ollama serve
                </code>
              </p>
            </div>
          )}

          {/* Model Selection for Ollama */}
          <div>
            <div className="flex items-center justify-between mb-1.5">
              <label className="block text-sm font-medium text-slate-700" htmlFor="ollama-model-select">
                Ollama Model (Chuẩn hóa JSON)
              </label>
              <button
                type="button"
                className="btn btn-ghost btn-sm text-slate-500 text-xs"
                onClick={loadOllamaModels}
                disabled={loadingOllamaModels}
              >
                {loadingOllamaModels ? <Spinner size={12} /> : <RefreshCw size={12} />}
                Tải lại danh sách
              </button>
            </div>
            <select
              id="ollama-model-select"
              className="input text-xs"
              value={ollamaModel}
              onChange={(e) => setOllamaModel(e.target.value)}
            >
              <option value="qwen2.5:3b">qwen2.5:3b (Khuyên dùng - 1.9GB, chạy cực nhẹ, không OOM)</option>
              <option value="llava:7b">llava:7b (Vision model - 4.7GB)</option>
              <option value="llava:13b">llava:13b (Chính xác cao hơn - cần nhiều VRAM hơn)</option>
              {ollamaModels
                .filter((m) => !['qwen2.5:3b', 'llava:7b', 'llava:13b'].includes(m.name))
                .map((m) => (
                  <option key={m.name} value={m.name}>
                    {m.name}
                  </option>
                ))}
            </select>
          </div>

          {/* Cross Validation Toggle */}
          <div className="p-3.5 rounded-xl bg-slate-50 border border-slate-200">
            <label className="flex items-start gap-3 cursor-pointer">
              <input
                type="checkbox"
                className="mt-0.5 h-4 w-4 rounded border-slate-300 text-indigo-600 focus:ring-indigo-500"
                checked={enableCrossValidation}
                onChange={(e) => setEnableCrossValidation(e.target.checked)}
              />
              <div className="flex-1">
                <span className="text-sm font-medium text-slate-800 block">
                  Bật Cross-Validation với PaddleOCR (Đối chiếu 2 engine)
                </span>
                <span className="text-xs text-slate-500 block mt-0.5 leading-relaxed">
                  So sánh mã HV, họ tên, điểm số giữa 2 engine và gán nhãn độ tin cậy tự động.
                </span>
              </div>
            </label>
          </div>
        </div>
      )}

      {/* Cloud Model Selection (When Gemini chosen) */}
      {ocrProvider === 'gemini' && (
        <div className="panel panel-body border-slate-200 shadow-sm space-y-4">
          <div className="flex items-center gap-2 pb-3 border-b border-slate-100">
            <Cloud size={17} className="text-blue-600" />
            <h2 className="text-xs font-bold text-slate-700 uppercase tracking-wider">
              Cấu hình Model Cloud AI
            </h2>
          </div>

          <div>
            <div className="flex items-center justify-between mb-1.5">
              <label className="block text-sm font-medium text-slate-700" htmlFor="model-select">
                Model AI Cloud
              </label>
              <button
                type="button"
                className="btn btn-ghost btn-sm text-slate-500 text-xs"
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
              className="input text-xs"
              value={selectedModel}
              onChange={(e) => setSelectedModel(e.target.value)}
            >
              <option value="models/gemini-2.0-flash">gemini-2.0-flash (Nhanh, thông minh, tối ưu)</option>
              <option value="models/gemini-1.5-flash">gemini-1.5-flash (Cũ hơn, ổn định)</option>
              <option value="models/gemini-2.5-flash-preview">gemini-2.5-flash-preview</option>
              {models
                .filter(
                  (m) =>
                    ![
                      'models/gemini-2.0-flash',
                      'models/gemini-1.5-flash',
                      'models/gemini-2.5-flash-preview',
                    ].includes(m.id)
                )
                .map((m) => (
                  <option key={m.id} value={m.id}>
                    {m.display_name || m.id} {m.supports_vision ? '· hỗ trợ ảnh' : ''}
                  </option>
                ))}
            </select>
          </div>
        </div>
      )}

      {/* Test result alert */}
      {testResult && (
        <Alert
          type={testResult.success ? 'success' : 'error'}
          message={
            testResult.success
              ? `Kết nối thành công · Model: ${testResult.model}`
              : testResult.message
          }
        />
      )}

      {/* Overview & Save Buttons */}
      <div className="panel panel-body bg-slate-50/70 border-slate-200">
        <h2 className="text-xs font-semibold text-slate-500 uppercase tracking-wide mb-3">
          Tóm tắt cấu hình đang áp dụng
        </h2>

        <dl className="space-y-2 mb-5">
          <InfoRow
            label="Engine OCR đang chọn"
            value={
              ocrProvider === 'paddle_ollama' ? (
                <span className="badge bg-emerald-100 text-emerald-800 font-semibold">
                  PaddleOCR + Ollama ({ollamaModel}) [Cấu trúc bảng]
                </span>
              ) : ocrProvider === 'ollama' ? (
                <span className="badge bg-indigo-100 text-indigo-700 font-semibold">
                  LLaVA ({ollamaModel}) + PaddleOCR Dual
                </span>
              ) : (
                <span className="badge bg-blue-100 text-blue-700 font-semibold">
                  Cloud AI ({selectedModel || 'Gemini'}) [Multi-Key Pool]
                </span>
              )
            }
          />

          <InfoRow
            label="Kho API Key Gemini"
            value={
              totalKeys > 0 ? (
                <span className="text-sm font-semibold text-slate-700">
                  {activeKeys}/{totalKeys} key sẵn sàng (Ước tính ~{estimatedPages} lượt đọc trang)
                </span>
              ) : (
                <span className="text-slate-400">Chưa có key</span>
              )
            }
          />
        </dl>

        <div className="flex gap-3">
          <button
            type="button"
            id="test-connection-btn"
            className="btn btn-secondary"
            onClick={handleTest}
            disabled={testing || saving}
          >
            {testing ? <Spinner size={14} /> : <Check size={15} />}
            Kiểm tra kết nối {ocrProvider === 'gemini' ? 'Cloud API' : 'Ollama'}
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
    </div>
  )
}

function InfoRow({ label, value }) {
  return (
    <div className="flex items-center justify-between py-1.5 border-b border-slate-100 last:border-0">
      <dt className="text-xs text-slate-500">{label}</dt>
      <dd className="text-sm">{value}</dd>
    </div>
  )
}
