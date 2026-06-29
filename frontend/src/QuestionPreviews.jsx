import { assetUrl } from './api'
import CanvasRichText from './CanvasRichText'
import { injectBlankSlots } from './blankHtmlUtils'

function resolveChoiceItem(item, choice, idx) {
  const text = item?.text || choice?.text || ''
  const html = item?.html || choice?.html || ''
  const image = item?.image || choice?.image || null
  const format = item?.format || choice?.format
  return { text, html, image, format, idx }
}

function ChoiceBody({
  item,
  choice,
  idx,
  wysiwyg,
  typography,
  editing,
  onChoiceTextChange,
  onChoiceBlur,
  onChoiceFocus,
  onEditorMount,
}) {
  const { text, html, format } = resolveChoiceItem(item, choice, idx)

  if (editing && wysiwyg && onChoiceTextChange) {
    return (
      <CanvasRichText
        className="truefalse-text"
        value={text}
        format={format}
        role="content"
        typography={typography}
        html={html}
        editing
        placeholder={`Đáp án ${idx + 1}`}
        onTextChange={(next) => onChoiceTextChange(idx, next)}
        onBlur={(payload) => onChoiceBlur?.(idx, payload || { text })}
        onFocus={() => onChoiceFocus?.(idx)}
        onEditorMount={onEditorMount}
      />
    )
  }

  if (html && (text.trim() || /<img\b/i.test(html))) {
    return (
      <div
        className="ispring-html fidelity-html truefalse-text"
        dangerouslySetInnerHTML={{ __html: html }}
        onPointerDown={(e) => {
          e.stopPropagation()
          onChoiceFocus?.(idx)
        }}
      />
    )
  }

  if (text.trim()) {
    return (
      <span
        className="truefalse-text"
        onPointerDown={(e) => {
          e.stopPropagation()
          onChoiceFocus?.(idx)
        }}
      >
        {text}
      </span>
    )
  }

  return null
}

export function TrueFalsePreview({
  preview,
  wysiwyg,
  choices,
  typography,
  sessionId,
  editingChoiceIdx,
  onChoiceTextChange,
  onChoiceBlur,
  onChoiceFocus,
  onEditorMount,
}) {
  const previewItems = preview?.items || []
  const sourceItems = previewItems.length
    ? previewItems
    : (choices || []).map((ch) => ({
        text: ch.text,
        html: ch.html || '',
        format: ch.format,
        image: ch.image,
        isCorrect: ch.isCorrect,
        inputType: 'truefalse',
      }))

  if (!sourceItems.length) return null

  const layout = preview?.layout || {}
  const rowHeight = layout.rowHeight || 52
  const choicePadding = layout.choicePadding ?? 12
  const hasImages = sourceItems.some((item, i) => resolveChoiceItem(item, choices?.[i], i).image)
  const imageOnly = layout.imageOnly
    ?? (hasImages && sourceItems.every((item, i) => !resolveChoiceItem(item, choices?.[i], i).text.trim()))

  const gridStyle = wysiwyg
    ? {
        gridTemplateColumns: 'repeat(2, minmax(0, 1fr))',
        gridTemplateRows: `${rowHeight}px`,
        gap: '0 16px',
        height: '100%',
        alignContent: 'center',
      }
    : undefined

  return (
    <div
      className={`truefalse-preview ${hasImages ? 'has-images' : ''} ${imageOnly ? 'image-only' : ''} ${wysiwyg ? 'wysiwyg fidelity' : ''}`}
      style={gridStyle}
    >
      {sourceItems.map((item, i) => {
        const resolved = resolveChoiceItem(item, choices?.[i], i)
        const editing = editingChoiceIdx === i
        const rowStyle = wysiwyg
          ? { minHeight: rowHeight, padding: choicePadding }
          : undefined

        return (
          <div
            key={i}
            className={`truefalse-choice ${resolved.image ? 'has-image' : ''} ${imageOnly ? 'image-primary' : ''}`}
            style={rowStyle}
          >
            <span className="fake-radio" aria-hidden />
            {resolved.image && (
              <img
                className={`truefalse-icon ${imageOnly ? 'truefalse-image-main' : ''}`}
                src={assetUrl(sessionId, resolved.image)}
                alt=""
                draggable={false}
              />
            )}
            <ChoiceBody
              item={item}
              choice={choices?.[i]}
              idx={i}
              wysiwyg={wysiwyg}
              typography={typography}
              editing={editing}
              onChoiceTextChange={onChoiceTextChange}
              onChoiceBlur={onChoiceBlur}
              onChoiceFocus={onChoiceFocus}
              onEditorMount={onEditorMount}
            />
          </div>
        )
      })}
    </div>
  )
}

