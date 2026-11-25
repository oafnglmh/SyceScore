import tailwindcss from '@tailwindcss/vite'
import react from '@vitejs/plugin-react'
import { defineConfig, loadEnv } from 'vite'

// API key AI CCE chỉ nằm trên server (file .env → GEMINI_API_KEY), KHÔNG bao giờ gửi xuống trình duyệt.
// Trình duyệt gọi /ai-api/... → server Vite (dev & preview) gắn key rồi chuyển tiếp tới Google.
const AI_PREFIX = '/ai-api'
const AI_TARGET = 'https://generativelanguage.googleapis.com'

const maskKey = (k) => (k.length > 12 ? `${k.slice(0, 4)}…${k.slice(-4)}` : '••••')

function aiProxy(apiKey) {
  return {
    [`${AI_PREFIX}/v1beta`]: {
      target: AI_TARGET,
      changeOrigin: true,
      rewrite: (p) => p.slice(AI_PREFIX.length),
      configure: (proxy) => {
        proxy.on('proxyReq', (req) => {
          // Bỏ mọi header key/cookie từ trình duyệt; chỉ dùng key của server.
          req.removeHeader('x-goog-api-key')
          req.removeHeader('cookie')
          req.removeHeader('referer')
          req.removeHeader('origin')
          if (apiKey) req.setHeader('x-goog-api-key', apiKey)
        })
      },
    },
  }
}

/** GET /ai-api/status → { configured, hint } (chỉ dạng che, không lộ key). */
function aiStatusPlugin(apiKey) {
  const handler = (req, res, next) => {
    if (req.url?.split('?')[0] !== `${AI_PREFIX}/status`) return next()
    res.setHeader('Content-Type', 'application/json')
    res.setHeader('Cache-Control', 'no-store')
    res.end(JSON.stringify({ configured: !!apiKey, hint: apiKey ? maskKey(apiKey) : '' }))
  }
  return {
    name: 'cce-ai-status',
    configureServer: (server) => void server.middlewares.use(handler),
    configurePreviewServer: (server) => void server.middlewares.use(handler),
  }
}

export default defineConfig(({ mode }) => {
  // Tham số '' = đọc cả biến không có tiền tố VITE_, nhưng chỉ dùng trong file config này (không vào bundle).
  const apiKey = String(loadEnv(mode, process.cwd(), '').GEMINI_API_KEY || '').trim()
  return {
    plugins: [aiStatusPlugin(apiKey), react(), tailwindcss()],
    server: {
      host: true,
      port: 5173,
      proxy: aiProxy(apiKey),
    },
    preview: {
      proxy: aiProxy(apiKey),
    },
  }
})
