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
  const previewHtml = html || buildStyledHtml(value, role, format, typography, html)
  const handleActivate = onActivate || onFocus

  return (
    <div className={`canvas-rich-text ${className}`.trim()}>
      {!editing && previewHtml && (
        <div
          className="ispring-html fidelity-html canvas-text-preview"
          dangerouslySetInnerHTML={{ __html: previewHtml }}
          onMouseDown={(e) => {
            e.preventDefault()
            e.stopPropagation()
            handleActivate?.()
          }}
        />
      )}
      {editing && (
        <CanvasEditableText
          className="rich-text-editor"
          value={value}
          format={format}
          role={role}
          typography={typography}
          placeholder={placeholder}
          onTextChange={onTextChange}
          onFocus={onFocus}
          onBlur={onBlur}
          onEditorMount={onEditorMount}
        />
      )}
    </div>
  )
}