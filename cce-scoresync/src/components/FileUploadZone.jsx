import { ALLOWED_EXTENSIONS, ALLOWED_MIME_TYPES } from '../constants'
import { FileText, Trash2, Upload, X } from 'lucide-react'
import { useCallback, useRef, useState } from 'react'
import { formatFileSize, genFileId, validateFile } from '../utils/helpers'

/**
 * Multi-file upload zone
 * @param {{
 *   label: string,
 *   sourceKey: 'A' | 'B',
 *   files: Array<{ id: string, file: File, error?: string }>,
 *   onAdd: (files: Array<{ id: string, file: File }>) => void,
 *   onRemove: (id: string) => void,
 *   disabled?: boolean,
 * }} props
 */
export function FileUploadZone({ label, sourceKey, files, onAdd, onRemove, disabled }) {
  const inputRef = useRef(null)
  const [dragOver, setDragOver] = useState(false)

  const processFiles = useCallback(
    (rawFiles) => {
      const entries = Array.from(rawFiles).map((f) => {
        const validation = validateFile(f)
        return {
          id: genFileId(),
          file: f,
          error: validation.valid ? undefined : validation.error,
        }
      })
      onAdd(entries)
    },
    [onAdd]
  )

  const handleDrop = useCallback(
    (e) => {
      e.preventDefault()
      setDragOver(false)
      if (disabled) return
      processFiles(e.dataTransfer.files)
    },
    [disabled, processFiles]
  )

  const handleDragOver = (e) => {
    e.preventDefault()
    if (!disabled) setDragOver(true)
  }

  const handleChange = (e) => {
    if (e.target.files?.length) {
      processFiles(e.target.files)
      e.target.value = ''
    }
  }

  const accentClass =
    sourceKey === 'A'
      ? 'border-slate-700 bg-slate-700'
      : 'border-blue-700 bg-blue-700'
  const labelClass =
    sourceKey === 'A' ? 'text-slate-700' : 'text-blue-700'

  return (
    <div className="flex flex-col gap-3">
      {/* Header */}
      <div className="flex items-center gap-2">
        <span
          className={`inline-flex items-center justify-center w-6 h-6 rounded text-white text-xs font-bold ${accentClass}`}
        >
          {sourceKey}
        </span>
        <h3 className={`font-semibold text-sm ${labelClass}`}>{label}</h3>
        {files.length > 0 && (
          <span className="ml-auto text-xs text-slate-400">
            {files.length} file
          </span>
        )}
      </div>

      {/* Drop zone */}
      <div
        className={`relative border-2 border-dashed rounded-lg p-6 flex flex-col items-center gap-3 transition-colors
          ${disabled ? 'opacity-50 cursor-not-allowed bg-slate-50' : 'cursor-pointer'}
          ${dragOver ? 'border-blue-400 bg-blue-50' : 'border-slate-200 bg-white hover:border-slate-300 hover:bg-slate-50'}
        `}
        onDrop={handleDrop}
        onDragOver={handleDragOver}
        onDragLeave={() => setDragOver(false)}
        onClick={() => !disabled && inputRef.current?.click()}
        role="button"
        tabIndex={0}
        onKeyDown={(e) => e.key === 'Enter' && !disabled && inputRef.current?.click()}
        aria-label={`Tải file lên cho ${label}`}
      >
        <input
          ref={inputRef}
          type="file"
          multiple
          accept={ALLOWED_MIME_TYPES.join(',')}
          onChange={handleChange}
          className="hidden"
          disabled={disabled}
          aria-hidden="true"
        />
        <Upload size={20} className="text-slate-400" />
        <div className="text-center">
          <p className="text-sm text-slate-600 font-medium">
            Kéo thả hoặc nhấn để chọn file
          </p>
          <p className="text-xs text-slate-400 mt-1">
            PDF, JPG, JPEG, PNG – tối đa 50MB/file (lên đến 50 file)
          </p>
        </div>
      </div>

      {/* File list */}
      {files.length > 0 && (
        <ul className="flex flex-col gap-1.5">
          {files.map((entry) => (
            <FileEntry
              key={entry.id}
              entry={entry}
              onRemove={() => onRemove(entry.id)}
              disabled={disabled}
            />
          ))}
        </ul>
      )}
    </div>
  )
}

function FileEntry({ entry, onRemove, disabled }) {
  const { file, error, status } = entry
  const ext = file.name.split('.').pop().toUpperCase()

  return (
    <li
      className={`flex items-center gap-2 px-3 py-2 rounded-md border text-sm
        ${error ? 'border-red-200 bg-red-50' : 'border-slate-100 bg-white'}
      `}
    >
      <FileText
        size={14}
        className={error ? 'text-red-400 shrink-0' : 'text-slate-400 shrink-0'}
      />
      <div className="flex-1 min-w-0">
        <p className="truncate font-medium text-slate-700">{file.name}</p>
        <p className="text-xs text-slate-400">
          {ext} · {formatFileSize(file.size)}
          {error && (
            <span className="text-red-500 ml-2">{error}</span>
          )}
          {status === 'processing' && (
            <span className="text-blue-500 ml-2">Đang xử lý...</span>
          )}
          {status === 'done' && (
            <span className="text-emerald-600 ml-2">Hoàn tất</span>
          )}
          {status === 'error' && !error && (
            <span className="text-red-500 ml-2">Lỗi xử lý</span>
          )}
        </p>
      </div>
      <button
        type="button"
        className="btn btn-ghost btn-sm p-1 text-slate-400 hover:text-red-500"
        onClick={(e) => { e.stopPropagation(); onRemove() }}
        disabled={disabled}
        aria-label="Xóa file"
      >
        <X size={14} />
      </button>
    </li>
  )
}
