import { describe, expect, it } from 'vitest'
import { compareCodePoints, compareCollections } from './sort'

describe('compareCodePoints', () => {
  it('orders BMP characters by code point', () => {
    // U+5C0F (小) < U+5DE5 (工), which is the order SQLite produces and the
    // opposite of what localeCompare's pinyin collation would give.
    expect(compareCodePoints('小说', '工作')).toBeLessThan(0)
    expect(compareCodePoints('a', 'b')).toBeLessThan(0)
    expect(compareCodePoints('ab', 'abc')).toBeLessThan(0)
    expect(compareCodePoints('同', '同')).toBe(0)
  })

  it('orders an astral character after a high BMP one, like SQLite does', () => {
    // '\u{1F4D8}' is one code point but two UTF-16 units starting at 0xD83D, so
    // a plain `<` comparison puts it *before* 'Ａ'. UTF-8 byte order — what
    // SQLite compares — puts it after, because its code point is larger.
    const astral = '\u{1F4D8}'
    const highBmp = 'Ａ'
    expect(astral < highBmp).toBe(true)
    expect(compareCodePoints(astral, highBmp)).toBeGreaterThan(0)
  })
})

describe('compareCollections', () => {
  it('breaks name ties with the id so the order is total', () => {
    const a = { name: '同名', id: 'a' }
    const b = { name: '同名', id: 'b' }
    expect(compareCollections(a, b)).toBeLessThan(0)
    expect(compareCollections(b, a)).toBeGreaterThan(0)
    expect(compareCollections(a, a)).toBe(0)
  })
})
