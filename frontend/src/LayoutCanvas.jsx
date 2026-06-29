import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { assetUrl } from './api'
import CanvasFonts from './CanvasFonts'
import CanvasIcon from './CanvasIcon'
import CanvasRichText from './CanvasRichText'
import TextFormatToolbar from './TextFormatToolbar'
import { applyFormatToElement } from './canvasTextUtils'
import { shapeBoxStyle, textPaddingStyle, verticalAlignStyle } from './canvasShapeUtils'
import { buildStyledHtml, defaultFormat, extractTextAlignFromHtml } from './textFormatUtils'
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

  if (type === 'TypeIn') {
    return (
      <div className={`choice-preview typein ${wysiwyg ? 'wysiwyg fidelity' : ''}`}>
        <div className="fake-input">Nhập đáp án...</div>
      </div>
    )
  }

  const layout = preview.layout
  const hasImages = items.some((item) => item.image)
  const cols = layout?.columns ?? (hasImages ? (items.length <= 2 ? 1 : 2) : 1)
  const rowHeight = layout?.rowHeight
  const choicePadding = layout?.choicePadding ?? 10

  const gridStyle = wysiwyg
    ? {
        gridTemplateColumns: `repeat(${cols}, minmax(0, 1fr))`,
        gridTemplateRows: rowHeight && cols === 1
          ? `repeat(${items.length}, ${rowHeight}px)`
          : rowHeight && cols > 1
            ? `repeat(${Math.ceil(items.length / cols)}, ${rowHeight}px)`
            : undefined,
        height: '100%',
      }
    : undefined

  return (
    <div
      className={`choice-preview ${type === 'MultipleResponse' ? 'type-mr' : ''} ${wysiwyg ? 'wysiwyg fidelity' : ''}`}
      style={gridStyle}
    >
      {items.map((item, i) => {
        const fmt = item.format || choices?.[i]?.format
        const editing = editingChoiceIdx === i
        const rowStyle = wysiwyg && rowHeight
          ? { minHeight: rowHeight, height: rowHeight, padding: choicePadding }
          : wysiwyg
            ? { padding: choicePadding }
            : undefined

        return (
          <div
            key={i}
            className={`choice-preview-row ${item.image ? 'has-image' : ''} ${item.inputType === 'checkbox' ? 'is-checkbox' : ''}`}
            style={rowStyle}
          >
            {item.inputType === 'radio' && <span className="fake-radio" aria-hidden />}
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
                onBlur={() => onChoiceBlur?.(i, choices?.[i]?.text || item.text || '')}
                onFocus={() => onChoiceFocus?.(i)}
                onEditorMount={onEditorMount}
              />
            ) : item.html && item.text?.trim() ? (
              <div
                className="ispring-html fidelity-html choice-html choice-html-preview"
                dangerouslySetInnerHTML={{ __html: item.html }}
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

function PropertiesPanel({ obj, onChange, overlaps, onLayerAction }) {
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

  return (
    <div className="props-panel">
      <h4>{obj.name}</h4>
      <span className={`role-tag role-${obj.role}`}>{obj.role}</span>

      <div className="props-grid">
        <label>X<input type="number" value={Math.round(obj.r.x)} onChange={(e) => set('x', e.target.value)} /></label>
        <label>Y<input type="number" value={Math.round(obj.r.y)} onChange={(e) => set('y', e.target.value)} /></label>
        <label>W<input type="number" value={Math.round(obj.r.w)} onChange={(e) => set('w', e.target.value)} /></label>
        <label>H<input type="number" value={Math.round(obj.r.h)} onChange={(e) => set('h', e.target.value)} /></label>
      </div>

      <div className="layer-actions">
        <button type="button" className="btn btn-sm" onClick={() => onLayerAction('up')}>↑ Lên trên</button>
        <button type="button" className="btn btn-sm" onClick={() => onLayerAction('down')}>↓ Xuống dưới</button>
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

export default function LayoutCanvas({ question, sessionId, fonts, onPatch, onChange }) {
  const containerRef = useRef(null)
  const editingElRef = useRef(null)
  const [scale, setScale] = useState(1)
  const [selectedIndex, setSelectedIndex] = useState(null)
  const [interaction, setInteraction] = useState(null)
  const [activeEditKey, setActiveEditKey] = useState(null)
  const [activeChoiceIdx, setActiveChoiceIdx] = useState(null)
  const [objects, setObjects] = useState(question?.layout?.objects || [])
  const objectsSnapshot = useMemo(
    () => JSON.stringify(question?.layout?.objects || []),
    [question?.layout?.objects],
  )

  useEffect(() => {
    setObjects(question?.layout?.objects || [])
    setSelectedIndex(null)
    setActiveEditKey(null)
    setActiveChoiceIdx(null)
  }, [question?.id])

  useEffect(() => {
    const incoming = question?.layout?.objects || []
    setObjects((prev) => (JSON.stringify(prev) === JSON.stringify(incoming) ? prev : incoming))
  }, [objectsSnapshot, question?.layout?.objects])

  useEffect(() => {
    const el = containerRef.current
    if (!el) return
    const ro = new ResizeObserver(() => {
      const w = el.clientWidth - 48
      setScale(Math.min(w / CANVAS_W, 1.2))
    })
    ro.observe(el)
    return () => ro.disconnect()
  }, [])

  const overlaps = detectOverlapsLocal(objects)
  const selected = objects.find((o) => o.index === selectedIndex)

  const commitObjects = useCallback(
    (next) => {
      setObjects(next)
      onChange({
        ...question,
        _dirtyLayout: true,
        layout: {
          ...question.layout,
          objects: next,
          overlaps: detectOverlapsLocal(next),
        },
      })
    },
    [onChange, question],
  )

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
      return {
        key: 'question',
        label: question.type === 'IntroSlide'
          ? 'Giới thiệu'
          : question.type === 'ResultSlide'
            ? 'Thông báo kết quả'
            : 'Câu hỏi',
        role: 'title',
        format: question.questionFormat || defaultFormat('title'),
      }
    }
    if (activeEditKey === 'subtitle') {
      return {
        key: 'subtitle',
        label: 'Gợi ý bắt đầu',
        role: 'content',
        format: question.subtitleFormat || defaultFormat('content'),
      }
    }
    if (activeEditKey === 'choice' && activeChoiceIdx !== null) {
      const ch = question.choices?.[activeChoiceIdx]
      if (!ch) return null
      return {
        key: `choice-${activeChoiceIdx}`,
        label: `Đáp án ${activeChoiceIdx + 1}`,
        role: 'content',
        format: ch.format || defaultFormat('content'),
      }
    }
    return null
  }, [activeEditKey, activeChoiceIdx, question])

  const syncDirectionHtml = useCallback(
    (text, format = question.questionFormat) => {
      const dir = objects.find((o) => o.I === 'direction')
      if (!dir) return
      const html = buildStyledHtml(
        text,
        'title',
        format,
        typography,
        dir.html,
      )
      const next = objects.map((o) =>
        o.I === 'direction' ? { ...o, html, text } : o,
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

  const syncChoiceHtml = useCallback(
    (idx, text, format) => {
      const preview = question.layout?.choicePreview
      const item = preview?.items?.[idx]
      const ch = question.choices?.[idx]
      if (!ch) return
      const html = buildStyledHtml(
        text,
        'content',
        format ?? ch.format,
        typography,
        item?.html,
      )
      const choices = [...question.choices]
      choices[idx] = { ...ch, text, html }
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
    const el = editingElRef.current
    if (el && activeEdit) {
      applyFormatToElement(el, fmt, activeEdit.role, typography)
    }

    if (activeEditKey === 'question') {
      updateSlide({ questionFormat: fmt })
      syncDirectionHtml(question.questionText || '', fmt)
      return
    }
    if (activeEditKey === 'subtitle') {
      updateSlide({ subtitleFormat: fmt })
      return
    }
    if (activeEditKey === 'choice' && activeChoiceIdx !== null) {
      const choices = [...(question.choices || [])]
      if (!choices[activeChoiceIdx]) return
      choices[activeChoiceIdx] = { ...choices[activeChoiceIdx], format: fmt }
      updateSlide({ choices })
      syncChoiceHtml(activeChoiceIdx, choices[activeChoiceIdx].text || '', fmt)
    }
  }, [activeEdit, activeEditKey, activeChoiceIdx, question.choices, question.questionText, syncChoiceHtml, syncDirectionHtml, typography, updateSlide])

  const handleChoiceTextChange = useCallback(
    (idx, text) => {
      if (!question.choices?.[idx]) return
      const choices = [...question.choices]
      choices[idx] = { ...choices[idx], text }
      updateSlide({ choices })
    },
    [question.choices, updateSlide],
  )

  const handleChoiceFocus = useCallback((idx) => {
    setActiveEditKey('choice')
    setActiveChoiceIdx(idx)
  }, [])

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
      const lockRatio = e.shiftKey || objects[interaction.index]?.role === 'slidePicture'
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
  const preview = question.layout?.choicePreview
    ? { ...question.layout.choicePreview, sessionId }
    : null

  return (
    <div className="layout-workspace">
      <CanvasFonts sessionId={sessionId} fonts={fonts} />
      <div className="layout-canvas-wrap" ref={containerRef}>
        <div className="canvas-toolbar">
          <span>Canvas {CANVAS_W}×{CANVAS_H}</span>
          <span className="toolbar-hint">
            Bấm trực tiếp vào chữ trên canvas để sửa · định dạng cập nhật ngay
            {question.layout?.typography && (
              <> · Title {question.layout.typography.titleSize}px / Content {question.layout.typography.contentSize}px</>
            )}
          </span>
          {activeEdit && (
            <div className="canvas-format-bar">
              <span className="canvas-format-target">Đang sửa: {activeEdit.label}</span>
              <TextFormatToolbar
                compact
                preserveFocus
                label=""
                role={activeEdit.role}
                format={activeEdit.format}
                showAlign={activeEdit.role === 'title'}
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
              const directionAlign = extractTextAlignFromHtml(obj.html) || 'center'
              const labelAlign = extractTextAlignFromHtml(obj.html) || 'right'

              return (
                <div
                  key={obj.index}
                  className={`canvas-object wysiwyg-object ${obj.role} ${visual?.variant || ''} ${isSelected ? 'selected' : ''} ${hasError ? 'has-error' : ''}`}
                  style={{ left: x, top: y, width: w, height: h, zIndex: zIdx + 1, ...shapeStyle }}
                  onPointerDown={(e) => { e.stopPropagation(); onPointerDown(e, obj.index) }}
                >
                  {obj.image && (obj.role === 'slidePicture' || obj.role === 'image') && (
                    <img
                      src={assetUrl(sessionId, obj.image)}
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
                        ...verticalAlignStyle(visual),
                        ...textPaddingStyle(visual),
                        textAlign: directionAlign,
                        justifyContent: directionAlign === 'left'
                          ? 'flex-start'
                          : directionAlign === 'right'
                            ? 'flex-end'
                            : directionAlign === 'justify'
                              ? 'stretch'
                              : 'center',
                      }}
                    >
                      <CanvasRichText
                        className="direction-editable"
                        value={question.questionText || obj.text || ''}
                        format={question.questionFormat || obj.textFormat}
                        role="title"
                        typography={typography}
                        html={obj.html}
                        editing={activeEditKey === 'question'}
                        placeholder="Nhập tiêu đề / nội dung chính..."
                        onTextChange={(text) => updateSlide({ questionText: text })}
                        onBlur={() => {
                          setActiveEditKey(null)
                          syncDirectionHtml(question.questionText || obj.text || '')
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
                          value={question.subtitleText || obj.text || ''}
                          format={question.subtitleFormat || obj.textFormat}
                          role="content"
                          typography={typography}
                          html={obj.html}
                          editing={activeEditKey === 'subtitle'}
                          placeholder='Gợi ý bắt đầu (vd: Bấm "Start Quiz")...'
                          onTextChange={(text) => updateSlide({ subtitleText: text })}
                          onFocus={() => {
                            setSelectedIndex(obj.index)
                            setActiveEditKey('subtitle')
                            setActiveChoiceIdx(null)
                          }}
                          onEditorMount={registerEditor}
                        />
                      ) : (
                        <ChoicePreview
                          preview={preview}
                          wysiwyg
                          choices={question.choices}
                          typography={typography}
                          editingChoiceIdx={activeEditKey === 'choice' ? activeChoiceIdx : null}
                          onChoiceTextChange={handleChoiceTextChange}
                          onChoiceBlur={(idx, text) => {
                            setActiveEditKey(null)
                            setActiveChoiceIdx(null)
                            syncChoiceHtml(idx, text)
                          }}
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
                        <div className="wordbank-hint">Word bank</div>
                      )}
                    </div>
                  )}

                  {!obj.image && obj.role === 'slidePicture' && (
                    <div className="picture-placeholder">Không có ảnh slide</div>
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

      <div className="layout-side">
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
          overlaps={overlaps.filter((w) => w.a === selectedIndex || w.b === selectedIndex)}
          onChange={(r) => updateObjectRect(selectedIndex, r)}
          onLayerAction={onLayerAction}
        />
      </div>
    </div>
  )
}