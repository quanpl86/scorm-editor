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
  onEditorMount,
}) {
  const previewHtml = html || buildStyledHtml(value, role, format, typography, html)

  return (
    <div className={`canvas-rich-text ${className}`.trim()}>
      {!editing && previewHtml && (
        <div
          className="ispring-html fidelity-html"
          dangerouslySetInnerHTML={{ __html: previewHtml }}
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