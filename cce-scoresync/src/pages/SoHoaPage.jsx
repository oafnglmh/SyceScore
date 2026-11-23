import { useState } from 'react'
import ProcessingView from '../components/ProcessingView'
import ReviewView from '../components/ReviewView'
import { Footer } from '../components/ui'
import UploadView from '../components/UploadView'
import useReadJob, { useLeaveGuard } from '../hooks/useReadJob'
import { buildSheets, readPage } from '../lib/extract'

const read = async (page, ctx) => {
  const { merged, results } = await readPage({ ...ctx, page })
  return { merged, passes: results.length }
}

/** Trang “Số hóa điểm” (#/): đọc biên bản thi viết tay → soát → xuất Excel. */
export default function SoHoaPage({ config, ready, keyProblem, stats, onOpenKeys }) {
  const [stage, setStage] = useState('upload') // upload | processing | review
  const [sheets, setSheets] = useState([])
  const reader = useReadJob({ config, read })
  useLeaveGuard(stage !== 'upload')

  function finish() {
    const job = reader.current()
    setSheets(buildSheets(job.files.map((f) => ({ id: f.id, name: f.name, pages: f.pages }))))
    setStage('review')
  }

  async function start(files) {
    if (!ready) return onOpenKeys()
    setSheets([])
    setStage('processing')
    if (await reader.start(files.map((file) => ({ file })))) finish()
  }

  async function retry() {
    if (ready && (await reader.retryFailed())) finish()
  }

  function restart() {
    if (stage === 'review' && !window.confirm('Bỏ kết quả hiện tại và làm file khác?')) return
    reader.release()
    setSheets([])
    setStage('upload')
  }

  return (
    <>
      {stage === 'upload' && <UploadView ready={ready} keyProblem={keyProblem} onOpenKeys={onOpenKeys} onStart={start} />}
      {stage === 'processing' && reader.job && (
        <ProcessingView job={reader.job} stats={stats} onCancel={reader.cancel} onRetry={retry} onContinue={finish} />
      )}
      {stage === 'review' && <ReviewView sheets={sheets} setSheets={setSheets} getPage={reader.getPage} onRestart={restart} />}
      {stage !== 'review' && <Footer />}
    </>
  )
}
