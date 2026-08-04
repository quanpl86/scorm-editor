export const NEW_BLANK_TOKEN = '[ô_trống]'

const BLANK_MARKER_SOURCE = '(?:_{3,}|\\[\\s*(?:ô|o)[_\\s-]*trống(?:[_\\s-]*\\d+)?\\s*\\])'

export function blankMarkerRegex(flags = 'gi') {
  return new RegExp(BLANK_MARKER_SOURCE, flags)
}

export function countBlankMarkers(text) {
  const source = normalizeBlankPrompt(text)
  const matches = [...source.matchAll(blankMarkerRegex())]
  if (!matches.length) return 0
  let count = 1
  for (let index = 1; index < matches.length; index += 1) {
    const previousEnd = matches[index - 1].index + matches[index - 1][0].length
    if (source.slice(previousEnd, matches[index].index).trim()) count += 1
  }
  return count
}

export function blankPromptKey(text) {
  return String(text || '')
    .replace(blankMarkerRegex(), ' <blank> ')
    .replace(/\s+/g, ' ')
    .trim()
    .toLocaleLowerCase('vi')
}

/** Normalize legacy markers and remove repeated prompt lines that only differ
 * by whether the blank is represented as ___ or [ô_trống]. */
export function normalizeBlankPrompt(text) {
  const source = String(text || '').replace(/\r\n?/g, '\n').trim()
  if (!source) return ''
  const seen = new Set()
  const normalized = []
  source.split(/\n+/).map(line => line.trim()).filter(Boolean).forEach(line => {
    const canonical = line.replace(blankMarkerRegex(), NEW_BLANK_TOKEN)
    const key = blankPromptKey(canonical)
    if (!key || seen.has(key)) return
    seen.add(key)
    normalized.push(canonical)
  })
  return normalized.join('\n')
}

export function ensureBlankMarkers(text, count) {
  const source = String(text || '').trim()
  const existing = countBlankMarkers(source)
  const matches = [...source.matchAll(blankMarkerRegex())]
  let cursor = 0
  let previousEnd = null
  const chunks = []
  matches.forEach(match => {
    const between = source.slice(cursor, match.index)
    if (previousEnd === null || source.slice(previousEnd, match.index).trim()) {
      chunks.push(between, NEW_BLANK_TOKEN)
    } else if (between) {
      chunks.push(' ')
    }
    cursor = match.index + match[0].length
    previousEnd = cursor
  })
  chunks.push(source.slice(cursor))
  const normalized = matches.length ? chunks.join('') : source
  if (existing >= count) return normalized
  return `${normalized} ${Array.from({ length: count - existing }, () => NEW_BLANK_TOKEN).join(' ')}`.trim()
}

export function normalizeBlankAnswers(question) {
  const existing = Array.isArray(question?.blankAnswers) ? question.blankAnswers : []
  const normalized = existing.length
    ? existing.map((blank, index) => ({
      ...blank,
      id: blank.id || `qmFillInTheBlank${index}`,
      values: Array.isArray(blank.values)
        ? blank.values
        : (Array.isArray(blank.acceptedAnswers)
          ? blank.acceptedAnswers
          : (Array.isArray(blank.correctAnswers) ? blank.correctAnswers : [])),
    }))
    : [{ id: 'qmFillInTheBlank0', values: [''] }]
  const detected = countBlankMarkers(question?.questionText)
  let lastMeaningful = -1
  normalized.forEach((blank, index) => {
    if ((blank.values || []).some(value => String(value || '').trim())) lastMeaningful = index
  })
  const target = Math.max(1, detected, lastMeaningful + 1)
  if (normalized.length > target) normalized.splice(target)
  while (normalized.length < detected) {
    normalized.push({ id: `qmFillInTheBlank${normalized.length}`, values: [''] })
  }
  return normalized
}

export function splitBlankPrompt(text) {
  return normalizeBlankPrompt(text).split(blankMarkerRegex())
}

export function buildDragCards(question) {
  const blanks = normalizeBlankAnswers(question)
  const correctCards = blanks
    .map((blank, index) => ({
      id: `blank-option-${index}`,
      text: String(blank.values?.[0] || '').trim(),
      blankId: blank.id,
      isDistractor: false,
    }))
    .filter(card => card.text)
  const distractors = question?.blankDistractors || question?.wordBankWords || []
  return [
    ...correctCards,
    ...distractors
      .map((text, index) => ({
        id: `distractor-${index}`,
        text: String(text || '').trim(),
        blankId: null,
        isDistractor: true,
      }))
      .filter(card => card.text),
  ]
}
