import { ALLOWED_EXTENSIONS, ALLOWED_MIME_TYPES, MAX_FILE_SIZE_MB } from '../constants'

/**
 * Validate a file for upload
 * @param {File} file
 * @returns {{ valid: boolean, error?: string }}
 */
export function validateFile(file) {
  const ext = '.' + file.name.split('.').pop().toLowerCase()

  if (!ALLOWED_EXTENSIONS.includes(ext)) {
    return { valid: false, error: `Định dạng không hỗ trợ: ${ext}` }
  }

  if (!ALLOWED_MIME_TYPES.includes(file.type) && file.type !== '') {
    return { valid: false, error: `Loại file không hợp lệ: ${file.type}` }
  }

  const sizeMB = file.size / (1024 * 1024)
  if (sizeMB > MAX_FILE_SIZE_MB) {
    return {
      valid: false,
      error: `File quá lớn: ${sizeMB.toFixed(1)}MB (tối đa ${MAX_FILE_SIZE_MB}MB)`,
    }
  }

  return { valid: true }
}

/**
 * Format file size for display
 * @param {number} bytes
 * @returns {string}
 */
export function formatFileSize(bytes) {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
}

/**
 * Format datetime string for display
 */
export function formatDateTime(dateStr) {
  if (!dateStr) return '—'
  try {
    return new Date(dateStr).toLocaleString('vi-VN', {
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
    })
  } catch {
    return dateStr
  }
}

/**
 * Generate a unique local ID for a file entry
 */
export function genFileId() {
  return `file_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`
}

/**
 * Download a blob as a file
 */
export function downloadBlob(blob, filename) {
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  document.body.appendChild(a)
  a.click()
  document.body.removeChild(a)
  URL.revokeObjectURL(url)
}

/**
 * Get status row CSS class
 */
export function getStatusRowClass(status) {
  if (status === 'MISMATCH') return 'row-mismatch'
  if (status === 'NEEDS_REVIEW') return 'row-review'
  return ''
}

/**
 * Format score for display
 */
export function formatScore(score) {
  if (score === null || score === undefined) return '—'
  const num = parseFloat(score)
  if (isNaN(num)) return String(score)
  return num % 1 === 0 ? num.toString() : num.toFixed(1)
}

