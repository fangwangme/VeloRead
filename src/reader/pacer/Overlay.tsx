import type { Rect } from './geometry'

interface OverlayProps {
  rect: Rect | null
  animMs?: number
  accentColor?: string
  isDark?: boolean
}

export function Overlay({
  rect,
  animMs = 150,
  accentColor = '#D97706',
  isDark = false,
}: OverlayProps) {
  if (!rect || rect.width <= 0 || rect.height <= 0) {
    return null
  }

  // Check prefers-reduced-motion
  const prefersReducedMotion =
    typeof window !== 'undefined' &&
    window.matchMedia?.('(prefers-reduced-motion: reduce)')?.matches

  // Expand rect slightly around the words for comfortable padding
  const paddingX = 2
  const paddingY = 1
  const left = rect.left - paddingX
  const top = rect.top - paddingY
  const width = rect.width + paddingX * 2
  const height = rect.height + paddingY * 2

  const bg = isDark ? hexToRgba(accentColor, 0.22) : hexToRgba(accentColor, 0.18)
  const underlineColor = isDark ? hexToRgba(accentColor, 0.65) : hexToRgba(accentColor, 0.75)

  return (
    <div
      aria-hidden="true"
      className="pointer-events-none absolute z-30 rounded-xs"
      style={{
        left: `${left}px`,
        top: `${top}px`,
        width: `${width}px`,
        height: `${height}px`,
        backgroundColor: bg,
        borderBottom: `2.5px solid ${underlineColor}`,
        mixBlendMode: isDark ? 'screen' : 'multiply',
        transition: prefersReducedMotion
          ? 'none'
          : `left ${animMs}ms cubic-bezier(0.2, 0, 0, 1), top ${animMs}ms cubic-bezier(0.2, 0, 0, 1), width ${animMs}ms cubic-bezier(0.2, 0, 0, 1), height ${animMs}ms cubic-bezier(0.2, 0, 0, 1)`,
      }}
    />
  )
}

function hexToRgba(hex: string, alpha: number): string {
  let c = hex.replace('#', '')
  if (c.length === 3) {
    c = c
      .split('')
      .map((x) => x + x)
      .join('')
  }
  const num = parseInt(c, 16)
  if (isNaN(num) || c.length !== 6) {
    return `rgba(217, 119, 6, ${alpha})`
  }
  const r = (num >> 16) & 255
  const g = (num >> 8) & 255
  const b = num & 255
  return `rgba(${r}, ${g}, ${b}, ${alpha})`
}
