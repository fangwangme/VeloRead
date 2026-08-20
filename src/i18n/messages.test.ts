import { describe, expect, it } from 'vitest'
import { zh } from './messages.zh'
import { en } from './messages.en'
import { format } from './format'
import { createTranslate } from './context'

const placeholders = (value: string) =>
  [...value.matchAll(/\{(\w+)\}/gu)].map((match) => match[1]).sort()

describe('dictionaries', () => {
  it('cover exactly the same keys', () => {
    expect(Object.keys(en).sort()).toEqual(Object.keys(zh).sort())
  })

  it('use the same placeholders in both languages', () => {
    // A translation that drops `{n}` renders a sentence with a hole in it, and
    // TypeScript cannot see inside the string.
    for (const key of Object.keys(zh) as (keyof typeof zh)[]) {
      expect({ key, names: placeholders(en[key]) }).toEqual({
        key,
        names: placeholders(zh[key]),
      })
    }
  })

  it('has no empty message', () => {
    for (const [key, value] of Object.entries({ ...zh })) {
      expect(value.length, key).toBeGreaterThan(0)
    }
    for (const [key, value] of Object.entries(en)) {
      expect(value.length, key).toBeGreaterThan(0)
    }
  })

  it('pairs every .one with an .other', () => {
    const keys = new Set(Object.keys(zh))
    for (const key of keys) {
      if (key.endsWith('.one')) {
        expect(keys.has(`${key.slice(0, -4)}.other`), key).toBe(true)
      }
    }
  })
})

describe('format', () => {
  it('substitutes named placeholders and leaves unknown ones alone', () => {
    expect(format('{a} and {b}', { a: 1, b: 'two' })).toBe('1 and two')
    expect(format('{missing}', { other: 1 })).toBe('{missing}')
    expect(format('nothing to do')).toBe('nothing to do')
  })
})

describe('createTranslate', () => {
  it('picks the singular only for exactly one', () => {
    const t = createTranslate('en')
    expect(t.plural('library.bookCount', 1)).toBe('1 book')
    expect(t.plural('library.bookCount', 2)).toBe('2 books')
    expect(t.plural('library.bookCount', 0)).toBe('0 books')
  })

  it('translates into the requested language', () => {
    expect(createTranslate('zh')('library.title')).toBe('书库')
    expect(createTranslate('en')('library.title')).toBe('Library')
  })
})
