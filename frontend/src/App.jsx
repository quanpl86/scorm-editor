import { useCallback, useEffect, useRef, useState } from 'react'
import {
  assetUrl,
  exportSession,
  importExcel,
  importExcelSample,
  importSample,
  importZip,
  saveSession,
  uploadImage,
} from './api'
import {
  clampChoiceColumns,
  maxChoiceColumns,
  patchChoiceColumnsLayout,
  resolveChoiceColumns,
  supportsChoiceColumns,
} from './choiceLayoutUtils'
import LayoutCanvas from './LayoutCanvas'
import PanelResizeHandle from './PanelResizeHandle'
import QuestionSideView from './QuestionSideView'
import QuizPreview from './QuizPreview'
import { useAutoSync } from './useAutoSync'
import { useQuizHistory } from './useQuizHistory'
import { useResizableWidth } from './useResizableWidth'
import TextFormatToolbar, { TextFormatPreview } from './TextFormatToolbar'
import { extractPlainTextFromHtml } from './richTextUtils'
import { sanitizeLayoutForSave } from './canvasObjectUtils'
import { buildStyledHtml, defaultFormat } from './textFormatUtils'

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
  TrueFalse: 'Đúng/Sai',
  DND: 'Kéo thả',
  IntroSlide: 'Giới thiệu',
  ResultSlide: 'Kết quả',
}

const RESULT_KIND_LABELS = {
  passed: 'Đạt',
  failed: 'Không đạt',
}

const REPORTING_FILTER_LABELS = {
  passedAndFailed: 'Đạt và không đạt',
  passed: 'Chỉ khi đạt',
  failed: 'Chỉ khi không đạt',
}

const DEFAULT_SERVER_REPORT_URL = 'https://n8n.teky.vn/webhook/teky-quiz-result-endpoint'

const DEFAULT_REPORTING = {
  sendToServer: { enabled: false, url: '' },
  adminEmail: { enabled: false, emails: '', filter: 'passedAndFailed' },
  studentEmail: { enabled: false, filter: 'passedAndFailed' },
}

function normalizeReporting(reporting) {
  const r = reporting || {}
  return {
    sendToServer: { ...DEFAULT_REPORTING.sendToServer, ...r.sendToServer },
    adminEmail: { ...DEFAULT_REPORTING.adminEmail, ...r.adminEmail },
    studentEmail: { ...DEFAULT_REPORTING.studentEmail, ...r.studentEmail },
  }
}

/** Giữ HTML đúng như canvas trước khi gửi server — tránh rebuild làm lệch font/layout */
function syncSlideCanvasHtml(slide) {
  if (!slide?.layout) return slide
  let next = { ...slide }
  const typography = slide.layout.typography

  if (slide._dirtyQuestionText || slide._dirtyQuestionFormat) {
    const dir = slide.layout.objects?.find((o) => o.I === 'direction')
    if (dir) {
      const html = (dir.html?.trim() && extractPlainTextFromHtml(dir.html))
        ? dir.html
        : buildStyledHtml(
          slide.questionText,
          'title',
          slide.questionFormat,
          typography,
          dir.html,
        )
      next = {
        ...next,
        layout: {
          ...next.layout,
          objects: (next.layout.objects || []).map((o) =>
            o.I === 'direction' ? { ...o, html, text: slide.questionText } : o,
          ),
        },
      }
      next._canvasQuestionHtml = html
    }
  }

  if (slide._dirtySubtitleText || slide._dirtySubtitleFormat) {
    const content = slide.layout.objects?.find((o) => o.role === 'content')
    if (content?.html != null || slide.subtitleText != null) {
      const html = (content?.html?.trim() && extractPlainTextFromHtml(content.html))
        ? content.html
        : buildStyledHtml(
          slide.subtitleText || '',
          'content',
          slide.subtitleFormat,
          typography,
          content?.html,
        )
      next = {
        ...next,
        layout: {
          ...next.layout,
          objects: (next.layout.objects || []).map((o) =>
            o.role === 'content' && slide.slideRole === 'intro'
              ? { ...o, html, text: slide.subtitleText }
              : o,
          ),
        },
      }
      next._canvasSubtitleHtml = html
    }
  }

  if (slide._dirtyChoices && slide.choices?.length) {
    const preview = slide.layout.choicePreview
    const items = preview?.items || []
    const syncedChoices = slide.choices.map((ch, idx) => {
      const item = items[idx]
      const sourceHtml = ch.html || item?.html
      const html = (sourceHtml?.trim() && extractPlainTextFromHtml(sourceHtml))
        ? sourceHtml
        : buildStyledHtml(ch.text, 'content', ch.format, typography, sourceHtml)
      return { ...ch, html }
    })
    const syncedItems = items.map((item, idx) => {
      const ch = slide.choices[idx]
      if (!ch) return item
      return {
        ...item,
        text: ch.text,
        html: syncedChoices[idx]?.html || item.html,
      }
    })
    next = {
      ...next,
      choices: syncedChoices,
      layout: {
        ...next.layout,
        choicePreview: preview ? { ...preview, items: syncedItems } : preview,
      },
    }
  }

  return next
}

