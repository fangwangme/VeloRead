import { describe, expect, it } from 'vitest'
import { chunkToOverlayRect } from './geometry'

describe('Pacer Geometry', () => {
  it('converts iframe-relative chunk rect to container-relative overlay coordinates', () => {
    const chunkRect = { left: 40, top: 80, width: 120, height: 24 }
    const metrics = {
      iframeRect: { left: 100, top: 150 },
      containerRect: { left: 20, top: 50 },
      scrollLeft: 0,
      scrollTop: 0,
    }

    const overlay = chunkToOverlayRect(chunkRect, metrics)

    // Expected x = (100 - 20) + 40 - 0 = 120
    // Expected y = (150 - 50) + 80 - 0 = 180
    expect(overlay).toEqual({
      left: 120,
      top: 180,
      width: 120,
      height: 24,
    })
  })

  it('handles container scroll offsets correctly', () => {
    const chunkRect = { left: 50, top: 60, width: 100, height: 20 }
    const metrics = {
      iframeRect: { left: 50, top: 100 },
      containerRect: { left: 10, top: 20 },
      scrollLeft: 15,
      scrollTop: 25,
    }

    const overlay = chunkToOverlayRect(chunkRect, metrics)

    // Expected left = (50 - 10) + 50 - 15 = 75
    // Expected top = (100 - 20) + 60 - 25 = 115
    expect(overlay).toEqual({
      left: 75,
      top: 115,
      width: 100,
      height: 20,
    })
  })
})
