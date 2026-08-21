import type { ResolvedStyle } from './types'

export function toCssRules(resolved: ResolvedStyle): Record<string, Record<string, string>> {
  const { palette, body, elements } = resolved
  const isCjk = Boolean(body.isCjk)

  const bodyRules: Record<string, string> = {
    background: `${palette.background} !important`,
    color: `${palette.text} !important`,
    'font-size': `${body.fontSizePx}px !important`,
    'line-height': `${body.lineHeight} !important`,
    'text-align': `${body.align} !important`,
    margin: '0 !important',
    padding: '0 !important',
    '-webkit-font-smoothing': 'antialiased !important',
    '-moz-osx-font-smoothing': 'grayscale !important',
    'text-rendering': 'optimizeLegibility !important',
    'word-break': isCjk ? 'break-all !important' : 'normal !important',
    'overflow-wrap': 'break-word !important',
  }

  if (body.hyphens) {
    bodyRules['hyphens'] = 'auto !important'
    bodyRules['-webkit-hyphens'] = 'auto !important'
  } else {
    bodyRules['hyphens'] = 'none !important'
    bodyRules['-webkit-hyphens'] = 'none !important'
  }

  if (body.fontStack) {
    bodyRules['font-family'] = `${body.fontStack} !important`
  }

  if (body.fontWeight) {
    bodyRules['font-weight'] = `${body.fontWeight} !important`
  }

  const pRules: Record<string, string> = {
    color: `${palette.text} !important`,
    'line-height': `${body.lineHeight} !important`,
    'text-align': `${body.align} !important`,
    'letter-spacing': isCjk ? '0.04em !important' : 'normal !important',
  }

  if (body.fontStack) {
    pRules['font-family'] = `${body.fontStack} !important`
  }

  if (body.paragraph === 'indent') {
    pRules['text-indent'] = `${isCjk ? '2em' : '1.5em'} !important`
    pRules['margin-top'] = '0 !important'
    pRules['margin-bottom'] = '0 !important'
  } else {
    pRules['text-indent'] = '0 !important'
    pRules['margin-top'] = '0.85em !important'
    pRules['margin-bottom'] = '0.85em !important'
  }

  const headingBase: Record<string, string> = {
    color: `${palette.text} !important`,
    'font-weight': `${elements.headingWeight} !important`,
    'text-align': 'start !important',
    'text-indent': '0 !important',
    'letter-spacing': '-0.02em !important',
    'break-after': 'avoid !important',
    '-webkit-column-break-after': 'avoid !important',
  }

  // An empty body font stack is the explicit "Original" choice. In that
  // mode headings must keep the EPUB's font as well; otherwise only the body
  // follows the book while every heading is silently replaced by the preset.
  if (body.fontStack && elements.headingFontStack) {
    headingBase['font-family'] = `${elements.headingFontStack} !important`
  }

  return {
    body: bodyRules,
    p: pRules,
    'h1, h2, h3, h4, h5, h6': headingBase,
    h1: {
      'font-size': `${Math.round(body.fontSizePx * elements.headingScale[0])}px !important`,
      'margin-top': '1.4em !important',
      'margin-bottom': '0.7em !important',
      'line-height': '1.25 !important',
    },
    h2: {
      'font-size': `${Math.round(body.fontSizePx * elements.headingScale[1])}px !important`,
      'margin-top': '1.25em !important',
      'margin-bottom': '0.6em !important',
      'line-height': '1.3 !important',
    },
    h3: {
      'font-size': `${Math.round(body.fontSizePx * elements.headingScale[2])}px !important`,
      'margin-top': '1.1em !important',
      'margin-bottom': '0.5em !important',
      'line-height': '1.35 !important',
    },
    h4: { 'font-size': `${Math.round(body.fontSizePx * elements.headingScale[3])}px !important` },
    h5: { 'font-size': `${Math.round(body.fontSizePx * elements.headingScale[4])}px !important` },
    h6: { 'font-size': `${Math.round(body.fontSizePx * elements.headingScale[5])}px !important` },
    a: {
      color: `${palette.accent} !important`,
      'text-decoration': 'underline !important',
      'text-underline-offset': '2px !important',
    },
    img: {
      'max-width': '100% !important',
      height: 'auto !important',
      'border-radius': '6px !important',
      margin: '1.2em auto !important',
      display: 'block !important',
    },
    'code, pre, kbd, samp': {
      'font-family': `${elements.codeFontStack} !important`,
      background: `${palette.codeBackground} !important`,
      'font-size': '0.88em !important',
      'border-radius': '3px !important',
      padding: '0.15em 0.35em !important',
    },
    pre: {
      padding: '0.85em 1.15em !important',
      'border-radius': '6px !important',
      'overflow-x': 'auto !important',
      'white-space': 'pre-wrap !important',
      'word-break': 'break-all !important',
      margin: '1.2em 0 !important',
    },
    'pre code': {
      background: 'transparent !important',
      padding: '0 !important',
    },
    blockquote: {
      color: `${palette.muted} !important`,
      'font-style': 'italic !important',
      ...(elements.blockquote === 'rule'
        ? {
            'border-left': `3.5px solid ${palette.rule} !important`,
            'padding-left': '1.2em !important',
            'margin-left': '0 !important',
            'margin-right': '0 !important',
          }
        : {
            'margin-left': '1.5em !important',
            'margin-right': '1.5em !important',
          }),
    },
    hr: {
      border: 'none !important',
      'border-top': `1px solid ${palette.rule} !important`,
      margin: '2.5em auto !important',
      width: '60% !important',
    },
    'figcaption, .caption': {
      color: `${palette.muted} !important`,
      'font-size': `${elements.figureCaptionScale}em !important`,
      'text-align': 'center !important',
      'margin-top': '0.5em !important',
    },
    table: {
      'border-collapse': 'collapse !important',
      width: '100% !important',
      margin: '1.5em 0 !important',
    },
    'th, td': {
      ...(elements.tableBorder === 'horizontal'
        ? { 'border-bottom': `1px solid ${palette.rule} !important` }
        : elements.tableBorder === 'all'
        ? { border: `1px solid ${palette.rule} !important` }
        : {}),
      padding: '0.6em 0.85em !important',
    },
    ul: {
      'padding-left': `${elements.listIndentEm}em !important`,
      margin: '0.8em 0 !important',
    },
    ol: {
      'padding-left': `${elements.listIndentEm}em !important`,
      margin: '0.8em 0 !important',
    },
    li: {
      'margin-bottom': '0.35em !important',
    },
  }
}
