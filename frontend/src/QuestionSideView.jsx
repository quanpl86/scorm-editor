import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { previewPlayerUrl } from './api'
import PanelResizeHandle from './PanelResizeHandle'
import { useResizableWidth } from './useResizableWidth'

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

function findSlide(quiz, slideId) {
  if (!quiz || !slideId) return null
  if (quiz.introSlide?.id === slideId) return quiz.introSlide
  const result = quiz.resultSlides?.find((r) => r.id === slideId)
  if (result) return result
  return quiz.questions.find((q) => q.id === slideId) || null
}

function buildNavTarget(slide) {
  if (!slide) return null
  if (slide.slideRole === 'intro') {
    return { slideId: slide.id, slideRole: 'intro', skipAutoStart: true }
  }
  if (slide.slideRole === 'result') {
    return {
      slideId: slide.id,
      slideRole: 'result',
      resultKind: slide.resultKind || '',
      skipAutoStart: false,
    }
  }
  return {
    slideId: slide.id,
    slideRole: 'question',
    qIndex: slide.questionIndex,
    skipAutoStart: false,
  }
}

function navigatePlayerToSlide(iframe, slide) {
  const target = buildNavTarget(slide)
  if (!iframe || !target) return
  const payload = { type: 'scorm-preview-goto-slide', ...target }
  try {
    iframe.contentWindow?.scormPreviewGoToSlide?.(target.slideId, target.qIndex, target)
  } catch {
    /* cross-origin guard */
  }
  try {
    iframe.contentWindow?.postMessage?.(payload, '*')
  } catch {
    /* ignore */
  }
}

function isSpecialSlide(slide) {
  return slide?.slideRole === 'intro' || slide?.slideRole === 'result'
}

