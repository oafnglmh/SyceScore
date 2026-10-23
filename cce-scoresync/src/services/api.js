import axios from 'axios'
import { API_BASE } from '../constants'

const client = axios.create({
  baseURL: API_BASE,
  timeout: 300000,
  headers: {
    'ngrok-skip-browser-warning': 'true',
  },
})

client.interceptors.response.use(
  (res) => res,
  (err) => {
    const message =
      err.response?.data?.detail || err.message || 'Lỗi kết nối máy chủ'
    return Promise.reject(new Error(message))
  }
)

// --- AI Settings ---
export const aiApi = {
  getSettings: () => client.get('/settings/ai'),
  updateSettings: (data) => client.put('/settings/ai', data),
  testConnection: (data) => client.post('/ai/test', data),
  getModels: () => client.get('/ai/models'),
}

// --- Reconciliations ---
export const reconciliationApi = {
  create: (formData) =>
    client.post('/reconciliations', formData, {
      headers: { 'Content-Type': 'multipart/form-data' },
      timeout: 300000,
    }),
  list: (params) => client.get('/reconciliations', { params }),
  get: (id) => client.get(`/reconciliations/${id}`),
  getProgress: (id) => client.get(`/reconciliations/${id}/progress`, { timeout: 15000 }),
  getExtractedData: (id) => client.get(`/reconciliations/${id}/extracted-data`),
  updateExtractedData: (id, data) =>
    client.put(`/reconciliations/${id}/extracted-data`, data),
  compare: (id) => client.post(`/reconciliations/${id}/compare`),
  getResults: (id, params) =>
    client.get(`/reconciliations/${id}/results`, { params }),
  exportExcel: (id, subject) => {
    const url = subject ? `/reconciliations/${id}/export?subject=${encodeURIComponent(subject)}` : `/reconciliations/${id}/export`
    return client.get(url, { responseType: 'blob' })
  },
  exportSubjectExcel: (id, subject) =>
    client.get(`/reconciliations/${id}/export?subject=${encodeURIComponent(subject)}`, { responseType: 'blob' }),
  exportZip: (id) =>
    client.get(`/reconciliations/${id}/export-zip`, { responseType: 'blob' }),
  confirmSubject: (id, data) =>
    client.post(`/reconciliations/${id}/confirm-subject`, data),
  updateName: (id, name) =>
    client.patch(`/reconciliations/${id}/name`, { name }),
  delete: (id) => client.delete(`/reconciliations/${id}`),
}

// --- Health ---
export const healthApi = {
  check: () => client.get('/health'),
}
