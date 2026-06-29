import { useEffect, useLayoutEffect, useRef } from 'react'
import { applyFormatToElement } from './canvasTextUtils'

export default function CanvasEditableText({
  value,
  format,
  role = 'content',
  typography = null,
  className = '',
  placeholder = 'Nhấn để nhập...',
  onTextChange,
  onFocus,
  onBlur,
  onEditorMount,
}) {
  const ref = useRef(null)
  const focusedRef = useRef(false)

  useLayoutEffect(() => {
    onEditorMount?.(ref.current)
  }, [onEditorMount])

  useLayoutEffect(() => {
    applyFormatToElement(ref.current, format, role, typography)
  }, [format, role, typography])

  useEffect(() => {
    if (focusedRef.current || !ref.current) return
    const next = value || ''
    if (ref.current.innerText !== next) {
      ref.current.innerText = next
    }
  }, [value])

  return (
    <div
      ref={ref}
      className={`canvas-editable-text ${className}`.trim()}
      contentEditable
      suppressContentEditableWarning
      data-editable="true"
      data-placeholder={placeholder}
      onFocus={() => {
        focusedRef.current = true
        onEditorMount?.(ref.current)
        onFocus?.()
      }}
      onBlur={() => {
        focusedRef.current = false
        onBlur?.()
      }}
      onInput={(e) => onTextChange?.(e.currentTarget.innerText)}
      onPointerDown={(e) => e.stopPropagation()}
      onMouseDown={(e) => e.stopPropagation()}
    />
  )
}