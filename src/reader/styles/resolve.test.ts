import { describe, expect, it } from 'vitest'
import { PRESETS } from './presets'
import { resolveStyle } from './resolve'

describe('resolveStyle', () => {
  it('resolves standard preset without overrides in light mode', () => {
    const style = PRESETS.book
    const resolved = resolveStyle(style, {}, false)

    expect(resolved.id).toBe('book')
    expect(resolved.body.fontSizePx).toBe(19)
    expect(resolved.body.lineHeight).toBe(PRESETS.book.body.lineHeight)
    expect(resolved.body.measureCh).toBe(66)
    expect(resolved.body.align).toBe('justify')
    expect(resolved.body.hyphens).toBe(true)
    expect(resolved.body.fontStack).toContain('Charter')
    expect(resolved.palette.background).toBe(PRESETS.book.lightPalette.background)
  })

  it('resolves preset in dark mode with darkPalette', () => {
    const style = PRESETS.sepia
    const resolved = resolveStyle(style, {}, true)

    expect(resolved.id).toBe('sepia')
    expect(resolved.palette.background).toBe(PRESETS.sepia.darkPalette.background)
    expect(resolved.palette.text).toBe(PRESETS.sepia.darkPalette.text)
  })

  it('applies relative font size, line height, and margin steps', () => {
    const style = PRESETS.book
    const baseLineHeight = PRESETS.book.body.lineHeight
    const resolved = resolveStyle(style, {
      fontSizeStep: 2, // 19 + 4 = 23
      lineHeightStep: 1, // base + 0.15
      marginStep: 1, // 66 - 8 = 58
      bold: true,
      justify: false,
    })

    expect(resolved.body.fontSizePx).toBe(23)
    expect(resolved.body.lineHeight).toBe(Number((baseLineHeight + 0.15).toFixed(2)))
    expect(resolved.body.measureCh).toBe(58)
    expect(resolved.body.fontWeight).toBe(700)
    expect(resolved.body.align).toBe('start')
  })

  it('handles "original" fontStack without overriding font-family', () => {
    const style = PRESETS.journal
    const resolved = resolveStyle(style, {
      fontStack: 'original',
    })

    expect(resolved.body.fontStack).toBe('')
  })

  it('handles custom fontStack override', () => {
    const style = PRESETS.journal
    const resolved = resolveStyle(style, {
      fontStack: 'CustomSerif, serif',
    })

    expect(resolved.body.fontStack).toBe('CustomSerif, serif')
  })

  it('handles CJK presets with 2em indent, no hyphens, and custom measure step', () => {
    const style = PRESETS.song
    const resolved = resolveStyle(style, {
      marginStep: 1, // 40 - 4 = 36
    })

    expect(resolved.body.isCjk).toBe(true)
    expect(resolved.body.hyphens).toBe(false)
    expect(resolved.body.measureCh).toBe(36)
    expect(resolved.body.paragraph).toBe('indent')
  })
})
