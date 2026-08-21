import { describe, expect, it } from 'vitest'
import { chunkToOverlayRect, columnPitchFromLayout } from './geometry'

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

describe('columnPitchFromLayout', () => {
  it('matches a measured two-column epub.js page', () => {
    // Read off a real page: body content 1480px, column-width 673, gap 134.
    // The columns there start at 67, 874, 1681 — 807 apart.
    expect(columnPitchFromLayout({ available: 1480, columnWidth: 673, columnGap: 134 })).toBe(807)
  })

  it('counts the columns the browser actually fits, then widens them', () => {
    // 400px columns in 1000px of space: two fit, and they widen to 480 each.
    expect(columnPitchFromLayout({ available: 1000, columnWidth: 400, columnGap: 40 })).toBe(520)
    // 300px columns in the same space: three fit, so the pitch is much smaller.
    expect(columnPitchFromLayout({ available: 1000, columnWidth: 300, columnGap: 40 })).toBeCloseTo(
      346.67,
      1,
    )
  })

  it('treats a single column as the whole page', () => {
    expect(columnPitchFromLayout({ available: 800, columnWidth: 900, columnGap: 40 })).toBe(840)
  })

  it('gives up rather than returning a nonsense pitch', () => {
    expect(columnPitchFromLayout({ available: 0, columnWidth: 300, columnGap: 40 })).toBeNull()
    expect(columnPitchFromLayout({ available: 900, columnWidth: Number.NaN, columnGap: 40 })).toBeNull()
  })
})
