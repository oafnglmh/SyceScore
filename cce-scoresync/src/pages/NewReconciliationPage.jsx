import { reconciliationApi } from '../services/api'
import { FileUploadZone } from '../components/FileUploadZone'
import { ProgressStepper } from '../components/ProgressStepper'
import { useToast } from '../components/Toast'
import { useCallback, useEffect, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { AlertCircle, Play, RefreshCw } from 'lucide-react'

const POLL_INTERVAL_MS = 2000

export default function NewReconciliationPage() {
  const navigate = useNavigate()
  const toast = useToast()
  const [filesA, setFilesA] = useState([])
  const [filesB, setFilesB] = useState([])
  const [sessionId, setSessionId] = useState(null)
  const [sessionName, setSessionName] = useState('')
  const [phase, setPhase] = useState('idle') // idle | uploading | processing | done | error
  const [progress, setProgress] = useState(null)
  const [error, setError] = useState(null)
  const [warningMessage, setWarningMessage] = useState(null)
  const pollRef = useRef(null)

  const addFiles = useCallback((source, entries) => {
    const setter = source === 'A' ? setFilesA : setFilesB
    setter((prev) => {
      const existing = new Set(prev.map((e) => e.file.name))
      const deduped = entries.filter((e) => !existing.has(e.file.name))
      return [...prev, ...deduped]
    })
  }, [])

  const removeFile = useCallback((source, id) => {
    const setter = source === 'A' ? setFilesA : setFilesB
    setter((prev) => prev.filter((e) => e.id !== id))
  }, [])

  const canStart =
    filesA.filter((f) => !f.error).length > 0 &&
    filesB.filter((f) => !f.error).length > 0

  const startReconciliation = async () => {
    setPhase('uploading')
    setError(null)
    setWarningMessage(null)
    setProgress(null)
    try {
      const formData = new FormData()
      if (sessionName.trim()) formData.append('session_name', sessionName.trim())
      filesA.filter((f) => !f.error).forEach((e) => formData.append('files_a', e.file))
      filesB.filter((f) => !f.error).forEach((e) => formData.append('files_b', e.file))

      const res = await reconciliationApi.create(formData)
      const id = res.data.id
      setSessionId(id)
      setPhase('processing')
      startPolling(id)
    } catch (e) {
      toast.error(`Khởi tạo thất bại: ${e.message}`)
      setPhase('error')
    }
  }

  const startPolling = (id) => {
    let failCount = 0
    pollRef.current = setInterval(async () => {
      try {
        const res = await reconciliationApi.getProgress(id)
        failCount = 0
        const prog = res.data
        setProgress(prog)

        // Detect key-rotation warning from message field
        if (prog.warning_message) {
          setWarningMessage(prog.warning_message)
        } else if (
          prog.message &&
          (prog.message.toLowerCase().includes('fallback') ||
            prog.message.toLowerCase().includes('paddle') ||
            prog.message.toLowerCase().includes('api key'))
        ) {
          setWarningMessage(prog.message)
        }

        if (prog.status === 'completed') {
          clearInterval(pollRef.current)
          setPhase('done')
          navigate(`/reconcile/${id}/preview`)
        } else if (prog.status === 'error') {
          clearInterval(pollRef.current)
          const errMsg = prog.error_message || 'Lỗi xử lý không xác định'
          // Keep phase as 'error' — progress panel stays visible
          setError(errMsg)
          setPhase('error')
        }
      } catch (e) {
        failCount += 1
        if (failCount >= 8) {
          toast.error(`Mất kết nối đến máy chủ: ${e.message}`)
          clearInterval(pollRef.current)
          setPhase('error')
          setError('Mất kết nối đến máy chủ. Vui lòng kiểm tra kết nối và thử lại.')
        }
      }
    }, POLL_INTERVAL_MS)
  }

  useEffect(() => {
    return () => {
      if (pollRef.current) clearInterval(pollRef.current)
    }
  }, [])

  const isProcessing = phase === 'uploading' || phase === 'processing'
  // Show the progress panel whenever we are beyond idle (processing, error, or done)
  const showProgress = phase !== 'idle'

  return (
    <div className="px-8 py-8 max-w-4xl">
      <h1 className="text-xl font-bold text-slate-800 mb-1">Đối soát mới</h1>
      <p className="text-sm text-slate-500 mb-8">
        Tải lên tài liệu điểm từ hai nguồn để bắt đầu đối chiếu.
      </p>

      {error && (
        <div className="mb-6 p-3 rounded-md bg-red-50 border border-red-200 text-sm text-red-700">
          {error}
        </div>
      )}

      {/* Tên đợt đối soát (Tùy chọn) */}
      <div className="panel p-4 mb-6 bg-slate-50/50">
        <label className="block text-xs font-bold text-slate-700 uppercase tracking-wider mb-1.5">
          Tên đợt đối soát (tùy chọn)
        </label>
        <input
          type="text"
          className="input w-full text-sm bg-white"
          placeholder="Ví dụ: Đối soát K30 - HK6 - Đợt 1 (hoặc để trống hệ thống sẽ tự gắn mã)"
          value={sessionName}
          onChange={(e) => setSessionName(e.target.value)}
          disabled={isProcessing}
        />
        <p className="text-xs text-slate-400 mt-1.5">
          Đặt tên gợi nhớ để dễ dàng tìm kiếm và xem lại trong trang Lịch sử.
        </p>
      </div>

      <div className="grid grid-cols-2 gap-6 mb-8">
        {/* Source A */}
        <div className="panel panel-body">
          <FileUploadZone
            label="Biên bản điểm viết tay"
            sourceKey="A"
            files={filesA}
            onAdd={(entries) => addFiles('A', entries)}
            onRemove={(id) => removeFile('A', id)}
            disabled={isProcessing}
          />
        </div>

        {/* Source B */}
        <div className="panel panel-body">
          <FileUploadZone
            label="Điểm hệ thống CCE"
            sourceKey="B"
            files={filesB}
            onAdd={(entries) => addFiles('B', entries)}
            onRemove={(id) => removeFile('B', id)}
            disabled={isProcessing}
          />
        </div>
      </div>

      {/* Action + Progress */}
      <div className="panel p-6">
        {!showProgress ? (
          <div className="flex items-center justify-between">
            <div className="text-sm text-slate-500">
              {filesA.filter((f) => !f.error).length} file nguồn A ·{' '}
              {filesB.filter((f) => !f.error).length} file nguồn B
            </div>
            <button
              type="button"
              className="btn btn-primary"
              disabled={!canStart}
              onClick={startReconciliation}
            >
              <Play size={15} />
              Bắt đầu đối soát
            </button>
          </div>
        ) : (
          <div className="flex gap-8">
            <div className="flex-1">
              <h3 className="text-sm font-semibold text-slate-700 mb-4">
                Tiến trình xử lý
              </h3>

              {/* Error banner — stays inside the progress panel */}
              {phase === 'error' && error && (
                <div className="flex items-start gap-2 mb-4 p-3 rounded-md bg-red-50 border border-red-200">
                  <AlertCircle size={15} className="shrink-0 mt-0.5 text-red-500" />
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-medium text-red-700">Xử lý thất bại</p>
                    <p className="text-xs text-red-600 mt-0.5 break-words">{error}</p>
                  </div>
                </div>
              )}

              <ProgressStepper
                currentStep={progress?.current_step || 'upload'}
                progress={progress}
                isError={phase === 'error'}
                warningMessage={warningMessage}
              />

              {/* Retry button after error */}
              {phase === 'error' && (
                <button
                  type="button"
                  className="mt-5 btn btn-secondary text-sm flex items-center gap-1.5"
                  onClick={() => {
                    setPhase('idle')
                    setError(null)
                    setWarningMessage(null)
                    setProgress(null)
                    setSessionId(null)
                  }}
                >
                  <RefreshCw size={13} />
                  Thử lại
                </button>
              )}
            </div>
            <div className="w-px bg-slate-100" />
            <div className="w-48 text-sm text-slate-500 space-y-2 pt-1">
              <p>
                <span className="font-medium text-slate-700">Phiên:</span>{' '}
                {sessionId?.slice(0, 8)}...
              </p>
              {progress?.total_files && (
                <p>
                  <span className="font-medium text-slate-700">File:</span>{' '}
                  {progress.processed_files}/{progress.total_files}
                </p>
              )}
              {progress?.total_pages && (
                <p>
                  <span className="font-medium text-slate-700">Trang:</span>{' '}
                  {progress.processed_pages}/{progress.total_pages}
                </p>
              )}
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
