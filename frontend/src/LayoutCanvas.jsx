import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { reflowSlideLayout } from './choiceLayoutUtils'
import MatchingPreview from './MatchingPreview'
import {
  BlankPreview,
  SequencePreview,
  TrueFalsePreview,
  TypeInPreview,
  WordBankChips,
} from './QuestionPreviews'
import { assetUrl, uploadNewImage } from './api'
import {
  buildLayoutPatch,
  canDeleteCanvasObject,
  createImageObject,
  createSlidePictureObject,
  normalizeLayoutObjects,
} from './canvasObjectUtils'
import PanelResizeHandle from './PanelResizeHandle'
import CanvasFonts from './CanvasFonts'
import { useResizableWidth } from './useResizableWidth'
import CanvasIcon from './CanvasIcon'
import CanvasRichText from './CanvasRichText'
import TextFormatToolbar from './TextFormatToolbar'
import { shapeBoxStyle, textPaddingStyle, verticalAlignStyle } from './canvasShapeUtils'
import {
  applyFormatPatch,
  diffFormat,
  extractPlainTextFromHtml,
  normalizeStoredHtml,
  readEditorPayload,
  readFormatFromEditor,
} from './richTextUtils'
import {
  buildStyledHtml,
  defaultFormat,
  extractTextAlignFromHtml,
  htmlToEditableText,
  resolveCanvasTextFormat,
} from './textFormatUtils'
import {
  CANVAS_H,
  CANVAS_W,
  applyResize,
  clampRect,
  detectOverlapsLocal,
  getHandleAt,
  hitTest,
} from './layoutUtils'

function ChoicePreview({
  preview,
  wysiwyg,
  choices,
  typography,
  editingChoiceIdx,
  onChoiceTextChange,
  onChoiceBlur,
  onChoiceFocus,
  onEditorMount,
}) {
  if (!preview?.items?.length) return null
  const { items, type } = preview

  const layout = preview.layout
  const hasImages = items.some((item) => item.image)
  const cols = layout?.columns ?? (hasImages ? (items.length <= 2 ? 1 : 2) : 1)
  const rowHeights = layout?.rowHeights
  const gridRowHeights = layout?.gridRowHeights
  const rowHeight = layout?.rowHeight
  const rowGap = layout?.rowGap ?? 0
  const choicePadding = layout?.choicePadding ?? 10
  const uniformRow = rowHeight
    || gridRowHeights?.[0]
    || rowHeights?.[0]
  const rowCount = Math.ceil(items.length / cols)

  const gridRows = uniformRow
    ? `repeat(${rowCount}, ${uniformRow}px)`
    : gridRowHeights?.length
      ? gridRowHeights.map((h) => `${h}px`).join(' ')
      : undefined

  const gridStyle = wysiwyg
    ? {
        gridTemplateColumns: `repeat(${cols}, minmax(0, 1fr))`,
        gridTemplateRows: gridRows,
        gap: rowGap ? `${rowGap}px 10px` : '0 10px',
        height: '100%',
        alignContent: 'start',
      }
    : undefined

  return (
    <div
      className={`choice-preview ${type === 'MultipleResponse' ? 'type-mr' : ''} ${wysiwyg ? 'wysiwyg fidelity' : ''}`}
      style={gridStyle}
    >
      {items.map((item, i) => {
        const fmt = resolveCanvasTextFormat(
          choices?.[i]?.format,
          item.format,
          item.html || choices?.[i]?.html,
          'content',
        )
        const editing = editingChoiceIdx === i
        const itemRowHeight = uniformRow
          || rowHeights?.[i]
          || gridRowHeights?.[Math.floor(i / cols)]
        const rowStyle = wysiwyg
          ? {
              minHeight: itemRowHeight || 28,
              padding: choicePadding,
              boxSizing: 'border-box',
            }
          : undefined

        return (
          <div
            key={i}
            className={`choice-preview-row ${item.image ? 'has-image' : ''} ${item.inputType === 'checkbox' ? 'is-checkbox' : ''}`}
            style={rowStyle}
          >
            {(item.inputType === 'radio' || item.inputType === 'truefalse') && (
              <span className="fake-radio" aria-hidden />
            )}
            {item.inputType === 'checkbox' && <span className="fake-checkbox" aria-hidden />}
            {item.inputType === 'sequence' && <span className="fake-drag">⋮⋮</span>}
            {item.image && (
              <img
                className="choice-preview-img"
                src={assetUrl(preview.sessionId, item.image)}
                alt=""
                draggable={false}
              />
            )}
            {editing && wysiwyg && onChoiceTextChange ? (
              <CanvasRichText
                className="choice-html"
                value={item.text || choices?.[i]?.text || ''}
                format={fmt}
                role="content"
                typography={typography}
                html={item.html}
                editing
                placeholder={`Đáp án ${i + 1}`}
                onTextChange={(text) => onChoiceTextChange(i, text)}
                onBlur={(payload) => onChoiceBlur?.(i, payload || { text: choices?.[i]?.text || item.text || '' })}
                onFocus={() => onChoiceFocus?.(i)}
                onEditorMount={onEditorMount}
              />
            ) : item.text?.trim() ? (
              <div
                className="ispring-html fidelity-html choice-html choice-html-preview"
                dangerouslySetInnerHTML={{
                  __html: item.html?.trim()
                    || choices?.[i]?.html?.trim()
                    || buildStyledHtml(
                      item.text || choices?.[i]?.text || '',
                      'content',
                      fmt,
                      typography,
                      item.html || choices?.[i]?.html,
                    ),
                }}
                onPointerDown={(e) => {
                  e.stopPropagation()
                  onChoiceFocus?.(i)
                }}
              />
            ) : item.text?.trim() ? (
              <span className="choice-preview-text">
                {item.text || choices?.[i]?.text || `Đáp án ${i + 1}`}
              </span>
            ) : null}
            {!wysiwyg && item.isCorrect && <span className="choice-correct-mark">✓</span>}
          </div>
        )
      })}
    </div>
  )
}

