import { useCallback, useRef, useState } from 'react'
import { assetUrl, exportSession, importSample, importZip, saveSession, uploadImage } from './api'
import LayoutCanvas from './LayoutCanvas'
import QuizPreview from './QuizPreview'
import TextFormatToolbar, { TextFormatPreview } from './TextFormatToolbar'
import { defaultFormat } from './textFormatUtils'

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
  DND: 'Kéo thả',
  IntroSlide: 'Giới thiệu',
  ResultSlide: 'Kết quả',
}

const RESULT_KIND_LABELS = {
  passed: 'Đạt',
  failed: 'Không đạt',
}

function buildSavePayload(quiz) {
  return {
    title: quiz.title,
    passingScore: quiz.passingScore,
    introSlide: quiz.introSlide || null,
    resultSlides: quiz.resultSlides || [],
    questions: quiz.questions,
  }
}

function firstSelectableId(quiz) {
  if (quiz.introSlide?.id) return quiz.introSlide.id
  return quiz.questions.find((q) => !q.deleted)?.id || null
}

function findSelectedSlide(quiz, selectedId) {
  if (!quiz || !selectedId) return null
  if (quiz.introSlide?.id === selectedId) return quiz.introSlide
  const result = quiz.resultSlides?.find((r) => r.id === selectedId)
  if (result) return result
  return quiz.questions.find((q) => q.id === selectedId) || null
}

function editableBadge(level) {
  if (level === 'full') return <span className="badge badge-full">Sửa đầy đủ</span>
  if (level === 'partial') return <span className="badge badge-partial">Sửa một phần</span>
  return <span className="badge badge-readonly">Chỉ xem</span>
}

function ImportPage({ onImport, loading, error }) {
  const inputRef = useRef(null)
  const [drag, setDrag] = useState(false)

  const handleFile = async (file) => {
    if (!file?.name?.toLowerCase().endsWith('.zip')) return
    await onImport(() => importZip(file))
  }

  return (
    <div className="import-page">
      <div className="import-card">
        <h2>SCORM Editor</h2>
        <p>Import gói SCORM iSpring Quiz, chỉnh sửa nội dung, và export lại file zip chuẩn LMS.</p>

        {error && <div className="error-banner">{error}</div>}

        <div
          className={`dropzone ${drag ? 'dragover' : ''}`}
          onClick={() => inputRef.current?.click()}
          onDragOver={(e) => { e.preventDefault(); setDrag(true) }}
          onDragLeave={() => setDrag(false)}
          onDrop={(e) => {
            e.preventDefault()
            setDrag(false)
            handleFile(e.dataTransfer.files[0])
          }}
        >
          <div className="dropzone-icon">📦</div>
          <div className="dropzone-text">
            {loading ? 'Đang xử lý...' : 'Kéo thả file .zip hoặc bấm để chọn'}
          </div>
          <div className="dropzone-hint">Hỗ trợ SCORM 1.2 từ iSpring Quiz Maker (zip lồng zip)</div>
          <input
            ref={inputRef}
            type="file"
            accept=".zip"
            hidden
            onChange={(e) => handleFile(e.target.files[0])}
          />
        </div>

        <div className="sample-buttons">
          <button className="btn" disabled={loading} onClick={() => onImport(() => importSample('zip'))}>
            Load mẫu ZIP
          </button>
          <button className="btn" disabled={loading} onClick={() => onImport(() => importSample('dir'))}>
            Load mẫu thư mục
          </button>
        </div>
      </div>
    </div>
  )
}

