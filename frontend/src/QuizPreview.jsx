import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { previewPlayerUrl } from './api'

const TYPE_LABELS = {
  MultipleChoice: 'Trắc nghiệm',
  MultipleResponse: 'Chọn nhiều',
  MultipleChoiceText: 'Chọn + chữ',
  Matching: 'Nối cặp',
  Hotspot: 'Hotspot',
  Sequence: 'Sắp xếp',
  WordBank: 'Điền từ',
  FillInTheBlank: 'Điền khuyết',
  TypeIn: 'Gõ đáp án',
  Numeric: 'Nhập số',
  TrueFalse: 'Đúng/Sai',
  DND: 'Kéo thả',
  ResultSlide: 'Kết quả',
  IntroSlide: 'Mở đầu',
}

const SCORM_FIELDS = [
  { key: 'cmi.core.lesson_status', label: 'Trạng thái' },
  { key: 'cmi.core.score.raw', label: 'Điểm' },
  { key: 'cmi.core.score.max', label: 'Điểm tối đa' },
  { key: 'cmi.core.lesson_location', label: 'Vị trí' },
  { key: 'cmi.suspend_data', label: 'Suspend data' },
]

function statusClass(status) {
  if (!status) return ''
  const s = status.toLowerCase()
  if (s === 'passed' || s === 'completed') return 'status-passed'
  if (s === 'failed') return 'status-failed'
  if (s === 'incomplete' || s === 'browsed') return 'status-incomplete'
  return ''
}

