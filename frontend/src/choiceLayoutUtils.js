import { CANVAS_H, clampRect } from './layoutUtils'

const CONTENT_ADDITIONAL_GAP = 10

/** Khớp iSpring Slide View: chia đều vùng content, không thêm row-gap */
const SCORM_ROW_GAP = 0

/** Hệ số chiều rộng ký tự — bold 18px Quicksand khớp SCORM player */
const CHAR_WIDTH_FACTOR = 0.30

export function estimateLines(text, fontSize, width, padding = 4) {
  if (!text) return 1
  const usable = Math.max(60, width - padding)
  const charsPerLine = Math.max(8, Math.floor(usable / (fontSize * CHAR_WIDTH_FACTOR)))
  return Math.max(1, Math.ceil(text.length / charsPerLine))
}

export function estimateTextHeight(text, fontSize, width, padding = 20) {
  const lines = estimateLines(text, fontSize, width, padding)
  return lines * fontSize * 1.35 + padding
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

/**
 * Reflow giữ vị trí SCORM gốc; chỉ mở rộng content.h khi text tràn.
 */
export function reflowSlideLayout(objects, {
  questionText = '',
  choices = [],
  choicePreview = null,
  typography = null,
  preservePositions = true,
}) {
  if (!objects?.length || !choicePreview?.items?.length) {
    return { objects, choicePreview, changed: false }
  }

  const content = objects.find((o) => o.role === 'content')
  if (!content) return { objects, choicePreview, changed: false }

  const metrics = computeChoiceMetrics(choicePreview, choices, typography, content.r)
  if (!metrics) return { objects, choicePreview, changed: false }

  const updatedPreview = {
    ...choicePreview,
    layout: {
      ...choicePreview.layout,
      rowHeight: metrics.rowHeight,
      rowHeights: metrics.rowHeights,
      gridRowHeights: metrics.gridRowHeights,
      rows: metrics.rows,
      columns: metrics.columns,
      rowGap: metrics.rowGap,
    },
  }

  const previewChanged = JSON.stringify(choicePreview.layout)
    !== JSON.stringify(updatedPreview.layout)

  if (preservePositions && !metrics.needsExpansion) {
    return {
      objects,
      choicePreview: updatedPreview,
      changed: previewChanged,
    }
  }

  const originalContent = { ...content.r }
  const contentH = Math.max(originalContent.h, metrics.contentHeight)

  let nextObjects = objects.map((o) => {
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
    const direction = objects.find((o) => o.role === 'direction')
    const titleSize = typography?.titleSize || 18
    const dirWidth = direction?.r?.w || 520
    const dirHeight = Math.round(
      Math.max(40, Math.min(
        estimateTextHeight(questionText, titleSize, dirWidth, 18),
        CANVAS_H * 0.28,
      )) * 10,
    ) / 10
    const contentY = direction
      ? Math.round((direction.r.y + dirHeight + 12) * 10) / 10
      : originalContent.y

    nextObjects = nextObjects.map((o) => {
      if (o.role === 'direction') {
        return { ...o, r: clampRect({ ...o.r, h: dirHeight }) }
      }
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

  const objectsChanged = JSON.stringify(objects) !== JSON.stringify(nextObjects)

  return {
    objects: nextObjects,
    choicePreview: updatedPreview,
    changed: previewChanged || objectsChanged,
  }
}