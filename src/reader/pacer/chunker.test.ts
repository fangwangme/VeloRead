import { describe, expect, it } from 'vitest'
import { groupWordsIntoChunks, type WordItem } from './chunker'

function makeWord(
  text: string,
  left: number,
  top: number,
  width = 40,
  height = 20,
  isCjk = false,
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
    isCjk,
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

    const chunks = groupWordsIntoChunks(words, { wpm: 250, chunkSize: 3 })

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

    const chunks = groupWordsIntoChunks(words, { wpm: 250, chunkSize: 3 })

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

  it('groups CJK characters by character count (default 8)', () => {
    const chars = [
      makeWord('白', 0, 10, 20, 20, true),
      makeWord('日', 20, 10, 20, 20, true),
      makeWord('依', 40, 10, 20, 20, true),
      makeWord('山', 60, 10, 20, 20, true),
      makeWord('尽', 80, 10, 20, 20, true),
      makeWord('黄', 100, 10, 20, 20, true),
      makeWord('河', 120, 10, 20, 20, true),
      makeWord('入', 140, 10, 20, 20, true),
      makeWord('海', 160, 10, 20, 20, true),
      makeWord('流', 180, 10, 20, 20, true),
    ]

    const chunks = groupWordsIntoChunks(chars, { wpm: 250, cjkChunkSize: 8 })

    expect(chunks).toHaveLength(2)
    expect(chunks[0].text).toBe('白日依山尽黄河入')
    expect(chunks[0].wordCount).toBe(8)
    expect(chunks[1].text).toBe('海流')
    expect(chunks[1].wordCount).toBe(2)
  })

  it('calculates dwell and animation time accurately', () => {
    const words = [makeWord('word1', 0, 0), makeWord('word2', 50, 0), makeWord('word3', 100, 0)]
    // At 250 wpm: 3 words -> (3 / 250) * 60,000 = 720ms
    const chunks = groupWordsIntoChunks(words, { wpm: 250, chunkSize: 3 })
    expect(chunks[0].dwellMs).toBe(720)
    expect(chunks[0].animMs).toBe(180) // min(720*0.5, 180) = 180ms
  })
})