function buildSlideSavePayload(slide) {
  if (!slide) return null
  const synced = syncSlideCanvasHtml(slide)
  const payload = { id: synced.id }
  if (synced.deleted) return { ...payload, deleted: true }
  if (synced.slideRole) payload.slideRole = synced.slideRole
  if (synced.type) payload.type = synced.type

  if (synced._dirtyQuestionText) payload.questionText = synced.questionText
  if (synced._dirtyQuestionFormat) payload.questionFormat = synced.questionFormat
  if (synced._canvasQuestionHtml) payload.questionHtml = synced._canvasQuestionHtml
  if (synced._dirtySubtitleText) payload.subtitleText = synced.subtitleText
  if (synced._dirtySubtitleFormat) payload.subtitleFormat = synced.subtitleFormat
  if (synced._canvasSubtitleHtml) payload.subtitleHtml = synced._canvasSubtitleHtml
  if (synced._dirtyLayout) payload.layout = sanitizeLayoutForSave(synced.layout)
  if (synced._dirtyChoices) payload.choices = synced.choices
  if (synced._dirtyFeedback) payload.feedback = synced.feedback
  if (synced._dirtyTypeIn) payload.typeInAnswers = synced.typeInAnswers
  if (synced._dirtyWordBank) payload.wordBankWords = synced.wordBankWords
  if (synced._dirtyRichHtml) payload.richHtml = synced.layout?.choicePreview?.richHtml
  if (synced.slideRole === 'question') {
    payload.points = synced.points ?? 1
    payload.timeLimitEnabled = !!synced.timeLimitEnabled
    payload.timeLimit = synced.timeLimit ?? 0
    payload.shuffleAnswers = !!synced.shuffleAnswers
  }
  return payload
}

function clearSlideDirtyFlags(slide) {
  if (!slide) return slide
  const next = { ...slide }
  Object.keys(next).forEach((key) => {
    if (key.startsWith('_dirty') || key.startsWith('_canvas')) delete next[key]
  })
  return next
}

function clearDirtyFlags(quiz) {
  if (!quiz) return quiz
  const { _dirtyMeta, ...rest } = quiz
  return {
    ...rest,
    introSlide: clearSlideDirtyFlags(quiz.introSlide),
    resultSlides: (quiz.resultSlides || []).map(clearSlideDirtyFlags),
    questions: (quiz.questions || []).map(clearSlideDirtyFlags),
  }
}

function fieldChanged(slide, patch, key) {
  return key in patch && JSON.stringify(slide?.[key]) !== JSON.stringify(patch[key])
}

