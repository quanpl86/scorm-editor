import { buildStyledHtml, extractTextAlignFromHtml, mergeFormat } from './textFormatUtils'

export function extractPlainTextFromHtml(html) {
  if (!html) return ''
  const div = document.createElement('div')
  div.innerHTML = html
  return (div.textContent || div.innerText || '').replace(/\u200b/g, '').trim()
}

export function normalizeEditorHtml(html) {
  if (!html?.trim()) return '<p><br></p>'

  let out = html
    .replace(/<script[\s\S]*?<\/script>/gi, '')
    .replace(/<style[\s\S]*?<\/style>/gi, '')

  out = out
    .replace(/<font([^>]*)>/gi, (_, attrs) => {
      const color = attrs.match(/color=["']?([^"'\s>]+)/i)
      const size = attrs.match(/size=["']?(\d+)/i)
      let style = ''
      if (color) style += `color:${color[1]};`
      if (size) style += `font-size:${size}px;`
      return style ? `<span style="${style}">` : '<span>'
    })
    .replace(/<\/font>/gi, '</span>')

  if (!/<(?:p|div|h[1-6]|ul|ol|li)\b/i.test(out)) {
    out = `<p style="margin:0;line-height:1.35">${out}</p>`
  }

  return out
}

export function prepareEditorHtml(html, fallbackText, format, role, typography) {
  if (html?.trim() && extractPlainTextFromHtml(html)) {
    return normalizeEditorHtml(html)
  }
  const built = buildStyledHtml(fallbackText || '', role, format, typography, html)
  return built || '<p><br></p>'
}

export function normalizeStoredHtml(html, format, role, typography) {
  const cleaned = normalizeEditorHtml(html)
  const plain = extractPlainTextFromHtml(cleaned)
  if (!plain) return ''

  const fmt = mergeFormat(format, {}, role)
  const div = document.createElement('div')
  div.innerHTML = cleaned

  const blocks = div.querySelectorAll('p, div')
  if (blocks.length) {
    blocks.forEach((block) => {
      if (fmt.align) block.style.textAlign = fmt.align
      if (!block.style.margin) block.style.margin = '0'
      if (!block.style.lineHeight) block.style.lineHeight = '1.35'
    })
    return div.innerHTML
  }

  return cleaned
}

export function selectAllContents(el) {
  const range = document.createRange()
  range.selectNodeContents(el)
  const sel = window.getSelection()
  sel?.removeAllRanges()
  sel?.addRange(range)
}

export function diffFormat(prev, next) {
  const delta = {}
  if (!next) return delta
  const keys = ['bold', 'italic', 'underline', 'color', 'fontSize', 'align']
  keys.forEach((key) => {
    if (!prev || prev[key] !== next[key]) delta[key] = next[key]
  })
  return delta
}

function cssColorToHex(color) {
  if (!color) return null
  const c = color.trim().toLowerCase()
  if (c.startsWith('#')) {
    if (c.length === 4) {
      return `#${c[1]}${c[1]}${c[2]}${c[2]}${c[3]}${c[3]}`
    }
    return c
  }
  const rgb = c.match(/rgba?\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)/)
  if (rgb) {
    const hex = (n) => parseInt(n, 10).toString(16).padStart(2, '0')
    return `#${hex(rgb[1])}${hex(rgb[2])}${hex(rgb[3])}`
  }
  return null
}

function applyStyleToSelection(style) {
  const sel = window.getSelection()
  if (!sel || sel.rangeCount === 0) return false
  const range = sel.getRangeAt(0)
  if (range.collapsed) return false

  const span = document.createElement('span')
  Object.entries(style).forEach(([key, value]) => {
    if (value != null) span.style[key] = value
  })

  try {
    range.surroundContents(span)
  } catch {
    const fragment = range.extractContents()
    span.appendChild(fragment)
    range.insertNode(span)
  }

  sel.removeAllRanges()
  const newRange = document.createRange()
  newRange.selectNodeContents(span)
  newRange.collapse(false)
  sel.addRange(newRange)
  return true
}

export function applyFormatPatch(el, patch, role, typography) {
  if (!el || !patch || Object.keys(patch).length === 0) return false

  el.focus()
  const sel = window.getSelection()
  const collapsed = !sel || sel.rangeCount === 0 || sel.isCollapsed

  document.execCommand('styleWithCSS', false, true)

  if ('align' in patch) {
    const cmdMap = {
      left: 'justifyLeft',
      center: 'justifyCenter',
      right: 'justifyRight',
      justify: 'justifyFull',
    }
    const cmd = cmdMap[patch.align]
    if (cmd) document.execCommand(cmd, false, null)
    el.style.textAlign = patch.align
    el.style.setProperty('--fmt-align', patch.align)
    return true
  }

  const hadCollapsed = collapsed
  if (collapsed) selectAllContents(el)

  if ('bold' in patch) {
    const isBold = document.queryCommandState('bold')
    if (!!patch.bold !== isBold) document.execCommand('bold', false, null)
  }

  if ('italic' in patch) {
    const isItalic = document.queryCommandState('italic')
    if (!!patch.italic !== isItalic) document.execCommand('italic', false, null)
  }

  if ('underline' in patch) {
    const isUnderline = document.queryCommandState('underline')
    if (!!patch.underline !== isUnderline) document.execCommand('underline', false, null)
  }

  if ('color' in patch) {
    document.execCommand('foreColor', false, patch.color)
  }

  if ('fontSize' in patch) {
    const autoSize = role === 'title'
      ? (typography?.titleSize || 18)
      : (typography?.contentSize || 16)
    const size = patch.fontSize ? `${patch.fontSize}px` : `${autoSize}px`
    applyStyleToSelection({ fontSize: size })
  }

  if (hadCollapsed) sel?.collapseToEnd()
  return true
}

export function readFormatFromEditor(el, baseFormat, role, typography) {
  const fmt = mergeFormat(baseFormat, {}, role)
  if (!el) return fmt

  document.execCommand('styleWithCSS', false, true)
  fmt.bold = document.queryCommandState('bold')
  fmt.italic = document.queryCommandState('italic')
  fmt.underline = document.queryCommandState('underline')

  const foreColor = document.queryCommandValue('foreColor')
  const hex = cssColorToHex(foreColor)
  if (hex) fmt.color = hex

  const sel = window.getSelection()
  if (sel?.rangeCount) {
    let node = sel.anchorNode
    if (node?.nodeType === Node.TEXT_NODE) node = node.parentElement
    if (node) {
      const px = parseInt(window.getComputedStyle(node).fontSize, 10)
      if (!Number.isNaN(px)) fmt.fontSize = px

      let block = node
      while (block && block !== el && !['P', 'DIV'].includes(block.nodeName)) {
        block = block.parentElement
      }
      if (block && block !== el) {
        const align = window.getComputedStyle(block).textAlign
        if (align) fmt.align = align === 'start' ? 'left' : align
      }
    }
  }

  const elAlign = el.style.textAlign || window.getComputedStyle(el).textAlign
  if (elAlign) fmt.align = elAlign === 'start' ? 'left' : elAlign

  const htmlAlign = extractTextAlignFromHtml(el.innerHTML)
  if (htmlAlign) fmt.align = htmlAlign

  return fmt
}

export function readEditorPayload(el) {
  if (!el) return { html: '', text: '' }
  const html = normalizeEditorHtml(el.innerHTML)
  const text = extractPlainTextFromHtml(html)
  return { html, text }
}