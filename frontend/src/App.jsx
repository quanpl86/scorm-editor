import { useCallback, useEffect, useRef, useState } from 'react'
import {
  assetUrl,
  exportCmsJson,
  exportSession,
  importCmsJson,
  importExcel,
  excelTemplateDownloadUrl,
  fetchExcelTemplates,
  importExcelFibWbSample,
  importExcelMediaSample,
  importExcelSample,
  importSample,
  importZip,
  publishTsvToLesson,
  importTsvZipToLesson,
  saveSession,
  loadSession,
  exportMedia,
  exportMediaLocal,
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
import TekyQuizEditor from './TekyQuizEditor'
import TekyQuizPreview from './TekyQuizPreview'
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
import { GuideButton, UserGuideModal } from './UserGuide'

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
      const htmlMatchesText = (
        dir.html?.trim()
        && extractPlainTextFromHtml(dir.html) === String(slide.questionText || '').trim()
      )
      const html = htmlMatchesText
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
      const htmlMatchesText = (
        content?.html?.trim()
        && extractPlainTextFromHtml(content.html) === String(slide.subtitleText || '').trim()
      )
      const html = htmlMatchesText
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
      const htmlMatchesText = (
        sourceHtml?.trim()
        && extractPlainTextFromHtml(sourceHtml) === String(ch.text || '').trim()
      )
      const html = htmlMatchesText
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
  // Teky answer editors are controlled collections. Send their full current
  // value so add/delete/reorder operations never depend on a fragile dirty flag.
  if (synced.choices !== undefined) payload.choices = synced.choices
  if (synced.matchingPairs !== undefined) payload.matchingPairs = synced.matchingPairs
  if (synced.blankAnswers !== undefined) payload.blankAnswers = synced.blankAnswers
  if (synced._dirtyFeedback) payload.feedback = synced.feedback
  if (synced.typeInAnswers !== undefined) payload.typeInAnswers = synced.typeInAnswers
  if (synced.wordBankWords !== undefined) payload.wordBankWords = synced.wordBankWords
  if (synced._dirtyRichHtml) payload.richHtml = synced.layout?.choicePreview?.richHtml
  if (synced.isNew) payload.isNew = true

  const force = !!synced.isNew;

  if (synced.slideRole === 'question') {
    payload.points = synced.points ?? 1
    payload.timeLimitEnabled = !!synced.timeLimitEnabled
    payload.timeLimit = synced.timeLimit ?? 0
    payload.shuffleAnswers = !!synced.shuffleAnswers

    if (synced.difficulty !== undefined) payload.difficulty = synced.difficulty
    if (synced.topic !== undefined) payload.topic = synced.topic
    if (synced.required !== undefined || force) payload.required = !!synced.required
    if (synced.useRegex !== undefined || force) payload.useRegex = !!synced.useRegex
    if (synced.explanation !== undefined || force) payload.explanation = synced.explanation || ''
    if (synced.video !== undefined || force) payload.video = synced.video || ''
    if (synced._dirtySlideImages || force) payload.slideImages = synced.slideImages || []
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
  if (fieldChanged(slide, patch, 'matchingPairs')) next._dirtyMatching = true
  if (fieldChanged(slide, patch, 'blankAnswers')) next._dirtyBlanks = true
  if (fieldChanged(slide, patch, 'feedback')) next._dirtyFeedback = true
  if (fieldChanged(slide, patch, 'typeInAnswers')) next._dirtyTypeIn = true
  if (fieldChanged(slide, patch, 'wordBankWords')) next._dirtyWordBank = true
  if (fieldChanged(slide, patch, 'slideImages')) next._dirtySlideImages = true
  if (
    fieldChanged(slide, patch, 'points')
    || fieldChanged(slide, patch, 'timeLimit')
    || fieldChanged(slide, patch, 'timeLimitEnabled')
    || fieldChanged(slide, patch, 'shuffleAnswers')
    || fieldChanged(slide, patch, 'difficulty')
    || fieldChanged(slide, patch, 'topic')
    || fieldChanged(slide, patch, 'required')
    || fieldChanged(slide, patch, 'useRegex')
    || fieldChanged(slide, patch, 'explanation')
    || fieldChanged(slide, patch, 'video')
  ) {
    next._dirtyQuestionOptions = true
  }
  return next
}

function buildSavePayload(quiz) {
  return {
    title: quiz.title,
    passingScore: quiz.passingScore,
    tekyQuiz: quiz.tekyQuiz || {},
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

const EXCEL_COLUMN_GUIDE = [
  { col: 'Question Type', desc: 'Loại câu: MC, MR, TF, TI, NUMG, FIB, WB, MG, SEQ, IS' },
  { col: 'Question Text', desc: 'Nội dung câu hỏi' },
  { col: 'Image / Video / Audio', desc: 'Đường dẫn file media (tương đối file Excel, ví dụ media\\ảnh.jpg)' },
  { col: 'Answer 1–10', desc: 'Đáp án; * = đúng; MG dùng premise|response; NUMG dùng =số hoặc số' },
  { col: 'Correct / Incorrect Feedback', desc: 'Nhận xét đúng/sai; hỗ trợ [image=], [audio=], [video=]' },
  { col: 'Points', desc: 'Điểm từng câu (tùy chọn)' },
]

function ImportReport({ report, summary, questions, onSelectSlide, onDismiss, compact }) {
  if (!report?.length) return null
  const statusLabel = {
    imported: 'Đã import',
    error: 'Lỗi',
    skipped: 'Bỏ qua',
  }
  const slideIndexById = Object.fromEntries(
    (questions || []).map((q) => [q.id, q.questionIndex + 1]),
  )

  const mediaWarnings = summary?.mediaWarnings?.length
    ? summary.mediaWarnings
    : report.flatMap((row) => (row.warnings || []).map((msg) => ({
        row: row.row,
        type: row.type,
        slideId: row.slideId,
        message: msg,
      })))

  return (
    <div className={`import-report ${compact ? 'import-report-compact' : ''}`}>
      <div className="import-report-header">
        {summary && (
          <div className="import-report-summary">
            <span className="import-report-summary-main">
              {summary.imported}/{summary.total} câu import thành công
            </span>
            {summary.quizTitle && (
              <span className="import-report-muted">Quiz: {summary.quizTitle}</span>
            )}
            {summary.groupTitle && (
              <span className="import-report-muted">Nhóm: {summary.groupTitle}</span>
            )}
            {summary.lessonCode && (
              <span className="import-report-muted">
                Bài học: {summary.lessonCode}
                {summary.excelPath ? ` → ${summary.excelPath}` : ''}
              </span>
            )}
            {summary.errors > 0 && <span className="import-report-warn">{summary.errors} lỗi</span>}
            {summary.skipped > 0 && <span className="import-report-muted">{summary.skipped} bỏ qua</span>}
            {mediaWarnings.length > 0 && (
              <span className="import-report-warn">{mediaWarnings.length} cảnh báo media</span>
            )}
          </div>
        )}
        {onDismiss && (
          <button type="button" className="btn btn-sm import-report-dismiss" onClick={onDismiss}>
            Đóng
          </button>
        )}
      </div>

      {mediaWarnings.length > 0 && (
        <details className="import-report-media-details" open={!compact}>
          <summary>Cảnh báo media ({mediaWarnings.length})</summary>
          <ul className="import-report-media-list">
            {mediaWarnings.map((w, idx) => (
              <li key={`${w.row}-${idx}`}>
                <span className="import-report-row">
                  {w.scope === 'quiz' ? 'Ảnh bìa quiz' : `Dòng ${w.row}`}
                </span>
                <span className="import-report-type">{w.type}</span>
                <span className="import-report-warn">{w.message}</span>
                {w.slideId && onSelectSlide && slideIndexById[w.slideId] && (
                  <button
                    type="button"
                    className="import-report-slide-link"
                    onClick={() => onSelectSlide(w.slideId)}
                  >
                    Mở slide #{slideIndexById[w.slideId]}
                  </button>
                )}
              </li>
            ))}
          </ul>
        </details>
      )}

      <ul className="import-report-list">
        {report.map((row) => (
          <li key={row.row} className={`import-report-item import-report-${row.status}`}>
            <span className="import-report-row">Dòng {row.row}</span>
            <span className="import-report-type">{row.type}</span>
            <span className="import-report-status">{statusLabel[row.status] || row.status}</span>
            {row.status === 'imported' && row.slideId && onSelectSlide && (
              <button
                type="button"
                className="import-report-slide-link"
                onClick={() => onSelectSlide(row.slideId)}
              >
                {slideIndexById[row.slideId]
                  ? `Mở slide #${slideIndexById[row.slideId]}`
                  : 'Mở slide'}
              </button>
            )}
            {row.question && <span className="import-report-question">{row.question}</span>}
            {row.errors?.length > 0 && (
              <span className="import-report-error">{row.errors.join('; ')}</span>
            )}
            {row.warnings?.length > 0 && !mediaWarnings.length && (
              <span className="import-report-warn">{row.warnings.join('; ')}</span>
            )}
          </li>
        ))}
      </ul>
    </div>
  )
}

const IMPORT_TABS = [
  { id: 'tsv', label: 'TSV → Excel', short: 'TSV', icon: '📋' },
  { id: 'excel', label: 'Tạo quiz từ Excel', short: 'Excel', icon: '📊' },
  { id: 'scorm', label: 'Chỉnh sửa SCORM Zip', short: 'SCORM', icon: '📦' },
  { id: 'json', label: 'Tải lại CMS JSON', short: 'JSON', icon: '📝' },
]

const QUIZ_SETTINGS_META = {
  title: 'Tên hiển thị của quiz',
  description: 'Mô tả quiz',
  coverImage: 'Ảnh đại diện cấp quiz (media/...)',
  subject: 'Related Subject — tên học phần',
  targetLesson: 'Target Lesson — tên bài học',
  difficultyLevel: 'easy | medium | hard',
  tags: 'Các tag phân cách bằng dấu phẩy',
  createdBy: 'Mã người tạo; không phải Quiz ID',
  createdByName: 'Tên người tạo',
  isPublic: 'Quiz có công khai hay không',
  duration: 'Thời lượng làm bài, đơn vị giây',
  shuffleQuestions: 'Trộn thứ tự câu hỏi',
  shuffleAnswers: 'Trộn thứ tự đáp án',
  attemptLimit: 'Số lần làm bài tối đa; 0 = không giới hạn',
  showResults: 'after_submit | immediately | never',
  allowReview: 'Cho phép xem lại sau khi nộp',
  createdAt: 'ISO-8601; để trống để hệ thống tự sinh',
  updatedAt: 'ISO-8601; để trống để hệ thống tự sinh',
}

const DEFAULT_SETTINGS_FORM = {
  title: '',
  description: '',
  coverImage: 'media/quiz_cover.jpg',
  subject: '', // Related Subject = tên học phần
  targetLesson: '', // Target Lesson = tên bài học
  difficultyLevel: 'medium',
  tags: '',
  createdBy: 'Teky Academy',
  createdByName: 'Teky Academy',
  isPublic: false,
  durationMinutes: 20,
  shuffleQuestions: true,
  shuffleAnswers: true,
  attemptLimit: 3,
  showResults: 'after_submit',
  allowReview: true,
}

function escapeTsvCell(value) {
  const s = value == null ? '' : String(value)
  if (/[\t\n\r]/.test(s)) {
    return s.replace(/\t/g, ' ').replace(/\r?\n/g, ' ')
  }
  return s
}

/** Build quiz_settings.tsv from manual form state. */
function buildSettingsTsvFromForm(form) {
  const minutes = Number(form.durationMinutes)
  const durationSec = Number.isFinite(minutes) && minutes > 0
    ? Math.round(minutes * 60)
    : 1200
  const attempt = Number(form.attemptLimit)
  const attemptLimit = Number.isFinite(attempt) && attempt >= 0 ? Math.floor(attempt) : 3

  const rows = [
    ['title', form.title?.trim() || 'Untitled Quiz'],
    ['description', form.description?.trim() || ''],
    ['coverImage', form.coverImage?.trim() || 'media/quiz_cover.jpg'],
    ['subject', form.subject?.trim() || ''],
    ['targetLesson', form.targetLesson?.trim() || ''],
    ['difficultyLevel', form.difficultyLevel || 'medium'],
    ['tags', form.tags?.trim() || ''],
    ['createdBy', form.createdBy?.trim() || 'Teky Academy'],
    ['createdByName', form.createdByName?.trim() || 'Teky Academy'],
    ['isPublic', form.isPublic ? 'True' : 'False'],
    ['duration', String(durationSec)],
    ['shuffleQuestions', form.shuffleQuestions ? 'True' : 'False'],
    ['shuffleAnswers', form.shuffleAnswers ? 'True' : 'False'],
    ['attemptLimit', String(attemptLimit)],
    ['showResults', form.showResults || 'after_submit'],
    ['allowReview', form.allowReview ? 'True' : 'False'],
    ['createdAt', ''],
    ['updatedAt', ''],
  ]

  const lines = ['Field\tValue\tDescription']
  for (const [field, value] of rows) {
    lines.push(
      `${field}\t${escapeTsvCell(value)}\t${escapeTsvCell(QUIZ_SETTINGS_META[field] || '')}`,
    )
  }
  return lines.join('\n')
}

function ImportPage({ onImport, loading, loadingMessage, error, errorKind, importReport }) {
  const scormInputRef = useRef(null)
  const excelInputRef = useRef(null)
  const tsvZipInputRef = useRef(null)
  const [importTab, setImportTab] = useState('tsv')
  const [scormDrag, setScormDrag] = useState(false)
  const [excelDrag, setExcelDrag] = useState(false)
  const [tsvZipDrag, setTsvZipDrag] = useState(false)
  const [quizTitle, setQuizTitle] = useState('')
  const [groupTitle, setGroupTitle] = useState('Imported Questions')
  const [templates, setTemplates] = useState([])
  const [templatesError, setTemplatesError] = useState(null)
  const [lessonCode, setLessonCode] = useState('')
  const [settingsTsv, setSettingsTsv] = useState('')
  const [questionsTsv, setQuestionsTsv] = useState('')
  const [combinedTsv, setCombinedTsv] = useState('')
  /** paste = dán TSV settings; form = nhập tay */
  const [settingsInputMode, setSettingsInputMode] = useState('form')
  const [settingsForm, setSettingsForm] = useState(() => ({ ...DEFAULT_SETTINGS_FORM }))
  const [tsvSourceMode, setTsvSourceMode] = useState('separate') // 'separate' | 'combined' | 'zip'
  const [tsvZipFile, setTsvZipFile] = useState(null)
  const [overwriteLesson, setOverwriteLesson] = useState(true)
  const [seedMedia, setSeedMedia] = useState(false)
  const [tsvLocalError, setTsvLocalError] = useState(null)

  const excelOpts = {
    quizTitle: quizTitle.trim() || undefined,
    groupTitle: groupTitle.trim() || undefined,
  }

  const patchSettingsForm = (key, value) => {
    setSettingsForm((prev) => ({ ...prev, [key]: value }))
  }

  useEffect(() => {
    fetchExcelTemplates()
      .then((data) => setTemplates(data.templates || []))
      .catch((err) => setTemplatesError(err.message))
  }, [])

  // Jump to tab matching active import error/report kind
  useEffect(() => {
    const kind = loadingMessage?.kind
    if (kind === 'tsv' || kind === 'excel' || kind === 'scorm') {
      setImportTab(kind)
    }
  }, [loadingMessage?.kind])

  const handleScormFile = async (file) => {
    if (!file?.name?.toLowerCase().endsWith('.zip')) return
    await onImport(() => importZip(file), { kind: 'scorm' })
  }

  const handleCmsJsonFile = async (file) => {
    if (!file?.name?.toLowerCase().endsWith('.json')) return
    await onImport(() => importCmsJson(file), { kind: 'scorm' })
  }

  const handleExcelFile = async (file) => {
    const name = file?.name?.toLowerCase() || ''
    if (!name.endsWith('.xls') && !name.endsWith('.xlsx') && !name.endsWith('.zip')) return
    await onImport(() => importExcel(file, excelOpts), { kind: 'excel' })
  }

  const runExcelSample = (fn) => onImport(fn, { kind: 'excel' })

  const handleTsvPublish = async () => {
    setTsvLocalError(null)
    const code = lessonCode.trim()
    if (!code) {
      setTsvLocalError('Nhập tên Bài học (ví dụ SNLT-HP01-B02).')
      return
    }

    if (tsvSourceMode === 'zip') {
      if (!tsvZipFile) {
        setTsvLocalError('Vui lòng chọn file TSV ZIP.')
        return
      }
      await onImport(
        () => importTsvZipToLesson(tsvZipFile, {
          lessonCode: code,
          overwrite: overwriteLesson,
          seedMediaFromTemplate: seedMedia,
          openInEditor: true,
          quizTitle: quizTitle.trim() || undefined,
          groupTitle: groupTitle.trim() || 'Imported Questions',
        }),
        { kind: 'tsv' },
      )
      return
    }

    if (tsvSourceMode === 'combined') {
      if (!combinedTsv.trim()) {
        setTsvLocalError('Dán combined TSV (có marker ### quiz_settings.tsv / ### quiz_questions.tsv).')
        return
      }
      await onImport(
        () => publishTsvToLesson({
          lessonCode: code,
          settingsTsv: '',
          questionsTsv: '',
          combinedTsv,
          overwrite: overwriteLesson,
          seedMediaFromTemplate: seedMedia,
          openInEditor: true,
          quizTitle: quizTitle.trim() || undefined,
          groupTitle: groupTitle.trim() || 'Imported Questions',
        }),
        { kind: 'tsv' },
      )
      return
    }

    if (!questionsTsv.trim()) {
      setTsvLocalError('Dán quiz_questions.tsv (nội dung câu hỏi).')
      return
    }

    let resolvedSettingsTsv = settingsTsv
    let formForBuild = settingsForm
    if (settingsInputMode === 'form') {
      if (!settingsForm.title?.trim()) {
        setTsvLocalError('Nhập tay: cần điền Tên quiz (title).')
        return
      }
      // Target Lesson mặc định = tên Bài học (mã thư mục) nếu chưa nhập
      formForBuild = {
        ...settingsForm,
        targetLesson: settingsForm.targetLesson?.trim() || code,
      }
      resolvedSettingsTsv = buildSettingsTsvFromForm(formForBuild)
    } else if (!settingsTsv.trim()) {
      setTsvLocalError('Dán quiz_settings.tsv hoặc chuyển sang «Nhập tay».')
      return
    }

    // Optional form override of title when pasting settings TSV
    const titleOverride =
      settingsInputMode === 'form'
        ? formForBuild.title.trim()
        : (quizTitle.trim() || undefined)

    const resolvedGroupTitle =
      (settingsInputMode === 'form' && formForBuild.targetLesson?.trim())
        || groupTitle.trim()
        || code
        || 'Imported Questions'

    await onImport(
      () => publishTsvToLesson({
        lessonCode: code,
        settingsTsv: resolvedSettingsTsv,
        questionsTsv,
        combinedTsv: null,
        overwrite: overwriteLesson,
        seedMediaFromTemplate: seedMedia,
        openInEditor: true,
        quizTitle: titleOverride || undefined,
        groupTitle: resolvedGroupTitle,
      }),
      { kind: 'tsv' },
    )
  }

  const tabError =
    importTab === 'tsv'
      ? (tsvLocalError || (errorKind === 'tsv' || loadingMessage?.kind === 'tsv' ? error : null))
      : (errorKind === importTab || loadingMessage?.kind === importTab ? error : null)

  return (
    <div className="import-page">
      <div className="import-card">
        <div className="import-card-header">
          <div>
            <h2>Bắt đầu làm việc</h2>
            <p>Chọn một tab để import nội dung: TSV (Teky LMS), Excel, hoặc gói SCORM Zip.</p>
          </div>
        </div>

        <div className="import-tabs" role="tablist" aria-label="Phương thức import">
          {IMPORT_TABS.map((tab) => (
            <button
              key={tab.id}
              type="button"
              role="tab"
              id={`import-tab-${tab.id}`}
              aria-selected={importTab === tab.id}
              aria-controls={`import-panel-${tab.id}`}
              className={`import-tab ${importTab === tab.id ? 'is-active' : ''}`}
              disabled={loading}
              onClick={() => {
                setImportTab(tab.id)
                setTsvLocalError(null)
                // không xóa error server — vẫn hiện nếu cùng kind
              }}
            >
              <span className="import-tab-icon" aria-hidden="true">{tab.icon}</span>
              <span className="import-tab-label">{tab.label}</span>
              <span className="import-tab-label-short">{tab.short}</span>
            </button>
          ))}
        </div>

        {(tabError || (error && importTab === loadingMessage?.kind)) && (
          <div className="error-banner" role="alert">
            <strong>Import thất bại.</strong> {tabError || error}
          </div>
        )}
        {importReport && (
          <ImportReport report={importReport.report} summary={importReport.summary} />
        )}

        {/* —— Tab: TSV → Excel —— */}
        {importTab === 'tsv' && (
          <section
            className="import-tab-panel"
            role="tabpanel"
            id="import-panel-tsv"
            aria-labelledby="import-tab-tsv"
          >
            <p className="import-section-hint import-section-hint-left">
              Cấu hình quiz + dán câu hỏi TSV (schema v2). Hệ thống tạo{' '}
              <code>ImportTemplate/&#123;TênBài&#125;/&#123;TênBài&#125;.xlsx</code> từ template{' '}
              <code>SNLT-HP01-B01</code>, tạo <code>media/</code>, rồi mở Editor.
            </p>

            <div className="import-form-fields">
              <label className="import-field">
                <span>Tên Bài học <em className="field-req">*</em></span>
                <input
                  type="text"
                  value={lessonCode}
                  onChange={(e) => setLessonCode(e.target.value)}
                  placeholder="Ví dụ: SNLT-HP01-B02"
                  disabled={loading}
                  autoComplete="off"
                />
              </label>
              <label className="import-field">
                <span>Tên nhóm câu hỏi</span>
                <input
                  type="text"
                  value={groupTitle}
                  onChange={(e) => setGroupTitle(e.target.value)}
                  placeholder="Imported Questions"
                  disabled={loading}
                />
              </label>
            </div>

            <div className="tsv-mode-toggle tsv-mode-block">
              <span className="tsv-mode-label">Nguồn dữ liệu</span>
              <label>
                <input
                  type="radio"
                  name="tsvMode"
                  checked={tsvSourceMode === 'separate'}
                  onChange={() => setTsvSourceMode('separate')}
                  disabled={loading}
                />
                Settings + Questions riêng
              </label>
              <label>
                <input
                  type="radio"
                  name="tsvMode"
                  checked={tsvSourceMode === 'combined'}
                  onChange={() => setTsvSourceMode('combined')}
                  disabled={loading}
                />
                Combined TSV (có marker)
              </label>
              <label>
                <input
                  type="radio"
                  name="tsvMode"
                  checked={tsvSourceMode === 'zip'}
                  onChange={() => setTsvSourceMode('zip')}
                  disabled={loading}
                />
                Upload File ZIP
              </label>
            </div>

            {tsvSourceMode === 'zip' ? (
              <div className="import-field import-field-wide">
                <span>File ZIP chứa quiz_settings.tsv & quiz_questions.tsv <em className="field-req">*</em></span>
                <div
                  className={`dropzone ${tsvZipDrag ? 'dragover' : ''} ${loading ? 'is-loading' : ''}`}
                  onClick={() => !loading && tsvZipInputRef.current?.click()}
                  onDragOver={(e) => { e.preventDefault(); if (!loading) setTsvZipDrag(true) }}
                  onDragLeave={() => setTsvZipDrag(false)}
                  onDrop={(e) => {
                    e.preventDefault()
                    setTsvZipDrag(false)
                    if (!loading && e.dataTransfer.files[0]) {
                      setTsvZipFile(e.dataTransfer.files[0])
                    }
                  }}
                  style={{ marginTop: '8px' }}
                >
                  <div className="dropzone-icon">📁</div>
                  <div className="dropzone-text">
                    {tsvZipFile ? tsvZipFile.name : 'Kéo thả file .zip hoặc bấm để chọn'}
                  </div>
                  <input
                    ref={tsvZipInputRef}
                    type="file"
                    accept=".zip"
                    hidden
                    disabled={loading}
                    onChange={(e) => {
                      if (e.target.files[0]) {
                        setTsvZipFile(e.target.files[0])
                      }
                    }}
                  />
                </div>
              </div>
            ) : tsvSourceMode === 'combined' ? (
              <label className="import-field import-field-wide">
                <span>Combined TSV</span>
                <textarea
                  className="tsv-paste-area tsv-paste-area-lg"
                  value={combinedTsv}
                  onChange={(e) => setCombinedTsv(e.target.value)}
                  placeholder={'### quiz_settings.tsv\nField\tValue\t...\n### quiz_questions.tsv\nQuestion Type\t...'}
                  disabled={loading}
                  spellCheck={false}
                />
              </label>
            ) : (
              <>
                {/* —— Quiz Settings —— */}
                <div className="settings-block">
                  <div className="settings-block-header">
                    <h4 className="settings-block-title">Quiz Settings</h4>
                    <div className="tsv-mode-toggle">
                      <label>
                        <input
                          type="radio"
                          name="settingsInputMode"
                          checked={settingsInputMode === 'form'}
                          onChange={() => setSettingsInputMode('form')}
                          disabled={loading}
                        />
                        Nhập tay
                      </label>
                      <label>
                        <input
                          type="radio"
                          name="settingsInputMode"
                          checked={settingsInputMode === 'paste'}
                          onChange={() => setSettingsInputMode('paste')}
                          disabled={loading}
                        />
                        Dán TSV
                      </label>
                    </div>
                  </div>

                  {settingsInputMode === 'form' ? (
                    <div className="settings-form">
                      <div className="import-form-fields">
                        <label className="import-field import-field-wide">
                          <span>Tên quiz (title) <em className="field-req">*</em></span>
                          <input
                            type="text"
                            value={settingsForm.title}
                            onChange={(e) => patchSettingsForm('title', e.target.value)}
                            placeholder="Ví dụ: [HP01] B02 — Ôn tập mạng máy tính"
                            disabled={loading}
                          />
                        </label>
                        <label className="import-field import-field-wide">
                          <span>Mô tả (description)</span>
                          <textarea
                            className="settings-textarea"
                            value={settingsForm.description}
                            onChange={(e) => patchSettingsForm('description', e.target.value)}
                            placeholder="Mô tả ngắn nội dung / mục tiêu quiz"
                            disabled={loading}
                            rows={2}
                          />
                        </label>
                        <label className="import-field">
                          <span>Ảnh bìa (coverImage)</span>
                          <input
                            type="text"
                            value={settingsForm.coverImage}
                            onChange={(e) => patchSettingsForm('coverImage', e.target.value)}
                            placeholder="media/quiz_cover.jpg"
                            disabled={loading}
                          />
                        </label>
                        <label className="import-field">
                          <span>Tên học phần (Related Subject)</span>
                          <input
                            type="text"
                            value={settingsForm.subject}
                            onChange={(e) => patchSettingsForm('subject', e.target.value)}
                            placeholder="Ví dụ: SNLT-HP01 · Khoa học máy tính"
                            disabled={loading}
                          />
                          <span className="field-hint">JSON: subject — Context RELATED SUBJECT</span>
                        </label>
                        <label className="import-field">
                          <span>Tên bài học (Target Lesson)</span>
                          <input
                            type="text"
                            value={settingsForm.targetLesson}
                            onChange={(e) => patchSettingsForm('targetLesson', e.target.value)}
                            placeholder={lessonCode.trim() || 'Mặc định = Tên Bài học / mã thư mục'}
                            disabled={loading}
                          />
                          <span className="field-hint">JSON: targetLesson — Context TARGET LESSON</span>
                        </label>
                        <label className="import-field">
                          <span>Độ khó quiz</span>
                          <select
                            value={settingsForm.difficultyLevel}
                            onChange={(e) => patchSettingsForm('difficultyLevel', e.target.value)}
                            disabled={loading}
                          >
                            <option value="easy">easy</option>
                            <option value="medium">medium</option>
                            <option value="hard">hard</option>
                          </select>
                        </label>
                        <label className="import-field">
                          <span>Tags (phân cách phẩy)</span>
                          <input
                            type="text"
                            value={settingsForm.tags}
                            onChange={(e) => patchSettingsForm('tags', e.target.value)}
                            placeholder="SNLT, HP01, B02, on-tap"
                            disabled={loading}
                          />
                        </label>
                        <label className="import-field">
                          <span>Thời lượng (phút)</span>
                          <input
                            type="number"
                            min={1}
                            step={1}
                            value={settingsForm.durationMinutes}
                            onChange={(e) => patchSettingsForm('durationMinutes', e.target.value)}
                            disabled={loading}
                          />
                          <span className="field-hint">
                            = {Math.max(1, Math.round(Number(settingsForm.durationMinutes) || 0) * 60) || 0} giây trong Excel
                          </span>
                        </label>
                        <label className="import-field">
                          <span>Số lần làm (attemptLimit)</span>
                          <input
                            type="number"
                            min={0}
                            step={1}
                            value={settingsForm.attemptLimit}
                            onChange={(e) => patchSettingsForm('attemptLimit', e.target.value)}
                            disabled={loading}
                          />
                          <span className="field-hint">0 = không giới hạn</span>
                        </label>
                        <label className="import-field">
                          <span>Hiện kết quả (showResults)</span>
                          <select
                            value={settingsForm.showResults}
                            onChange={(e) => patchSettingsForm('showResults', e.target.value)}
                            disabled={loading}
                          >
                            <option value="after_submit">after_submit</option>
                            <option value="immediately">immediately</option>
                            <option value="never">never</option>
                          </select>
                        </label>
                        <label className="import-field">
                          <span>Người tạo (createdBy)</span>
                          <input
                            type="text"
                            value={settingsForm.createdBy}
                            onChange={(e) => patchSettingsForm('createdBy', e.target.value)}
                            placeholder="Teky Academy"
                            disabled={loading}
                          />
                        </label>
                        <label className="import-field">
                          <span>Tên người tạo</span>
                          <input
                            type="text"
                            value={settingsForm.createdByName}
                            onChange={(e) => patchSettingsForm('createdByName', e.target.value)}
                            placeholder="Teky Academy"
                            disabled={loading}
                          />
                        </label>
                      </div>

                      <div className="settings-checks">
                        <label className="tsv-check">
                          <input
                            type="checkbox"
                            checked={settingsForm.shuffleQuestions}
                            onChange={(e) => patchSettingsForm('shuffleQuestions', e.target.checked)}
                            disabled={loading}
                          />
                          Trộn thứ tự câu hỏi
                        </label>
                        <label className="tsv-check">
                          <input
                            type="checkbox"
                            checked={settingsForm.shuffleAnswers}
                            onChange={(e) => patchSettingsForm('shuffleAnswers', e.target.checked)}
                            disabled={loading}
                          />
                          Trộn thứ tự đáp án
                        </label>
                        <label className="tsv-check">
                          <input
                            type="checkbox"
                            checked={settingsForm.allowReview}
                            onChange={(e) => patchSettingsForm('allowReview', e.target.checked)}
                            disabled={loading}
                          />
                          Cho xem lại sau khi nộp
                        </label>
                        <label className="tsv-check">
                          <input
                            type="checkbox"
                            checked={settingsForm.isPublic}
                            onChange={(e) => patchSettingsForm('isPublic', e.target.checked)}
                            disabled={loading}
                          />
                          Quiz công khai (isPublic)
                        </label>
                      </div>
                      <p className="field-hint settings-form-note">
                        createdAt / updatedAt để trống — hệ thống tự sinh khi export.
                      </p>
                    </div>
                  ) : (
                    <label className="import-field import-field-wide">
                      <span>quiz_settings.tsv</span>
                      <textarea
                        className="tsv-paste-area"
                        value={settingsTsv}
                        onChange={(e) => setSettingsTsv(e.target.value)}
                        placeholder={'Field\tValue\tDescription\ntitle\t...\t...'}
                        disabled={loading}
                        spellCheck={false}
                      />
                      <span className="field-hint">
                        Tùy chọn: ghi đè title khi import bằng ô bên dưới
                      </span>
                      <input
                        type="text"
                        className="settings-title-override"
                        value={quizTitle}
                        onChange={(e) => setQuizTitle(e.target.value)}
                        placeholder="Ghi đè title (tùy chọn)"
                        disabled={loading}
                      />
                    </label>
                  )}
                </div>

                {/* —— Questions TSV —— */}
                <label className="import-field import-field-wide">
                  <span>quiz_questions.tsv <em className="field-req">*</em></span>
                  <textarea
                    className="tsv-paste-area tsv-paste-area-lg"
                    value={questionsTsv}
                    onChange={(e) => setQuestionsTsv(e.target.value)}
                    placeholder={'Question Type\tQuestion Text\tAnswer 1\t...'}
                    disabled={loading}
                    spellCheck={false}
                  />
                </label>
              </>
            )}

            <div className="tsv-options">
              <label className="tsv-check">
                <input
                  type="checkbox"
                  checked={overwriteLesson}
                  onChange={(e) => setOverwriteLesson(e.target.checked)}
                  disabled={loading}
                />
                Ghi đè nếu thư mục bài học đã tồn tại (nên bật khi import lại cùng mã)
              </label>
              <label className="tsv-check">
                <input
                  type="checkbox"
                  checked={seedMedia}
                  onChange={(e) => setSeedMedia(e.target.checked)}
                  disabled={loading}
                />
                Copy ảnh mẫu từ SNLT-HP01-B01/media
              </label>
            </div>

            <div className="import-actions">
              <button
                type="button"
                className="btn btn-primary"
                disabled={loading}
                onClick={handleTsvPublish}
              >
                {loading && loadingMessage?.kind === 'tsv'
                  ? 'Đang xuất bản…'
                  : 'Import → Excel & mở Editor'}
              </button>
            </div>
            {loading && loadingMessage?.kind === 'tsv' && (
              <div className="tsv-loading-hint">
                <div className="spinner" />
                <span>{loadingMessage.text}</span>
              </div>
            )}
          </section>
        )}

        {/* —— Tab: Excel —— */}
        {importTab === 'excel' && (
          <section
            className="import-tab-panel"
            role="tabpanel"
            id="import-panel-excel"
            aria-labelledby="import-tab-excel"
          >
            <p className="import-section-hint import-section-hint-left">
              Upload .xls / .xlsx hoặc .zip (Excel + media). Hỗ trợ MC, MR, TF, Short Answer,
              Numeric, FIB, Word Bank, Matching, Sequence, Info Slide.
            </p>

            <div className="import-form-fields">
              <label className="import-field">
                <span>Tên quiz (tùy chọn)</span>
                <input
                  type="text"
                  value={quizTitle}
                  onChange={(e) => setQuizTitle(e.target.value)}
                  placeholder="Ví dụ: Kiểm tra Toán lớp 5"
                  disabled={loading}
                />
              </label>
              <label className="import-field">
                <span>Tên nhóm câu hỏi</span>
                <input
                  type="text"
                  value={groupTitle}
                  onChange={(e) => setGroupTitle(e.target.value)}
                  placeholder="Imported Questions"
                  disabled={loading}
                />
              </label>
            </div>

            <details className="import-column-guide">
              <summary>Hướng dẫn cột Excel</summary>
              <div className="import-column-guide-scroll">
                <table>
                  <thead>
                    <tr>
                      <th>Cột</th>
                      <th>Mô tả</th>
                    </tr>
                  </thead>
                  <tbody>
                    {EXCEL_COLUMN_GUIDE.map((row) => (
                      <tr key={row.col}>
                        <td>{row.col}</td>
                        <td>{row.desc}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </details>

            <div className="import-template-downloads">
              <span className="import-template-label">Tải file mẫu:</span>
              {templatesError && <span className="import-report-warn">{templatesError}</span>}
              <div className="import-template-links">
                {templates.map((tpl) => (
                  <a
                    key={tpl.id}
                    className="import-template-link"
                    href={excelTemplateDownloadUrl(tpl.id)}
                    download={tpl.filename}
                  >
                    {tpl.filename}
                  </a>
                ))}
              </div>
            </div>

            <div
              className={`dropzone dropzone-excel ${excelDrag ? 'dragover' : ''} ${loading ? 'is-loading' : ''}`}
              onClick={() => !loading && excelInputRef.current?.click()}
              onDragOver={(e) => { e.preventDefault(); if (!loading) setExcelDrag(true) }}
              onDragLeave={() => setExcelDrag(false)}
              onDrop={(e) => {
                e.preventDefault()
                setExcelDrag(false)
                if (!loading) handleExcelFile(e.dataTransfer.files[0])
              }}
            >
              {loading && loadingMessage?.kind === 'excel' && (
                <div className="dropzone-loading">
                  <div className="spinner" />
                  <span>{loadingMessage.text}</span>
                </div>
              )}
              <div className="dropzone-icon">📊</div>
              <div className="dropzone-text">
                {loading ? 'Đang import Excel...' : 'Kéo thả .xls / .xlsx / .zip hoặc bấm để chọn'}
              </div>
              <div className="dropzone-hint">Ảnh: đường dẫn tương đối media/ten_file.jpg</div>
              <input
                ref={excelInputRef}
                type="file"
                accept=".xls,.xlsx,.zip"
                hidden
                disabled={loading}
                onChange={(e) => handleExcelFile(e.target.files[0])}
              />
            </div>
            <div className="sample-buttons">
              <button
                type="button"
                className="btn btn-primary"
                disabled={loading}
                onClick={() => runExcelSample(() => importExcelSample(excelOpts))}
              >
                Import mẫu Excel
              </button>
              <button
                type="button"
                className="btn"
                disabled={loading}
                onClick={() => runExcelSample(() => importExcelMediaSample(excelOpts))}
              >
                Import mẫu Audio/Video
              </button>
              <button
                type="button"
                className="btn"
                disabled={loading}
                onClick={() => runExcelSample(() => importExcelFibWbSample(excelOpts))}
              >
                Import mẫu FIB / WB / Numeric
              </button>
            </div>
          </section>
        )}

        {/* —— Tab: SCORM Zip —— */}
        {importTab === 'scorm' && (
          <section
            className="import-tab-panel"
            role="tabpanel"
            id="import-panel-scorm"
            aria-labelledby="import-tab-scorm"
          >
            <p className="import-section-hint import-section-hint-left">
              Mở gói SCORM 1.2 từ iSpring Quiz Maker để chỉnh sửa nội dung, layout và export lại.
            </p>

            <div
              className={`dropzone ${scormDrag ? 'dragover' : ''} ${loading ? 'is-loading' : ''}`}
              onClick={() => !loading && scormInputRef.current?.click()}
              onDragOver={(e) => { e.preventDefault(); if (!loading) setScormDrag(true) }}
              onDragLeave={() => setScormDrag(false)}
              onDrop={(e) => {
                e.preventDefault()
                setScormDrag(false)
                if (!loading) handleScormFile(e.dataTransfer.files[0])
              }}
            >
              {loading && loadingMessage?.kind === 'scorm' && (
                <div className="dropzone-loading">
                  <div className="spinner" />
                  <span>{loadingMessage.text}</span>
                </div>
              )}
              <div className="dropzone-icon">📦</div>
              <div className="dropzone-text">
                {loading ? 'Đang mở SCORM...' : 'Kéo thả file .zip hoặc bấm để chọn'}
              </div>
              <div className="dropzone-hint">SCORM 1.2 · hỗ trợ zip lồng zip</div>
              <input
                ref={scormInputRef}
                type="file"
                accept=".zip"
                hidden
                disabled={loading}
                onChange={(e) => handleScormFile(e.target.files[0])}
              />
            </div>
            <div className="sample-buttons">
              <button
                type="button"
                className="btn"
                disabled={loading}
                onClick={() => onImport(() => importSample('zip'), { kind: 'scorm' })}
              >
                Load mẫu ZIP
              </button>
              <button
                type="button"
                className="btn"
                disabled={loading}
                onClick={() => onImport(() => importSample('dir'), { kind: 'scorm' })}
              >
                Load mẫu thư mục
              </button>
            </div>
          </section>
        )}

        {/* —— Tab: CMS JSON —— */}
        {importTab === 'json' && (
          <section
            className="import-tab-panel"
            role="tabpanel"
            id="import-panel-json"
            aria-labelledby="import-tab-json"
          >
            <p className="import-section-hint import-section-hint-left">
              Import lại file CMS JSON đã xuất bản (hỗ trợ khôi phục tiến trình làm việc dang dở).
            </p>

            <div
              className={`dropzone ${scormDrag ? 'dragover' : ''} ${loading ? 'is-loading' : ''}`}
              onClick={() => !loading && scormInputRef.current?.click()}
              onDragOver={(e) => { e.preventDefault(); if (!loading) setScormDrag(true) }}
              onDragLeave={() => setScormDrag(false)}
              onDrop={(e) => {
                e.preventDefault()
                setScormDrag(false)
                if (!loading) handleCmsJsonFile(e.dataTransfer.files[0])
              }}
            >
              {loading && loadingMessage?.kind === 'scorm' && (
                <div className="dropzone-loading">
                  <div className="spinner" />
                  <span>{loadingMessage.text}</span>
                </div>
              )}
              <div className="dropzone-icon">📝</div>
              <div className="dropzone-text">
                {loading ? 'Đang đọc JSON...' : 'Kéo thả file .json hoặc bấm để chọn'}
              </div>
              <div className="dropzone-hint">Chỉ hỗ trợ file JSON xuất từ Teky Editor</div>
              <input
                ref={scormInputRef}
                type="file"
                accept=".json"
                hidden
                disabled={loading}
                onChange={(e) => handleCmsJsonFile(e.target.files[0])}
              />
            </div>
          </section>
        )}
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
              {ch.audio && (
                <div className="field">
                  <label>Audio đáp án</label>
                  <audio controls src={assetUrl(sessionId, ch.audio)} style={{ width: '100%', maxWidth: 320 }} />
                  <span className="image-name">{ch.audio}</span>
                </div>
              )}
              {ch.video && (
                <div className="field">
                  <label>Video đáp án</label>
                  <video controls src={assetUrl(sessionId, ch.video)} style={{ width: '100%', maxWidth: 320 }} />
                  <span className="image-name">{ch.video}</span>
                </div>
              )}
            </div>
          ))}
        </div>
      )}

      {question.type === 'TypeIn' && (
        <div className="editor-section">
          <h4>Đáp án đúng chấp nhận (Trả lời ngắn)</h4>
          <div className="field">
            <input
              type="text"
              value={question.typeInAnswers?.[0] || ''}
              onChange={(e) => update({ typeInAnswers: [e.target.value] })}
              placeholder="Chỉ nhập một đáp án đúng"
            />
          </div>
        </div>
      )}

      {question.type === 'Numeric' && (
        <div className="editor-section">
          <h4>Đáp án số (Numeric)</h4>
          {(question.typeInAnswers || []).map((ans, idx) => (
            <div key={idx} className="field">
              <input
                type="text"
                value={ans}
                onChange={(e) => {
                  const typeInAnswers = [...(question.typeInAnswers || [])]
                  typeInAnswers[idx] = e.target.value
                  update({ typeInAnswers })
                }}
              />
            </div>
          ))}
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

      {question.type === 'FillInTheBlank' && (
        <div className="editor-section">
          <h4>Đáp án đúng chấp nhận (Điền vào chỗ trống)</h4>
          <p style={{ fontSize: '0.85rem', color: '#666' }}>
            Dùng ký tự <strong>___</strong> trong nội dung câu hỏi để đánh dấu chỗ trống.
          </p>
          <div className="field">
            <input
              type="text"
              value={question.blankAnswers?.[0]?.values?.[0] || ''}
              onChange={(e) => update({
                blankAnswers: [{
                  id: question.blankAnswers?.[0]?.id || 'qmFillInTheBlank0',
                  values: [e.target.value],
                }],
              })}
              placeholder="Chỉ nhập một đáp án đúng"
            />
          </div>
        </div>
      )}

      {question.type === 'WordBank' && (
        <div className="editor-section">
          <h4>Đáp án đúng (Word Bank)</h4>
          {(question.blankAnswers || []).length === 0 && (
             <div style={{ fontSize: '0.85rem', color: '#666' }}>Không có ô đáp án nào được tìm thấy. Vui lòng import lại gói SCORM.</div>
          )}
          {(question.blankAnswers || []).map((ans, idx) => (
            <div key={ans.id || idx} className="field">
              <label>Ô {idx + 1} ({ans.id})</label>
              <input
                type="text"
                value={(ans.values || []).join('; ')}
                onChange={(e) => {
                  const blankAnswers = [...(question.blankAnswers || [])]
                  blankAnswers[idx] = {
                    ...ans,
                    values: e.target.value.split(';').map(s => s.trim()).filter(Boolean)
                  }
                  update({ blankAnswers })
                }}
              />
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
            {question.feedback?.[`${key}Audio`] && (
              <div className="field">
                <label>Audio feedback</label>
                <audio
                  controls
                  src={assetUrl(sessionId, question.feedback[`${key}Audio`])}
                  style={{ width: '100%', maxWidth: 320 }}
                />
                <span className="image-name">{question.feedback[`${key}Audio`]}</span>
              </div>
            )}
            {question.feedback?.[`${key}Image`] && (
              <div className="field">
                <label>Ảnh feedback</label>
                <div className="image-card" style={{ maxWidth: 200 }}>
                  <img src={assetUrl(sessionId, question.feedback[`${key}Image`])} alt="" />
                  <span className="image-name">{question.feedback[`${key}Image`]}</span>
                </div>
              </div>
            )}
            {question.feedback?.[`${key}Video`] && (
              <div className="field">
                <label>Video feedback</label>
                <video
                  controls
                  src={assetUrl(sessionId, question.feedback[`${key}Video`])}
                  style={{ width: '100%', maxWidth: 320 }}
                />
                <span className="image-name">{question.feedback[`${key}Video`]}</span>
              </div>
            )}
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
          quizTitle={quiz.title}
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
  const [quizMode, setQuizMode] = useState('teky') // 'teky' or 'ispring'
  const [workspaceMode, setWorkspaceMode] = useState('edit')
  const [loading, setLoading] = useState(false)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState(null)
  /** Giữ kind lỗi sau khi loading xong để banner Import vẫn hiện message server */
  const [errorKind, setErrorKind] = useState(null)
  const [importReport, setImportReport] = useState(null)
  const [loadingMessage, setLoadingMessage] = useState(null)
  const [toast, setToast] = useState(null)
  const [canvasEditing, setCanvasEditing] = useState(false)
  const [guideOpen, setGuideOpen] = useState(false)
  const [headerMenuOpen, setHeaderMenuOpen] = useState(false)
  const sidebarResize = useResizableWidth('scorm-editor.sidebar-width', 320, { min: 240, max: 480 })

  useEffect(() => {
    const handleDocClick = (e) => {
      if (!e.target.closest('.header-menu-container')) {
        setHeaderMenuOpen(false)
      }
    }
    document.addEventListener('click', handleDocClick)
    return () => document.removeEventListener('click', handleDocClick)
  }, [])

  useEffect(() => {
    const sid = localStorage.getItem('activeSessionId')
    if (sid && !quiz) {
      setLoading(true)
      setLoadingMessage({ kind: 'scorm', text: 'Đang khôi phục phiên làm việc...' })
      loadSession(sid)
        .then((data) => {
          resetHistory(data)
          if (data.tekyQuiz?.importSummary) {
            setImportReport({ summary: data.tekyQuiz.importSummary })
          } else if (data.importSummary) {
            setImportReport({ summary: data.importSummary })
          }
          if (data.questions?.length > 0) {
            const first = data.questions.find((q) => !q.deleted)
            if (first) setSelectedId(first.id)
          }
        })
        .catch((e) => {
          console.warn('Cannot restore session', e)
          localStorage.removeItem('activeSessionId')
        })
        .finally(() => setLoading(false))
    }
  }, [])

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

      const savedQuestionList = (savedView.questions || []).map(clearSlideDirtyFlags)
      const savedQuestions = Object.fromEntries(savedQuestionList.map((q) => [q.id, q]))
      const previousPersistentIds = new Set(
        (prev.questions || []).filter((q) => !q.isNew).map((q) => q.id),
      )
      const newlyCreatedQuestions = savedQuestionList.filter(
        (q) => !previousPersistentIds.has(q.id),
      )
      let createdIndex = 0
      const questions = (prev.questions || [])
        .filter((q) => !q.deleted)
        .map((q) => {
          if (q.isNew && newlyCreatedQuestions[createdIndex]) {
            const created = newlyCreatedQuestions[createdIndex]
            createdIndex += 1
            return created
          }
          return savedQuestions[q.id] || clearSlideDirtyFlags(syncSlideCanvasHtml(q))
        })

      return clearDirtyFlags({
        ...prev,
        title: savedView.title ?? prev.title,
        tekyQuiz: savedView.tekyQuiz ?? prev.tekyQuiz,
        passingScore: savedView.passingScore ?? prev.passingScore,
        reporting: normalizeReporting(savedView.reporting ?? prev.reporting),
        questionCount: questions.length,
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
    // Teky LMS is an explicit-save editor. Keeping blank draft rows local until
    // Save Quiz prevents backend normalization from removing a row mid-edit.
    paused: canvasEditing || quizMode === 'teky',
  })

  const showToast = (msg, type = 'success') => {
    setToast({ msg, type })
    setTimeout(() => setToast(null), 3000)
  }

  const handleImport = async (fn, { kind = 'scorm' } = {}) => {
    setLoading(true)
    setError(null)
    setErrorKind(null)
    setImportReport(null)
    const loadingText =
      kind === 'excel'
        ? 'Đang đọc Excel và tạo quiz...'
        : kind === 'tsv'
          ? 'Đang tạo Excel bài học từ TSV và mở Editor...'
          : 'Đang phân tích gói SCORM...'
    setLoadingMessage({
      kind,
      text: loadingText,
    })
    try {
      const data = await fn()
      // Package-only response (openInEditor false) has no sessionId
      if (!data?.sessionId && data?.package) {
        showToast(data.message || `Đã tạo ${data.package.relativeExcel}`)
        return
      }
      if (data?.sessionId) {
        localStorage.setItem('activeSessionId', data.sessionId)
      }
      resetHistory(data)
      const firstImported = data.importReport?.find((r) => r.status === 'imported' && r.slideId)
      setSelectedId(firstImported?.slideId || firstSelectableId(data))
      const slideCount = (data.introSlide ? 1 : 0) + (data.resultSlides?.length || 0)
      if (data.importReport) {
        setImportReport({ report: data.importReport, summary: data.importSummary })
        const s = data.importSummary
        const lessonHint = s?.lessonCode ? ` · Bài ${s.lessonCode}` : ''
        showToast(
          s
            ? `Excel: ${s.imported}/${s.total} câu import — tổng ${data.questionCount} câu${lessonHint}`
            : `Đã import ${data.questionCount} câu`,
        )
      } else {
        showToast(`Đã import ${data.questionCount} câu + ${slideCount} slide đặc biệt`)
      }
    } catch (err) {
      const msg = err?.message || String(err)
      setError(msg)
      setErrorKind(kind)
      showToast(msg, 'error')
    } finally {
      setLoading(false)
      setLoadingMessage(null)
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
      const saved = await persistQuiz()
      const exportTitle = saved?.title || quiz.title
      const blob = await exportSession(quiz.sessionId, exportTitle)
      const url = URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url
      a.download = `${exportTitle || 'scorm-export'}.zip`
      a.click()
      URL.revokeObjectURL(url)
      showToast('Đã export SCORM zip')
    } catch (err) {
      showToast(err.message, 'error')
    } finally {
      setSaving(false)
    }
  }

  const handleExportMedia = async () => {
    if (!quiz) return
    setSaving(true)
    try {
      await persistQuiz()
      const blob = await exportMedia(quiz.sessionId)
      const url = URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url
      a.download = `media-export-${quiz.sessionId}.zip`
      document.body.appendChild(a)
      a.click()
      URL.revokeObjectURL(url)
      showToast('Đã tải xuống file Media ZIP')
    } catch (err) {
      showToast(err.message, 'error')
    } finally {
      setSaving(false)
    }
  }

  const handleExportCmsJson = async () => {
    if (!quiz) return
    setSaving(true)
    try {
      await persistQuiz()
      const { blob, filename } = await exportCmsJson(quiz.sessionId)
      
      const url = URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url
      a.download = filename || 'cms-export.json'
      a.click()
      URL.revokeObjectURL(url)
      
      showToast(`✅ Đã xuất JSON thành công! Phiên làm việc đã kết thúc. Để sửa lại, vui lòng Import lại file JSON này.`, 'success')
      
      // Xoá session hoàn toàn ở frontend (Backend sẽ dọn rác tự động)
      localStorage.removeItem('activeSessionId')
      setTimeout(() => {
        setQuiz(null)
      }, 3000)
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
          <h1 onClick={() => { localStorage.removeItem('activeSessionId'); window.location.reload(); }} style={{ cursor: 'pointer' }} title="Về trang chủ"><span>SCORM</span> Editor</h1>
          <div className="header-actions">
            <select
              className="quiz-mode-selector"
              value={quizMode}
              onChange={(e) => setQuizMode(e.target.value)}
              style={{ marginRight: '16px', padding: '6px 12px', borderRadius: '4px', border: '1px solid #ccc' }}
            >
              <option value="teky">🌟 Mode: Teky LMS</option>
              <option value="ispring">📦 Mode: iSpring SCORM</option>
            </select>
            <GuideButton onClick={() => setGuideOpen(true)} />
          </div>
        </header>
        <ImportPage
          onImport={handleImport}
          loading={loading}
          loadingMessage={loadingMessage}
          error={error}
          errorKind={errorKind}
          importReport={importReport}
        />
        <UserGuideModal open={guideOpen} onClose={() => setGuideOpen(false)} />
      </div>
    )
  }

  if (workspaceMode === 'preview') {
    return (
      <div className="app app-preview">
        {quizMode === 'teky' ? (
          <TekyQuizPreview
            quiz={quiz}
            onBack={() => setWorkspaceMode('edit')}
          />
        ) : (
          <QuizPreview
            quiz={quiz}
            saving={saving || autoSaving}
            previewRevision={previewRevision}
            onBack={() => setWorkspaceMode('edit')}
            onSave={persistQuiz}
          />
        )}
        {toast && <div className={`toast toast-${toast.type}`}>{toast.msg}</div>}
      </div>
    )
  }

  const activeQuestions = quiz.questions.filter((q) => !q.deleted)
  let lastGroup = null

  return (
    <div className="app">
      <header className="header">
        <h1 onClick={() => { localStorage.removeItem('activeSessionId'); window.location.reload(); }} style={{ cursor: 'pointer' }} title="Về trang chủ"><span>SCORM</span> Editor</h1>
        <div className="header-actions">
          <div className="header-actions-desktop-only">
            <select
              className="quiz-mode-selector"
              value={quizMode}
              onChange={(e) => setQuizMode(e.target.value)}
              style={{ marginRight: '16px', padding: '6px 12px', borderRadius: '4px', border: '1px solid #ccc' }}
            >
              <option value="teky">🌟 Mode: Teky LMS</option>
              <option value="ispring">📦 Mode: iSpring SCORM</option>
            </select>
            <GuideButton onClick={() => setGuideOpen(true)} />
          </div>
          
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
          
          <div className="header-actions-desktop-only">
            <button
              className="btn"
              onClick={() => {
                resetHistory(null)
                setSelectedId(null)
                setImportReport(null)
                setWorkspaceMode('edit')
              }}
            >
              Import mới
            </button>
          </div>
          
          <button className="btn" disabled={saving} onClick={handleOpenPreview}>
            Xem & Làm bài
          </button>
          
          <div className="header-actions-desktop-only">
            {quizMode !== 'teky' && (
              <button className="btn btn-primary" disabled={saving} onClick={handleSave}>
                {saving ? 'Đang lưu...' : 'Lưu'}
              </button>
            )}
            <button className="btn btn-primary" disabled={saving} onClick={handleExport}>
              Export SCORM
            </button>
            <button className="btn btn-primary" disabled={saving} onClick={handleExportMedia}>
              Export Media
            </button>
          </div>

          <button
            className="btn btn-cms-export"
            disabled={saving}
            onClick={handleExportCmsJson}
            title="Xuất toàn bộ câu hỏi sang JSON để import vào LMS CMS"
          >
            📋 Xuất bản CMS json
          </button>

          <div className="header-menu-container">
            <button
              className="btn btn-icon hamburger-btn"
              onClick={() => setHeaderMenuOpen(!headerMenuOpen)}
              title="Menu mở rộng"
            >
              ☰
            </button>
            {headerMenuOpen && (
              <div className="header-dropdown">
                <select
                  className="quiz-mode-selector mobile-menu-item"
                  value={quizMode}
                  onChange={(e) => {
                    setQuizMode(e.target.value)
                    setHeaderMenuOpen(false)
                  }}
                >
                  <option value="teky">🌟 Mode: Teky LMS</option>
                  <option value="ispring">📦 Mode: iSpring SCORM</option>
                </select>
                <button className="btn mobile-menu-item" onClick={() => { setGuideOpen(true); setHeaderMenuOpen(false) }}>
                  📖 Guide
                </button>
                <button
                  className="btn mobile-menu-item"
                  onClick={() => {
                    resetHistory(null)
                    setSelectedId(null)
                    setImportReport(null)
                    setWorkspaceMode('edit')
                    setHeaderMenuOpen(false)
                  }}
                >
                  Import mới
                </button>
                {quizMode !== 'teky' && (
                  <button className="btn btn-primary mobile-menu-item" disabled={saving} onClick={() => { handleSave(); setHeaderMenuOpen(false) }}>
                    {saving ? 'Đang lưu...' : 'Lưu'}
                  </button>
                )}
                <button className="btn btn-primary mobile-menu-item" disabled={saving} onClick={() => { handleExport(); setHeaderMenuOpen(false) }}>
                  Export SCORM
                </button>
                <button className="btn btn-primary mobile-menu-item" disabled={saving} onClick={() => { handleExportMedia(); setHeaderMenuOpen(false) }}>
                  Export Media
                </button>
              </div>
            )}
          </div>
        </div>
      </header>

      {importReport && (
        <div className="import-report-banner">
          <ImportReport
            report={importReport.report}
            summary={importReport.summary}
            questions={quiz.questions}
            onSelectSlide={setSelectedId}
            onDismiss={() => setImportReport(null)}
            compact
          />
        </div>
      )}

      {quizMode === 'teky' && quiz ? (
        <TekyQuizEditor
          quiz={quiz}
          activeSlide={selectedSlide}
          onQuizChange={setQuiz}
          onSlideChange={updateSlide}
          onSelectSlide={setSelectedId}
          sessionId={quiz.sessionId}
          onSave={handleSave}
          saving={saving}
        />
      ) : quiz ? (
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
      ) : (
        <div className="empty-state">
          <p>Chưa có dữ liệu quiz.</p>
          <p>Vui lòng Import file Excel hoặc SCORM để bắt đầu.</p>
        </div>
      )}

      {toast && <div className={`toast toast-${toast.type}`}>{toast.msg}</div>}
      <UserGuideModal open={guideOpen} onClose={() => setGuideOpen(false)} />
    </div>
  )
}
