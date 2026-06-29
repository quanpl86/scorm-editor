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
  const mountedRef = useRef(false)

  useLayoutEffect(() => {
    const el = ref.current
    if (!el || mountedRef.current) return
    mountedRef.current = true
    onEditorMount?.(el)
    const next = value || ''
    if (el.innerText !== next) {
      el.innerText = next
    }
    applyFormatToElement(el, format, role, typography)
    requestAnimationFrame(() => {
      if (!ref.current) return
      ref.current.focus()
      const range = document.createRange()
      range.selectNodeContents(ref.current)
      range.collapse(false)
      const sel = window.getSelection()
      sel?.removeAllRanges()
      sel?.addRange(range)
    })
  }, [format, onEditorMount, role, typography, value])

  useLayoutEffect(() => {
    if (!mountedRef.current) return
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
        onBlur?.(ref.current?.innerText ?? '')
      }}
      onInput={(e) => onTextChange?.(e.currentTarget.innerText)}
      onPointerDown={(e) => e.stopPropagation()}
      onMouseDown={(e) => e.stopPropagation()}
    />
  )
}