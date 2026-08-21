import { describe, expect, it } from 'vitest'
import {
  countReadingUnits,
  groupWordsIntoChunks,
  isCjkChar,
  type WordItem,
} from './chunker'

/** A two-column spread 400px wide per column with a 40px gutter. */
const COLUMN_PITCH = 440

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
    expect(chunks[0].units.latinWords).toBe(3)
    expect(chunks[0].rect.left).toBe(0)
    expect(chunks[0].rect.width).toBe(140) // 100 + 40 - 0

    expect(chunks[1].text).toBe('fox jumps over')
    expect(chunks[1].units.latinWords).toBe(3)

    expect(chunks[2].text).toBe('lazy')
    expect(chunks[2].units.latinWords).toBe(1)
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
    expect(chunks[0].units.latinWords).toBe(2)
    expect(chunks[0].rect.top).toBe(10)

    // Second chunk has 3 words on the next line
    expect(chunks[1].text).toBe('next line text')
    expect(chunks[1].units.latinWords).toBe(3)
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
    expect(chunks[0].units.cjkCharacters).toBe(8)
    expect(chunks[1].text).toBe('海流')
    expect(chunks[1].units.cjkCharacters).toBe(2)
  })

  it('uses four CJK graphemes per chunk by default', () => {
    const chars = Array.from('白日依山尽').map((char, index) =>
      makeWord(char, index * 20, 10, 20, 20, 'cjk'),
    )

    const chunks = groupWordsIntoChunks(chars, {
      latinWpm: 250,
      cjkCpm: 300,
    })

    expect(chunks.map((chunk) => chunk.units.cjkCharacters)).toEqual([4, 1])
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

    expect(chunk.units.cjkCharacters).toBe(8)
    expect(chunk.dwellMs).toBe(1600)
    expect((chunk.units.cjkCharacters / chunk.dwellMs) * 60_000).toBe(300)
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

    expect(chunks.map((chunk) => [chunk.units, chunk.dwellMs])).toEqual([
      [{ latinWords: 0, cjkCharacters: 2 }, 400],
      [{ latinWords: 2, cjkCharacters: 0 }, 480],
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
    expect(chunk.units.cjkCharacters).toBe(2)
    expect(chunk.dwellMs).toBe(520)
    expect(countReadingUnits(words)).toEqual({ latinWords: 0, cjkCharacters: 2 })
  })
})

describe('Pacer Chunker · column awareness', () => {
  it('does not group the end of one column with the start of the next', () => {
    // A two-column spread: both lines are the Nth line of their column, so they
    // share a `top`. Only the column pitch can tell them apart.
    const words = [
      makeWord('end', 300, 10),
      makeWord('of', 350, 10),
      makeWord('start', 460, 10),
      makeWord('of', 520, 10),
    ]

    const chunks = groupWordsIntoChunks(words, {
      latinWpm: 250,
      cjkCpm: 300,
      latinChunkSize: 3,
      columnPitch: COLUMN_PITCH,
    })

    expect(chunks.map((chunk) => chunk.text)).toEqual(['end of', 'start of'])
    // The union rect of a chunk that spanned both columns would be as wide as
    // the whole spread; each of these stays inside its own column.
    for (const chunk of chunks) {
      expect(chunk.rect.width).toBeLessThan(COLUMN_PITCH)
    }
  })

  it('falls back to comparing tops when no column pitch is available', () => {
    // Scrolled flow and any failure to read the layout land here. It must still
    // produce chunks — the old, column-blind behaviour is the fallback.
    const words = [
      makeWord('end', 300, 10),
      makeWord('of', 350, 10),
      makeWord('start', 460, 10),
      makeWord('of', 520, 10),
    ]

    const chunks = groupWordsIntoChunks(words, {
      latinWpm: 250,
      cjkCpm: 300,
      latinChunkSize: 3,
    })

    expect(chunks.map((chunk) => chunk.text)).toEqual(['end of start', 'of'])
  })
})

