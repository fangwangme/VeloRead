export interface Rect {
  left: number
  top: number
  width: number
  height: number
}

export interface ContainerMetrics {
  iframeRect: { left: number; top: number; width?: number; height?: number }
  containerRect: { left: number; top: number; width?: number; height?: number }
  scrollLeft?: number
  scrollTop?: number
}

/**
 * Pure function: converts an iframe-relative rect to parent container-relative coordinates.
 *
 * Formula:
 * x = iframeRect.left - containerRect.left + chunkRect.left - (scrollLeft || 0)
 * y = iframeRect.top - containerRect.top + chunkRect.top - (scrollTop || 0)
 */
export function chunkToOverlayRect(chunkRect: Rect, metrics: ContainerMetrics): Rect {
  const scrollLeft = metrics.scrollLeft ?? 0
  const scrollTop = metrics.scrollTop ?? 0

  const left = metrics.iframeRect.left - metrics.containerRect.left + chunkRect.left - scrollLeft
  const top = metrics.iframeRect.top - metrics.containerRect.top + chunkRect.top - scrollTop

  return {
    left: Math.round(left),
    top: Math.round(top),
    width: Math.round(chunkRect.width),
    height: Math.round(chunkRect.height),
  }
}

/**
 * Distance between the left edges of two adjacent columns of a CSS multi-column
 * page, given the layout the page reports.
 *
 * Not simply `column-width + column-gap`: `column-width` is a request, and the
 * browser decides how many columns fit and then widens them to fill the space.
 * `available` must therefore be the content box — measured on a real epub.js
 * page, the body carries `box-sizing: border-box` and a `gap`-wide padding, and
 * feeding the border-box width in puts the pitch a whole gap out, which is
 * enough to put the last words of a line in the wrong column.
 *
 * Returns null when the numbers are not usable, which the chunker reads as
 * "no column awareness" rather than "no chunks".
 */
export function columnPitchFromLayout(layout: {
  /** Width of the content box the columns are laid out in. */
  available: number
  /** The computed `column-width`. */
  columnWidth: number
  /** The computed `column-gap`. */
  columnGap: number
}): number | null {
  const { available, columnWidth, columnGap } = layout
  if (!Number.isFinite(available) || !Number.isFinite(columnWidth)) return null
  if (available <= 0 || columnWidth <= 0) return null
  const gap = Number.isFinite(columnGap) && columnGap > 0 ? columnGap : 0

  const columns = Math.max(1, Math.floor((available + gap) / (columnWidth + gap)))
  const usedWidth = (available - (columns - 1) * gap) / columns
  const pitch = usedWidth + gap
  return pitch > 0 ? pitch : null
}
