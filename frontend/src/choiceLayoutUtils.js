import { CANVAS_H, clampRect } from './layoutUtils'

const CONTENT_ADDITIONAL_GAP = 10

/** Khớp iSpring Slide View: chia đều vùng content, không thêm row-gap */
const SCORM_ROW_GAP = 0

/** Hệ số chiều rộng ký tự — đáp án (bold 18px) */
const CHAR_WIDTH_FACTOR = 0.30
/** Title/question — khớp backend typography (Quicksand 20px justify) */
const TITLE_CHAR_WIDTH_FACTOR = 0.52
const TITLE_LINE_HEIGHT = 1.35
const DIRECTION_MIN_GAP = 12

export function estimateLines(text, fontSize, width, padding = 4, charFactor = CHAR_WIDTH_FACTOR) {
  if (!text) return 1
  const usable = Math.max(60, width - padding)
  const charsPerLine = Math.max(8, Math.floor(usable / (fontSize * charFactor)))
  return Math.max(1, Math.ceil(text.length / charsPerLine))
}

export function estimateTextHeight(text, fontSize, width, padding = 20) {
  const lines = estimateLines(text, fontSize, width, padding)
  return lines * fontSize * TITLE_LINE_HEIGHT + padding
}

/**
 * Chiều cao direction (title) — tính padding shape iSpring + chừa chân chữ.
 */
export function estimateDirectionHeight(questionText, fontSize, dirRect, visual = null) {
  const pad = visual?.padding || { l: 14, r: 16, t: 9, b: 12 }
  const horizontalPad = (pad.l ?? 14) + (pad.r ?? 16)
  const verticalPad = (pad.t ?? 9) + (pad.b ?? 12)
  const usableW = Math.max(80, (dirRect?.w || 520) - horizontalPad)
  const lines = estimateLines(questionText, fontSize, usableW, 0, TITLE_CHAR_WIDTH_FACTOR)
  const textH = lines * fontSize * TITLE_LINE_HEIGHT
  const descenderRoom = 3
  return Math.round(Math.max(40, textH + verticalPad + descenderRoom) * 10) / 10
}

function applyDirectionReflow(objects, {
  questionText = '',
  typography = null,
  questionFormat = null,
  preservePositions = true,
}) {
  const direction = objects.find((o) => o.role === 'direction')
  if (!direction) return { objects, changed: false }

  const titleSize = questionFormat?.fontSize
    || typography?.titleSize
    || direction.textFormat?.fontSize
    || 18

  const neededH = Math.min(
    CANVAS_H * 0.28,
    estimateDirectionHeight(
      questionText || direction.text || '',
      titleSize,
      direction.r,
      direction.visual,
    ),
  )

  const newH = preservePositions
    ? Math.max(direction.r.h, neededH)
    : neededH

  const heightChanged = Math.abs(newH - direction.r.h) > 0.5
  if (!heightChanged) return { objects, changed: false }

  let nextObjects = objects.map((o) =>
    (o.role === 'direction'
      ? { ...o, r: clampRect({ ...o.r, h: newH }) }
      : o),
  )

  const dirBottom = direction.r.y + newH
  const content = nextObjects.find((o) => o.role === 'content')
  if (content) {
    const minContentY = Math.round((dirBottom + DIRECTION_MIN_GAP) * 10) / 10
    if (content.r.y < minContentY - 0.5) {
      const delta = minContentY - content.r.y
      nextObjects = nextObjects.map((o) =>
        (o.role === 'content'
          ? { ...o, r: clampRect({ ...o.r, y: o.r.y + delta }) }
          : o),
      )
    }
  }

  return { objects: nextObjects, changed: true }
}

/** Tự scale textbox shape (Cột A/B…) khi resizeShapeToFitText */
function reflowShapeTextBoxes(objects) {
  let changed = false
  const nextObjects = objects.map((o) => {
    if (o.role !== 'shape' || !o.text?.trim()) return o
    const autofit = o.visual?.autofit === 'resizeShapeToFitText'
    if (!autofit) return o

    const fontSize = o.textFormat?.fontSize || 18
    const neededH = estimateDirectionHeight(o.text, fontSize, o.r, o.visual)
    const neededW = Math.max(
      o.r.w,
      Math.ceil(o.text.length * fontSize * 0.55) + (o.visual?.padding?.l || 10) + (o.visual?.padding?.r || 10),
    )

    const newH = Math.max(o.r.h, neededH)
    const newW = neededW > o.r.w + 0.5 ? neededW : o.r.w
    if (Math.abs(newH - o.r.h) < 0.5 && Math.abs(newW - o.r.w) < 0.5) return o

    changed = true
    return {
      ...o,
      r: clampRect({ ...o.r, h: newH, w: newW }),
    }
  })
  return { objects: nextObjects, changed }
}