function PropertiesPanel({
  obj,
  sessionId,
  imgRev,
  onChange,
  overlaps,
  onLayerAction,
  onPickImage,
  onClearImage,
  onImageZoomChange,
  onDeleteObject,
}) {
  if (!obj) {
    return (
      <div className="props-panel empty">
        <p>Chọn một thành phần trên canvas để chỉnh vị trí và kích thước.</p>
      </div>
    )
  }

  const set = (field, val) => {
    const num = parseFloat(val)
    if (Number.isNaN(num)) return
    onChange({ ...obj.r, [field]: num })
  }

  const isMedia = obj.role === 'slidePicture' || obj.role === 'image'

  return (
    <div className="props-panel">
      <h4>{obj.name}</h4>
      <span className={`role-tag role-${obj.role}`}>{obj.role}</span>

      {isMedia && (
        <div className="props-media">
          <h5>Ảnh</h5>
          {obj.image ? (
            <div className="props-media-preview">
              <img src={`${assetUrl(sessionId, obj.image)}&v=${imgRev || 0}`} alt="" />
              <div className="props-media-actions">
                <label className="btn btn-sm">
                  Đổi ảnh
                  <input type="file" accept="image/*" hidden onChange={(e) => onPickImage?.(e.target.files?.[0])} />
                </label>
                <button type="button" className="btn btn-sm" onClick={() => onClearImage?.()}>Gỡ ảnh</button>
              </div>
            </div>
          ) : (
            <label className="btn btn-sm btn-primary props-media-upload">
              Chèn ảnh vào khung
              <input type="file" accept="image/*" hidden onChange={(e) => onPickImage?.(e.target.files?.[0])} />
            </label>
          )}
          <label className="props-zoom-toggle">
            <input
              type="checkbox"
              checked={obj.imageZoom ?? (obj.role === 'slidePicture')}
              onChange={(e) => onImageZoomChange?.(e.target.checked)}
            />
            <span>Phóng to khi xem Slide View</span>
          </label>
          {obj.role === 'slidePicture' && (
            <p className="props-hint">Áp dụng cho toàn bộ khung ảnh slide trên câu hỏi này.</p>
          )}
        </div>
      )}

      <div className="props-grid">
        <label>X<input type="number" value={Math.round(obj.r.x)} onChange={(e) => set('x', e.target.value)} /></label>
        <label>Y<input type="number" value={Math.round(obj.r.y)} onChange={(e) => set('y', e.target.value)} /></label>
        <label>W<input type="number" value={Math.round(obj.r.w)} onChange={(e) => set('w', e.target.value)} /></label>
        <label>H<input type="number" value={Math.round(obj.r.h)} onChange={(e) => set('h', e.target.value)} /></label>
      </div>

      <div className="layer-actions">
        <button type="button" className="btn btn-sm" onClick={() => onLayerAction('up')}>↑ Lên trên</button>
        <button type="button" className="btn btn-sm" onClick={() => onLayerAction('down')}>↓ Xuống dưới</button>
        {canDeleteCanvasObject(obj) && (
          <button type="button" className="btn btn-sm btn-danger" onClick={() => onDeleteObject?.()}>Xoá thành phần</button>
        )}
      </div>

      {overlaps.length > 0 && (
        <div className="overlap-list">
          <h5>Cảnh báo chồng lấn</h5>
          {overlaps.map((w, i) => (
            <div key={i} className={`overlap-item ${w.severity}`}>
              {w.aName} ∩ {w.bName}
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

export default function LayoutCanvas({
  question,
  sessionId,
  fonts,
  imgRev = 0,
  onPatch,
  onChange,
  onCanvasEditStart,
  onCanvasEditStateChange,
  onImageUpload,
}) {
  const containerRef = useRef(null)
  const editingElRef = useRef(null)
  const imageInputRef = useRef(null)
  const pendingImageTarget = useRef(null)
  const [scale, setScale] = useState(1)
  const [selectedIndex, setSelectedIndex] = useState(null)
  const [interaction, setInteraction] = useState(null)
  const [activeEditKey, setActiveEditKey] = useState(null)
  const [activeChoiceIdx, setActiveChoiceIdx] = useState(null)
  const [liveFormat, setLiveFormat] = useState(null)
  const [objects, setObjects] = useState(() =>
    normalizeLayoutObjects(question?.layout?.objects || [], question?.layout),
  )
  const objectsSnapshot = useMemo(
    () => JSON.stringify(question?.layout?.objects || []),
    [question?.layout?.objects],
  )

  useLayoutEffect(() => {
    setObjects(normalizeLayoutObjects(question?.layout?.objects || [], question?.layout))
    setSelectedIndex(null)
    setActiveEditKey(null)
    setActiveChoiceIdx(null)
  }, [question?.id])

  useEffect(() => {
    if (activeEditKey || question?._dirtyLayout) return
    const incoming = question?.layout?.objects || []
    const layout = question?.layout
    const normalized = normalizeLayoutObjects(incoming, layout)
    setObjects((prev) => (JSON.stringify(prev) === JSON.stringify(normalized) ? prev : normalized))
  }, [activeEditKey, objectsSnapshot, question?._dirtyLayout, question?.layout?.objects, question?.layout?.slideAttachmentZoom])

  useEffect(() => {
    onCanvasEditStateChange?.(!!activeEditKey)
  }, [activeEditKey, onCanvasEditStateChange])

  useEffect(() => () => onCanvasEditStateChange?.(false), [onCanvasEditStateChange])

  const rightPanelResize = useResizableWidth('scorm-editor.right-panel-width', 280, { min: 200, max: 440 })

  useEffect(() => {
    const el = containerRef.current
    if (!el) return
    const updateScale = () => {
      const host = el.querySelector('.canvas-stage-host')
      const w = (host?.clientWidth ?? el.clientWidth) - 24
      const h = (host?.clientHeight ?? el.clientHeight) - 24
      // Giữ canvas chuẩn 720×540 — chỉ thu nhỏ khi viewport không đủ chỗ
      setScale(Math.min(1, w / CANVAS_W, h / CANVAS_H))
    }
    updateScale()
    const ro = new ResizeObserver(updateScale)
    ro.observe(el)
    const host = el.querySelector('.canvas-stage-host')
    if (host) ro.observe(host)
    return () => ro.disconnect()
  }, [])

  const reflowKey = useMemo(
    () => JSON.stringify({
      id: question?.id,
      questionText: question?.questionText,
      choices: (question?.choices || []).map((c) => ({
        text: c.text,
        fontSize: c.format?.fontSize,
      })),
      items: (question?.layout?.choicePreview?.items || []).map((i) => i.text),
      pairs: (question?.layout?.choicePreview?.pairs || []).map((p) => ({
        left: p.leftText,
        right: p.rightText,
      })),
      questionType: question?.type,
      questionFormat: question?.questionFormat,
      titleSize: question?.layout?.typography?.titleSize,
      contentSize: question?.layout?.typography?.contentSize,
    }),
    [question],
  )

  const resolvePreview = useCallback(() => {
    const cp = question.layout?.choicePreview
    if (cp?.pairs?.length || cp?.items?.length || cp?.richHtml) return cp
    if (question.choices?.length && (question.type === 'TrueFalse' || question.type === 'Sequence')) {
      return {
        type: question.type,
        items: question.choices.map((ch) => ({
          text: ch.text,
          html: ch.html || '',
          format: ch.format,
          image: ch.image,
          isCorrect: ch.isCorrect,
          inputType: question.type === 'TrueFalse' ? 'truefalse' : 'sequence',
        })),
        layout: {
          ...(cp?.layout || {}),
          hasImages: question.choices.some((ch) => ch.image),
          imageOnly: question.choices.every((ch) => ch.image && !ch.text?.trim()),
        },
      }
    }
    if (question.type === 'Matching' && question.matchingPairs?.length) {
      const pairs = question.matchingPairs.map((p) => ({
        leftText: p.leftText,
        rightText: p.rightText,
        leftHtml: p.leftHtml || '',
        rightHtml: p.rightHtml || '',
        leftFormat: p.leftFormat,
        rightFormat: p.rightFormat,
        leftImage: p.leftImage,
        rightImage: p.rightImage,
      }))
      return {
        type: 'Matching',
        pairs,
        responses: cp?.responses || pairs.map((p) => ({
          text: p.rightText,
          html: p.rightHtml,
          format: p.rightFormat,
          image: p.rightImage,
        })),
        shuffleResponses: cp?.shuffleResponses ?? false,
        shuffleSeed: cp?.shuffleSeed || question.id,
        layout: cp?.layout || {},
        columnLabels: cp?.columnLabels,
      }
    }
    return cp || null
  }, [question.choices, question.id, question.layout?.choicePreview, question.matchingPairs, question.type])

  const applyReflow = useCallback(
    (sourceObjects, { markDirty = false } = {}) => {
      const preview = resolvePreview()
      const canReflow = preview?.items?.length || preview?.pairs?.length || preview?.richHtml
      if (!canReflow) return false
      const isDirty = !!(
        question._dirtyChoices
        || question._dirtyQuestionText
        || question._dirtyQuestionFormat
      )
      const { objects: reflowed, choicePreview: cp, changed } = reflowSlideLayout(
        sourceObjects,
        {
          questionText: question.questionText,
          choices: question.choices,
          choicePreview: preview,
          typography: question.layout?.typography,
          questionFormat: question.questionFormat,
          preservePositions: !isDirty,
        },
      )
      if (!changed) return false
      setObjects(reflowed)
      const layoutPatch = {
        ...question.layout,
        objects: reflowed,
        choicePreview: cp,
        overlaps: detectOverlapsLocal(reflowed),
      }
      if (onPatch) {
        onPatch(markDirty ? { _dirtyLayout: true, layout: layoutPatch } : { layout: layoutPatch })
      } else {
        onChange({
          ...question,
          ...(markDirty ? { _dirtyLayout: true } : {}),
          layout: layoutPatch,
        })
      }
      return true
    },
    [onChange, onPatch, question, resolvePreview],
  )

  useLayoutEffect(() => {
    if (activeEditKey) return
    const cp = question?.layout?.choicePreview
    const hasReflowTarget = question?.layout?.objects?.length
      && (
        cp?.items?.length
        || cp?.pairs?.length
        || cp?.richHtml
        || question?.type === 'Matching'
        || (question?.type === 'TrueFalse' && question?.choices?.length)
        || (question?.type === 'Sequence' && question?.choices?.length)
      )
    if (!hasReflowTarget) return
    const sourceObjects = normalizeLayoutObjects(
      question.layout?.objects || [],
      question.layout,
    )
    applyReflow(sourceObjects, {
      markDirty: !!(
        question._dirtyChoices
        || question._dirtyQuestionText
        || question._dirtyQuestionFormat
      ),
    })
  // eslint-disable-next-line react-hooks/exhaustive-deps -- reflow keyed by content, not object refs
  }, [reflowKey, activeEditKey])

  const overlaps = detectOverlapsLocal(objects)
  const selected = objects.find((o) => o.index === selectedIndex)

  const pushLayoutPatch = useCallback(
    (layoutWithObjects) => {
      const patch = { _dirtyLayout: true, layout: layoutWithObjects }
      if (onPatch) {
        onPatch(patch)
        return
      }
      onChange({ ...question, ...patch })
    },
    [onChange, onPatch, question],
  )

  const commitLayoutState = useCallback(
    (next, extra = {}) => {
      const layout = buildLayoutPatch(question, next, {
        overlaps: detectOverlapsLocal(next),
        ...extra,
      })
      const normalized = normalizeLayoutObjects(next, layout)
      setObjects(normalized)
      pushLayoutPatch({ ...layout, objects: normalized })
    },
    [pushLayoutPatch, question],
  )

  const commitObjects = useCallback(
    (next) => commitLayoutState(next),
    [commitLayoutState],
  )

  const assignImageToObject = useCallback(async (objIndex, file) => {
    if (!file || objIndex == null) return
    const { filename } = await uploadNewImage(sessionId, file)
    const target = objects.find((o) => o.index === objIndex)
    const zoom = target?.imageZoom ?? (target?.role === 'slidePicture')
    const next = objects.map((o) => (o.index === objIndex ? { ...o, image: filename, imageZoom: zoom } : o))
    const extra = {}
    if (target?.role === 'slidePicture') {
      extra.slideAttachment = filename
      extra.slideAttachmentZoom = zoom
    }
    commitLayoutState(next, extra)
    onImageUpload?.(filename, file)
  }, [commitLayoutState, objects, onImageUpload, sessionId])

  const handleImageZoomChange = useCallback((zoom) => {
    if (selectedIndex == null) return
    const target = objects.find((o) => o.index === selectedIndex)
    if (!target || (target.role !== 'slidePicture' && target.role !== 'image')) return
    const extra = {}
    const next = objects.map((o) => {
      if (target.role === 'slidePicture' && o.role === 'slidePicture') {
        return { ...o, imageZoom: zoom }
      }
      if (o.index === selectedIndex) return { ...o, imageZoom: zoom }
      return o
    })
    if (target.role === 'slidePicture') extra.slideAttachmentZoom = zoom
    commitLayoutState(next, extra)
  }, [commitLayoutState, objects, selectedIndex])

  const handleImageFile = useCallback(async (file) => {
    if (!file) return
    const target = pendingImageTarget.current
    pendingImageTarget.current = null
    try {
      if (target === 'canvas-image') {
        const { filename } = await uploadNewImage(sessionId, file)
        const obj = createImageObject(objects, null, filename)
        const next = [...objects, obj]
        const zOrder = [...(question.layout?.zOrder || objects.map((o) => o.index)), obj.index]
        commitLayoutState(next, { zOrder })
        setSelectedIndex(obj.index)
        onImageUpload?.(filename, file)
        return
      }
      if (target === 'new-frame') {
        const { filename } = await uploadNewImage(sessionId, file)
        const obj = createSlidePictureObject(objects)
        obj.image = filename
        const next = [...objects, obj]
        const zOrder = [...(question.layout?.zOrder || objects.map((o) => o.index)), obj.index]
        commitLayoutState(next, { zOrder, slideAttachment: filename, slideAttachmentZoom: true })
        setSelectedIndex(obj.index)
        onImageUpload?.(filename, file)
        return
      }
      if (typeof target === 'number') {
        await assignImageToObject(target, file)
      }
    } catch (err) {
      console.error(err)
      window.alert(err.message || 'Upload ảnh thất bại')
    }
  }, [assignImageToObject, commitLayoutState, objects, onImageUpload, question.layout?.zOrder, sessionId])

  const openImagePicker = useCallback((target) => {
    pendingImageTarget.current = target
    imageInputRef.current?.click()
  }, [])

  const handleAddSlidePicture = useCallback(() => {
    const obj = createSlidePictureObject(objects)
    const next = [...objects, obj]
    const zOrder = [...(question.layout?.zOrder || objects.map((o) => o.index)), obj.index]
    commitLayoutState(next, { zOrder })
    setSelectedIndex(obj.index)
  }, [commitLayoutState, objects, question.layout?.zOrder])

  const handleDeleteObject = useCallback((index) => {
    const obj = objects.find((o) => o.index === index)
    if (!canDeleteCanvasObject(obj)) return
    const next = objects.filter((o) => o.index !== index)
    const zOrder = (question.layout?.zOrder || objects.map((o) => o.index)).filter((i) => i !== index)
    const extra = { zOrder }
    if (obj.role === 'slidePicture' && obj.image) {
      extra.slideAttachment = null
    }
    commitLayoutState(next, extra)
    if (selectedIndex === index) setSelectedIndex(null)
  }, [commitLayoutState, objects, question.layout?.zOrder, selectedIndex])

  const updateSlide = useCallback(
    (patch) => {
      if (onPatch) {
        onPatch(patch)
        return
      }
      onChange({ ...question, ...patch })
    },
    [onChange, onPatch, question],
  )

  const registerEditor = useCallback((el) => {
    editingElRef.current = el
  }, [])

  const typography = question.layout?.typography || null

  const activeEdit = useMemo(() => {
    if (activeEditKey === 'question') {
      const dir = objects.find((o) => o.I === 'direction')
      return {
        key: 'question',
        label: question.type === 'IntroSlide'
          ? 'Giới thiệu'
          : question.type === 'ResultSlide'
            ? 'Thông báo kết quả'
            : 'Câu hỏi',
        role: 'title',
        format: resolveCanvasTextFormat(
          question.questionFormat,
          dir?.textFormat,
          dir?.html,
          'title',
        ),
      }
    }
    if (activeEditKey === 'subtitle') {
      const content = objects.find((o) => o.role === 'content')
      return {
        key: 'subtitle',
        label: 'Gợi ý bắt đầu',
        role: 'content',
        format: resolveCanvasTextFormat(
          question.subtitleFormat,
          content?.textFormat,
          content?.html,
          'content',
        ),
      }
    }
    if (activeEditKey === 'choice' && activeChoiceIdx !== null) {
      const ch = question.choices?.[activeChoiceIdx]
      if (!ch) return null
      const item = question.layout?.choicePreview?.items?.[activeChoiceIdx]
      return {
        key: `choice-${activeChoiceIdx}`,
        label: `Đáp án ${activeChoiceIdx + 1}`,
        role: 'content',
        format: resolveCanvasTextFormat(ch.format, item?.format, ch.html || item?.html, 'content'),
      }
    }
    return null
  }, [activeEditKey, activeChoiceIdx, question, objects])

  const selectedFormatTarget = useMemo(() => {
    if (selectedIndex === null || activeEditKey) return null
    const obj = objects.find((o) => o.index === selectedIndex)
    if (!obj) return null

    if (obj.role === 'direction' || obj.I === 'direction') {
      const label = question.type === 'IntroSlide'
        ? 'Giới thiệu'
        : question.type === 'ResultSlide'
          ? 'Thông báo kết quả'
          : 'Câu hỏi'
      return {
        key: 'question',
        label,
        role: 'title',
        format: resolveCanvasTextFormat(
          question.questionFormat,
          obj.textFormat,
          obj.html,
          'title',
        ),
      }
    }
    if (obj.role === 'content' && question.type === 'IntroSlide') {
      return {
        key: 'subtitle',
        label: 'Gợi ý bắt đầu',
        role: 'content',
        format: resolveCanvasTextFormat(
          question.subtitleFormat,
          obj.textFormat,
          obj.html,
          'content',
        ),
      }
    }
    return null
  }, [activeEditKey, objects, question, selectedIndex])

  const formatToolbarTarget = activeEdit || selectedFormatTarget

  useEffect(() => {
    if (!activeEdit || !editingElRef.current) {
      setLiveFormat(null)
      return undefined
    }
    const el = editingElRef.current
    const base = formatToolbarTarget?.format
    const role = formatToolbarTarget?.role || 'content'
    const update = () => {
      if (editingElRef.current) {
        setLiveFormat(readFormatFromEditor(editingElRef.current, base, role, typography))
      }
    }
    document.addEventListener('selectionchange', update)
    el.addEventListener('keyup', update)
    el.addEventListener('mouseup', update)
    update()
    return () => {
      document.removeEventListener('selectionchange', update)
      el.removeEventListener('keyup', update)
      el.removeEventListener('mouseup', update)
    }
  }, [activeEdit, formatToolbarTarget, typography])

  const syncDirectionHtml = useCallback(
    (payload, format = question.questionFormat) => {
      const dir = objects.find((o) => o.I === 'direction')
      if (!dir) return
      let text
      let html
      if (typeof payload === 'object' && payload !== null && payload.html) {
        text = payload.text ?? extractPlainTextFromHtml(payload.html)
        html = normalizeStoredHtml(payload.html, format, 'title', typography)
      } else {
        text = typeof payload === 'string' ? payload : (payload?.text ?? '')
        html = buildStyledHtml(text, 'title', format, typography, dir.html)
      }
      const next = objects.map((o) =>
        o.I === 'direction' ? { ...o, html, text, textFormat: format } : o,
      )
      setObjects(next)
      onChange({
        ...question,
        questionText: text,
        _dirtyQuestionText: true,
        layout: { ...question.layout, objects: next },
      })
    },
    [objects, onChange, question, typography],
  )

  const syncSubtitleHtml = useCallback(
    (payload, format = question.subtitleFormat) => {
      const content = objects.find((o) => o.role === 'content')
      if (!content) return
      let text
      let html
      if (typeof payload === 'object' && payload !== null && payload.html) {
        text = payload.text ?? extractPlainTextFromHtml(payload.html)
        html = normalizeStoredHtml(payload.html, format, 'content', typography)
      } else {
        text = typeof payload === 'string' ? payload : (payload?.text ?? '')
        html = buildStyledHtml(text, 'content', format, typography, content.html)
      }
      const next = objects.map((o) =>
        o.role === 'content' ? { ...o, html, text, textFormat: format } : o,
      )
      setObjects(next)
      onChange({
        ...question,
        subtitleText: text,
        _dirtySubtitleText: true,
        layout: { ...question.layout, objects: next },
      })
    },
    [objects, onChange, question, typography],
  )

  const syncChoiceHtml = useCallback(
    (idx, payload, format) => {
      const preview = question.layout?.choicePreview
      const item = preview?.items?.[idx]
      const ch = question.choices?.[idx]
      if (!ch) return
      const fmt = format ?? ch.format
      let text
      let html
      if (typeof payload === 'object' && payload !== null && payload.html) {
        text = payload.text ?? extractPlainTextFromHtml(payload.html)
        html = normalizeStoredHtml(payload.html, fmt, 'content', typography)
      } else {
        text = typeof payload === 'string' ? payload : (payload?.text ?? '')
        html = buildStyledHtml(text, 'content', fmt, typography, item?.html)
      }
      const choices = [...question.choices]
      choices[idx] = { ...ch, text, html, format: fmt }
      const items = (preview?.items || []).map((row, i) =>
        i === idx ? { ...row, text, html } : row,
      )
      onChange({
        ...question,
        choices,
        _dirtyChoices: true,
        layout: {
          ...question.layout,
          choicePreview: preview ? { ...preview, items } : preview,
        },
      })
    },
    [onChange, question, typography],
  )

  const handleFormatChange = useCallback((fmt) => {
    const target = activeEdit || selectedFormatTarget
    if (!target) return

    const el = editingElRef.current
    const prevFmt = liveFormat || target.format

    if (el && activeEdit) {
      const delta = diffFormat(prevFmt, fmt)
      if (Object.keys(delta).length) {
        applyFormatPatch(el, delta, target.role, typography)
        setLiveFormat(readFormatFromEditor(el, fmt, target.role, typography))
      }
    }

    if (target.key === 'question') {
      if (activeEdit && el) {
        const payload = readEditorPayload(el)
        updateSlide({ questionFormat: fmt, questionText: payload.text, _dirtyQuestionFormat: true })
        syncDirectionHtml(payload, fmt)
      } else {
        const dir = objects.find((o) => o.I === 'direction')
        const liveText = question.questionText ?? htmlToEditableText(dir?.html, dir?.text || '')
        updateSlide({ questionFormat: fmt, _dirtyQuestionFormat: true })
        syncDirectionHtml(liveText, fmt)
      }
      return
    }
    if (target.key === 'subtitle') {
      if (activeEdit && el) {
        const payload = readEditorPayload(el)
        updateSlide({ subtitleFormat: fmt, subtitleText: payload.text })
        syncSubtitleHtml(payload, fmt)
      } else {
        const content = objects.find((o) => o.role === 'content')
        const liveText = question.subtitleText ?? htmlToEditableText(content?.html, content?.text || '')
        updateSlide({ subtitleFormat: fmt })
        syncSubtitleHtml(liveText, fmt)
      }
      return
    }
    if (target.key?.startsWith('choice-')) {
      const idx = activeChoiceIdx
      if (idx === null) return
      const choices = [...(question.choices || [])]
      if (!choices[idx]) return
      if (activeEdit && el) {
        const payload = readEditorPayload(el)
        choices[idx] = { ...choices[idx], format: fmt, text: payload.text }
        updateSlide({ choices })
        syncChoiceHtml(idx, payload, fmt)
      } else {
        choices[idx] = { ...choices[idx], format: fmt }
        updateSlide({ choices })
        syncChoiceHtml(idx, choices[idx].text || '', fmt)
      }
    }
  }, [activeEdit, activeChoiceIdx, liveFormat, objects, question.choices, question.questionText, question.subtitleText, selectedFormatTarget, syncChoiceHtml, syncDirectionHtml, syncSubtitleHtml, typography, updateSlide])

  const handleChoiceTextChange = useCallback(
    (idx, text) => {
      const baseChoices = question.choices?.length
        ? question.choices
        : (question.layout?.choicePreview?.items || []).map((item, i) => ({
          id: `choice-${i}`,
          text: item.text || '',
          format: item.format,
          image: item.image,
          isCorrect: item.isCorrect,
        }))
      if (!baseChoices[idx]) return
      const choices = [...baseChoices]
      choices[idx] = { ...choices[idx], text }
      updateSlide({ choices })
    },
    [question.choices, question.layout?.choicePreview?.items, updateSlide],
  )

  const handleChoiceFocus = useCallback((idx) => {
    const content = objects.find((o) => o.role === 'content')
    if (content) setSelectedIndex(content.index)
    setActiveEditKey('choice')
    setActiveChoiceIdx(idx)
  }, [objects])

  const handleChoiceBlur = useCallback((idx, payload) => {
    setLiveFormat(null)
    const ch = question.choices?.[idx]
    const item = question.layout?.choicePreview?.items?.[idx]
    const fmt = resolveCanvasTextFormat(ch?.format, item?.format, ch?.html || item?.html, 'content')
    if (typeof payload === 'object' && payload?.html) {
      syncChoiceHtml(idx, payload, fmt)
    } else {
      const text = typeof payload === 'object' ? payload?.text : payload
      syncChoiceHtml(idx, text || ch?.text || '', fmt)
    }
    setActiveEditKey(null)
    setActiveChoiceIdx(null)
  }, [question.choices, question.layout?.choicePreview?.items, syncChoiceHtml])

  const updateObjectRect = (index, r) => {
    const next = objects.map((o) => (o.index === index ? { ...o, r: clampRect(r) } : o))
    commitObjects(next)
  }

  const toCanvas = (clientX, clientY) => {
    const rect = containerRef.current.querySelector('.canvas-stage').getBoundingClientRect()
    return { x: (clientX - rect.left) / scale, y: (clientY - rect.top) / scale }
  }

  const onPointerDown = (e, objIndex = null) => {
    if (e.button !== 0) return
    if (e.target.closest('[data-editable="true"]')) return
    const pt = toCanvas(e.clientX, e.clientY)

    if (objIndex === null) {
      const hit = hitTest(objects, pt.x, pt.y)
      if (hit === null) {
        setSelectedIndex(null)
        return
      }
      objIndex = hit
    }

    const obj = objects.find((o) => o.index === objIndex)
    if (!obj?.selectable) return

    setSelectedIndex(objIndex)
    const handle = getHandleAt(obj.r, pt.x, pt.y, scale)
    onCanvasEditStart?.()
    if (handle) {
      setInteraction({ type: 'resize', index: objIndex, handle, start: pt, orig: { ...obj.r } })
    } else {
      setInteraction({ type: 'drag', index: objIndex, start: pt, orig: { ...obj.r } })
    }
    e.currentTarget.setPointerCapture(e.pointerId)
  }

  const onPointerMove = (e) => {
    if (!interaction) return
    const pt = toCanvas(e.clientX, e.clientY)
    const dx = pt.x - interaction.start.x
    const dy = pt.y - interaction.start.y

    if (interaction.type === 'drag') {
      updateObjectRect(interaction.index, {
        ...interaction.orig,
        x: interaction.orig.x + dx,
        y: interaction.orig.y + dy,
      })
    } else {
      const lockRatio = e.shiftKey
        || objects[interaction.index]?.role === 'slidePicture'
        || objects[interaction.index]?.role === 'image'
      updateObjectRect(
        interaction.index,
        applyResize(interaction.orig, interaction.handle, dx, dy, lockRatio),
      )
    }
  }

  const onPointerUp = () => setInteraction(null)

  const onLayerAction = (action) => {
    if (selectedIndex === null) return
    const zOrder = [...(question.layout?.zOrder || objects.map((o) => o.index))]
    const pos = zOrder.indexOf(selectedIndex)
    if (pos < 0) return
    if (action === 'up' && pos < zOrder.length - 1) {
      ;[zOrder[pos], zOrder[pos + 1]] = [zOrder[pos + 1], zOrder[pos]]
    }
    if (action === 'down' && pos > 0) {
      ;[zOrder[pos], zOrder[pos - 1]] = [zOrder[pos - 1], zOrder[pos]]
    }
    onChange({
      ...question,
      _dirtyLayout: true,
      layout: {
        ...question.layout,
        objects,
        zOrder,
        overlaps: detectOverlapsLocal(objects),
      },
    })
  }

  const renderOrder = (question.layout?.zOrder || objects.map((o) => o.index))
    .map((idx) => objects.find((o) => o.index === idx))
    .filter(Boolean)

  const autoFixLayout = () => {
    const content = objects.find((o) => o.role === 'content')
    const pictures = objects.filter((o) => o.role === 'slidePicture' || o.role === 'image')
    if (!content || !pictures.length) return
    const maxBottom = Math.max(...pictures.map((p) => p.r.y + p.r.h))
    const gap = 16
    const newY = maxBottom + gap
    if (content.r.y >= newY - 4) return
    const next = objects.map((o) =>
      o.role === 'content'
        ? {
            ...o,
            r: clampRect({
              ...o.r,
              y: newY,
              h: Math.min(o.r.h, CANVAS_H - newY - 8),
            }),
          }
        : o,
    )
    commitObjects(next)
  }

  const bg = question.layout?.background
  const bgFit = question.layout?.backgroundFit || 'cover'
  const hotspots = question.layout?.hotspots || []
  const preview = useMemo(() => {
    const cp = question.layout?.choicePreview
    if (cp?.pairs?.length || cp?.items?.length || cp?.richHtml) {
      const extraWords = question.wordBankWords || cp?.extraWords
      return { ...cp, sessionId, ...(extraWords ? { extraWords } : {}) }
    }
    if (question.choices?.length && (question.type === 'TrueFalse' || question.type === 'Sequence')) {
      return {
        type: question.type,
        sessionId,
        items: question.choices.map((ch) => ({
          text: ch.text,
          html: ch.html || '',
          format: ch.format,
          image: ch.image,
          isCorrect: ch.isCorrect,
          inputType: question.type === 'TrueFalse' ? 'truefalse' : 'sequence',
        })),
        layout: {
          ...(cp?.layout || {}),
          hasImages: question.choices.some((ch) => ch.image),
          imageOnly: question.choices.every((ch) => ch.image && !ch.text?.trim()),
        },
      }
    }
    if (question.type === 'Matching' && question.matchingPairs?.length) {
      const pairs = question.matchingPairs.map((p) => ({
        leftText: p.leftText,
        rightText: p.rightText,
        leftHtml: p.leftHtml || '',
        rightHtml: p.rightHtml || '',
        leftFormat: p.leftFormat,
        rightFormat: p.rightFormat,
        leftImage: p.leftImage,
        rightImage: p.rightImage,
      }))
      return {
        type: 'Matching',
        sessionId,
        pairs,
        responses: cp?.responses || pairs.map((p) => ({
          text: p.rightText,
          html: p.rightHtml,
          format: p.rightFormat,
          image: p.rightImage,
        })),
        shuffleResponses: cp?.shuffleResponses ?? false,
        shuffleSeed: cp?.shuffleSeed || question.id,
        layout: cp?.layout || {},
        columnLabels: cp?.columnLabels,
      }
    }
    return cp ? { ...cp, sessionId } : null
  }, [question.choices, question.layout?.choicePreview, question.matchingPairs, question.type, question.wordBankWords, sessionId])

  return (
    <div className="layout-workspace">
      <CanvasFonts sessionId={sessionId} fonts={fonts} />
      <div className="layout-canvas-wrap" ref={containerRef}>
        <input
          ref={imageInputRef}
          type="file"
          accept="image/*"
          hidden
          onChange={(e) => {
            handleImageFile(e.target.files?.[0])
            e.target.value = ''
          }}
        />
        <div className="canvas-toolbar">
          <span>Canvas {CANVAS_W}×{CANVAS_H}</span>
          <div className="canvas-media-actions">
            <button type="button" className="btn btn-sm" onClick={handleAddSlidePicture}>
              + Khung ảnh
            </button>
            <button type="button" className="btn btn-sm" onClick={() => openImagePicker('new-frame')}>
              + Khung có ảnh
            </button>
            <button type="button" className="btn btn-sm btn-primary" onClick={() => openImagePicker('canvas-image')}>
              + Ảnh lên canvas
            </button>
          </div>
          <span className="toolbar-hint">
            Bấm vào chữ để sửa · bôi đen chữ rồi đổi màu/B/I/U · chọn khung để căn lề toàn khung
            {question.layout?.typography && (
              <> · Title {question.layout.typography.titleSize}px / Content {question.layout.typography.contentSize}px</>
            )}
          </span>
          {formatToolbarTarget && (
            <div className="canvas-format-bar">
              <span className="canvas-format-target">
                {activeEdit ? `Đang sửa: ${formatToolbarTarget.label}` : `Đã chọn: ${formatToolbarTarget.label}`}
              </span>
              <TextFormatToolbar
                compact
                preserveFocus={!!activeEdit}
                label=""
                role={formatToolbarTarget.role}
                format={liveFormat || formatToolbarTarget.format}
                showAlign
                onChange={handleFormatChange}
              />
            </div>
          )}
          {overlaps.some((o) => o.severity === 'error') && (
            <>
              <span className="toolbar-error">⚠ Ảnh đang đè vùng đáp án</span>
              <button type="button" className="btn btn-sm btn-primary" onClick={autoFixLayout}>
                Tự sửa chồng lấn
              </button>
            </>
          )}
        </div>

        <div className="canvas-stage-host">
        <div
          className="canvas-stage"
          style={{ width: CANVAS_W * scale, height: CANVAS_H * scale }}
          onPointerDown={(e) => onPointerDown(e)}
          onPointerMove={onPointerMove}
          onPointerUp={onPointerUp}
        >
          <div className="canvas-inner wysiwyg fidelity" style={{ transform: `scale(${scale})`, width: CANVAS_W, height: CANVAS_H }}>
            {bg && (
              <img
                className="canvas-bg"
                src={assetUrl(sessionId, bg)}
                alt=""
                draggable={false}
                style={{ objectFit: bgFit }}
              />
            )}
            {!bg && <div className="canvas-bg-empty" />}

            {renderOrder.map((obj, zIdx) => {
              if (!obj.r?.w || !obj.r?.h) return null

              const isSelected = obj.index === selectedIndex
              const hasError = overlaps.some(
                (w) => w.severity === 'error' && (w.a === obj.index || w.b === obj.index),
              )
              const { x, y, w, h } = obj.r
              const visual = obj.visual
              const shapeStyle = shapeBoxStyle(visual)
              const directionAlign = question.questionFormat?.align
                || extractTextAlignFromHtml(obj.html)
                || 'center'
              const labelAlign = extractTextAlignFromHtml(obj.html) || 'right'

              return (
                <div
                  key={obj.index}
                  className={`canvas-object wysiwyg-object ${obj.role} ${visual?.variant || ''} ${question.type === 'Matching' && (obj.text === 'Cột A' || obj.text === 'Cột B') ? 'matching-label' : ''} ${isSelected ? 'selected' : ''} ${hasError ? 'has-error' : ''}`}
                  style={{ left: x, top: y, width: w, height: h, zIndex: zIdx + 1, ...shapeStyle }}
                  onPointerDown={(e) => { e.stopPropagation(); onPointerDown(e, obj.index) }}
                >
                  {obj.image && (obj.role === 'slidePicture' || obj.role === 'image') && (
                    <img
                      src={`${assetUrl(sessionId, obj.image)}&v=${imgRev}`}
                      alt=""
                      draggable={false}
                      style={{ objectFit: question.layout?.backgroundFit || 'cover' }}
                    />
                  )}

                  {obj.role === 'icon' && (
                    <CanvasIcon kind={obj.iconKind || 'passed'} />
                  )}

                  {obj.role === 'direction' && (
                    <div
                      className="obj-html direction-html"
                      style={{
                        position: 'absolute',
                        inset: 0,
                        ...verticalAlignStyle(visual),
                        ...textPaddingStyle(visual),
                        textAlign: directionAlign,
                        justifyContent: directionAlign === 'left'
                          ? 'flex-start'
                          : directionAlign === 'right'
                            ? 'flex-end'
                            : 'center',
                      }}
                    >
                      <CanvasRichText
                        className="direction-editable"
                        value={
                          activeEditKey === 'question'
                            ? (question.questionText ?? htmlToEditableText(obj.html, obj.text || ''))
                            : htmlToEditableText(obj.html, question.questionText || obj.text || '')
                        }
                        format={resolveCanvasTextFormat(
                          question.questionFormat,
                          obj.textFormat,
                          obj.html,
                          'title',
                        )}
                        role="title"
                        typography={typography}
                        html={obj.html}
                        editing={activeEditKey === 'question'}
                        placeholder="Nhập tiêu đề / nội dung chính..."
                        onTextChange={(text) => updateSlide({ questionText: text })}
                        onBlur={(payload) => {
                          setLiveFormat(null)
                          const fmt = resolveCanvasTextFormat(
                            question.questionFormat,
                            obj.textFormat,
                            typeof payload === 'object' ? payload.html : obj.html,
                            'title',
                          )
                          if (typeof payload === 'object' && payload?.html) {
                            syncDirectionHtml(payload, fmt)
                            updateSlide({ questionText: payload.text, questionFormat: fmt })
                          } else {
                            const latest = payload || question.questionText || obj.text || ''
                            syncDirectionHtml(latest, fmt)
                          }
                          setActiveEditKey(null)
                        }}
                        onActivate={() => {
                          setSelectedIndex(obj.index)
                          setActiveEditKey('question')
                          setActiveChoiceIdx(null)
                        }}
                        onFocus={() => {
                          setSelectedIndex(obj.index)
                          setActiveEditKey('question')
                          setActiveChoiceIdx(null)
                        }}
                        onEditorMount={registerEditor}
                      />
                    </div>
                  )}

                  {obj.role === 'content' && question.type !== 'ResultSlide' && (
                    <div
                      className="content-zone wysiwyg-content editable-zone"
                      style={textPaddingStyle(visual)}
                    >
                      {question.type === 'IntroSlide' ? (
                        <CanvasRichText
                          className="intro-subtitle"
                          value={
                            activeEditKey === 'subtitle'
                              ? (question.subtitleText ?? htmlToEditableText(obj.html, obj.text || ''))
                              : htmlToEditableText(obj.html, question.subtitleText || obj.text || '')
                          }
                          format={resolveCanvasTextFormat(
                            question.subtitleFormat,
                            obj.textFormat,
                            obj.html,
                            'content',
                          )}
                          role="content"
                          typography={typography}
                          html={obj.html}
                          editing={activeEditKey === 'subtitle'}
                          placeholder='Gợi ý bắt đầu (vd: Bấm "Start Quiz")...'
                          onTextChange={(text) => updateSlide({ subtitleText: text })}
                          onBlur={(payload) => {
                            setLiveFormat(null)
                            const fmt = resolveCanvasTextFormat(
                              question.subtitleFormat,
                              obj.textFormat,
                              typeof payload === 'object' ? payload.html : obj.html,
                              'content',
                            )
                            if (typeof payload === 'object' && payload?.html) {
                              syncSubtitleHtml(payload, fmt)
                              updateSlide({ subtitleText: payload.text, subtitleFormat: fmt })
                            } else {
                              const latest = payload || question.subtitleText || obj.text || ''
                              syncSubtitleHtml(latest, fmt)
                            }
                            setActiveEditKey(null)
                          }}
                          onActivate={() => {
                            setSelectedIndex(obj.index)
                            setActiveEditKey('subtitle')
                            setActiveChoiceIdx(null)
                          }}
                          onFocus={() => {
                            setSelectedIndex(obj.index)
                            setActiveEditKey('subtitle')
                            setActiveChoiceIdx(null)
                          }}
                          onEditorMount={registerEditor}
                        />
                      ) : question.type === 'Matching' ? (
                        <MatchingPreview
                          preview={preview}
                          wysiwyg
                          sessionId={sessionId}
                        />
                      ) : question.type === 'TrueFalse' ? (
                        <TrueFalsePreview
                          preview={preview}
                          wysiwyg
                          sessionId={sessionId}
                          choices={question.choices}
                          typography={typography}
                          editingChoiceIdx={activeEditKey === 'choice' ? activeChoiceIdx : null}
                          onChoiceTextChange={handleChoiceTextChange}
                          onChoiceBlur={handleChoiceBlur}
                          onChoiceFocus={handleChoiceFocus}
                          onEditorMount={registerEditor}
                        />
                      ) : question.type === 'Sequence' ? (
                        <SequencePreview
                          preview={preview}
                          wysiwyg
                          choices={question.choices}
                          typography={typography}
                          editingChoiceIdx={activeEditKey === 'choice' ? activeChoiceIdx : null}
                          onChoiceTextChange={handleChoiceTextChange}
                          onChoiceBlur={handleChoiceBlur}
                          onChoiceFocus={handleChoiceFocus}
                          onEditorMount={registerEditor}
                        />
                      ) : question.type === 'TypeIn' ? (
                        <TypeInPreview preview={preview} wysiwyg />
                      ) : (question.type === 'WordBank' || question.type === 'FillInTheBlank') ? (
                        <BlankPreview preview={preview} wysiwyg />
                      ) : (
                        <ChoicePreview
                          preview={preview}
                          wysiwyg
                          choices={question.choices}
                          typography={typography}
                          editingChoiceIdx={activeEditKey === 'choice' ? activeChoiceIdx : null}
                          onChoiceTextChange={handleChoiceTextChange}
                          onChoiceBlur={handleChoiceBlur}
                          onChoiceFocus={handleChoiceFocus}
                          onEditorMount={registerEditor}
                        />
                      )}
                    </div>
                  )}

                  {obj.role === 'shape' && (
                    (obj.text || obj.html || visual?.gradient || visual?.border) && (
                      <div
                        className={`shape-label-preview ${visual?.variant || ''} ${visual?.variant === 'label' ? `align-${labelAlign}` : ''}`}
                        style={{ ...verticalAlignStyle(visual), ...textPaddingStyle(visual), display: 'flex' }}
                      >
                        {obj.html ? (
                          <div className="ispring-html fidelity-html" dangerouslySetInnerHTML={{ __html: obj.html }} />
                        ) : obj.text ? (
                          <span>{obj.text}</span>
                        ) : null}
                      </div>
                    )
                  )}

                  {obj.role === 'additionalContent' && (
                    <div className="content-zone wysiwyg-content additional-zone">
                      {preview?.type === 'WordBank' && (
                        <WordBankChips preview={preview} wysiwyg />
                      )}
                    </div>
                  )}

                  {!obj.image && (obj.role === 'slidePicture' || obj.role === 'image') && (
                    <button
                      type="button"
                      className="picture-placeholder clickable"
                      onMouseDown={(e) => e.stopPropagation()}
                      onClick={(e) => {
                        e.stopPropagation()
                        openImagePicker(obj.index)
                      }}
                    >
                      Bấm để chèn ảnh
                    </button>
                  )}

                  {isSelected && (
                    <>
                      <span className="obj-label edit-only">{obj.name}</span>
                      {['nw', 'n', 'ne', 'e', 'se', 's', 'sw', 'w'].map((handle) => (
                        <span key={handle} className={`resize-handle handle-${handle}`} />
                      ))}
                    </>
                  )}
                </div>
              )
            })}

            {hotspots.map((hs) => (
              <div
                key={`hs-${hs.index}`}
                className={`hotspot-overlay ${hs.correct ? 'correct' : ''} ${hs.type}`}
                style={{ left: hs.r.x, top: hs.r.y, width: hs.r.w, height: hs.r.h, zIndex: 90 }}
                title={hs.label}
              />
            ))}
          </div>
        </div>
        </div>
      </div>

      <PanelResizeHandle
        side="left"
        label="Kéo để đổi chiều rộng panel thuộc tính"
        onPointerDown={(e) => rightPanelResize.onPointerDown(e, 'expand-left')}
      />

      <div className="layout-side" style={{ width: rightPanelResize.width }}>
        <div className="layer-panel">
          <h4>Thành phần</h4>
          {[...renderOrder].reverse().map((obj) => (
            <button
              key={obj.index}
              type="button"
              className={`layer-item ${obj.index === selectedIndex ? 'active' : ''}`}
              onClick={() => setSelectedIndex(obj.index)}
            >
              <span className={`layer-dot role-${obj.role}`} />
              <span className="layer-name">{obj.name}</span>
              <span className="layer-size">{Math.round(obj.r.w)}×{Math.round(obj.r.h)}</span>
            </button>
          ))}
        </div>

        <PropertiesPanel
          obj={selected}
          sessionId={sessionId}
          imgRev={imgRev}
          overlaps={overlaps.filter((w) => w.a === selectedIndex || w.b === selectedIndex)}
          onChange={(r) => updateObjectRect(selectedIndex, r)}
          onLayerAction={onLayerAction}
          onPickImage={(file) => assignImageToObject(selectedIndex, file)}
          onClearImage={() => {
            if (selectedIndex == null) return
            const next = objects.map((o) => (o.index === selectedIndex ? { ...o, image: null } : o))
            const target = next.find((o) => o.index === selectedIndex)
            const extra = target?.role === 'slidePicture' ? { slideAttachment: null } : {}
            commitLayoutState(next, extra)
          }}
          onImageZoomChange={handleImageZoomChange}
          onDeleteObject={() => handleDeleteObject(selectedIndex)}
        />
      </div>
    </div>
  )
}