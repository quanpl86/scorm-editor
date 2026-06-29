export default function PanelResizeHandle({ side, label, onPointerDown }) {
  return (
    <div
      className={`panel-resize-handle panel-resize-${side}`}
      role="separator"
      aria-orientation="vertical"
      aria-label={label}
      title={label}
      onPointerDown={onPointerDown}
    />
  )
}