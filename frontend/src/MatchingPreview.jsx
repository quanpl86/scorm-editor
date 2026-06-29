import { useMemo } from 'react'
import { assetUrl } from './api'

function hashSeed(text = '') {
  let h = 0
  for (let i = 0; i < text.length; i += 1) {
    h = ((h * 31) + text.charCodeAt(i)) >>> 0
  }
  return h
}

function seededShuffle(items, seed) {
  const arr = [...items]
  let state = seed >>> 0
  for (let i = arr.length - 1; i > 0; i -= 1) {
    state = ((state * 1103515245) + 12345) >>> 0
    const j = state % (i + 1)
    ;[arr[i], arr[j]] = [arr[j], arr[i]]
  }
  return arr
}

function MatchingCell({ side, item, sessionId, rowHeight, choicePadding }) {
  const isLeft = side === 'premise'
  const text = item.text
  const html = item.html
  const image = item.image
  const portPad = 40
  const pad = choicePadding ?? 16
  const cellStyle = {
    height: rowHeight,
    minHeight: rowHeight,
    padding: isLeft
      ? `${pad}px ${portPad}px ${pad}px ${pad}px`
      : `${pad}px ${pad}px ${pad}px ${portPad}px`,
  }

  return (
    <div
      className={`matching-cell ${side}`}
      style={cellStyle}
    >
      <span className={`matching-connector ${isLeft ? 'connector-right' : 'connector-left'}`} aria-hidden />
      {image ? (
        <img
          className="matching-item-img"
          src={assetUrl(sessionId, image)}
          alt=""
          draggable={false}
        />
      ) : html && (text?.trim() || /<img\b/i.test(html)) ? (
        <div
          className="matching-item-text ispring-html fidelity-html"
          dangerouslySetInnerHTML={{ __html: html }}
        />
      ) : (
        <span className="matching-item-text">{text?.trim() || '—'}</span>
      )}
    </div>
  )
}

export default function MatchingPreview({ preview, wysiwyg, sessionId }) {
  const pairs = preview?.pairs || []
  if (!pairs.length) return null

  const layout = preview?.layout || {}
  const rowHeight = layout.rowHeight || 52
  const rowGap = layout.rowGap ?? 12
  const colGap = layout.columnGap ?? 64
  const premiseWidth = layout.premiseWidth
  const responseWidth = layout.responseWidth
  const choicePadding = layout.choicePadding ?? 16

  const premises = useMemo(
    () => pairs.map((pair) => ({
      text: pair.leftText,
      html: pair.leftHtml,
      image: pair.leftImage,
      format: pair.leftFormat,
    })),
    [pairs],
  )

  const responses = useMemo(() => {
    const source = (preview?.responses?.length
      ? preview.responses
      : pairs.map((pair) => ({
        text: pair.rightText,
        html: pair.rightHtml,
        image: pair.rightImage,
        format: pair.rightFormat,
      })))
    if (!preview?.shuffleResponses) return source
    const seed = hashSeed(preview.shuffleSeed || preview.type || 'matching')
    return seededShuffle(source, seed)
  }, [pairs, preview?.responses, preview?.shuffleResponses, preview?.shuffleSeed, preview?.type])

  const gridStyle = wysiwyg
    ? {
        gridTemplateColumns: premiseWidth && responseWidth
          ? `${premiseWidth}px ${colGap}px ${responseWidth}px`
          : `1fr ${colGap}px 1fr`,
        height: '100%',
        width: '100%',
      }
    : undefined

  const colStyle = wysiwyg ? { gap: `${rowGap}px` } : undefined

  return (
    <div className={`matching-preview ${wysiwyg ? 'wysiwyg fidelity' : ''}`}>
      <div className="matching-columns" style={gridStyle}>
        <div className="matching-column premise" style={colStyle}>
          {premises.map((item, i) => (
            <MatchingCell
              key={`l-${i}`}
              side="premise"
              item={item}
              sessionId={sessionId}
              rowHeight={rowHeight}
              choicePadding={choicePadding}
            />
          ))}
        </div>
        <div className="matching-column-spacer" aria-hidden />
        <div className="matching-column response" style={colStyle}>
          {responses.map((item, i) => (
            <MatchingCell
              key={`r-${i}`}
              side="response"
              item={item}
              sessionId={sessionId}
              rowHeight={rowHeight}
              choicePadding={choicePadding}
            />
          ))}
        </div>
      </div>
    </div>
  )
}