function QuestionEditor({ question, sessionId, onChange, onDelete, onImageUpload, hideHeader }) {
  if (!question) {
    return <div className="editor-empty">Chọn một câu hỏi để chỉnh sửa</div>
  }

  const update = (patch) => onChange({ ...question, ...patch })
  const readonly = question.editableLevel === 'readonly'
  const partial = question.editableLevel === 'partial'

  return (
    <div className="editor-panel">
      {!hideHeader && <QuestionHeader question={question} onDelete={onDelete} />}

      {(readonly || partial) && (
        <div className="readonly-notice">
          {readonly
            ? 'Loại câu hỏi phức tạp (Hotspot / Kéo thả) — dùng tab Canvas để sửa layout; nội dung đáp án sửa hạn chế trên tab Nội dung.'
            : 'Một số loại câu hỏi chỉ sửa được một phần nội dung. Layout luôn chỉnh được trên tab Canvas.'}
        </div>
      )}

      <div className="editor-section">
        <h4>Câu hỏi</h4>
        <div className="field">
          <label>Nội dung câu hỏi</label>
          <textarea
            value={question.questionText}
            onChange={(e) => update({ questionText: e.target.value })}
            rows={3}
          />
        </div>
        <TextFormatToolbar
          label="Tiêu đề"
          role="title"
          format={question.questionFormat}
          showAlign
          onChange={(questionFormat) => update({ questionFormat })}
        />
        <TextFormatPreview
          text={question.questionText}
          format={question.questionFormat}
          role="title"
        />
      </div>

      {question.choices?.length > 0 && (
        <div className="editor-section">
          <h4>Đáp án ({question.choices.length})</h4>
          {question.choices.map((ch, idx) => (
            <div key={ch.id || idx} className="choice-card">
              <div className="choice-header">
                <input
                  type="checkbox"
                  id={`correct-${ch.id}`}
                  checked={!!ch.isCorrect}
                  onChange={(e) => {
                    const choices = [...question.choices]
                    if (question.type === 'MultipleChoice') {
                      choices.forEach((c, i) => { choices[i] = { ...c, isCorrect: i === idx } })
                    } else {
                      choices[idx] = { ...ch, isCorrect: e.target.checked }
                    }
                    update({ choices })
                  }}
                />
                <label htmlFor={`correct-${ch.id}`}>Đáp án đúng</label>
              </div>
              <div className="field">
                <label>Nội dung đáp án</label>
                <input
                  type="text"
                  value={ch.text}
                  onChange={(e) => {
                    const choices = [...question.choices]
                    choices[idx] = { ...ch, text: e.target.value }
                    update({ choices })
                  }}
                />
              </div>
              <TextFormatToolbar
                label="Đáp án"
                role="content"
                compact
                format={ch.format}
                onChange={(format) => {
                  const choices = [...question.choices]
                  choices[idx] = { ...ch, format }
                  update({ choices })
                }}
              />
              {ch.image && (
                <div className="field">
                  <label>Ảnh đáp án</label>
                  <div className="image-card" style={{ maxWidth: 200 }}>
                    <img src={assetUrl(sessionId, ch.image)} alt={ch.image} />
                    <div className="image-card-footer">
                      <span className="image-name">{ch.image}</span>
                      <label className="btn btn-sm" style={{ cursor: 'pointer' }}>
                        Thay ảnh
                        <input
                          type="file"
                          accept="image/*"
                          hidden
                          onChange={(e) => onImageUpload(ch.image, e.target.files[0])}
                        />
                      </label>
                    </div>
                  </div>
                </div>
              )}
            </div>
          ))}
        </div>
      )}

      {question.typeInAnswers?.length > 0 && (
        <div className="editor-section">
          <h4>Đáp án chấp nhận (Type In)</h4>
          {question.typeInAnswers.map((ans, idx) => (
            <div key={idx} className="field">
              <input
                type="text"
                value={ans}
                onChange={(e) => {
                  const typeInAnswers = [...question.typeInAnswers]
                  typeInAnswers[idx] = e.target.value
                  update({ typeInAnswers })
                }}
              />
            </div>
          ))}
          <button
            className="btn btn-sm"
            onClick={() => update({ typeInAnswers: [...question.typeInAnswers, ''] })}
          >
            + Thêm đáp án
          </button>
        </div>
      )}

      {question.matchingPairs?.length > 0 && (
        <div className="editor-section">
          <h4>Cặp nối (Matching) — chỉ xem</h4>
          {question.matchingPairs.map((pair, idx) => (
            <div key={idx} className="choice-card">
              <div style={{ fontSize: '0.85rem' }}>
                <div>Trái: {pair.leftText || pair.leftImage || '—'}</div>
                <div>Phải: {pair.rightText || pair.rightImage || '—'}</div>
              </div>
            </div>
          ))}
        </div>
      )}

      {question.sequenceItems?.length > 0 && (
        <div className="editor-section">
          <h4>Thứ tự (Sequence) — chỉ xem</h4>
          {question.sequenceItems.map((item, idx) => (
            <div key={item.id} className="choice-card">
              <span style={{ fontSize: '0.85rem' }}>{idx + 1}. {item.text}</span>
            </div>
          ))}
        </div>
      )}

      <div className="editor-section">
        <h4>Giải thích / Feedback</h4>
        {[
          { key: 'correct', label: 'Khi trả lời đúng' },
          { key: 'incorrect', label: 'Khi trả lời sai' },
          { key: 'attempt', label: 'Khi hết lượt thử' },
        ].map(({ key, label }) => (
          <div key={key} className="feedback-format-block">
            <div className="field">
              <label>{label}</label>
              <input
                type="text"
                value={question.feedback?.[key] || ''}
                onChange={(e) => update({
                  feedback: {
                    ...question.feedback,
                    [key]: e.target.value,
                    formats: {
                      ...(question.feedback?.formats || {}),
                      [key]: question.feedback?.formats?.[key] || defaultFormat('content'),
                    },
                  },
                })}
              />
            </div>
            <TextFormatToolbar
              label="Định dạng"
              role="content"
              compact
              format={question.feedback?.formats?.[key]}
              onChange={(format) => update({
                feedback: {
                  ...question.feedback,
                  formats: { ...(question.feedback?.formats || {}), [key]: format },
                },
              })}
            />
          </div>
        ))}
      </div>

      {question.slideImages?.length > 0 && (
        <div className="editor-section">
          <h4>Ảnh trong câu hỏi</h4>
          <div className="image-grid">
            {question.slideImages.map((img) => (
              <div key={img} className="image-card">
                <img src={assetUrl(sessionId, img)} alt={img} />
                <div className="image-card-footer">
                  <span className="image-name">{img}</span>
                  <label className="btn btn-sm" style={{ cursor: 'pointer' }}>
                    Thay ảnh
                    <input
                      type="file"
                      accept="image/*"
                      hidden
                      onChange={(e) => onImageUpload(img, e.target.files[0])}
                    />
                  </label>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}

function SlideHeader({ slide, onDelete }) {
  if (!slide) return null
  const isQuestion = slide.slideRole === 'question'
  const isResult = slide.slideRole === 'result'
  const title = isQuestion
    ? `Câu ${slide.questionIndex + 1}: ${TYPE_LABELS[slide.type] || slide.type}`
    : isResult
      ? `Kết quả: ${RESULT_KIND_LABELS[slide.resultKind] || slide.resultKind || 'Kết quả'}`
      : `Slide ${TYPE_LABELS[slide.type] || slide.type}`

  return (
    <div className="question-header">
      <div>
        <h2>{title}</h2>
        <div className="question-header-meta">
          {isQuestion && editableBadge(slide.editableLevel)}
          {isQuestion && <span>{slide.groupTitle}</span>}
          {slide.slideRole === 'intro' && <span className="badge badge-full">Slide mở đầu</span>}
          {isResult && <span className="badge badge-full">Slide kết quả</span>}
          {slide.layout?.overlaps?.some((o) => o.severity === 'error') && (
            <span className="badge badge-readonly">Layout lỗi</span>
          )}
        </div>
      </div>
      {isQuestion && (
        <button className="btn btn-danger btn-sm" onClick={onDelete}>Xoá câu</button>
      )}
    </div>
  )
}

function SpecialSlideEditor({ slide, sessionId, onChange, onImageUpload, hideHeader }) {
  if (!slide) {
    return <div className="editor-empty">Chọn một slide để chỉnh sửa</div>
  }

  const update = (patch) => onChange({ ...slide, ...patch })
  const isIntro = slide.slideRole === 'intro'

  return (
    <div className="editor-panel">
      {!hideHeader && <SlideHeader slide={slide} />}

      <div className="editor-section">
        <h4>{isIntro ? 'Nội dung giới thiệu' : 'Thông báo kết quả'}</h4>
        <div className="field">
          <label>{isIntro ? 'Tiêu đề / mô tả' : 'Tiêu đề chính'}</label>
          <textarea
            value={slide.questionText}
            onChange={(e) => update({ questionText: e.target.value })}
            rows={isIntro ? 6 : 3}
          />
        </div>
        <TextFormatToolbar
          label="Tiêu đề"
          role="title"
          format={slide.questionFormat}
          showAlign
          onChange={(questionFormat) => update({ questionFormat })}
        />
        <TextFormatPreview
          text={slide.questionText}
          format={slide.questionFormat}
          role="title"
        />
      </div>

      {isIntro && (
        <div className="editor-section">
          <h4>Gợi ý bắt đầu</h4>
          <div className="field">
            <label>Dòng phụ (ví dụ: Bấm Start Quiz)</label>
            <input
              type="text"
              value={slide.subtitleText || ''}
              onChange={(e) => update({ subtitleText: e.target.value })}
            />
          </div>
          <TextFormatToolbar
            label="Gợi ý"
            role="content"
            format={slide.subtitleFormat}
            onChange={(subtitleFormat) => update({ subtitleFormat })}
          />
          <TextFormatPreview
            text={slide.subtitleText}
            format={slide.subtitleFormat}
            role="content"
          />
        </div>
      )}

      {slide.slideImages?.length > 0 && (
        <div className="editor-section">
          <h4>Ảnh trong slide</h4>
          <div className="image-grid">
            {slide.slideImages.map((img) => (
              <div key={img} className="image-card">
                <img src={assetUrl(sessionId, img)} alt={img} />
                <div className="image-card-footer">
                  <span className="image-name">{img}</span>
                  <label className="btn btn-sm" style={{ cursor: 'pointer' }}>
                    Thay ảnh
                    <input
                      type="file"
                      accept="image/*"
                      hidden
                      onChange={(e) => onImageUpload(img, e.target.files[0])}
                    />
                  </label>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}

function EditorWorkspace({ slide, sessionId, fonts, onChange, onPatch, onDelete, onImageUpload }) {
  const [tab, setTab] = useState('layout')
  const isSpecial = slide?.slideRole === 'intro' || slide?.slideRole === 'result'

  if (!slide) {
    return <div className="editor-empty">Chọn một slide để chỉnh sửa</div>
  }

  return (
    <div className="editor-workspace">
      <SlideHeader slide={slide} onDelete={onDelete} />
      <div className="editor-tabs">
        <button type="button" className={tab === 'layout' ? 'active' : ''} onClick={() => setTab('layout')}>
          Canvas Layout
        </button>
        <button type="button" className={tab === 'content' ? 'active' : ''} onClick={() => setTab('content')}>
          {isSpecial ? 'Nội dung' : 'Nội dung & Feedback'}
        </button>
      </div>
      {tab === 'layout' ? (
        <LayoutCanvas
          question={slide}
          sessionId={sessionId}
          fonts={fonts}
          onPatch={onPatch}
          onChange={onChange}
        />
      ) : isSpecial ? (
        <SpecialSlideEditor
          slide={slide}
          sessionId={sessionId}
          onChange={onChange}
          onImageUpload={onImageUpload}
          hideHeader
        />
      ) : (
        <QuestionEditor
          question={slide}
          sessionId={sessionId}
          onChange={onChange}
          onDelete={onDelete}
          onImageUpload={onImageUpload}
          hideHeader
        />
      )}
    </div>
  )
}

export default function App() {
  const [quiz, setQuiz] = useState(null)
  const [selectedId, setSelectedId] = useState(null)
  const [workspaceMode, setWorkspaceMode] = useState('edit')
  const [loading, setLoading] = useState(false)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState(null)
  const [toast, setToast] = useState(null)

  const showToast = (msg, type = 'success') => {
    setToast({ msg, type })
    setTimeout(() => setToast(null), 3000)
  }

  const handleImport = async (fn) => {
    setLoading(true)
    setError(null)
    try {
      const data = await fn()
      setQuiz(data)
      setSelectedId(firstSelectableId(data))
      const slideCount = (data.introSlide ? 1 : 0) + (data.resultSlides?.length || 0)
      showToast(`Đã import ${data.questionCount} câu + ${slideCount} slide đặc biệt`)
    } catch (err) {
      setError(err.message)
    } finally {
      setLoading(false)
    }
  }

  const selectedSlide = findSelectedSlide(quiz, selectedId)

  const updateSlide = useCallback((updated) => {
    setQuiz((prev) => {
      if (updated.slideRole === 'intro') {
        return { ...prev, introSlide: updated }
      }
      if (updated.slideRole === 'result') {
        return {
          ...prev,
          resultSlides: (prev.resultSlides || []).map((r) =>
            r.id === updated.id ? updated : r,
          ),
        }
      }
      return {
        ...prev,
        questions: prev.questions.map((q) => (q.id === updated.id ? updated : q)),
      }
    })
  }, [])

  const patchSlide = useCallback((patch) => {
    if (!selectedId) return
    setQuiz((prev) => {
      if (prev.introSlide?.id === selectedId) {
        return { ...prev, introSlide: { ...prev.introSlide, ...patch } }
      }
      if (prev.resultSlides?.some((r) => r.id === selectedId)) {
        return {
          ...prev,
          resultSlides: prev.resultSlides.map((r) =>
            r.id === selectedId ? { ...r, ...patch } : r,
          ),
        }
      }
      return {
        ...prev,
        questions: prev.questions.map((q) =>
          q.id === selectedId ? { ...q, ...patch } : q,
        ),
      }
    })
  }, [selectedId])

  const deleteQuestion = () => {
    if (!selectedSlide || selectedSlide.slideRole !== 'question') return
    if (!confirm(`Xoá câu ${selectedSlide.questionIndex + 1}?`)) return
    setQuiz((prev) => ({
      ...prev,
      questions: prev.questions.map((q) =>
        q.id === selectedId ? { ...q, deleted: true } : q
      ),
      questionCount: prev.questions.filter((q) => q.id !== selectedId && !q.deleted).length,
    }))
    const remaining = quiz.questions.filter((q) => q.id !== selectedId && !q.deleted)
    setSelectedId(remaining[0]?.id || null)
    showToast('Đã đánh dấu xoá — nhấn Lưu để áp dụng')
  }

  const persistQuiz = async () => {
    if (!quiz) return null
    const data = await saveSession(quiz.sessionId, buildSavePayload(quiz))
    setQuiz(data)
    return data
  }

  const handleSave = async () => {
    if (!quiz) return
    setSaving(true)
    try {
      await persistQuiz()
      showToast('Đã lưu thay đổi')
    } catch (err) {
      showToast(err.message, 'error')
    } finally {
      setSaving(false)
    }
  }

  const handleOpenPreview = async () => {
    if (!quiz) return
    setSaving(true)
    try {
      await persistQuiz()
      setWorkspaceMode('preview')
      showToast('Đã mở Slide View — làm bài với player SCORM')
    } catch (err) {
      showToast(err.message, 'error')
    } finally {
      setSaving(false)
    }
  }

  const handleExport = async () => {
    if (!quiz) return
    setSaving(true)
    try {
      await saveSession(quiz.sessionId, buildSavePayload(quiz))
      const blob = await exportSession(quiz.sessionId, quiz.title)
      const url = URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url
      a.download = `${quiz.title || 'scorm-export'}.zip`
      a.click()
      URL.revokeObjectURL(url)
      showToast('Đã export SCORM zip')
    } catch (err) {
      showToast(err.message, 'error')
    } finally {
      setSaving(false)
    }
  }

  const handleImageUpload = async (filename, file) => {
    if (!file || !quiz) return
    try {
      await uploadImage(quiz.sessionId, filename, file)
      showToast(`Đã thay ảnh ${filename}`)
      setQuiz((prev) => ({ ...prev, _imgRev: Date.now() }))
    } catch (err) {
      showToast(err.message, 'error')
    }
  }

  if (!quiz) {
    return (
      <div className="app">
        <header className="header">
          <h1><span>SCORM</span> Editor</h1>
        </header>
        <ImportPage onImport={handleImport} loading={loading} error={error} />
        {loading && (
          <div className="loading" style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.5)' }}>
            <div className="spinner" /> Đang phân tích gói SCORM...
          </div>
        )}
      </div>
    )
  }

  if (workspaceMode === 'preview') {
    return (
      <div className="app app-preview">
        <QuizPreview
          quiz={quiz}
          saving={saving}
          onBack={() => setWorkspaceMode('edit')}
          onSave={persistQuiz}
        />
        {toast && <div className={`toast toast-${toast.type}`}>{toast.msg}</div>}
      </div>
    )
  }

  const activeQuestions = quiz.questions.filter((q) => !q.deleted)
  let lastGroup = null

  return (
    <div className="app">
      <header className="header">
        <h1><span>SCORM</span> Editor</h1>
        <div className="header-actions">
          <button className="btn" onClick={() => { setQuiz(null); setSelectedId(null); setWorkspaceMode('edit') }}>
            Import mới
          </button>
          <button className="btn" disabled={saving} onClick={handleOpenPreview}>
            Xem & Làm bài
          </button>
          <button className="btn btn-primary" disabled={saving} onClick={handleSave}>
            {saving ? 'Đang lưu...' : 'Lưu'}
          </button>
          <button className="btn btn-primary" disabled={saving} onClick={handleExport}>
            Export SCORM
          </button>
        </div>
      </header>

      <div className="main">
        <aside className="sidebar">
          <div className="sidebar-header">
            <h3>Cài đặt Quiz</h3>
            <div className="meta-field">
              <label>Tên quiz</label>
              <input
                type="text"
                value={quiz.title}
                onChange={(e) => setQuiz((p) => ({ ...p, title: e.target.value }))}
              />
            </div>
            <div className="meta-field">
              <label>Điểm đạt (%)</label>
              <input
                type="number"
                min={0}
                max={100}
                value={quiz.passingScore}
                onChange={(e) => setQuiz((p) => ({ ...p, passingScore: Number(e.target.value) }))}
              />
            </div>
            <div className="stats-row">
              <span className="stat"><strong>{activeQuestions.length}</strong> câu hỏi</span>
              <span className="stat"><strong>{quiz.groups?.length}</strong> nhóm</span>
            </div>
          </div>

          <div className="question-list">
            {quiz.introSlide && (
              <div>
                <div className="group-label">Mở đầu</div>
                <button
                  className={`question-item special-slide ${quiz.introSlide.id === selectedId ? 'active' : ''}`}
                  onClick={() => setSelectedId(quiz.introSlide.id)}
                >
                  <div className="q-item-top">
                    <span className="q-num">Intro</span>
                    <span className="q-type">{TYPE_LABELS.IntroSlide}</span>
                  </div>
                  <div className="q-preview">{quiz.introSlide.questionText || '(không có text)'}</div>
                </button>
              </div>
            )}

            {quiz.questions.map((q) => {
              const showGroup = q.groupTitle !== lastGroup
              lastGroup = q.groupTitle
              return (
                <div key={q.id}>
                  {showGroup && <div className="group-label">{q.groupTitle}</div>}
                  <button
                    className={`question-item ${q.id === selectedId ? 'active' : ''} ${q.deleted ? 'deleted' : ''}`}
                    onClick={() => !q.deleted && setSelectedId(q.id)}
                    disabled={q.deleted}
                  >
                    <div className="q-item-top">
                      <span className="q-num">#{q.questionIndex + 1}</span>
                      <span className={`q-type ${q.editableLevel === 'readonly' ? 'readonly' : ''}`}>
                        {TYPE_LABELS[q.type] || q.type}
                      </span>
                    </div>
                    <div className="q-preview">{q.questionText || '(không có text)'}</div>
                    {q.layout?.overlaps?.some((o) => o.severity === 'error') && (
                      <span className="q-layout-warn">⚠ layout</span>
                    )}
                  </button>
                </div>
              )
            })}

            {quiz.resultSlides?.length > 0 && (
              <div>
                <div className="group-label">Kết quả</div>
                {quiz.resultSlides.map((r) => (
                  <button
                    key={r.id}
                    className={`question-item special-slide ${r.id === selectedId ? 'active' : ''}`}
                    onClick={() => setSelectedId(r.id)}
                  >
                    <div className="q-item-top">
                      <span className="q-num">{RESULT_KIND_LABELS[r.resultKind] || 'Kết quả'}</span>
                      <span className="q-type">{TYPE_LABELS.ResultSlide}</span>
                    </div>
                    <div className="q-preview">{r.questionText || '(không có text)'}</div>
                  </button>
                ))}
              </div>
            )}
          </div>
        </aside>

        <EditorWorkspace
          slide={selectedSlide}
          sessionId={quiz.sessionId}
          fonts={quiz.fonts}
          onChange={updateSlide}
          onPatch={patchSlide}
          onDelete={deleteQuestion}
          onImageUpload={handleImageUpload}
        />
      </div>

      {toast && <div className={`toast toast-${toast.type}`}>{toast.msg}</div>}
    </div>
  )
}