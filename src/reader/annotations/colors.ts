import type { HighlightColor } from '../../platform/types'

export interface HighlightPalette {
  id: HighlightColor
  label: string
  /** Swatch shown in pickers and in the highlight list. */
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
  { id: 'yellow', label: '黄', swatch: '#F5C518', fill: '#F5C518', fillOpacity: '0.35' },
  { id: 'green', label: '绿', swatch: '#4CAF6D', fill: '#4CAF6D', fillOpacity: '0.32' },
  { id: 'blue', label: '蓝', swatch: '#4A90D9', fill: '#4A90D9', fillOpacity: '0.32' },
  { id: 'pink', label: '粉', swatch: '#E4699A', fill: '#E4699A', fillOpacity: '0.32' },
  { id: 'purple', label: '紫', swatch: '#9B7BD4', fill: '#9B7BD4', fillOpacity: '0.32' },
]

export const DEFAULT_HIGHLIGHT_COLOR: HighlightColor = 'yellow'

export function highlightPalette(color: HighlightColor): HighlightPalette {
  return HIGHLIGHT_COLORS.find((item) => item.id === color) ?? HIGHLIGHT_COLORS[0]
}
