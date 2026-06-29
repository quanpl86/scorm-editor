const BLANK_SPAN_RE = /<span\s+id="qm(?:WordBank|FillInTheBlank)\d+"[^>]*>\s*<\/span>/gi

export function injectBlankSlots(html, kind = 'fillin') {
  if (!html) return ''
  return html.replace(BLANK_SPAN_RE, () => {
    const cls = kind === 'wordbank' ? 'wordbank-blank' : 'fib-blank'
    return `<span class="blank-slot ${cls}" contenteditable="false">&nbsp;</span>`
  })
}