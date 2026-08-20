import { describe, expect, it } from 'vitest'
import { isCjkGrapheme, tokenizeText } from './tokenizer'

describe('Pacer tokenizer', () => {
  it('keeps Latin words and expands CJK words into grapheme characters', () => {
    const tokens = tokenizeText('Read 中文 text')

    expect(tokens.map(({ text, kind }) => ({ text, kind }))).toEqual([
      { text: 'Read', kind: 'latin' },
      { text: '中', kind: 'cjk' },
      { text: '文', kind: 'cjk' },
      { text: 'text', kind: 'latin' },
    ])
    expect(tokens[1].wordBoundaryAfter).toBe(false)
    expect(tokens[2].wordBoundaryAfter).toBe(true)
  })

  it('classifies fullwidth punctuation, curly quotes, and supplementary Han correctly', () => {
    const tokens = tokenizeText('“𠮷！”')

    expect(tokens.map(({ text, kind }) => ({ text, kind }))).toEqual([
      { text: '“', kind: 'punctuation' },
      { text: '𠮷', kind: 'cjk' },
      { text: '！', kind: 'punctuation' },
      { text: '”', kind: 'punctuation' },
    ])
    expect(isCjkGrapheme('𠮷')).toBe(true)
  })

  it('counts a decomposed kana with its combining mark as one grapheme', () => {
    const tokens = tokenizeText('か\u3099')

    expect(tokens).toHaveLength(1)
    expect(tokens[0]).toMatchObject({ text: 'か\u3099', kind: 'cjk' })
  })

  it('keeps full-width and half-width Japanese prolonged sounds in the CJK profile', () => {
    for (const text of ['スーパー', 'ケーキ', 'ｽｰﾊﾟｰ']) {
      const tokens = tokenizeText(text)
      expect(tokens.every((token) => token.kind === 'cjk')).toBe(true)
      expect(tokens.map((token) => token.text).join('')).toBe(text)
    }
    expect(isCjkGrapheme('ー')).toBe(true)
    expect(isCjkGrapheme('ｰ')).toBe(true)
  })

  it('does not count punctuation as a Latin or CJK reading unit', () => {
    const tokens = tokenizeText('Hello，世界。')

    expect(tokens.filter((token) => token.kind === 'latin')).toHaveLength(1)
    expect(tokens.filter((token) => token.kind === 'cjk')).toHaveLength(2)
    expect(tokens.filter((token) => token.kind === 'punctuation')).toHaveLength(2)
  })
})
