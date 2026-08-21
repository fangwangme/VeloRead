import { describe, expect, it } from 'vitest'
import { PRESETS } from './presets'
import { resolveStyle } from './resolve'
import { toCssRules } from './toCssRules'

describe('toCssRules', () => {
  it('does not override body or heading font families in Original mode', () => {
    const rules = toCssRules(resolveStyle(PRESETS.book, { fontStack: 'original' }))

    expect(rules.body['font-family']).toBeUndefined()
    expect(rules.p['font-family']).toBeUndefined()
    expect(rules['h1, h2, h3, h4, h5, h6']['font-family']).toBeUndefined()
    expect(rules['code, pre, kbd, samp']['font-family']).toContain('ui-monospace')
  })
})
