import { describe, expect, it } from 'vitest'
import {
  countReadingUnits,
  groupWordsIntoChunks,
  isCjkChar,
  type WordItem,
} from './chunker'

function makeWord(
  text: string,
  left: number,
  top: number,
  width = 40,
  height = 20,
  kind: WordItem['kind'] = 'latin',
): WordItem {
  return {
    text,
    rect: {
      left,
      top,
      width,
      height,
      right: left + width,
      bottom: top + height,
    },
    kind,
    wordBoundaryAfter: true,
  }
}

describe('Pacer Chunker', () => {
  it('groups English words into 3-word chunks by default', () => {
    const words = [
      makeWord('The', 0, 10),
      makeWord('quick', 50, 10),
      makeWord('brown', 100, 10),
      makeWord('fox', 150, 10),
      makeWord('jumps', 200, 10),
      makeWord('over', 250, 10),
      makeWord('lazy', 300, 10),
    ]

    const chunks = groupWordsIntoChunks(words, {
      latinWpm: 250,
      cjkCpm: 300,
      latinChunkSize: 3,
    })

    expect(chunks).toHaveLength(3)
    expect(chunks[0].text).toBe('The quick brown')
    expect(chunks[0].wordCount).toBe(3)
    expect(chunks[0].rect.left).toBe(0)
    expect(chunks[0].rect.width).toBe(140) // 100 + 40 - 0

    expect(chunks[1].text).toBe('fox jumps over')
    expect(chunks[1].wordCount).toBe(3)

    expect(chunks[2].text).toBe('lazy')
    expect(chunks[2].wordCount).toBe(1)
  })

  it('breaks groups at the end of a line even if group is not full', () => {
    // 2 words on line 1, then line wraps to top = 40
    const words = [
      makeWord('Hello', 0, 10),
      makeWord('world', 50, 10),
      makeWord('next', 0, 40),
      makeWord('line', 50, 40),
      makeWord('text', 100, 40),
    ]

    const chunks = groupWordsIntoChunks(words, {
      latinWpm: 250,
      cjkCpm: 300,
      latinChunkSize: 3,
    })

    expect(chunks).toHaveLength(2)
    // First chunk has only 2 words because line ended
    expect(chunks[0].text).toBe('Hello world')
    expect(chunks[0].wordCount).toBe(2)
    expect(chunks[0].rect.top).toBe(10)

    // Second chunk has 3 words on the next line
    expect(chunks[1].text).toBe('next line text')
    expect(chunks[1].wordCount).toBe(3)
    expect(chunks[1].rect.top).toBe(40)
  })

  it('groups CJK characters by the configured character count', () => {
    const chars = [
      makeWord('白', 0, 10, 20, 20, 'cjk'),
      makeWord('日', 20, 10, 20, 20, 'cjk'),
      makeWord('依', 40, 10, 20, 20, 'cjk'),
      makeWord('山', 60, 10, 20, 20, 'cjk'),
      makeWord('尽', 80, 10, 20, 20, 'cjk'),
      makeWord('黄', 100, 10, 20, 20, 'cjk'),
      makeWord('河', 120, 10, 20, 20, 'cjk'),
      makeWord('入', 140, 10, 20, 20, 'cjk'),
      makeWord('海', 160, 10, 20, 20, 'cjk'),
      makeWord('流', 180, 10, 20, 20, 'cjk'),
    ]

    const chunks = groupWordsIntoChunks(chars, {
      latinWpm: 250,
      cjkCpm: 300,
      cjkChunkSize: 8,
    })

    expect(chunks).toHaveLength(2)
    expect(chunks[0].text).toBe('白日依山尽黄河入')
    expect(chunks[0].wordCount).toBe(8)
    expect(chunks[1].text).toBe('海流')
    expect(chunks[1].wordCount).toBe(2)
  })

  it('uses four CJK graphemes per chunk by default', () => {
    const chars = Array.from('白日依山尽').map((char, index) =>
      makeWord(char, index * 20, 10, 20, 20, 'cjk'),
    )

    const chunks = groupWordsIntoChunks(chars, {
      latinWpm: 250,
      cjkCpm: 300,
    })

    expect(chunks.map((chunk) => chunk.wordCount)).toEqual([4, 1])
  })

  it('treats CJK speed as characters per minute without a hidden conversion', () => {
    const chars = Array.from('白日依山尽黄河入').map((char, index) =>
      makeWord(char, index * 20, 10, 20, 20, 'cjk'),
    )

    const [chunk] = groupWordsIntoChunks(chars, {
      latinWpm: 250,
      cjkCpm: 300,
      cjkChunkSize: 8,
    })

    expect(chunk.wordCount).toBe(8)
    expect(chunk.dwellMs).toBe(1600)
    expect((chunk.wordCount / chunk.dwellMs) * 60_000).toBe(300)
  })

  it('recognizes Chinese, Japanese, and Korean graphemes without counting punctuation', () => {
    expect(isCjkChar('阅')).toBe(true)
    expect(isCjkChar('あ')).toBe(true)
    expect(isCjkChar('한')).toBe(true)
    expect(isCjkChar('。')).toBe(false)
    expect(isCjkChar('A')).toBe(false)
  })

  it('calculates dwell and animation time accurately', () => {
    const words = [makeWord('word1', 0, 0), makeWord('word2', 50, 0), makeWord('word3', 100, 0)]
    // At 250 wpm: 3 words -> (3 / 250) * 60,000 = 720ms
    const chunks = groupWordsIntoChunks(words, {
      latinWpm: 250,
      cjkCpm: 300,
      latinChunkSize: 3,
    })
    expect(chunks[0].dwellMs).toBe(720)
    expect(chunks[0].animMs).toBe(180) // min(720*0.5, 180) = 180ms
  })

  it('uses the matching speed profile for mixed Latin and CJK chunks', () => {
    const words = [
      makeWord('中', 0, 10, 20, 20, 'cjk'),
      makeWord('文', 20, 10, 20, 20, 'cjk'),
      makeWord('two', 50, 10),
      makeWord('words', 100, 10),
    ]

    const chunks = groupWordsIntoChunks(words, {
      latinWpm: 250,
      cjkCpm: 300,
      latinChunkSize: 2,
      cjkChunkSize: 2,
    })

    expect(chunks.map((chunk) => [chunk.unitKind, chunk.dwellMs])).toEqual([
      ['cjk', 400],
      ['latin', 480],
    ])
  })

  it('attaches punctuation without counting it and pauses at sentence endings', () => {
    const words = [
      makeWord('你', 0, 10, 20, 20, 'cjk'),
      makeWord('好', 20, 10, 20, 20, 'cjk'),
      makeWord('！', 40, 10, 20, 20, 'punctuation'),
    ]

    const [chunk] = groupWordsIntoChunks(words, {
      latinWpm: 250,
      cjkCpm: 300,
      cjkChunkSize: 4,
    })

    expect(chunk.text).toBe('你好！')
    expect(chunk.wordCount).toBe(2)
    expect(chunk.dwellMs).toBe(520)
    expect(countReadingUnits(words)).toEqual({ latinWords: 0, cjkCharacters: 2 })
  })
})
