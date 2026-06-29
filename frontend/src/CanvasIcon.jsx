export default function CanvasIcon({ kind = 'passed' }) {
  const isPassed = kind === 'passed'
  return (
    <div className={`canvas-result-icon ${isPassed ? 'passed' : 'failed'}`} aria-hidden>
      <svg viewBox="0 0 120 120" className="result-icon-svg">
        <circle cx="60" cy="60" r="54" className="icon-ring" />
        {isPassed ? (
          <path className="icon-mark" d="M34 62 L52 80 L88 40" fill="none" strokeWidth="10" strokeLinecap="round" strokeLinejoin="round" />
        ) : (
          <g className="icon-mark" strokeWidth="10" strokeLinecap="round">
            <path d="M42 42 L78 78" fill="none" />
            <path d="M78 42 L42 78" fill="none" />
          </g>
        )}
      </svg>
    </div>
  )
}