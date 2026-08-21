import { describe, expect, it } from 'vitest'
import {
  AUTO_HIGHLIGHT_COLOR,
  DEFAULT_PACER_HIGHLIGHT,
  clampHighlightOpacity,
  cursorModeChunksWholeLines,
  hexToRgba,
  readHighlightStyle,
  resolveOverlayStyle,
} from './overlayStyle'

describe('resolveOverlayStyle', () => {
  it('follows the reading style accent when the colour is auto', () => {
    const resolved = resolveOverlayStyle(DEFAULT_PACER_HIGHLIGHT, '#123456', false)
    expect(resolved.backgroundColor).toBe('rgba(18, 52, 86, 0.18)')
    expect(resolved.underlineColor).toBe('rgba(18, 52, 86, 0.75)')
  })

  it('uses the chosen colour over the accent', () => {
    const resolved = resolveOverlayStyle(
      { ...DEFAULT_PACER_HIGHLIGHT, color: '#FF0000' },
      '#123456',
      false,
    )
    expect(resolved.backgroundColor).toBe('rgba(255, 0, 0, 0.18)')
  })

  it('strengthens the fill on a dark page', () => {
    const light = resolveOverlayStyle(DEFAULT_PACER_HIGHLIGHT, '#000000', false)
    const dark = resolveOverlayStyle(DEFAULT_PACER_HIGHLIGHT, '#000000', true)
    expect(light.backgroundColor).toBe('rgba(0, 0, 0, 0.18)')
    expect(dark.backgroundColor).toBe('rgba(0, 0, 0, 0.22)')
    expect(dark.mixBlendMode).toBe('screen')
  })

  it('drops the fill for underline-only and the rule for block-only', () => {
    const underline = resolveOverlayStyle(
      { ...DEFAULT_PACER_HIGHLIGHT, shape: 'underline' },
      '#D97706',
      false,
    )
    expect(underline.backgroundColor).toBe('transparent')
    expect(underline.underlineColor).not.toBeNull()

    const block = resolveOverlayStyle(
      { ...DEFAULT_PACER_HIGHLIGHT, shape: 'block' },
      '#D97706',
      false,
    )
    expect(block.backgroundColor).not.toBe('transparent')
    expect(block.underlineColor).toBeNull()
  })
})

describe('cursor mode', () => {
  it('draws no line band unless the cursor asks for one', () => {
    for (const cursorMode of ['chunk', 'line'] as const) {
      const resolved = resolveOverlayStyle(
        { ...DEFAULT_PACER_HIGHLIGHT, cursorMode },
        '#D97706',
        false,
      )
      expect(resolved.lineBackgroundColor).toBeNull()
    }
  })

  it('draws the band fainter than the cursor over it', () => {
    const resolved = resolveOverlayStyle(
      { ...DEFAULT_PACER_HIGHLIGHT, cursorMode: 'chunk-in-line' },
      '#D97706',
      false,
    )
    expect(resolved.lineBackgroundColor).toBe('rgba(217, 119, 6, 0.081)')
    expect(resolved.backgroundColor).toBe('rgba(217, 119, 6, 0.18)')
  })

  it('gives the band a fill even when the cursor is a rule only', () => {
    const resolved = resolveOverlayStyle(
      { ...DEFAULT_PACER_HIGHLIGHT, cursorMode: 'chunk-in-line', shape: 'underline' },
      '#D97706',
      false,
    )
    expect(resolved.backgroundColor).toBe('transparent')
    expect(resolved.lineBackgroundColor).not.toBeNull()
  })

  it('chunks whole lines only in line mode', () => {
    expect(cursorModeChunksWholeLines('line')).toBe(true)
    expect(cursorModeChunksWholeLines('chunk')).toBe(false)
    expect(cursorModeChunksWholeLines('chunk-in-line')).toBe(false)
  })
})

describe('readHighlightStyle', () => {
  it('fills in every default from empty settings', () => {
    expect(readHighlightStyle({})).toEqual(DEFAULT_PACER_HIGHLIGHT)
    expect(readHighlightStyle({}).color).toBe(AUTO_HIGHLIGHT_COLOR)
  })

  it('keeps the chunk cursor as the default', () => {
    expect(readHighlightStyle({}).cursorMode).toBe('chunk')
    expect(readHighlightStyle({ pacerCursorMode: 'line' }).cursorMode).toBe('line')
  })

  it('clamps a stored opacity that is out of range', () => {
    expect(readHighlightStyle({ pacerHighlightOpacity: 9 }).opacity).toBe(0.5)
    expect(readHighlightStyle({ pacerHighlightOpacity: -1 }).opacity).toBe(0.04)
    expect(clampHighlightOpacity(Number.NaN)).toBe(DEFAULT_PACER_HIGHLIGHT.opacity)
  })
})

describe('hexToRgba', () => {
  it('expands shorthand hex and rejects nonsense', () => {
    expect(hexToRgba('#abc', 0.5)).toBe('rgba(170, 187, 204, 0.5)')
    expect(hexToRgba('not-a-colour', 0.5)).toBe('rgba(217, 119, 6, 0.5)')
  })
})
