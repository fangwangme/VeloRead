/**
 * Appearance of the Pacer's moving highlight.
 *
 * Kept out of the component so the reader and the settings preview cannot drift
 * apart, and so the rules are testable without a DOM.
 */

/** What the highlight is made of. */
export type PacerHighlightShape = 'block' | 'block-underline' | 'underline'

export interface PacerHighlightStyle {
  /** A hex colour, or `auto` to follow the reading style's accent. */
  color: string
  /** Fill strength in light mode, 0.04–0.5. Dark mode adds a little. */
  opacity: number
  shape: PacerHighlightShape
}

/** `auto` keeps the highlight tied to the typography preset, as it always was. */
export const AUTO_HIGHLIGHT_COLOR = 'auto'

export const DEFAULT_PACER_HIGHLIGHT: PacerHighlightStyle = {
  color: AUTO_HIGHLIGHT_COLOR,
  opacity: 0.18,
  shape: 'block-underline',
}

export const MIN_HIGHLIGHT_OPACITY = 0.04
export const MAX_HIGHLIGHT_OPACITY = 0.5

/**
 * A dark page needs a slightly stronger fill for the same apparent weight,
 * because the highlight is screened onto the text rather than multiplied into
 * it. One offset rather than a second setting to keep in sync.
 */
const DARK_OPACITY_BONUS = 0.04

const UNDERLINE_OPACITY_LIGHT = 0.75
const UNDERLINE_OPACITY_DARK = 0.65

/** Offered in the picker. `auto` first, then a spread that works on both themes. */
export const PACER_HIGHLIGHT_SWATCHES: { id: string; hex: string | null }[] = [
  { id: AUTO_HIGHLIGHT_COLOR, hex: null },
  { id: 'amber', hex: '#D97706' },
  { id: 'yellow', hex: '#EAB308' },
  { id: 'green', hex: '#16A34A' },
  { id: 'blue', hex: '#2563EB' },
  { id: 'violet', hex: '#7C3AED' },
  { id: 'rose', hex: '#E11D48' },
]

export interface ResolvedOverlayStyle {
  /** `transparent` when the shape is underline-only. */
  backgroundColor: string
  /** Null when the shape has no rule under it. */
  underlineColor: string | null
  mixBlendMode: 'multiply' | 'screen'
}

export function clampHighlightOpacity(value: number): number {
  if (!Number.isFinite(value)) return DEFAULT_PACER_HIGHLIGHT.opacity
  return Math.min(MAX_HIGHLIGHT_OPACITY, Math.max(MIN_HIGHLIGHT_OPACITY, value))
}

/** Read the stored settings into a complete style, filling in every default. */
export function readHighlightStyle(settings: {
  pacerHighlightColor?: string
  pacerHighlightOpacity?: number
  pacerHighlightShape?: PacerHighlightShape
}): PacerHighlightStyle {
  return {
    color: settings.pacerHighlightColor ?? DEFAULT_PACER_HIGHLIGHT.color,
    opacity: clampHighlightOpacity(
      settings.pacerHighlightOpacity ?? DEFAULT_PACER_HIGHLIGHT.opacity,
    ),
    shape: settings.pacerHighlightShape ?? DEFAULT_PACER_HIGHLIGHT.shape,
  }
}

export function resolveOverlayStyle(
  style: PacerHighlightStyle,
  accentColor: string,
  isDark: boolean,
): ResolvedOverlayStyle {
  const hex = style.color === AUTO_HIGHLIGHT_COLOR ? accentColor : style.color
  const fill = clampHighlightOpacity(style.opacity) + (isDark ? DARK_OPACITY_BONUS : 0)
  const underline = isDark ? UNDERLINE_OPACITY_DARK : UNDERLINE_OPACITY_LIGHT

  return {
    backgroundColor: style.shape === 'underline' ? 'transparent' : hexToRgba(hex, fill),
    underlineColor: style.shape === 'block' ? null : hexToRgba(hex, underline),
    mixBlendMode: isDark ? 'screen' : 'multiply',
  }
}

/** Falls back to the default amber rather than emitting an invalid colour. */
export function hexToRgba(hex: string, alpha: number): string {
  let value = hex.replace('#', '')
  if (value.length === 3) {
    value = value
      .split('')
      .map((digit) => digit + digit)
      .join('')
  }
  const parsed = Number.parseInt(value, 16)
  if (Number.isNaN(parsed) || value.length !== 6) {
    return `rgba(217, 119, 6, ${alpha})`
  }
  return `rgba(${(parsed >> 16) & 255}, ${(parsed >> 8) & 255}, ${parsed & 255}, ${alpha})`
}
