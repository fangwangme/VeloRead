import type { ReadingStyle, ResolvedStyle, StyleOverride } from './types'

export function resolveStyle(
  style: ReadingStyle,
  override: StyleOverride = {},
  isDark: boolean = false,
): ResolvedStyle {
  const isCjk = Boolean(style.body.isCjk)

  // Font size step: one step is one pixel, bounded 12px..36px.
  //
  // It used to be two, over nine positions. Reading size is the setting people
  // fiddle with until it is right, and at 2px a tap was a visible jolt with no
  // stop in between — while the range still ran out before either end of what
  // the renderer allows.
  const fontSizeStep = override.fontSizeStep ?? 0
  const fontSizePx = Math.max(12, Math.min(36, style.body.fontSizePx + fontSizeStep))

  // Line height step: -1 (tight: base - 0.15), 0 (normal: base), 1 (loose: base + 0.15)
  const lineHeightStep = override.lineHeightStep ?? 0
  const lineHeight = Math.max(
    1.2,
    Math.min(2.4, Number((style.body.lineHeight + lineHeightStep * 0.15).toFixed(2))),
  )

  // Margin step: -1 (narrow margin -> wider measure), 0 (normal), 1 (wide margin -> narrower measure)
  // For CJK: step is 4 characters. For Western: step is 8 characters.
  const marginStep = override.marginStep ?? 0
  const stepDelta = isCjk ? 4 : 8
  const measureCh = Math.max(25, Math.min(100, style.body.measureCh - marginStep * stepDelta))

  // Font stack: 'original' means follow book original font (don't override font-family)
  let fontStack = style.body.fontStack
  if (override.fontStack !== undefined && override.fontStack !== null) {
    if (override.fontStack === 'original' || override.fontStack === '') {
      fontStack = ''
    } else {
      fontStack = override.fontStack
    }
  }

  // Alignment: if explicitly specified, override preset
  const align =
    override.justify !== undefined && override.justify !== null
      ? override.justify
        ? 'justify'
        : 'start'
      : style.body.align

  // Bold: if true, weight 700
  const fontWeight = override.bold ? 700 : undefined

  // Pick palette based on isDark mode
  const palette = isDark ? { ...style.darkPalette } : { ...style.lightPalette }

  return {
    id: style.id,
    palette,
    body: {
      ...style.body,
      fontStack,
      fontSizePx,
      lineHeight,
      measureCh,
      align,
      ...(fontWeight ? { fontWeight } : {}),
      // CJK never hyphens
      hyphens: isCjk ? false : style.body.hyphens,
      isCjk,
    },
    elements: {
      ...style.elements,
      headingScale: [...style.elements.headingScale],
    },
  }
}
