import { defaultFormat, mergeFormat } from './textFormatUtils'

export function formatToCanvasStyle(format, role = 'content', typography = null) {
  const fmt = mergeFormat(format, defaultFormat(role))
  const autoSize = role === 'title'
    ? (typography?.titleSize || 18)
    : (typography?.contentSize || 16)
  const fontWeight = fmt.bold ? 700 : (role === 'title' ? 600 : 500)

  return {
    '--fmt-size': fmt.fontSize ? `${fmt.fontSize}px` : `${autoSize}px`,
    '--fmt-weight': String(fontWeight),
    '--fmt-style': fmt.italic ? 'italic' : 'normal',
    '--fmt-decoration': fmt.underline ? 'underline' : 'none',
    '--fmt-color': fmt.color || '#000000',
    '--fmt-align': fmt.align || (role === 'title' ? 'center' : 'left'),
  }
}

export function applyFormatToElement(el, format, role = 'content', typography = null) {
  if (!el) return
  const vars = formatToCanvasStyle(format, role, typography)
  Object.entries(vars).forEach(([key, value]) => {
    el.style.setProperty(key, value)
  })
}