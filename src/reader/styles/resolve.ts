import type { ReadingStyle, ResolvedStyle, StyleOverride } from './types'

export function resolveStyle(style: ReadingStyle, override: StyleOverride = {}): ResolvedStyle {
  const isCjk = Boolean(style.body.isCjk)

  // Font size step: each step adjusts font size by 2px (bounded 12px..36px)
  const fontSizeStep = override.fontSizeStep ?? 0
  const fontSizePx = Math.max(12, Math.min(36, style.body.fontSizePx + fontSizeStep * 2))

  // Line height step: -1 (tight: base - 0.15), 0 (normal: base), 1 (loose: base + 0.15)
  const lineHeightStep = override.lineHeightStep ?? 0
  const lineHeight = Math.max(1.2, Math.min(2.4, Number((style.body.lineHeight + lineHeightStep * 0.15).toFixed(2))))

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
  const align = override.justify !== undefined && override.justify !== null
    ? (override.justify ? 'justify' : 'start')
    : style.body.align

  // Bold: if true, weight 700
  const fontWeight = override.bold ? 700 : undefined

  return {
    id: style.id,
    palette: { ...style.palette },
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