export function SequencePreview({
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
  const previewItems = preview?.items || []
  const sourceItems = previewItems.length
    ? previewItems
    : (choices || []).map((ch) => ({
        text: ch.text,
        html: ch.html || '',
        format: ch.format,
        image: ch.image,
        inputType: 'sequence',
      }))

  if (!sourceItems.length) return null

  const layout = preview?.layout || {}
  const rowHeight = layout.rowHeight || 52
  const rowGap = layout.rowGap ?? 8
  const choicePadding = layout.choicePadding ?? 16

  const colStyle = wysiwyg ? { gap: `${rowGap}px` } : undefined

  return (
    <div className={`sequence-preview ${wysiwyg ? 'wysiwyg fidelity' : ''}`} style={colStyle}>
      {sourceItems.map((item, i) => {
        const fmt = item.format || choices?.[i]?.format
        const editing = editingChoiceIdx === i
        const text = item.text || choices?.[i]?.text || ''
        const html = item.html || choices?.[i]?.html || ''
        const rowStyle = wysiwyg
          ? { height: rowHeight, minHeight: rowHeight }
          : undefined
        const cardStyle = wysiwyg
          ? { padding: `${choicePadding}px ${choicePadding + 24}px ${choicePadding}px ${choicePadding}px` }
          : undefined

        return (
          <div key={i} className="sequence-row" style={rowStyle}>
            <span className="sequence-index" aria-hidden>{i + 1}.</span>
            <div className="sequence-item" style={cardStyle}>
              {editing && wysiwyg && onChoiceTextChange ? (
                <CanvasRichText
                  className="sequence-text"
                  value={text}
                  format={fmt}
                  role="content"
                  typography={typography}
                  html={html}
                  editing
                  placeholder={`Dòng ${i + 1}`}
                  onTextChange={(next) => onChoiceTextChange(i, next)}
                  onBlur={(payload) => onChoiceBlur?.(i, payload || { text })}
                  onFocus={() => onChoiceFocus?.(i)}
                  onEditorMount={onEditorMount}
                />
              ) : html && (text.trim() || /<img\b/i.test(html)) ? (
                <div
                  className="ispring-html fidelity-html sequence-text"
                  dangerouslySetInnerHTML={{ __html: html }}
                  onPointerDown={(e) => {
                    e.stopPropagation()
                    onChoiceFocus?.(i)
                  }}
                />
              ) : (
                <span
                  className="sequence-text"
                  onPointerDown={(e) => {
                    e.stopPropagation()
                    onChoiceFocus?.(i)
                  }}
                >
                  {text || `Dòng ${i + 1}`}
                </span>
              )}
              <span className="sequence-drag-handle" aria-hidden />
            </div>
          </div>
        )
      })}
    </div>
  )
}

export function TypeInPreview({ preview, wysiwyg }) {
  const placeholder = preview?.items?.[0]?.placeholder || 'Nhập đáp án...'
  return (
    <div className={`typein-preview ${wysiwyg ? 'wysiwyg fidelity' : ''}`}>
      <div className="typein-field">
        <span className="typein-placeholder">{placeholder}</span>
      </div>
    </div>
  )
}

export function BlankPreview({ preview, wysiwyg }) {
  const html = preview?.richHtml
  if (!html) return null
  const kind = preview?.blankKind || 'fillin'
  const rendered = injectBlankSlots(html, kind)
  const wrapperClass = kind === 'wordbank' ? 'wordbank-preview' : 'fillin-preview'

  return (
    <div className={`${wrapperClass} ${wysiwyg ? 'wysiwyg fidelity' : ''}`}>
      <div
        className="blank-rich-text ispring-html fidelity-html"
        dangerouslySetInnerHTML={{ __html: rendered }}
      />
    </div>
  )
}

export function WordBankChips({ preview, wysiwyg }) {
  const words = preview?.extraWords || []
  if (!words.length) return null

  return (
    <div className={`wordbank-chips ${wysiwyg ? 'wysiwyg fidelity' : ''}`}>
      {words.map((word, i) => (
        <span key={`${word}-${i}`} className="wordbank-chip" draggable={false}>
          {word}
        </span>
      ))}
    </div>
  )
}