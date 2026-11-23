import { useCallback, useMemo, useState } from 'react'
import DoDiemUploadView from '../components/DoDiemUploadView'
import ProcessingView from '../components/ProcessingView'
import ResultView from '../components/ResultView'
import { Footer } from '../components/ui'
import useReadJob, { useLeaveGuard } from '../hooks/useReadJob'
import { compareAll } from '../lib/compare'
import { buildSections, buildSheets, readPage } from '../lib/read'
import { exportReport } from '../lib/report'

const read = (page, ctx) => readPage({ ...ctx, kind: page.kind, page })

/** Trang “Dò điểm” (#/do-diem): so bảng điểm hệ thống với biên bản viết tay, báo dòng sai. */
export default function DoDiemPage({ config, ready, keyProblem, stats, onOpenKeys }) {
  const [stage, setStage] = useState('upload') // upload | processing | review
  const [docs, setDocs] = useState({ sections: [], sheets: [] })
  // Người dùng chọn lại cặp ghép / cột điểm, và sửa điểm AI đọc sai – kết quả dò tính lại ngay.
  const [overrides, setOverrides] = useState({})
  const [edits, setEdits] = useState({})
  const reader = useReadJob({ config, read })
  useLeaveGuard(stage !== 'upload')

  const result = useMemo(
    () => (stage === 'review' ? compareAll(docs.sheets, docs.sections, overrides, edits) : null),
    [stage, docs, overrides, edits],
  )

  function resetResult() {
    setDocs({ sections: [], sheets: [] })
    setOverrides({})
    setEdits({})
  }

  function finish() {
    const job = reader.current()
    const pick = (kind) => job.files.filter((f) => f.kind === kind).map((f) => ({ id: f.id, name: f.name, pages: f.pages }))
    setDocs({ sections: buildSections(pick('system')), sheets: buildSheets(pick('hand')) })
    setStage('review')
  }

  async function start(systemFiles, handFiles) {
    if (!ready) return onOpenKeys()
    resetResult()
    setStage('processing')
    const entries = [...systemFiles.map((file) => ({ file, kind: 'system' })), ...handFiles.map((file) => ({ file, kind: 'hand' }))]
    if (await reader.start(entries)) finish()
  }

  async function retry() {
    if (ready && (await reader.retryFailed())) finish()
  }

  function restart() {
    if (stage === 'review' && !window.confirm('Bỏ kết quả hiện tại và dò bộ file khác?')) return
    reader.release()
    resetResult()
    setStage('upload')
  }

  const setOverride = useCallback((sheetId, value) => setOverrides((o) => ({ ...o, [sheetId]: value })), [])
  const setEdit = useCallback(
    (key, value) =>
      setEdits((e) => {
        const next = { ...e }
        if (value === undefined) delete next[key]
        else next[key] = value
        return next
      }),
    [],
  )

  return (
    <>
      {stage === 'upload' && <DoDiemUploadView ready={ready} keyProblem={keyProblem} onOpenKeys={onOpenKeys} onStart={start} />}
      {stage === 'processing' && reader.job && (
        <ProcessingView
          job={reader.job}
          stats={stats}
          onCancel={reader.cancel}
          onRetry={retry}
          onContinue={finish}
          title="AI CCE đang đọc bảng điểm hệ thống và biên bản viết tay…"
          continueLabel="Xem kết quả dò điểm"
        />
      )}
      {stage === 'review' && result && (
        <ResultView
          result={result}
          sections={docs.sections}
          getPage={reader.getPage}
          setOverride={setOverride}
          setEdit={setEdit}
          onExport={() => exportReport(result)}
          onRestart={restart}
        />
      )}
      {stage !== 'review' && <Footer />}
    </>
  )
}