function itemFontSize(item, choices, idx, typography) {
  return item?.format?.fontSize
    || choices?.[idx]?.format?.fontSize
    || typography?.contentSize
    || 16
}

/**
 * Mô hình SCORM Slide View: mọi hàng đáp án cùng chiều cao = availH / rows.
 * Chỉ tăng đồng đều khi có text cần nhiều dòng hơn slot hiện tại.
 */
export function computeChoiceMetrics(preview, choices, typography, contentRect) {
  const items = preview?.items || []
  const layout = preview?.layout || {}
  if (!items.length) return null

  const contentPad = layout.contentPadding || { l: 10, r: 10, t: 5, b: 5 }
  const cols = layout.columns ?? 1
  const rowCount = layout.rows ?? Math.ceil(items.length / cols)
  const choicePadding = layout.choicePadding ?? 10
  const radioReserve = 41

  const availH = Math.max(0, (contentRect?.h || 0) - contentPad.t - contentPad.b)
  const contentWidth = layout.contentWidth
    ?? Math.max(120, (contentRect?.w || 300) - contentPad.l - contentPad.r)
  const colWidth = contentWidth / cols

  const scormRowHeight = layout.rowHeight
    ?? (rowCount > 0 && availH > 0
      ? Math.round((availH / rowCount) * 100) / 100
      : 46)

  let uniformRowHeight = scormRowHeight

  let maxLinesNeeded = 1
  let maxFontSize = typography?.contentSize || 16
  items.forEach((item, i) => {
    const text = item.text || choices?.[i]?.text || ''
    const fontSize = itemFontSize(item, choices, i, typography)
    maxFontSize = Math.max(maxFontSize, fontSize)
    const lines = estimateLines(text, fontSize, colWidth - radioReserve)
    maxLinesNeeded = Math.max(maxLinesNeeded, lines)
  })

  // iSpring căn giữa theo chiều dọc trong cả hàng — text dùng gần hết chiều cao hàng
  const innerRow = uniformRowHeight
  const lineHeight = 1.28
  const linesFitInRow = Math.max(
    1,
    Math.floor(innerRow / (maxFontSize * lineHeight)),
  )

  if (maxLinesNeeded > linesFitInRow) {
    uniformRowHeight = Math.round(
      (uniformRowHeight * maxLinesNeeded / linesFitInRow) * 100,
    ) / 100
  }

  const rowHeights = items.map(() => uniformRowHeight)
  const gridRowHeights = Array.from({ length: rowCount }, () => uniformRowHeight)
  const stackHeight = rowCount * uniformRowHeight
  const contentHeight = Math.round((stackHeight + contentPad.t + contentPad.b) * 100) / 100
  const originalContentH = contentRect?.h || 0

  return {
    rowHeight: uniformRowHeight,
    rowHeights,
    gridRowHeights,
    rows: rowCount,
    columns: cols,
    rowGap: SCORM_ROW_GAP,
    stackHeight,
    contentHeight,
    contentPad,
    needsExpansion: contentHeight > originalContentH + 0.5,
    overflow: maxLinesNeeded > linesFitInRow,
  }
}

export function computeMatchingMetrics(preview, typography, contentRect) {
  const pairs = preview?.pairs || []
  const layout = preview?.layout || {}
  if (!pairs.length) return null

  const contentPad = layout.contentPadding || { l: 10, r: 10, t: 5, b: 5 }
  const rowCount = pairs.length
  const choicePadding = layout.choicePadding ?? 16
  const rowGap = layout.rowGap ?? 12
  const portReserve = 40

  const availH = Math.max(0, (contentRect?.h || 0) - contentPad.t - contentPad.b)
  const contentWidth = layout.contentWidth
    ?? Math.max(120, (contentRect?.w || 300) - contentPad.l - contentPad.r)
  const colWidth = layout.premiseWidth || layout.responseWidth || (contentWidth - 24) / 2

  let uniformRowHeight = layout.rowHeight
    ?? (rowCount > 0 && availH > 0
      ? Math.round(((availH - Math.max(0, rowCount - 1) * rowGap) / rowCount) * 100) / 100
      : 52)

  let maxLinesNeeded = 1
  let maxFontSize = typography?.contentSize || 18
  pairs.forEach((pair) => {
    ;['leftText', 'rightText'].forEach((key) => {
      const text = pair[key] || ''
      const fmtKey = key === 'leftText' ? 'leftFormat' : 'rightFormat'
      const fontSize = pair[fmtKey]?.fontSize || maxFontSize
      maxFontSize = Math.max(maxFontSize, fontSize)
      const lines = estimateLines(text, fontSize, colWidth - portReserve - choicePadding * 2)
      maxLinesNeeded = Math.max(maxLinesNeeded, lines)
    })
  })

  const lineHeight = 1.28
  const linesFitInRow = Math.max(1, Math.floor(uniformRowHeight / (maxFontSize * lineHeight)))

  if (maxLinesNeeded > linesFitInRow) {
    uniformRowHeight = Math.round(
      (uniformRowHeight * maxLinesNeeded / linesFitInRow) * 100,
    ) / 100
  }

  const stackHeight = rowCount * uniformRowHeight + Math.max(0, rowCount - 1) * rowGap
  const contentHeight = Math.round((stackHeight + contentPad.t + contentPad.b) * 100) / 100
  const originalContentH = contentRect?.h || 0

  return {
    rowHeight: uniformRowHeight,
    rows: rowCount,
    columns: 2,
    rowGap,
    columnGap: layout.columnGap ?? 64,
    premiseWidth: layout.premiseWidth,
    responseWidth: layout.responseWidth,
    stackHeight,
    contentHeight,
    contentPad,
    needsExpansion: contentHeight > originalContentH + 0.5,
  }
}

