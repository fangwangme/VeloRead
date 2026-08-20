import type { HighlightColor } from '../../platform/types'

export interface HighlightPalette {
  id: HighlightColor
  labelKey: 'highlight.color.yellow' | 'highlight.color.green' | 'highlight.color.blue' | 'highlight.color.pink' | 'highlight.color.purple'
  /** Swatch shown in pickers and in the highlight list. */
  /** Message key for the colour's name, resolved where it is shown. */
  swatch: string
  /** Fill painted over the book page by epub.js (an SVG attribute value). */
  fill: string
  fillOpacity: string
}

/**
 * One palette drives the picker, the on-page highlight and the list swatch, so
 * a highlight cannot look like one colour in the book and another in the list.
 *
 * The on-page fill is a solid colour plus opacity rather than an alpha hex,
 * because epub.js hands these straight to SVG attributes on the mark group.
 */
export const HIGHLIGHT_COLORS: HighlightPalette[] = [
  { id: 'yellow', labelKey: 'highlight.color.yellow', swatch: '#F5C518', fill: '#F5C518', fillOpacity: '0.35' },
  { id: 'green', labelKey: 'highlight.color.green', swatch: '#4CAF6D', fill: '#4CAF6D', fillOpacity: '0.32' },
  { id: 'blue', labelKey: 'highlight.color.blue', swatch: '#4A90D9', fill: '#4A90D9', fillOpacity: '0.32' },
  { id: 'pink', labelKey: 'highlight.color.pink', swatch: '#E4699A', fill: '#E4699A', fillOpacity: '0.32' },
  { id: 'purple', labelKey: 'highlight.color.purple', swatch: '#9B7BD4', fill: '#9B7BD4', fillOpacity: '0.32' },
]

export const DEFAULT_HIGHLIGHT_COLOR: HighlightColor = 'yellow'

export function highlightPalette(color: HighlightColor): HighlightPalette {
  return HIGHLIGHT_COLORS.find((item) => item.id === color) ?? HIGHLIGHT_COLORS[0]
}
