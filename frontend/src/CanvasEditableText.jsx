import { useEffect, useLayoutEffect, useRef } from 'react'
import { applyBaseEditorStyle } from './canvasTextUtils'
import {
  extractPlainTextFromHtml,
  normalizeEditorHtml,
  prepareEditorHtml,
  readEditorPayload,
} from './richTextUtils'

export default function CanvasEditableText({
  value,
  html,
  format,
  role = 'content',
  typography = null,
  rich = true,
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

    if (rich) {
      el.innerHTML = prepareEditorHtml(html, value, format, role, typography)
    } else if (el.innerText !== (value || '')) {
      el.innerText = value || ''
    }

    applyBaseEditorStyle(el, format, role, typography)

    requestAnimationFrame(() => {
      if (!ref.current) return
      const node = ref.current
      node.scrollTop = 0
      node.focus({ preventScroll: true })
      const range = document.createRange()
      const startNode = node.firstChild || node
      const startOffset = startNode.nodeType === Node.TEXT_NODE ? 0 : 0
      try {
        range.setStart(startNode, startOffset)
        range.collapse(true)
      } catch {
        range.selectNodeContents(node)
        range.collapse(true)
      }
      const sel = window.getSelection()
      sel?.removeAllRanges()
      sel?.addRange(range)
      node.scrollTop = 0
      requestAnimationFrame(() => {
        if (ref.current) ref.current.scrollTop = 0
      })
    })
  // eslint-disable-next-line react-hooks/exhaustive-deps -- chỉ khởi tạo khi mount editor
  }, [])

  useLayoutEffect(() => {
    if (!mountedRef.current || !ref.current) return
    applyBaseEditorStyle(ref.current, format, role, typography)
  }, [format, role, typography])

  useEffect(() => {
    if (focusedRef.current || !ref.current || rich) return
    const next = value || ''
    if (ref.current.innerText !== next) {
      ref.current.innerText = next
    }
  }, [rich, value])

  const emitChange = () => {
    if (!ref.current) return
    if (rich) {
      onTextChange?.(readEditorPayload(ref.current))
      return
    }
    onTextChange?.(ref.current.innerText)
  }

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
        if (rich) {
          onBlur?.(readEditorPayload(ref.current))
        } else {
          onBlur?.(ref.current?.innerText ?? '')
        }
      }}
      onInput={emitChange}
      onPointerDown={(e) => e.stopPropagation()}
      onMouseDown={(e) => e.stopPropagation()}
    />
  )
}