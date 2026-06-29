import { useEffect } from 'react'
import { packageResUrl } from './api'

function uniqueFaces(fonts) {
  const seen = new Set()
  const out = []
  for (const face of [...(fonts?.faces || []), ...(fonts?.aliases || [])]) {
    if (!face?.family || !face?.path || seen.has(face.family)) continue
    seen.add(face.family)
    out.push(face)
  }
  return out
}

function fontsCacheKey(sessionId, fonts) {
  const faces = uniqueFaces(fonts)
  return `${sessionId}:${faces.map((f) => `${f.family}|${f.path}|${f.weight || 400}`).join(';')}`
}

export default function CanvasFonts({ sessionId, fonts }) {
  const cacheKey = fontsCacheKey(sessionId, fonts)

  useEffect(() => {
    if (!sessionId) return undefined
    const style = document.createElement('style')
    style.setAttribute('data-canvas-fonts', cacheKey)

    const google = `
@import url('https://fonts.googleapis.com/css2?family=Quicksand:wght@400;500;600;700&display=swap');
`

    const faces = uniqueFaces(fonts)
    const embedded = faces.length
      ? faces
        .map(
          ({ family, path, weight }) => `
@font-face {
  font-family: ${family};
  src: url('${packageResUrl(sessionId, path)}') format('woff');
  font-weight: ${weight || 400};
  font-style: normal;
  font-display: swap;
}
`,
        )
        .join('\n')
      : `
@font-face {
  font-family: fnt6_24031;
  src: local('Quicksand SemiBold'), local('Quicksand');
  font-weight: 700;
  font-style: normal;
}
@font-face {
  font-family: fnt5_24031;
  src: local('Quicksand Medium'), local('Quicksand');
  font-weight: 500;
  font-style: normal;
}
`

    style.textContent = google + embedded
    document.head.appendChild(style)
    return () => style.remove()
  }, [sessionId, cacheKey])

  return null
}