import type { Rect } from './geometry'

interface OverlayProps {
  rect: Rect | null
  animMs?: number
  accentColor?: string
}

export function Overlay({ rect, animMs = 150, accentColor }: OverlayProps) {
  if (!rect || rect.width <= 0 || rect.height <= 0) {
    return null
  }

  // Check prefers-reduced-motion
  const prefersReducedMotion =
    typeof window !== 'undefined' &&
    window.matchMedia?.('(prefers-reduced-motion: reduce)')?.matches

  // Expand rect slightly around the words for a clean book highlight
  const paddingX = 3
  const paddingY = 2
  const left = rect.left - paddingX
  const top = rect.top - paddingY
  const width = rect.width + paddingX * 2
  const height = rect.height + paddingY * 2

  const bg = accentColor || 'rgba(59, 130, 246, 0.25)'

  return (
    <div
      aria-hidden="true"
      className="pointer-events-none absolute z-30 rounded-md"
      style={{
        left: `${left}px`,
        top: `${top}px`,
        width: `${width}px`,
        height: `${height}px`,
        backgroundColor: bg,
        transition: prefersReducedMotion
          ? 'none'
          : `left ${animMs}ms cubic-bezier(0.2, 0, 0, 1), top ${animMs}ms cubic-bezier(0.2, 0, 0, 1), width ${animMs}ms cubic-bezier(0.2, 0, 0, 1), height ${animMs}ms cubic-bezier(0.2, 0, 0, 1)`,
      }}
    />
  )
}
