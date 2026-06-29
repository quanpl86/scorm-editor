export const CANVAS_W = 720
export const CANVAS_H = 540

export const HANDLES = ['nw', 'n', 'ne', 'e', 'se', 's', 'sw', 'w']

export const ROLE_COLORS = {
  direction: { fill: 'rgba(59, 130, 246, 0.12)', stroke: '#3b82f6', label: '#2563eb' },
  content: { fill: 'rgba(34, 197, 94, 0.1)', stroke: '#22c55e', label: '#16a34a' },
  additionalContent: { fill: 'rgba(14, 165, 233, 0.1)', stroke: '#0ea5e9', label: '#0284c7' },
  slidePicture: { fill: 'rgba(168, 85, 247, 0.08)', stroke: '#a855f7', label: '#9333ea' },
  image: { fill: 'rgba(236, 72, 153, 0.08)', stroke: '#ec4899', label: '#db2777' },
  shape: { fill: 'rgba(148, 163, 184, 0.1)', stroke: '#94a3b8', label: '#64748b' },
}

export function clampRect(r) {
  return {
    x: Math.round(r.x * 10) / 10,
    y: Math.round(r.y * 10) / 10,
    w: Math.max(8, Math.round(r.w * 10) / 10),
    h: Math.max(8, Math.round(r.h * 10) / 10),
  }
}

export function rectsOverlap(a, b) {
  return !(a.x + a.w <= b.x || b.x + b.w <= a.x || a.y + a.h <= b.y || b.y + b.h <= a.y)
}

export function detectOverlapsLocal(objects) {
  const warnings = []
  const key = (o) => o.role
  const important = objects.filter((o) => ['slidePicture', 'image', 'content', 'direction'].includes(o.role))

  for (let i = 0; i < important.length; i++) {
    for (let j = i + 1; j < important.length; j++) {
      const a = important[i]
      const b = important[j]
      if (rectsOverlap(a.r, b.r)) {
        const severity =
          (a.role === 'content' && (b.role === 'slidePicture' || b.role === 'image')) ||
          (b.role === 'content' && (a.role === 'slidePicture' || a.role === 'image'))
            ? 'error'
            : 'warning'
        warnings.push({ a: a.index, b: b.index, aName: a.name, bName: b.name, severity })
      }
    }
  }
  return warnings
}

export function applyResize(r, handle, dx, dy, lockRatio = false) {
  let { x, y, w, h } = { ...r }
  const min = 8

  if (handle.includes('e')) w = Math.max(min, w + dx)
  if (handle.includes('w')) {
    w = Math.max(min, w - dx)
    x = r.x + (r.w - w)
  }
  if (handle.includes('s')) h = Math.max(min, h + dy)
  if (handle.includes('n')) {
    h = Math.max(min, h - dy)
    y = r.y + (r.h - h)
  }

  if (lockRatio && r.w && r.h) {
    const ratio = r.w / r.h
    if (handle === 'e' || handle === 'w') h = w / ratio
    else if (handle === 'n' || handle === 's') w = h * ratio
    else {
      w = Math.max(w, h * ratio)
      h = w / ratio
    }
  }

  return clampRect({ x, y, w, h })
}

export function hitTest(objects, cx, cy) {
  for (let i = objects.length - 1; i >= 0; i--) {
    const o = objects[i]
    if (!o.selectable) continue
    const { x, y, w, h } = o.r
    if (cx >= x && cx <= x + w && cy >= y && cy <= y + h) return o.index
  }
  return null
}

export function getHandleAt(r, cx, cy, scale, threshold = 8) {
  const t = threshold / scale
  const pts = {
    nw: [r.x, r.y],
    n: [r.x + r.w / 2, r.y],
    ne: [r.x + r.w, r.y],
    e: [r.x + r.w, r.y + r.h / 2],
    se: [r.x + r.w, r.y + r.h],
    s: [r.x + r.w / 2, r.y + r.h],
    sw: [r.x, r.y + r.h],
    w: [r.x, r.y + r.h / 2],
  }
  for (const [name, [hx, hy]] of Object.entries(pts)) {
    if (Math.abs(cx - hx) <= t && Math.abs(cy - hy) <= t) return name
  }
  return null
}