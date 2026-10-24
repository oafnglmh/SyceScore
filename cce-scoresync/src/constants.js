// API configuration
export const API_BASE = import.meta.env.VITE_API_BASE || 'https://sycescore.onrender.com/api'

// File constraints
export const MAX_FILE_SIZE_MB = 50
export const MAX_FILES_PER_SOURCE = 50
export const ALLOWED_MIME_TYPES = [
  'application/pdf',
  'image/jpeg',
  'image/jpg',
  'image/png',
]
export const ALLOWED_EXTENSIONS = ['.pdf', '.jpg', '.jpeg', '.png']

// Reconciliation status labels
export const STATUS_LABELS = {
  MATCH: 'Khớp',
  MISMATCH: 'Sai lệch',
  MISSING_SOURCE_A: 'Thiếu nguồn A',
  MISSING_SOURCE_B: 'Thiếu nguồn B',
  DUPLICATE: 'Trùng lặp',
  NEEDS_REVIEW: 'Cần kiểm tra',
}

export const STATUS_COLORS = {
  MATCH: 'badge-match',
  MISMATCH: 'badge-mismatch',
  MISSING_SOURCE_A: 'badge-missing',
  MISSING_SOURCE_B: 'badge-missing',
  DUPLICATE: 'badge-duplicate',
  NEEDS_REVIEW: 'badge-review',
}

// Processing step labels
export const PROCESSING_STEPS = [
  { id: 'upload', label: 'Đọc tài liệu' },
  { id: 'extract', label: 'Trích xuất dữ liệu' },
  { id: 'validate', label: 'Kiểm tra & chuẩn hóa' },
  { id: 'match', label: 'Đối chiếu học viên' },
  { id: 'done', label: 'Hoàn tất báo cáo' },
]

// Session storage key for draft session
export const SESSION_DRAFT_KEY = 'cce_scoresync_draft'