export default function QuestionSideView({
  quiz,
  selectedId,
  onSelectSlide,
  onSave,
  saving,
  autoSaving,
  previewRevision = 0,
}) {
  const [reloadKey, setReloadKey] = useState(0)
  const [syncing, setSyncing] = useState(false)
  const [playerReady, setPlayerReady] = useState(false)
  const iframeRef = useRef(null)
  const lastPlayerSlideId = useRef(null)
  const filmstripResize = useResizableWidth('scorm-editor.sideview-filmstrip-width', 240, {
    min: 180,
    max: 400,
  })

  const selectedSlide = useMemo(
    () => findSlide(quiz, selectedId),
    [quiz, selectedId],
  )

  const activeQuestions = useMemo(
    () => quiz.questions.filter((q) => !q.deleted),
    [quiz.questions],
  )

  const filmstripSlides = useMemo(() => {
    const slides = []
    if (quiz.introSlide) slides.push(quiz.introSlide)
    activeQuestions.forEach((q) => slides.push(q))
    ;(quiz.resultSlides || []).forEach((r) => slides.push(r))
    return slides
  }, [quiz.introSlide, quiz.resultSlides, activeQuestions])

  const playerUrl = useMemo(() => {
    const slide = selectedSlide || findSlide(quiz, selectedId)
    const isIntro = slide?.slideRole === 'intro'
    const isResult = slide?.slideRole === 'result'
    return previewPlayerUrl(quiz.sessionId, {
      reloadKey,
      slideId: selectedId,
      qIndex: slide?.slideRole === 'question' ? slide.questionIndex : -1,
      editor: true,
      skipStart: isIntro,
      slideRole: slide?.slideRole || '',
      resultKind: isResult ? slide.resultKind || '' : '',
    })
  }, [quiz.sessionId, selectedId, selectedSlide, reloadKey])

  useEffect(() => {
    const handler = (event) => {
      const data = event.data
      if (!data || typeof data !== 'object') return
      if (data.type === 'scorm-preview-player-ready') {
        setPlayerReady(true)
        const slide = findSlide(quiz, selectedId)
        navigatePlayerToSlide(iframeRef.current, slide)
      }
      if (data.type === 'scorm-preview-slide-changed' && data.slideId) {
        if (data.slideId !== selectedId) onSelectSlide(data.slideId)
      }
    }
    window.addEventListener('message', handler)
    return () => window.removeEventListener('message', handler)
  }, [quiz, selectedId, onSelectSlide])

  useEffect(() => {
    setPlayerReady(false)
  }, [reloadKey])

  useEffect(() => {
    if (previewRevision > 0) {
      setPlayerReady(false)
      setReloadKey((k) => k + 1)
    }
  }, [previewRevision])

  useEffect(() => {
    const slide = findSlide(quiz, selectedId)
    if (!selectedId || !slide) return

    const needsReload = isSpecialSlide(slide) && lastPlayerSlideId.current !== selectedId
    if (needsReload) {
      lastPlayerSlideId.current = selectedId
      setPlayerReady(false)
      setReloadKey((k) => k + 1)
      return
    }

    if (!playerReady) return
    navigatePlayerToSlide(iframeRef.current, slide)
  }, [quiz, selectedId, playerReady])

  const handleSyncAndReload = useCallback(async () => {
    if (!onSave) return
    setSyncing(true)
    try {
      await onSave()
      setPlayerReady(false)
      setReloadKey((k) => k + 1)
    } finally {
      setSyncing(false)
    }
  }, [onSave])

  const handleFilmstripClick = (slide) => {
    if (slide.deleted) return
    onSelectSlide(slide.id)
    if (!isSpecialSlide(slide) && playerReady) {
      navigatePlayerToSlide(iframeRef.current, slide)
    }
  }

  let lastGroup = null

  return (
    <div className="sideview-workspace">
      <div className="sideview-toolbar">
        <span className="sideview-toolbar-title">Slide View + Side View</span>
        <div className="sideview-toolbar-actions">
          {autoSaving && <span className="sideview-sync-hint">Đang cập nhật player...</span>}
          <button
            type="button"
            className="btn btn-sm"
            disabled={syncing || saving || !onSave}
            onClick={handleSyncAndReload}
          >
            {syncing ? 'Đang tải lại...' : 'Tải lại player'}
          </button>
        </div>
      </div>

      <div className="sideview-body">
        <aside className="preview-filmstrip sideview-filmstrip" style={{ width: filmstripResize.width }}>
          <div className="filmstrip-header">
            <h3>Side View</h3>
            <span>{filmstripSlides.length} slide</span>
          </div>
          <div className="filmstrip-list">
            {quiz.introSlide && (
              <button
                type="button"
                className={`filmstrip-slide special filmstrip-slide-btn ${quiz.introSlide.id === selectedId ? 'active' : ''}`}
                onClick={() => handleFilmstripClick(quiz.introSlide)}
              >
                <div className="filmstrip-slide-num">Intro</div>
                <div className="filmstrip-slide-body">
                  <div className="filmstrip-slide-type">{TYPE_LABELS.IntroSlide}</div>
                  <div className="filmstrip-slide-text">
                    {quiz.introSlide.questionText || '(không có text)'}
                  </div>
                </div>
              </button>
            )}

            {quiz.questions.map((q) => {
              const showGroup = q.groupTitle !== lastGroup
              lastGroup = q.groupTitle
              if (q.deleted) return null
              return (
                <div key={q.id}>
                  {showGroup && <div className="filmstrip-group">{q.groupTitle}</div>}
                  <button
                    type="button"
                    className={`filmstrip-slide filmstrip-slide-btn ${q.id === selectedId ? 'active' : ''}`}
                    onClick={() => handleFilmstripClick(q)}
                  >
                    <div className="filmstrip-slide-num">#{q.questionIndex + 1}</div>
                    <div className="filmstrip-slide-body">
                      <div className="filmstrip-slide-type">
                        {TYPE_LABELS[q.type] || q.type}
                      </div>
                      <div className="filmstrip-slide-text">
                        {q.questionText || '(không có text)'}
                      </div>
                    </div>
                  </button>
                </div>
              )
            })}

            {quiz.resultSlides?.length > 0 && (
              <>
                <div className="filmstrip-group">Kết quả</div>
                {quiz.resultSlides.map((r) => (
                  <button
                    key={r.id}
                    type="button"
                    className={`filmstrip-slide special filmstrip-slide-btn ${r.id === selectedId ? 'active' : ''}`}
                    onClick={() => handleFilmstripClick(r)}
                  >
                    <div className="filmstrip-slide-num">
                      {r.resultKind === 'passed' ? 'Đạt' : r.resultKind === 'failed' ? 'Không đạt' : 'KQ'}
                    </div>
                    <div className="filmstrip-slide-body">
                      <div className="filmstrip-slide-type">{TYPE_LABELS.ResultSlide}</div>
                      <div className="filmstrip-slide-text">
                        {r.questionText || '(không có text)'}
                      </div>
                    </div>
                  </button>
                ))}
              </>
            )}
          </div>
          <p className="filmstrip-hint">
            Bấm slide để xem trong player — đồng bộ với danh sách câu hỏi bên trái.
          </p>
        </aside>

        <PanelResizeHandle
          side="right"
          label="Kéo để đổi chiều rộng Side View"
          onPointerDown={(e) => filmstripResize.onPointerDown(e, 'expand-right')}
        />

        <div className="sideview-player-wrap">
          <div className="sideview-player-label">Slide View — câu đang chọn</div>
          <div className="preview-player-frame sideview-player-frame">
            <iframe
              ref={iframeRef}
              key={`${reloadKey}-${selectedId}`}
              title="SCORM Slide Preview"
              src={playerUrl}
              className="preview-iframe"
              allow="autoplay"
            />
          </div>
        </div>
      </div>
    </div>
  )
}