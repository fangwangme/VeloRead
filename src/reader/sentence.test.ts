import { describe, expect, it } from 'vitest'
import { sentenceAt } from './sentence'

const PARAGRAPH =
  'The gene is the unit of selection. He kept running until it was dark. Nobody followed.'

/** Index of the first occurrence of `word`, as the renderer would compute it. */
const at = (text: string, word: string) => text.indexOf(word)

describe('sentenceAt', () => {
  it('takes the sentence the word is in, not the paragraph', () => {
    expect(sentenceAt(PARAGRAPH, at(PARAGRAPH, 'running'))).toBe(
      'He kept running until it was dark.',
    )
  })

  it('handles a word in the first and last sentences', () => {
    expect(sentenceAt(PARAGRAPH, at(PARAGRAPH, 'gene'))).toBe(
      'The gene is the unit of selection.',
    )
    expect(sentenceAt(PARAGRAPH, at(PARAGRAPH, 'followed'))).toBe('Nobody followed.')
  })

  it('folds the whitespace a reflowed page leaves behind', () => {
    const text = 'One thing.\n   He kept\n  running.\tThen stopped.'
    expect(sentenceAt(text, text.indexOf('running'))).toBe('He kept running.')
  })

  it('keeps a quoted sentence whole, closing punctuation included', () => {
    const text = '“It was dark,” she said. He kept running.'
    expect(sentenceAt(text, text.indexOf('said'))).toBe('“It was dark,” she said.')
  })

  it('does not split on an abbreviation', () => {
    const text = 'Mr. Darcy kept running. She did not.'
    expect(sentenceAt(text, text.indexOf('running'))).toBe('Mr. Darcy kept running.')
  })

  it('handles CJK terminators', () => {
    const text = '他一直在跑。她没有跟上。'
    expect(sentenceAt(text, text.indexOf('跑'))).toBe('他一直在跑。')
  })

  it('takes a window around the word when there is no punctuation at all', () => {
    const text = 'word '.repeat(300)
    const sentence = sentenceAt(text, 700)
    expect(sentence.length).toBeLessThanOrEqual(400)
    expect(sentence.length).toBeGreaterThan(0)
  })

  it('has nothing to say about empty text', () => {
    expect(sentenceAt('', 0)).toBe('')
    expect(sentenceAt('   ', 1)).toBe('')
  })

  it('clamps an offset outside the text', () => {
    expect(sentenceAt(PARAGRAPH, -5)).toBe('The gene is the unit of selection.')
    expect(sentenceAt(PARAGRAPH, 10_000)).toBe('Nobody followed.')
  })
})
