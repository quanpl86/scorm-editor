export const TITLE_SIZES = [14, 16, 18, 20, 22, 24]
export const CONTENT_SIZES = [12, 14, 16, 18, 20]

export const COLOR_PRESETS = [
  '#000000',
  '#1e293b',
  '#334155',
  '#dc2626',
  '#ea580c',
  '#ca8a04',
  '#16a34a',
  '#2563eb',
  '#7c3aed',
  '#db2777',
]

export function defaultFormat(role = 'content') {
  return {
    fontSize: null,
    bold: role === 'title',
    italic: false,
    underline: false,
    color: '#000000',
    align: role === 'title' ? 'center' : 'left',
  }
}

export function mergeFormat(base, patch) {
  return { ...defaultFormat(), ...base, ...patch }
}

export function stripPlainFromHtml(htmlText) {
  if (!htmlText) return ''
  return htmlText
    .replace(/<br\s*\/?>/gi, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/gi, ' ')
    .replace(/\u200b/g, '')
    .replace(/\s+/g, ' ')
    .trim()
}

export function extractFontFamilyFromHtml(htmlText) {
  if (!htmlText) return null
  const match = htmlText.match(/font-family:\s*([^;"']+)/i)
  return match ? match[1].trim() : null
}

export function extractTextAlignFromHtml(htmlText) {
  if (!htmlText) return null
  const match = htmlText.match(/text-align:\s*(left|center|right|justify)/i)
  return match ? match[1].toLowerCase() : null
}

/** Chuyển HTML iSpring sang plain text giữ xuống dòng cho contentEditable */
export function htmlToEditableText(html, fallback = '') {
  if (!html) return fallback || ''
  let text = html
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/p>\s*<p[^>]*>/gi, '\n')
    .replace(/<\/div>\s*<div[^>]*>/gi, '\n')
  text = text.replace(/<[^>]+>/g, '')
  text = text
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/\u200b/g, '')
  const plain = text.replace(/\n{3,}/g, '\n\n').trim()
  return plain || fallback || ''
}

/** Gộp format slide + object + HTML gốc để không mất căn lề/cỡ chữ khi bấm sửa */
export function resolveCanvasTextFormat(slideFormat, objFormat, html, role = 'content') {
  const base = mergeFormat(slideFormat || objFormat, defaultFormat(role))
  const align = slideFormat?.align || extractTextAlignFromHtml(html) || base.align
  const next = { ...base, align }
  if (!next.fontSize && html) {
    const sizeMatch = html.match(/font-size:\s*(\d+)px/i)
    if (sizeMatch) next.fontSize = Number(sizeMatch[1])
  }
  if (html && (!slideFormat?.color || slideFormat.color === '#000000')) {
    const colorMatch = html.match(/color:\s*(#[0-9a-fA-F]{3,6})/i)
    if (colorMatch) next.color = colorMatch[1]
  }
  return next
}

export function buildStyledHtml(text, role = 'content', format = null, typography = null, sourceHtml = null) {
  const fmt = mergeFormat(format, defaultFormat(role))
  const plain = (text || '').trim()
  if (!plain) return ''

  const autoSize = role === 'title'
    ? (typography?.titleSize || 18)
    : (typography?.contentSize || 16)
  const size = fmt.fontSize || autoSize
  const font = fmt?.fontFamily
    || extractFontFamilyFromHtml(sourceHtml)
    || (role === 'title' ? 'fnt6_24031' : 'fnt5_24031')
  const align = fmt.align || (role === 'title' ? 'center' : 'left')
  const weight = fmt.bold || role === 'title' ? 'bold' : 'normal'
  const style = fmt.italic ? 'italic' : 'normal'
  const deco = fmt.underline ? 'underline' : 'none'
  const color = fmt.color || '#000000'
  const escaped = plain
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/\n/g, '<br>')

  return `<p style="text-align:${align};font-size:${size}px;font-family:${font};color:${color};font-weight:${weight};font-style:${style};text-decoration:${deco};margin:0;line-height:1.35"><span style="color:${color};font-size:${size}px;font-family:${font};font-weight:${weight};font-style:${style};text-decoration:${deco}">${escaped}</span></p>`
}

export function formatLabel(fmt) {
  const parts = []
  if (fmt?.fontSize) parts.push(`${fmt.fontSize}px`)
  else parts.push('Auto')
  if (fmt?.bold) parts.push('B')
  if (fmt?.italic) parts.push('I')
  if (fmt?.underline) parts.push('U')
  if (fmt?.color && fmt.color !== '#000000') parts.push(fmt.color)
  return parts.join(' · ')
}