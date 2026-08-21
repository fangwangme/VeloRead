import { describe, expect, it } from 'vitest'
import { resolveLanguage } from './resolveLanguage'

describe('resolveLanguage', () => {
  it('honours an explicit choice over the system', () => {
    expect(resolveLanguage('en', ['zh-CN'])).toBe('en')
    expect(resolveLanguage('zh', ['en-US'])).toBe('zh')
  })

  it('follows the system when set to auto', () => {
    expect(resolveLanguage('auto', ['en-GB', 'zh-CN'])).toBe('en')
    expect(resolveLanguage('auto', ['zh-Hant-TW'])).toBe('zh')
    expect(resolveLanguage(undefined, ['en-US'])).toBe('en')
  })

  it('skips languages it does not have, rather than stopping at the first tag', () => {
    expect(resolveLanguage('auto', ['fr-FR', 'en-US'])).toBe('en')
  })

  it('falls back to the language the messages are authored in', () => {
    expect(resolveLanguage('auto', ['fr-FR'])).toBe('zh')
    expect(resolveLanguage('auto', [])).toBe('zh')
  })
})
