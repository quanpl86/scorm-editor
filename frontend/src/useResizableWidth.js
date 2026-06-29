import { useCallback, useEffect, useState } from 'react'

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value))
}

function readStoredWidth(storageKey, defaultWidth, min, max) {
  try {
    const raw = localStorage.getItem(storageKey)
    if (raw) {
      const parsed = Number(raw)
      if (!Number.isNaN(parsed)) return clamp(parsed, min, max)
    }
  } catch {
    /* ignore */
  }
  return defaultWidth
}

/**
 * @param {'expand-right' | 'expand-left'} direction
 * expand-right: kéo sang phải → panel rộng hơn (sidebar trái)
 * expand-left: kéo sang trái → panel rộng hơn (panel phải)
 */
export function useResizableWidth(storageKey, defaultWidth, { min = 200, max = 520 } = {}) {
  const [width, setWidth] = useState(() => readStoredWidth(storageKey, defaultWidth, min, max))

  useEffect(() => {
    try {
      localStorage.setItem(storageKey, String(width))
    } catch {
      /* ignore */
    }
  }, [storageKey, width])

  const onPointerDown = useCallback((event, direction) => {
    event.preventDefault()
    event.stopPropagation()

    const startX = event.clientX
    const startWidth = width
    const handle = event.currentTarget
    handle.setPointerCapture?.(event.pointerId)
    handle.classList.add('is-active')
    document.body.classList.add('is-panel-resizing')

    const onMove = (e) => {
      const delta = e.clientX - startX
      const next = direction === 'expand-right'
        ? startWidth + delta
        : startWidth - delta
      setWidth(clamp(next, min, max))
    }

    const onUp = (e) => {
      handle.releasePointerCapture?.(e.pointerId)
      handle.classList.remove('is-active')
      document.body.classList.remove('is-panel-resizing')
      window.removeEventListener('pointermove', onMove)
      window.removeEventListener('pointerup', onUp)
      window.removeEventListener('pointercancel', onUp)
    }

    window.addEventListener('pointermove', onMove)
    window.addEventListener('pointerup', onUp)
    window.addEventListener('pointercancel', onUp)
  }, [width, min, max])

  return { width, onPointerDown }
}