function applyDirtyFlags(slide, patch) {
  const next = { ...slide, ...patch }
  if (fieldChanged(slide, patch, 'questionText')) next._dirtyQuestionText = true
  if (fieldChanged(slide, patch, 'questionFormat')) next._dirtyQuestionFormat = true
  if (fieldChanged(slide, patch, 'subtitleText')) next._dirtySubtitleText = true
  if (fieldChanged(slide, patch, 'subtitleFormat')) next._dirtySubtitleFormat = true
  if (fieldChanged(slide, patch, 'layout') || patch._dirtyLayout) next._dirtyLayout = true
  if (fieldChanged(slide, patch, 'choices')) next._dirtyChoices = true
  if (fieldChanged(slide, patch, 'feedback')) next._dirtyFeedback = true
  if (fieldChanged(slide, patch, 'typeInAnswers')) next._dirtyTypeIn = true
  if (fieldChanged(slide, patch, 'wordBankWords')) next._dirtyWordBank = true
  if (
    fieldChanged(slide, patch, 'points')
    || fieldChanged(slide, patch, 'timeLimit')
    || fieldChanged(slide, patch, 'timeLimitEnabled')
    || fieldChanged(slide, patch, 'shuffleAnswers')
  ) {
    next._dirtyQuestionOptions = true
  }
  return next
}