export default function QuizPreview({ quiz, onBack, onSave, saving, previewRevision = 0 }) {
  const [scorm, setScorm] = useState({ initialized: false, data: {} })
  const [reloadKey, setReloadKey] = useState(0)
  const [syncing, setSyncing] = useState(false)
  const iframeRef = useRef(null)

  const activeQuestions = useMemo(
    () => quiz.questions.filter((q) => !q.deleted),
    [quiz.questions],
  )

  const filmstripSlides = useMemo(() => {
    const slides = []
    if (quiz.introSlide) {
      slides.push({ ...quiz.introSlide, filmstripLabel: 'Intro' })
    }
    activeQuestions.forEach((q) => {
      slides.push({ ...q, filmstripLabel: `#${q.questionIndex + 1}` })
    })
    ;(quiz.resultSlides || []).forEach((r) => {
      slides.push({
        ...r,
        filmstripLabel: r.resultKind === 'passed' ? 'Đạt' : r.resultKind === 'failed' ? 'Không đạt' : 'Kết quả',
      })
    })
    return slides
  }, [quiz.introSlide, quiz.resultSlides, activeQuestions])

  const playerUrl = useMemo(
    () => previewPlayerUrl(quiz.sessionId, { reloadKey }),
    [quiz.sessionId, reloadKey],
  )

  useEffect(() => {
    if (previewRevision > 0) {
      setReloadKey((k) => k + 1)
    }
  }, [previewRevision])

  useEffect(() => {
    const handler = (event) => {
      if (event.data?.type !== 'scorm-preview-update') return
      setScorm({
        initialized: !!event.data.initialized,
        data: event.data.data || {},
      })
    }
    window.addEventListener('message', handler)
    return () => window.removeEventListener('message', handler)
  }, [])

  const handleSyncAndReload = useCallback(async () => {
    setSyncing(true)
    try {
      await onSave()
      setReloadKey((k) => k + 1)
    } finally {
      setSyncing(false)
    }
  }, [onSave])

  const handleReset = () => {
    try {
      iframeRef.current?.contentWindow?.resetScormPreview?.()
    } catch {
      /* cross-origin guard */
    }
    setReloadKey((k) => k + 1)
  }

  let lastGroup = null

  return (
    <div className="preview-workspace">
      <div className="preview-toolbar">
        <div className="preview-toolbar-left">
          <button type="button" className="btn" onClick={onBack}>
            ← Quay lại chỉnh sửa
          </button>
          <span className="preview-title">{quiz.title || 'Quiz Preview'}</span>
        </div>
        <div className="preview-toolbar-right">
          <button
            type="button"
            className="btn"
            disabled={syncing || saving}
            onClick={handleSyncAndReload}
          >
            {syncing ? 'Đang đồng bộ...' : 'Đồng bộ & tải lại'}
          </button>
          <button type="button" className="btn" onClick={handleReset}>
            Làm lại từ đầu
          </button>
        </div>
      </div>

      <div className="preview-body">
        <aside className="preview-filmstrip">
          <div className="filmstrip-header">
            <h3>Slide View</h3>
            <span>{filmstripSlides.length} slide</span>
          </div>
          <div className="filmstrip-list">
            {quiz.introSlide && (
              <div className="filmstrip-slide special">
                <div className="filmstrip-slide-num">Intro</div>
                <div className="filmstrip-slide-body">
                  <div className="filmstrip-slide-type">{TYPE_LABELS.IntroSlide}</div>
                  <div className="filmstrip-slide-text">
                    {quiz.introSlide.questionText || '(không có text)'}
                  </div>
                </div>
              </div>
            )}

            {quiz.questions.map((q) => {
              const showGroup = q.groupTitle !== lastGroup
              lastGroup = q.groupTitle
              if (q.deleted) return null
              return (
                <div key={q.id}>
                  {showGroup && <div className="filmstrip-group">{q.groupTitle}</div>}
                  <div className="filmstrip-slide">
                    <div className="filmstrip-slide-num">#{q.questionIndex + 1}</div>
                    <div className="filmstrip-slide-body">
                      <div className="filmstrip-slide-type">
                        {TYPE_LABELS[q.type] || q.type}
                      </div>
                      <div className="filmstrip-slide-text">
                        {q.questionText || '(không có text)'}
                      </div>
                    </div>
                  </div>
                </div>
              )
            })}

            {quiz.resultSlides?.length > 0 && (
              <>
                <div className="filmstrip-group">Kết quả</div>
                {quiz.resultSlides.map((r) => (
                  <div key={r.id} className="filmstrip-slide special">
                    <div className="filmstrip-slide-num">
                      {r.resultKind === 'passed' ? 'Đạt' : r.resultKind === 'failed' ? 'Không đạt' : 'KQ'}
                    </div>
                    <div className="filmstrip-slide-body">
                      <div className="filmstrip-slide-type">{TYPE_LABELS.ResultSlide}</div>
                      <div className="filmstrip-slide-text">
                        {r.questionText || '(không có text)'}
                      </div>
                    </div>
                  </div>
                ))}
              </>
            )}
          </div>
          <p className="filmstrip-hint">
            Làm bài trong player bên phải — điều hướng bằng nút Next/Back của quiz iSpring.
          </p>
        </aside>

        <div className="preview-player-wrap">
          <div className="preview-player-frame">
            <iframe
              ref={iframeRef}
              key={reloadKey}
              title="SCORM Quiz Preview"
              src={playerUrl}
              className="preview-iframe"
              allow="autoplay"
            />
          </div>
        </div>

        <aside className="preview-scorm-panel">
          <div className="scorm-panel-header">
            <h3>SCORM 1.2</h3>
            <span className={`scorm-badge ${scorm.initialized ? 'active' : ''}`}>
              {scorm.initialized ? 'Đã kết nối' : 'Chờ player...'}
            </span>
          </div>
          <div className="scorm-fields">
            {SCORM_FIELDS.map(({ key, label }) => {
              const value = scorm.data[key] ?? '—'
              const cls = key === 'cmi.core.lesson_status' ? statusClass(value) : ''
              return (
                <div key={key} className="scorm-field">
                  <label>{label}</label>
                  <div className={`scorm-value ${cls}`} title={String(value)}>
                    {value || '—'}
                  </div>
                </div>
              )
            })}
          </div>
          <div className="scorm-meta">
            <div className="scorm-field">
              <label>Học sinh</label>
              <div className="scorm-value">
                {scorm.data['cmi.core.student_name'] || 'Preview User'}
              </div>
            </div>
            <div className="scorm-field">
              <label>Điểm đạt</label>
              <div className="scorm-value">{quiz.passingScore}%</div>
            </div>
          </div>
        </aside>
      </div>
    </div>
  )
}