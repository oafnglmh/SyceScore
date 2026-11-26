import tailwindcss from '@tailwindcss/vite'
import react from '@vitejs/plugin-react'
import { defineConfig, loadEnv } from 'vite'
import { KEY_HEADER, loadServerKeys, statusJson } from './scripts/ai-keys.mjs'

// API key AI CCE chỉ nằm trên server (file .env → GEMINI_FREE_KEYS + GEMINI_API_KEY), KHÔNG bao giờ gửi xuống trình duyệt.
// Trình duyệt gọi /ai-api/... kèm header X-CCE-Key: <slot> → server Vite (dev & preview) gắn key của slot đó rồi chuyển tiếp tới Google.
const AI_PREFIX = '/ai-api'
const AI_TARGET = 'https://generativelanguage.googleapis.com'

function aiProxy(slots) {
  const bySlot = new Map(slots.map((s) => [s.slot, s.key]))
  // Thiếu / sai slot → key free đầu tiên (không bao giờ tự rơi vào key trả phí khi còn key free).
  const fallback = slots[0]?.key || ''
  return {
    [`${AI_PREFIX}/v1beta`]: {
      target: AI_TARGET,
      changeOrigin: true,
      rewrite: (p) => p.slice(AI_PREFIX.length),
      configure: (proxy) => {
        proxy.on('proxyReq', (proxyReq, req) => {
          const apiKey = bySlot.get(String(req.headers[KEY_HEADER] || '')) || fallback
          // Bỏ mọi header key/cookie từ trình duyệt; chỉ dùng key của server.
          proxyReq.removeHeader(KEY_HEADER)
          proxyReq.removeHeader('x-goog-api-key')
          proxyReq.removeHeader('cookie')
          proxyReq.removeHeader('referer')
          proxyReq.removeHeader('origin')
          if (apiKey) proxyReq.setHeader('x-goog-api-key', apiKey)
        })
      },
    },
  }
}

/** GET /ai-api/status → { configured, hint, keys: [{ slot, hint, tier }] } (chỉ dạng che, không lộ key). */
function aiStatusPlugin(slots) {
  const body = statusJson(slots)
  const handler = (req, res, next) => {
    if (req.url?.split('?')[0] !== `${AI_PREFIX}/status`) return next()
    res.setHeader('Content-Type', 'application/json')
    res.setHeader('Cache-Control', 'no-store')
    res.end(body)
  }
  return {
    name: 'cce-ai-status',
    configureServer: (server) => void server.middlewares.use(handler),
    configurePreviewServer: (server) => void server.middlewares.use(handler),
  }
}

export default defineConfig(({ mode }) => {
  // Tham số '' = đọc cả biến không có tiền tố VITE_, nhưng chỉ dùng trong file config này (không vào bundle).
  const slots = loadServerKeys(loadEnv(mode, process.cwd(), ''))
  return {
    plugins: [aiStatusPlugin(slots), react(), tailwindcss()],
    server: {
      host: true,
      port: 5173,
      proxy: aiProxy(slots),
    },
    preview: {
      proxy: aiProxy(slots),
    },
  }
})
