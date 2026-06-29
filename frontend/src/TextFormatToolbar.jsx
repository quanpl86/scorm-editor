import { COLOR_PRESETS, CONTENT_SIZES, TITLE_SIZES, defaultFormat, mergeFormat } from './textFormatUtils'

export default function TextFormatToolbar({
  label = 'Định dạng',
  role = 'content',
  format,
  onChange,
  showAlign = false,
  compact = false,
  preserveFocus = false,
}) {
  const fmt = mergeFormat(format, defaultFormat(role))
  const sizes = role === 'title' ? TITLE_SIZES : CONTENT_SIZES

  const set = (patch) => onChange(mergeFormat(fmt, patch))
  const keepFocus = preserveFocus
    ? { onMouseDown: (e) => e.preventDefault() }
    : {}

  return (
    <div className={`text-format-toolbar ${compact ? 'compact' : ''}`}>
      <span className="text-format-label">{label}</span>
      <div className="text-format-row" {...keepFocus}>
        <select
          className="text-format-select"
          value={fmt.fontSize ?? ''}
          onChange={(e) => set({ fontSize: e.target.value ? Number(e.target.value) : null })}
          title="Cỡ chữ"
        >
          <option value="">Auto</option>
          {sizes.map((s) => (
            <option key={s} value={s}>{s}px</option>
          ))}
        </select>

        <button
          type="button"
          className={`fmt-btn ${fmt.bold ? 'active' : ''}`}
          onClick={() => set({ bold: !fmt.bold })}
          title="Bold"
        >
          B
        </button>
        <button
          type="button"
          className={`fmt-btn ${fmt.italic ? 'active' : ''}`}
          onClick={() => set({ italic: !fmt.italic })}
          title="Italic"
        >
          I
        </button>
        <button
          type="button"
          className={`fmt-btn ${fmt.underline ? 'active' : ''}`}
          onClick={() => set({ underline: !fmt.underline })}
          title="Underline"
        >
          U
        </button>

        {showAlign && (
          <select
            className="text-format-select align-select"
            value={fmt.align}
            onChange={(e) => set({ align: e.target.value })}
            title="Căn lề"
          >
            <option value="left">Trái</option>
            <option value="center">Giữa</option>
            <option value="right">Phải</option>
          </select>
        )}

        <div className="color-picker-wrap">
          <input
            type="color"
            className="color-input"
            value={fmt.color}
            onChange={(e) => set({ color: e.target.value })}
            title="Màu chữ"
          />
          <div className="color-presets">
            {COLOR_PRESETS.map((c) => (
              <button
                key={c}
                type="button"
                className={`color-swatch ${fmt.color === c ? 'active' : ''}`}
                style={{ background: c }}
                onClick={() => set({ color: c })}
                title={c}
              />
            ))}
          </div>
        </div>
      </div>
    </div>
  )
}

export function TextFormatPreview({ text, format, role = 'content' }) {
  const fmt = mergeFormat(format, defaultFormat(role))
  const style = {
    fontFamily: "fnt6_24031, 'Quicksand', sans-serif",
    fontSize: fmt.fontSize ? `${fmt.fontSize}px` : role === 'title' ? '18px' : '16px',
    fontWeight: fmt.bold || role === 'title' ? 700 : 500,
    fontStyle: fmt.italic ? 'italic' : 'normal',
    textDecoration: fmt.underline ? 'underline' : 'none',
    color: fmt.color,
    textAlign: fmt.align,
    lineHeight: 1.35,
    padding: '8px 10px',
    borderRadius: 8,
    background: 'var(--surface2)',
    border: '1px solid var(--border)',
    minHeight: 40,
  }
  if (role === 'content') {
    style.fontFamily = "fnt5_24031, 'Quicksand', sans-serif"
    style.fontWeight = fmt.bold ? 700 : 500
  }
  return (
    <div className="text-format-preview" style={style}>
      {text || '(xem trước)'}
    </div>
  )
}