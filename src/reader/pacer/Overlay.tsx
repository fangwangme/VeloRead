import type { Rect } from './geometry'
import { resolveOverlayStyle, type PacerHighlightStyle } from './overlayStyle'

interface OverlayProps {
  /**
   * One box per line the chunk sits on. Two when a word was hyphenated across
   * the line break: the cursor has to cover both halves, because they are one
   * word and are read as one.
   */
  rects: Rect[]
  /** The line the chunk sits on, drawn faintly behind it in `chunk-in-line`. */
  lineRect?: Rect | null
  animMs?: number
  /** The reading style's accent, used when the highlight colour is `auto`. */
  accentColor?: string
  isDark?: boolean
  style: PacerHighlightStyle
}

export function Overlay({
  rects,
  lineRect = null,
  animMs = 150,
  accentColor = '#D97706',
  isDark = false,
  style,
}: OverlayProps) {
  const boxes = rects.filter((box) => box.width > 0 && box.height > 0)
  if (boxes.length === 0) {
    return null
  }

  const prefersReducedMotion =
    typeof window !== 'undefined' &&
    window.matchMedia?.('(prefers-reduced-motion: reduce)')?.matches

  // Expand the rect slightly around the words for comfortable padding
  const paddingX = 2
  const paddingY = 1
  const resolved = resolveOverlayStyle(style, accentColor, isDark)
  const transition = prefersReducedMotion
    ? 'none'
    : `left ${animMs}ms cubic-bezier(0.2, 0, 0, 1), top ${animMs}ms cubic-bezier(0.2, 0, 0, 1), width ${animMs}ms cubic-bezier(0.2, 0, 0, 1), height ${animMs}ms cubic-bezier(0.2, 0, 0, 1)`
  const showBand = Boolean(resolved.lineBackgroundColor && lineRect && lineRect.width > 0)

  return (
    <>
      {showBand && lineRect && (
        <div
          aria-hidden="true"
          className="pointer-events-none absolute z-20 rounded-xs"
          style={{
            left: `${lineRect.left - paddingX}px`,
            top: `${lineRect.top - paddingY}px`,
            width: `${lineRect.width + paddingX * 2}px`,
            height: `${lineRect.height + paddingY * 2}px`,
            backgroundColor: resolved.lineBackgroundColor ?? undefined,
            mixBlendMode: resolved.mixBlendMode,
            transition,
          }}
        />
      )}
      {boxes.map((box, index) => (
        <div
          // Keyed by position in the chunk: box 0 is the one that carries the
          // cursor's movement, so it animates rather than being replaced.
          key={index}
          aria-hidden="true"
          className="pointer-events-none absolute z-30 rounded-xs"
          style={{
            left: `${box.left - paddingX}px`,
            top: `${box.top - paddingY}px`,
            width: `${box.width + paddingX * 2}px`,
            height: `${box.height + paddingY * 2}px`,
            backgroundColor: resolved.backgroundColor,
            borderBottom: resolved.underlineColor
              ? `2.5px solid ${resolved.underlineColor}`
              : undefined,
            mixBlendMode: resolved.mixBlendMode,
            transition,
          }}
        />
      ))}
    </>
  )
}