describe('Pacer Chunker · whole-line cursor', () => {
  it('makes one chunk per line instead of splitting by chunk size', () => {
    const words = [
      makeWord('one', 0, 10),
      makeWord('two', 50, 10),
      makeWord('three', 100, 10),
      makeWord('four', 150, 10),
      makeWord('five', 200, 10),
      makeWord('next', 0, 40),
      makeWord('line', 50, 40),
    ]

    const chunks = groupWordsIntoChunks(words, {
      latinWpm: 250,
      cjkCpm: 300,
      latinChunkSize: 3,
      wholeLine: true,
    })

    expect(chunks.map((chunk) => chunk.text)).toEqual(['one two three four five', 'next line'])
    expect(chunks[0].rect.top).toBe(10)
    expect(chunks[1].rect.top).toBe(40)
  })

  it('still stops at a column boundary', () => {
    const words = [
      makeWord('left', 300, 10),
      makeWord('column', 350, 10),
      makeWord('right', 460, 10),
      makeWord('column', 520, 10),
    ]

    const chunks = groupWordsIntoChunks(words, {
      latinWpm: 250,
      cjkCpm: 300,
      wholeLine: true,
      columnPitch: COLUMN_PITCH,
    })

    expect(chunks.map((chunk) => chunk.text)).toEqual(['left column', 'right column'])
    for (const chunk of chunks) {
      expect(chunk.rect.width).toBeLessThan(COLUMN_PITCH)
    }
  })

  it('does not break a mixed-script line into separate chunks', () => {
    const words = [
      makeWord('中', 0, 10, 20, 20, 'cjk'),
      makeWord('文', 20, 10, 20, 20, 'cjk'),
      makeWord('and', 50, 10),
      makeWord('English', 100, 10),
    ]

    const chunks = groupWordsIntoChunks(words, {
      latinWpm: 250,
      cjkCpm: 300,
      wholeLine: true,
    })

    expect(chunks).toHaveLength(1)
    expect(chunks[0].units).toEqual({ latinWords: 2, cjkCharacters: 2 })
  })

  it('reports the line rect every chunk sits on', () => {
    const words = [
      makeWord('one', 0, 10),
      makeWord('two', 50, 10),
      makeWord('three', 100, 10),
      makeWord('four', 150, 10),
    ]

    const chunks = groupWordsIntoChunks(words, {
      latinWpm: 250,
      cjkCpm: 300,
      latinChunkSize: 3,
    })

    // Two chunks, one line: the band the `chunk-in-line` cursor draws is the
    // same for both, and covers the whole line rather than the chunk.
    expect(chunks).toHaveLength(2)
    for (const chunk of chunks) {
      expect(chunk.lineRect).toEqual({ left: 0, top: 10, width: 190, height: 20 })
    }
  })
})

describe('Pacer Chunker · mixed dwell', () => {
  it('times each script by its own rate and adds the punctuation pause', () => {
    const words = [
      makeWord('中', 0, 10, 20, 20, 'cjk'),
      makeWord('文', 20, 10, 20, 20, 'cjk'),
      makeWord('，', 40, 10, 20, 20, 'punctuation'),
      makeWord('two', 60, 10),
      makeWord('words', 110, 10),
    ]

    const [chunk] = groupWordsIntoChunks(words, {
      latinWpm: 250,
      cjkCpm: 300,
      wholeLine: true,
    })

    // 2 characters at 300 cpm = 400ms, 2 words at 250 wpm = 480ms, comma = 60ms.
    expect(chunk.units).toEqual({ latinWords: 2, cjkCharacters: 2 })
    expect(chunk.dwellMs).toBe(940)
  })

  it('leaves single-script dwell exactly where it was', () => {
    const latin = groupWordsIntoChunks(
      [makeWord('a', 0, 10), makeWord('b', 50, 10), makeWord('c', 100, 10)],
      { latinWpm: 250, cjkCpm: 300, latinChunkSize: 3 },
    )
    const cjk = groupWordsIntoChunks(
      Array.from('白日依山').map((char, index) => makeWord(char, index * 20, 10, 20, 20, 'cjk')),
      { latinWpm: 250, cjkCpm: 300, cjkChunkSize: 4 },
    )

    expect(latin[0].dwellMs).toBe(720) // (3 / 250) * 60_000
    expect(cjk[0].dwellMs).toBe(800) // (4 / 300) * 60_000
  })
})
