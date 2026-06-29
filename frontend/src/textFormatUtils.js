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
    fontFamily: null,
    bold: role === 'title',
    italic: false,
    underline: false,
    color: '#000000',
    align: role === 'title' ? 'center' : 'left',
  }
}

export function mergeFormat(base, patch, role = 'content') {
  return { ...defaultFormat(role), ...(base || {}), ...(patch || {}) }
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

function isBoldWeight(value) {
  if (!value) return false
  const v = String(value).trim().toLowerCase()
  if (v === 'bold' || v === 'bolder') return true
  const n = parseInt(v, 10)
  return !Number.isNaN(n) && n >= 600
}

/** Trích xuất định dạng từ HTML iSpring (inline style + thẻ cơ bản) */
export function extractFormatFromHtml(htmlText, role = 'content') {
  const fmt = defaultFormat(role)
  if (!htmlText) return fmt

  const align = extractTextAlignFromHtml(htmlText)
  if (align) fmt.align = align

  const sizeMatch = htmlText.match(/font-size:\s*(\d+)px/i)
  if (sizeMatch) fmt.fontSize = Number(sizeMatch[1])

  const colorMatch = htmlText.match(/color:\s*(#[0-9a-fA-F]{3,6})/i)
  if (colorMatch) fmt.color = colorMatch[1]

  const fontFamily = extractFontFamilyFromHtml(htmlText)
  if (fontFamily) fmt.fontFamily = fontFamily

  const weightMatch = htmlText.match(/font-weight:\s*([^;"']+)/i)
  if (weightMatch) {
    fmt.bold = isBoldWeight(weightMatch[1])
  } else if (/<(?:b|strong)\b/i.test(htmlText)) {
    fmt.bold = true
  }

  if (/font-style:\s*italic/i.test(htmlText) || /<(?:i|em)\b/i.test(htmlText)) {
    fmt.italic = true
  }

  const decoMatch = htmlText.match(/text-decoration(?:-line)?:\s*([^;"']+)/i)
  if (decoMatch?.[1]?.includes('underline') || /<u\b/i.test(htmlText)) {
    fmt.underline = true
  }

  return fmt
}

/** Gộp format slide + object + HTML gốc — ưu tiên format đã lưu, HTML bổ sung thiếu sót */
export function resolveCanvasTextFormat(slideFormat, objFormat, html, role = 'content') {
  const fromHtml = extractFormatFromHtml(html, role)
  const stored = { ...(objFormat || {}), ...(slideFormat || {}) }
  return mergeFormat(fromHtml, stored, role)
}

export function buildStyledHtml(text, role = 'content', format = null, typography = null, sourceHtml = null) {
  const fmt = mergeFormat(format, {}, role)
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