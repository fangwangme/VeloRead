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
  }

  if (body.fontStack) {
    pRules['font-family'] = `${body.fontStack} !important`
  }

  if (body.paragraph === 'indent') {
    pRules['text-indent'] = `${isCjk ? '2em' : '1.2em'} !important`
    pRules['margin-top'] = '0 !important'
    pRules['margin-bottom'] = '0 !important'
  } else {
    pRules['text-indent'] = '0 !important'
    pRules['margin-top'] = '0.75em !important'
    pRules['margin-bottom'] = '0.75em !important'
  }

  const headingBase: Record<string, string> = {
    color: `${palette.text} !important`,
    'font-weight': `${elements.headingWeight} !important`,
    'text-align': 'start !important',
    'text-indent': '0 !important',
    'break-after': 'avoid !important',
    '-webkit-column-break-after': 'avoid !important',
  }

  if (elements.headingFontStack) {
    headingBase['font-family'] = `${elements.headingFontStack} !important`
  }

  return {
    body: bodyRules,
    p: pRules,
    'h1, h2, h3, h4, h5, h6': headingBase,
    h1: { 'font-size': `${Math.round(body.fontSizePx * elements.headingScale[0])}px !important`, 'margin-top': '1.2em !important', 'margin-bottom': '0.6em !important' },
    h2: { 'font-size': `${Math.round(body.fontSizePx * elements.headingScale[1])}px !important`, 'margin-top': '1.1em !important', 'margin-bottom': '0.5em !important' },
    h3: { 'font-size': `${Math.round(body.fontSizePx * elements.headingScale[2])}px !important`, 'margin-top': '1.0em !important', 'margin-bottom': '0.4em !important' },
    h4: { 'font-size': `${Math.round(body.fontSizePx * elements.headingScale[3])}px !important` },
    h5: { 'font-size': `${Math.round(body.fontSizePx * elements.headingScale[4])}px !important` },
    h6: { 'font-size': `${Math.round(body.fontSizePx * elements.headingScale[5])}px !important` },
    a: {
      color: `${palette.accent} !important`,
      'text-decoration': 'underline !important',
    },
    'code, pre, kbd, samp': {
      'font-family': `${elements.codeFontStack} !important`,
      background: `${palette.codeBackground} !important`,
      'font-size': '0.9em !important',
    },
    pre: {
      padding: '0.75em 1em !important',
      'border-radius': '4px !important',
      'overflow-x': 'auto !important',
      'white-space': 'pre-wrap !important',
      'word-break': 'break-all !important',
    },
    'pre code': {
      background: 'transparent !important',
      padding: '0 !important',
    },
    blockquote: {
      color: `${palette.muted} !important`,
      ...(elements.blockquote === 'rule'
        ? {
            'border-left': `3px solid ${palette.rule} !important`,
            'padding-left': '1em !important',
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
      margin: '2em 0 !important',
    },
    'figcaption, .caption': {
      color: `${palette.muted} !important`,
      'font-size': `${elements.figureCaptionScale}em !important`,
      'text-align': 'center !important',
    },
    table: {
      'border-collapse': 'collapse !important',
      width: '100% !important',
      margin: '1em 0 !important',
    },
    'th, td': {
      ...(elements.tableBorder === 'horizontal'
        ? { 'border-bottom': `1px solid ${palette.rule} !important` }
        : elements.tableBorder === 'all'
        ? { border: `1px solid ${palette.rule} !important` }
        : {}),
      padding: '0.5em 0.75em !important',
    },
    ul: {
      'padding-left': `${elements.listIndentEm}em !important`,
    },
    ol: {
      'padding-left': `${elements.listIndentEm}em !important`,
    },
  }
}
