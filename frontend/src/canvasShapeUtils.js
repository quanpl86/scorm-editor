export function gradientCss(gradient) {
  if (!gradient?.stops?.length) return null
  const angle = gradient.angle ?? 90
  const stops = gradient.stops
    .map((s) => `${s.color} ${Math.round((s.pos ?? 0) * 100)}%`)
    .join(', ')
  return `linear-gradient(${angle}deg, ${stops})`
}

export function shapeBoxStyle(visual) {
  if (!visual) return {}
  const style = {
    borderRadius: visual.borderRadius ? `${visual.borderRadius}px` : undefined,
    background: visual.background || 'transparent',
    boxSizing: 'border-box',
  }
  const grad = gradientCss(visual.gradient)
  if (grad) style.background = grad
  if (visual.border?.width) {
    style.border = `${visual.border.width}px solid ${visual.border.color}`
  }
  return style
}

export function textPaddingStyle(visual) {
  const p = visual?.padding
  if (!p) return {}
  return {
    padding: `${p.t ?? 4}px ${p.r ?? 8}px ${p.b ?? 4}px ${p.l ?? 8}px`,
  }
}

export function verticalAlignStyle(visual) {
  const v = visual?.verticalAlign || 'middle'
  if (v === 'top') return { alignItems: 'flex-start' }
  if (v === 'bottom') return { alignItems: 'flex-end' }
  return { alignItems: 'center' }
}