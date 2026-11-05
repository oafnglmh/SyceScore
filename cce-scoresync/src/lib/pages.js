import * as pdfjs from 'pdfjs-dist'
import workerUrl from 'pdfjs-dist/build/pdf.worker.min.mjs?url'

pdfjs.GlobalWorkerOptions.workerSrc = workerUrl

// Ảnh gửi AI CCE: lần đọc A ~1700px chiều ngang (màu gốc),
// lần đọc B ~2300px, ảnh xám tăng tương phản – để hai lần đọc thật sự độc lập.
const VARIANTS = {
  A: { width: 1700, gray: false, quality: 0.92 },
  B: { width: 2300, gray: true, quality: 0.92 },
}

function canvasToBlob(canvas, quality) {
  return new Promise((resolve, reject) =>
    canvas.toBlob((b) => (b ? resolve(b) : reject(new Error('Không tạo được ảnh trang'))), 'image/jpeg', quality),
  )
}

function enhanceGray(canvas) {
  const ctx = canvas.getContext('2d')
  const img = ctx.getImageData(0, 0, canvas.width, canvas.height)
  const d = img.data
  // Tìm ngưỡng đen/trắng (percentile 1% và 99%) để kéo giãn tương phản.
  const hist = new Uint32Array(256)
  for (let i = 0; i < d.length; i += 4) {
    const y = (d[i] * 299 + d[i + 1] * 587 + d[i + 2] * 114) / 1000
    hist[y | 0]++
  }
  const total = d.length / 4
  const cut = total * 0.01
  let lo = 0
  let hi = 255
  let acc = hist[0]
  while (lo < 254 && acc < cut) acc += hist[++lo]
  acc = hist[255]
  while (hi > lo + 1 && acc < cut) acc += hist[--hi]
  const range = Math.max(1, hi - lo)
  for (let i = 0; i < d.length; i += 4) {
    const y = (d[i] * 299 + d[i + 1] * 587 + d[i + 2] * 114) / 1000
    const v = Math.max(0, Math.min(255, ((y - lo) * 255) / range))
    d[i] = d[i + 1] = d[i + 2] = v
  }
  ctx.putImageData(img, 0, 0)
}

async function variantFromSource(drawAt, srcWidth, srcHeight, variant) {
  const scale = variant.width / srcWidth
  const canvas = document.createElement('canvas')
  canvas.width = Math.round(srcWidth * scale)
  canvas.height = Math.round(srcHeight * scale)
  const ctx = canvas.getContext('2d')
  ctx.fillStyle = '#fff'
  ctx.fillRect(0, 0, canvas.width, canvas.height)
  await drawAt(ctx, scale, canvas)
  if (variant.gray) enhanceGray(canvas)
  const blob = await canvasToBlob(canvas, variant.quality)
  canvas.width = canvas.height = 0
  return blob
}

/**
 * Tách file (PDF hoặc ảnh) thành danh sách trang.
 * Mỗi trang: { pageNumber, images: { A: Blob, B: Blob }, previewUrl }
 */
export async function loadPages(file, onPage) {
  const isPdf = file.type === 'application/pdf' || /\.pdf$/i.test(file.name)
  const pages = []

  if (isPdf) {
    const data = new Uint8Array(await file.arrayBuffer())
    const loadingTask = pdfjs.getDocument({ data })
    const doc = await loadingTask.promise
    try {
      for (let n = 1; n <= doc.numPages; n++) {
        const page = await doc.getPage(n)
        const base = page.getViewport({ scale: 1 })
        const images = {}
        for (const [key, variant] of Object.entries(VARIANTS)) {
          images[key] = await variantFromSource(
            async (ctx, scale, canvas) => {
              await page.render({ canvas, canvasContext: ctx, viewport: page.getViewport({ scale }) }).promise
            },
            base.width,
            base.height,
            variant,
          )
        }
        page.cleanup()
        const entry = { pageNumber: n, images, previewUrl: URL.createObjectURL(images.A) }
        pages.push(entry)
        onPage?.(entry, n, doc.numPages)
      }
    } finally {
      // pdf.js v6: giải phóng qua loadingTask (PDFDocumentProxy không còn destroy()).
      await loadingTask.destroy().catch(() => {})
    }
    return pages
  }

  // Ảnh JPG/PNG: một ảnh = một trang.
  const bitmap = await createImageBitmap(file)
  const images = {}
  for (const [key, variant] of Object.entries(VARIANTS)) {
    images[key] = await variantFromSource(
      (ctx, scale) => ctx.drawImage(bitmap, 0, 0, bitmap.width * scale, bitmap.height * scale),
      bitmap.width,
      bitmap.height,
      variant,
    )
  }
  bitmap.close()
  const entry = { pageNumber: 1, images, previewUrl: URL.createObjectURL(images.A) }
  pages.push(entry)
  onPage?.(entry, 1, 1)
  return pages
}