function buildSavePayload(quiz) {
  return {
    title: quiz.title,
    passingScore: quiz.passingScore,
    reporting: normalizeReporting(quiz.reporting),
    introSlide: buildSlideSavePayload(quiz.introSlide),
    resultSlides: (quiz.resultSlides || []).map(buildSlideSavePayload).filter(Boolean),
    questions: (quiz.questions || []).map(buildSlideSavePayload),
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

function QuizSettingsPanel({ quiz, questionCount, setQuiz }) {
  return (
    <div className="editor-panel quiz-settings-panel">
      <div className="editor-section">
        <h4>Thông tin quiz</h4>
        <div className="meta-field">
          <label>Tên quiz</label>
          <input
            type="text"
            value={quiz.title}
            onChange={(e) => setQuiz((p) => ({ ...p, title: e.target.value, _dirtyMeta: true }), { burst: true })}
          />
        </div>
        <div className="meta-field">
          <label>Điểm đạt (%)</label>
          <input
            type="number"
            min={0}
            max={100}
            value={quiz.passingScore}
            onChange={(e) => setQuiz((p) => ({ ...p, passingScore: Number(e.target.value), _dirtyMeta: true }), { burst: true })}
          />
        </div>
        <div className="stats-row quiz-settings-stats">
          <span className="stat"><strong>{questionCount}</strong> câu hỏi</span>
          <span className="stat"><strong>{quiz.groups?.length || 0}</strong> nhóm</span>
        </div>
      </div>
      <ReportingSettings
        reporting={quiz.reporting}
        onChange={(reporting) => setQuiz((p) => ({ ...p, reporting, _dirtyMeta: true }), { burst: true })}
      />
    </div>
  )
}

function ReportingSettings({ reporting, onChange }) {
  const r = normalizeReporting(reporting)

  const patch = (section, field, value) => {
    onChange({
      ...r,
      [section]: { ...r[section], [field]: value },
    })
  }

  const toggleSendToServer = (enabled) => {
    const next = { ...r.sendToServer, enabled }
    if (enabled && !String(r.sendToServer.url || '').trim()) {
      next.url = DEFAULT_SERVER_REPORT_URL
    }
    onChange({ ...r, sendToServer: next })
  }

  return (
    <div className="reporting-settings editor-section">
      <h4>Reporting</h4>
      <p className="reporting-hint">
        Kết quả chi tiết được gửi khi học sinh hoàn thành quiz trên LMS.
      </p>

      <div className="reporting-block">
        <label className="meta-check">
          <input
            type="checkbox"
            checked={r.sendToServer.enabled}
            onChange={(e) => toggleSendToServer(e.target.checked)}
          />
          <span>Gửi kết quả lên server</span>
        </label>
        <div className="meta-field">
          <label>URL server nhận kết quả</label>
          <input
            type="url"
            placeholder={DEFAULT_SERVER_REPORT_URL}
            value={r.sendToServer.url}
            disabled={!r.sendToServer.enabled}
            onChange={(e) => patch('sendToServer', 'url', e.target.value)}
          />
        </div>
      </div>

      <div className="reporting-block">
        <label className="meta-check">
          <input
            type="checkbox"
            checked={r.adminEmail.enabled}
            onChange={(e) => patch('adminEmail', 'enabled', e.target.checked)}
          />
          <span>Gửi báo cáo qua email (admin)</span>
        </label>
        <div className="meta-field">
          <label>Email nhận báo cáo</label>
          <input
            type="text"
            placeholder="admin@school.edu, reports@school.edu"
            value={r.adminEmail.emails}
            disabled={!r.adminEmail.enabled}
            onChange={(e) => patch('adminEmail', 'emails', e.target.value)}
          />
        </div>
        <div className="meta-field">
          <label>Gửi khi</label>
          <select
            value={r.adminEmail.filter}
            disabled={!r.adminEmail.enabled}
            onChange={(e) => patch('adminEmail', 'filter', e.target.value)}
          >
            {Object.entries(REPORTING_FILTER_LABELS).map(([value, label]) => (
              <option key={value} value={value}>{label}</option>
            ))}
          </select>
        </div>
      </div>

      <div className="reporting-block">
        <label className="meta-check">
          <input
            type="checkbox"
            checked={r.studentEmail.enabled}
            onChange={(e) => patch('studentEmail', 'enabled', e.target.checked)}
          />
          <span>Gửi báo cáo cho học sinh</span>
        </label>
        <div className="meta-field">
          <label>Gửi khi</label>
          <select
            value={r.studentEmail.filter}
            disabled={!r.studentEmail.enabled}
            onChange={(e) => patch('studentEmail', 'filter', e.target.value)}
          >
            {Object.entries(REPORTING_FILTER_LABELS).map(([value, label]) => (
              <option key={value} value={value}>{label}</option>
            ))}
          </select>
        </div>
        <p className="reporting-note">
          Email học sinh lấy từ slide Authorization (nếu quiz có yêu cầu nhập email).
        </p>
      </div>
    </div>
  )
}

function ImportReport({ report, summary }) {
  if (!report?.length) return null
  const statusLabel = {
    imported: 'Đã import',
    error: 'Lỗi',
    skipped: 'Bỏ qua',
  }
  return (
    <div className="import-report">
      {summary && (
        <div className="import-report-summary">
          <span>{summary.imported}/{summary.total} câu import thành công</span>
          {summary.errors > 0 && <span className="import-report-warn">{summary.errors} lỗi</span>}
          {summary.skipped > 0 && <span className="import-report-muted">{summary.skipped} bỏ qua</span>}
        </div>
      )}
      <ul className="import-report-list">
        {report.map((row) => (
          <li key={row.row} className={`import-report-item import-report-${row.status}`}>
            <span className="import-report-row">Dòng {row.row}</span>
            <span className="import-report-type">{row.type}</span>
            <span className="import-report-status">{statusLabel[row.status] || row.status}</span>
            {row.question && <span className="import-report-question">{row.question}</span>}
            {row.errors?.length > 0 && (
              <span className="import-report-error">{row.errors.join('; ')}</span>
            )}
          </li>
        ))}
      </ul>
    </div>
  )
}

function ImportPage({ onImport, loading, error, importReport }) {
  const scormInputRef = useRef(null)
  const excelInputRef = useRef(null)
  const [scormDrag, setScormDrag] = useState(false)
  const [excelDrag, setExcelDrag] = useState(false)

  const handleScormFile = async (file) => {
    if (!file?.name?.toLowerCase().endsWith('.zip')) return
    await onImport(() => importZip(file))
  }

  const handleExcelFile = async (file) => {
    const name = file?.name?.toLowerCase() || ''
    if (!name.endsWith('.xls') && !name.endsWith('.xlsx') && !name.endsWith('.zip')) return
    await onImport(() => importExcel(file))
  }

  return (
    <div className="import-page">
      <div className="import-card">
        <h2>SCORM Editor</h2>
        <p>Import gói SCORM iSpring Quiz hoặc tạo quiz mới từ template Excel iSpring QuizMaker.</p>

        {error && <div className="error-banner">{error}</div>}
        {importReport && <ImportReport report={importReport.report} summary={importReport.summary} />}

        <section className="import-section">
          <h3>Tạo quiz từ Excel</h3>
          <p className="import-section-hint">
            Định dạng theo{' '}
            <a
              href="https://ispringhelpdocs.com/quizmaker9/importing-questions-from-excel-6128674.html"
              target="_blank"
              rel="noreferrer"
            >
              hướng dẫn iSpring QuizMaker
            </a>
            . Hỗ trợ MC, MR, TF, Short Answer, Matching, Sequence, Info Slide.
          </p>
          <div
            className={`dropzone dropzone-excel ${excelDrag ? 'dragover' : ''}`}
            onClick={() => excelInputRef.current?.click()}
            onDragOver={(e) => { e.preventDefault(); setExcelDrag(true) }}
            onDragLeave={() => setExcelDrag(false)}
            onDrop={(e) => {
              e.preventDefault()
              setExcelDrag(false)
              handleExcelFile(e.dataTransfer.files[0])
            }}
          >
            <div className="dropzone-icon">📊</div>
            <div className="dropzone-text">
              {loading ? 'Đang xử lý...' : 'Kéo thả file .xls / .xlsx hoặc .zip (Excel + media)'}
            </div>
            <div className="dropzone-hint">Ảnh đính kèm: đường dẫn tương đối như media\Columbus_ship.jpg</div>
            <input
              ref={excelInputRef}
              type="file"
              accept=".xls,.xlsx,.zip"
              hidden
              onChange={(e) => handleExcelFile(e.target.files[0])}
            />
          </div>
          <div className="sample-buttons">
            <button className="btn btn-primary" disabled={loading} onClick={() => onImport(() => importExcelSample())}>
              Import mẫu Excel (Sample_import_template.xls)
            </button>
          </div>
        </section>

        <section className="import-section">
          <h3>Chỉnh sửa SCORM có sẵn</h3>
          <div
            className={`dropzone ${scormDrag ? 'dragover' : ''}`}
            onClick={() => scormInputRef.current?.click()}
            onDragOver={(e) => { e.preventDefault(); setScormDrag(true) }}
            onDragLeave={() => setScormDrag(false)}
            onDrop={(e) => {
              e.preventDefault()
              setScormDrag(false)
              handleScormFile(e.dataTransfer.files[0])
            }}
          >
            <div className="dropzone-icon">📦</div>
            <div className="dropzone-text">
              {loading ? 'Đang xử lý...' : 'Kéo thả file .zip hoặc bấm để chọn'}
            </div>
            <div className="dropzone-hint">Hỗ trợ SCORM 1.2 từ iSpring Quiz Maker (zip lồng zip)</div>
            <input
              ref={scormInputRef}
              type="file"
              accept=".zip"
              hidden
              onChange={(e) => handleScormFile(e.target.files[0])}
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
        </section>
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
          {supportsChoiceColumns(question.type) && (
            <div className="field choice-columns-field">
              <label>Hiển thị đáp án</label>
              <div className="choice-columns-picker" role="group" aria-label="Số cột đáp án">
                {Array.from({ length: maxChoiceColumns(question.type) }, (_, i) => i + 1).map((n) => {
                  const cols = resolveChoiceColumns(question.layout, question.type)
                  return (
                    <button
                      key={n}
                      type="button"
                      className={`btn btn-sm choice-col-btn ${cols === n ? 'active' : ''}`}
                      onClick={() => {
                        const result = patchChoiceColumnsLayout(
                          question,
                          question.layout?.objects,
                          n,
                        )
                        if (!result) return
                        update({
                          _dirtyLayout: true,
                          layout: result.layout,
                        })
                      }}
                    >
                      {n} cột
                    </button>
                  )
                })}
              </div>
            </div>
          )}
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

      {question.type === 'WordBank' && (
        <div className="editor-section">
          <h4>Từ trong word bank</h4>
          {(question.wordBankWords || question.layout?.choicePreview?.extraWords || []).map((word, idx) => (
            <div key={idx} className="field">
              <input
                type="text"
                value={word}
                onChange={(e) => {
                  const words = [...(question.wordBankWords || question.layout?.choicePreview?.extraWords || [])]
                  words[idx] = e.target.value
                  update({ wordBankWords: words })
                }}
              />
            </div>
          ))}
          <button
            className="btn btn-sm"
            onClick={() => update({
              wordBankWords: [...(question.wordBankWords || question.layout?.choicePreview?.extraWords || []), ''],
            })}
          >
            + Thêm từ
          </button>
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

function EditorWorkspace({
  slide,
  quiz,
  selectedId,
  sessionId,
  fonts,
  saving,
  autoSaving,
  previewRevision,
  questionCount,
  setQuiz,
  onChange,
  onPatch,
  onDelete,
  onImageUpload,
  onSelectSlide,
  onSave,
  onCanvasEditStart,
  onCanvasEditStateChange,
}) {
  const [tab, setTab] = useState('layout')
  const isSpecial = slide?.slideRole === 'intro' || slide?.slideRole === 'result'
  const showSlideHeader = slide && tab !== 'sideview' && tab !== 'settings'

  const renderTabBody = () => {
    if (tab === 'settings') {
      return (
        <QuizSettingsPanel
          quiz={quiz}
          questionCount={questionCount}
          setQuiz={setQuiz}
        />
      )
    }

    if (tab === 'sideview') {
      return (
        <QuestionSideView
          quiz={quiz}
          selectedId={selectedId}
          onSelectSlide={onSelectSlide}
          onSave={onSave}
          saving={saving || autoSaving}
          autoSaving={autoSaving}
          previewRevision={previewRevision}
        />
      )
    }

    if (!slide) {
      return (
        <div className="editor-empty">
          Chọn một slide từ danh sách bên trái để chỉnh sửa, hoặc mở tab Cài đặt Quiz.
        </div>
      )
    }

    if (tab === 'layout') {
      return (
        <LayoutCanvas
          question={slide}
          sessionId={sessionId}
          fonts={fonts}
          imgRev={quiz._imgRev || 0}
          onPatch={onPatch}
          onChange={onChange}
          onCanvasEditStart={onCanvasEditStart}
          onCanvasEditStateChange={onCanvasEditStateChange}
          onImageUpload={onImageUpload}
        />
      )
    }

    if (isSpecial) {
      return (
        <SpecialSlideEditor
          slide={slide}
          sessionId={sessionId}
          onChange={onChange}
          onImageUpload={onImageUpload}
          hideHeader
        />
      )
    }

    return (
      <QuestionEditor
        question={slide}
        sessionId={sessionId}
        onChange={onChange}
        onDelete={onDelete}
        onImageUpload={onImageUpload}
        hideHeader
      />
    )
  }

  return (
    <div className="editor-workspace">
      {showSlideHeader && <SlideHeader slide={slide} onDelete={onDelete} />}
      <div className="editor-tabs">
        <button
          type="button"
          className={tab === 'layout' ? 'active' : ''}
          disabled={!slide}
          onClick={() => setTab('layout')}
        >
          Canvas Layout
        </button>
        <button
          type="button"
          className={tab === 'content' ? 'active' : ''}
          disabled={!slide}
          onClick={() => setTab('content')}
        >
          {isSpecial ? 'Nội dung' : 'Nội dung & Feedback'}
        </button>
        <button type="button" className={tab === 'sideview' ? 'active' : ''} onClick={() => setTab('sideview')}>
          Side View
        </button>
        <button type="button" className={tab === 'settings' ? 'active' : ''} onClick={() => setTab('settings')}>
          Cài đặt Quiz
        </button>
      </div>
      {renderTabBody()}
    </div>
  )
}

function isEditableTarget(target) {
  if (!target) return false
  const tag = target.tagName
  if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return true
  return !!target.isContentEditable
}

export default function App() {
  const {
    quiz,
    setQuiz,
    resetHistory,
    undo,
    redo,
    beginCanvasEdit,
    canUndo,
    canRedo,
  } = useQuizHistory(null)
  const [selectedId, setSelectedId] = useState(null)
  const [workspaceMode, setWorkspaceMode] = useState('edit')
  const [loading, setLoading] = useState(false)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState(null)
  const [importReport, setImportReport] = useState(null)
  const [toast, setToast] = useState(null)
  const [canvasEditing, setCanvasEditing] = useState(false)
  const sidebarResize = useResizableWidth('scorm-editor.sidebar-width', 320, { min: 240, max: 480 })

  const applySavedState = useCallback((savedView) => {
    setQuiz((prev) => {
      if (!savedView) {
        const questions = (prev.questions || [])
          .filter((q) => !q.deleted)
          .map((q) => clearSlideDirtyFlags(syncSlideCanvasHtml(q)))
        return clearDirtyFlags({
          ...prev,
          questions,
          questionCount: questions.length,
          resultSlides: (prev.resultSlides || []).map(clearSlideDirtyFlags),
          introSlide: clearSlideDirtyFlags(prev.introSlide),
        })
      }

      const savedQuestions = Object.fromEntries(
        (savedView.questions || []).map((q) => [q.id, clearSlideDirtyFlags(q)]),
      )
      const questions = (prev.questions || [])
        .filter((q) => !q.deleted)
        .map((q) => savedQuestions[q.id] || clearSlideDirtyFlags(syncSlideCanvasHtml(q)))

      return clearDirtyFlags({
        ...prev,
        title: savedView.title ?? prev.title,
        passingScore: savedView.passingScore ?? prev.passingScore,
        reporting: normalizeReporting(savedView.reporting ?? prev.reporting),
        questionCount: savedView.questionCount ?? questions.length,
        questions,
        introSlide: savedView.introSlide
          ? clearSlideDirtyFlags(savedView.introSlide)
          : clearSlideDirtyFlags(prev.introSlide),
        resultSlides: (savedView.resultSlides || []).map(clearSlideDirtyFlags),
        fonts: savedView.fonts ?? prev.fonts,
      })
    }, { recordHistory: false })
  }, [setQuiz])

  const { previewRevision, autoSaving, bumpPreviewRevision } = useAutoSync({
    quiz,
    buildPayload: buildSavePayload,
    applySavedState,
    paused: canvasEditing,
  })

  const showToast = (msg, type = 'success') => {
    setToast({ msg, type })
    setTimeout(() => setToast(null), 3000)
  }

  const handleImport = async (fn) => {
    setLoading(true)
    setError(null)
    setImportReport(null)
    try {
      const data = await fn()
      resetHistory(data)
      setSelectedId(firstSelectableId(data))
      const slideCount = (data.introSlide ? 1 : 0) + (data.resultSlides?.length || 0)
      if (data.importReport) {
        setImportReport({ report: data.importReport, summary: data.importSummary })
        const s = data.importSummary
        showToast(
          s
            ? `Excel: ${s.imported}/${s.total} câu import — tổng ${data.questionCount} câu trong quiz`
            : `Đã import ${data.questionCount} câu`,
        )
      } else {
        showToast(`Đã import ${data.questionCount} câu + ${slideCount} slide đặc biệt`)
      }
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
        return { ...prev, introSlide: applyDirtyFlags(prev.introSlide || updated, updated) }
      }
      if (updated.slideRole === 'result') {
        return {
          ...prev,
          resultSlides: (prev.resultSlides || []).map((r) =>
            r.id === updated.id ? applyDirtyFlags(r, updated) : r,
          ),
        }
      }
      return {
        ...prev,
        questions: prev.questions.map((q) =>
          q.id === updated.id ? applyDirtyFlags(q, updated) : q,
        ),
      }
    }, { burst: true })
  }, [setQuiz])

  const patchSlide = useCallback((patch) => {
    if (!selectedId) return
    setQuiz((prev) => {
      if (prev.introSlide?.id === selectedId) {
        return { ...prev, introSlide: applyDirtyFlags(prev.introSlide, patch) }
      }
      if (prev.resultSlides?.some((r) => r.id === selectedId)) {
        return {
          ...prev,
          resultSlides: prev.resultSlides.map((r) =>
            r.id === selectedId ? applyDirtyFlags(r, patch) : r,
          ),
        }
      }
      return {
        ...prev,
        questions: prev.questions.map((q) =>
          q.id === selectedId ? applyDirtyFlags(q, patch) : q,
        ),
      }
    }, { burst: true })
  }, [selectedId, setQuiz])

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
    showToast('Đã đánh dấu xoá')
  }

  const persistQuiz = async () => {
    if (!quiz) return null
    const saved = await saveSession(quiz.sessionId, buildSavePayload(quiz))
    applySavedState(saved)
    bumpPreviewRevision()
    return saved
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

  useEffect(() => {
    const onKeyDown = (e) => {
      if (!isEditableTarget(e.target) && (e.metaKey || e.ctrlKey)) {
        if (e.key === 'z' && !e.shiftKey) {
          e.preventDefault()
          if (canUndo) undo()
          return
        }
        if ((e.key === 'z' && e.shiftKey) || e.key === 'y') {
          e.preventDefault()
          if (canRedo) redo()
          return
        }
      }
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [canUndo, canRedo, undo, redo])

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
      setQuiz((prev) => ({ ...prev, _imgRev: Date.now() }), { recordHistory: false })
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
        <ImportPage
          onImport={handleImport}
          loading={loading}
          error={error}
          importReport={importReport}
        />
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
          saving={saving || autoSaving}
          previewRevision={previewRevision}
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
          <div className="history-actions">
            <button
              type="button"
              className="btn btn-icon"
              disabled={!canUndo}
              onClick={undo}
              title="Hoàn tác (Ctrl+Z)"
            >
              ↶ Undo
            </button>
            <button
              type="button"
              className="btn btn-icon"
              disabled={!canRedo}
              onClick={redo}
              title="Làm lại (Ctrl+Shift+Z)"
            >
              ↷ Redo
            </button>
          </div>
          {autoSaving && <span className="auto-sync-badge">Đang đồng bộ...</span>}
          <button className="btn" onClick={() => { resetHistory(null); setSelectedId(null); setWorkspaceMode('edit') }}>
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
        <aside className="sidebar" style={{ width: sidebarResize.width }}>
          <div className="sidebar-header">
            <h3>Danh sách slide</h3>
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

        <PanelResizeHandle
          side="right"
          label="Kéo để đổi chiều rộng danh sách câu hỏi"
          onPointerDown={(e) => sidebarResize.onPointerDown(e, 'expand-right')}
        />

        <EditorWorkspace
          slide={selectedSlide}
          quiz={quiz}
          selectedId={selectedId}
          sessionId={quiz.sessionId}
          fonts={quiz.fonts}
          saving={saving}
          autoSaving={autoSaving}
          previewRevision={previewRevision}
          questionCount={activeQuestions.length}
          setQuiz={setQuiz}
          onChange={updateSlide}
          onPatch={patchSlide}
          onDelete={deleteQuestion}
          onImageUpload={handleImageUpload}
          onSelectSlide={setSelectedId}
          onSave={persistQuiz}
          onCanvasEditStart={beginCanvasEdit}
          onCanvasEditStateChange={setCanvasEditing}
        />
      </div>

      {toast && <div className={`toast toast-${toast.type}`}>{toast.msg}</div>}
    </div>
  )
}