/**
 * Reflow giữ vị trí SCORM gốc; chỉ mở rộng content.h khi text tràn.
 */
export function reflowSlideLayout(objects, {
  questionText = '',
  choices = [],
  choicePreview = null,
  typography = null,
  questionFormat = null,
  preservePositions = true,
}) {
  if (!objects?.length) {
    return { objects, choicePreview, changed: false }
  }

  const dirReflow = applyDirectionReflow(objects, {
    questionText,
    typography,
    questionFormat,
    preservePositions,
  })
  let workingObjects = dirReflow.objects
  let layoutChanged = dirReflow.changed

  const shapeReflow = reflowShapeTextBoxes(workingObjects)
  workingObjects = shapeReflow.objects
  layoutChanged = layoutChanged || shapeReflow.changed

  const isMatching = choicePreview?.type === 'Matching' && choicePreview?.pairs?.length
  const hasChoices = choicePreview?.items?.length

  if (!hasChoices && !isMatching) {
    return { objects: workingObjects, choicePreview, changed: layoutChanged }
  }

  const content = workingObjects.find((o) => o.role === 'content')
  if (!content) {
    return { objects: workingObjects, choicePreview, changed: layoutChanged }
  }

  const metrics = isMatching
    ? computeMatchingMetrics(choicePreview, typography, content.r)
    : computeChoiceMetrics(choicePreview, choices, typography, content.r)
  if (!metrics) {
    return { objects: workingObjects, choicePreview, changed: layoutChanged }
  }

  const updatedPreview = {
    ...choicePreview,
    layout: {
      ...choicePreview.layout,
      rowHeight: metrics.rowHeight,
      ...(metrics.rowHeights ? { rowHeights: metrics.rowHeights } : {}),
      ...(metrics.gridRowHeights ? { gridRowHeights: metrics.gridRowHeights } : {}),
      rows: metrics.rows,
      columns: metrics.columns,
      rowGap: metrics.rowGap,
      columnGap: metrics.columnGap,
      premiseWidth: metrics.premiseWidth,
      responseWidth: metrics.responseWidth,
    },
  }

  const previewChanged = JSON.stringify(choicePreview.layout)
    !== JSON.stringify(updatedPreview.layout)

  if (preservePositions && !metrics.needsExpansion) {
    return {
      objects: workingObjects,
      choicePreview: updatedPreview,
      changed: layoutChanged || previewChanged,
    }
  }

  const originalContent = { ...content.r }
  const contentH = Math.max(originalContent.h, metrics.contentHeight)

  let nextObjects = workingObjects.map((o) => {
    if (o.role === 'content') {
      return {
        ...o,
        r: clampRect({
          ...o.r,
          y: preservePositions ? originalContent.y : o.r.y,
          h: contentH,
        }),
      }
    }
    return o
  })

  if (!preservePositions) {
    const direction = nextObjects.find((o) => o.role === 'direction')
    const contentY = direction
      ? Math.round((direction.r.y + direction.r.h + DIRECTION_MIN_GAP) * 10) / 10
      : originalContent.y

    nextObjects = nextObjects.map((o) => {
      if (o.role === 'content') {
        return { ...o, r: clampRect({ ...o.r, y: contentY, h: contentH }) }
      }
      return o
    })
  }

  const contentObj = nextObjects.find((o) => o.role === 'content')
  const contentBottom = contentObj.r.y + contentObj.r.h

  nextObjects = nextObjects.map((o) => {
    if (o.role === 'additionalContent') {
      const newY = contentBottom + CONTENT_ADDITIONAL_GAP
      if (Math.abs(o.r.y - newY) < 0.5) return o
      return { ...o, r: clampRect({ ...o.r, y: newY }) }
    }
    return o
  })

  const objectsChanged = JSON.stringify(workingObjects) !== JSON.stringify(nextObjects)

  return {
    objects: nextObjects,
    choicePreview: updatedPreview,
    changed: layoutChanged || previewChanged || objectsChanged,
  }
}