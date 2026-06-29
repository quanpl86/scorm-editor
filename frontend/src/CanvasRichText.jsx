import CanvasEditableText from './CanvasEditableText'
import { buildStyledHtml } from './textFormatUtils'

export default function CanvasRichText({
  value,
  format,
  role = 'content',
  typography = null,
  html,
  editing = false,
  className = '',
  placeholder,
  onTextChange,
  onFocus,
  onBlur,
  onActivate,
  onEditorMount,
}) {
  const previewText = (value || '').trim()
  const previewHtml = html?.trim()
    || (previewText ? buildStyledHtml(previewText, role, format, typography, html) : '')
  const handleActivate = onActivate || onFocus

  const handleTextChange = (payload) => {
    if (typeof payload === 'object' && payload !== null) {
      onTextChange?.(payload.text ?? '')
      return
    }
    onTextChange?.(payload)
  }

  const handleBlur = (payload) => {
    if (typeof payload === 'object' && payload !== null) {
      onBlur?.(payload)
      return
    }
    onBlur?.(payload)
  }

  return (
    <div className={`canvas-rich-text ${editing ? 'is-editing' : ''} ${className}`.trim()}>
      {editing ? (
        <CanvasEditableText
          className="rich-text-editor"
          value={value}
          html={html}
          format={format}
          role={role}
          typography={typography}
          rich
          placeholder={placeholder}
          onTextChange={handleTextChange}
          onFocus={onFocus}
          onBlur={handleBlur}
          onEditorMount={onEditorMount}
        />
      ) : previewHtml ? (
        <div
          className="ispring-html fidelity-html canvas-text-preview"
          dangerouslySetInnerHTML={{ __html: previewHtml }}
          onMouseDown={(e) => {
            e.preventDefault()
            e.stopPropagation()
            handleActivate?.()
          }}
        />
      ) : null}
    </div>
  )
}