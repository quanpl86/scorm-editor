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