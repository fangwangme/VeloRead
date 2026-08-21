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
