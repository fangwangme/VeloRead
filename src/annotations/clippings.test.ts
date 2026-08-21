import { describe, expect, it } from 'vitest'
import type { Annotation, BookRecord } from '../platform/types'
import {
  clippingsFileName,
  formatAllClippings,
  formatBookClippings,
  formatTimestamp,
  sortBooks,
  sortByPosition,
} from './clippings'

function book(overrides: Partial<BookRecord> = {}): BookRecord {
  return {
    id: 'b1',
    title: 'The Selfish Gene',
    author: 'Richard Dawkins',
    language: 'en',
    coverMime: null,
    fileSize: 1,
    addedAt: '2026-08-01T00:00:00.000Z',
    lastReadAt: null,
    ...overrides,
  }
}

function annotation(overrides: Partial<Annotation> = {}): Annotation {
  return {
    id: 'a1',
    bookId: 'b1',
    cfiRange: 'epubcfi(/6/4[chap01]!/4/2/2[p1]/1:0)',
    text: 'A passage.',
    note: '',
    color: 'yellow',
    chapterTitle: 'One',
    source: 'local',
    createdAt: '2016-03-26T14:59:39.000Z',
    updatedAt: '2016-03-26T14:59:39.000Z',
    ...overrides,
  }
}

describe('sortByPosition', () => {
  it('orders by place in the book, not by when it was highlighted', () => {
    const later = annotation({
      id: 'later',
      cfiRange: 'epubcfi(/6/4[chap01]!/4/2/20[p9]/1:0)',
      createdAt: '2020-01-01T00:00:00.000Z',
    })
    const earlier = annotation({
      id: 'earlier',
      cfiRange: 'epubcfi(/6/4[chap01]!/4/2/2[p1]/1:0)',
      createdAt: '2026-01-01T00:00:00.000Z',
    })
    expect(sortByPosition([earlier, later]).map((a) => a.id)).toEqual(['earlier', 'later'])
    expect(sortByPosition([later, earlier]).map((a) => a.id)).toEqual(['earlier', 'later'])
  })

  it('falls back to time when a row has no usable CFI', () => {
    // Imported Kindle rows cannot always be anchored, and must not be dropped
    // or throw the whole export.
    const imported = annotation({ id: 'imported', cfiRange: '', createdAt: '2015-01-01T00:00:00Z' })
    const anchored = annotation({ id: 'anchored', createdAt: '2016-01-01T00:00:00Z' })
    expect(sortByPosition([anchored, imported]).map((a) => a.id)).toHaveLength(2)
  })
})

describe('formatBookClippings', () => {
  it('writes the Kindle record shape', () => {
    const text = formatBookClippings({ book: book(), annotations: [annotation()] })
    const lines = text.split('\n')
    expect(lines[0]).toBe('The Selfish Gene (Richard Dawkins)')
    expect(lines[1]).toMatch(/^- Your Highlight \| location 1 \| Added on \w+, \d+ \w+ \d{4} \d{2}:\d{2}:\d{2}$/)
    expect(lines[2]).toBe('')
    expect(lines[3]).toBe('A passage.')
    expect(lines[4]).toBe('==========')
  })

  it('splits a highlight with a note into two records, highlight first', () => {
    const text = formatBookClippings({
      book: book(),
      annotations: [annotation({ note: 'Worth remembering.' })],
    })
    expect(text.match(/- Your Highlight/g)).toHaveLength(1)
    expect(text.match(/- Your Note/g)).toHaveLength(1)
    expect(text.indexOf('- Your Highlight')).toBeLessThan(text.indexOf('- Your Note'))
    expect(text).toContain('Worth remembering.')
  })

  it('leaves out a note that is only whitespace', () => {
    const text = formatBookClippings({ book: book(), annotations: [annotation({ note: '   ' })] })
    expect(text).not.toContain('- Your Note')
  })

  it('numbers locations in reading order, from one', () => {
    const text = formatBookClippings({
      book: book(),
      annotations: [
        annotation({ id: 'b', cfiRange: 'epubcfi(/6/4[chap01]!/4/2/20[p9]/1:0)', text: 'Second.' }),
        annotation({ id: 'a', cfiRange: 'epubcfi(/6/4[chap01]!/4/2/2[p1]/1:0)', text: 'First.' }),
      ],
    })
    expect(text.indexOf('First.')).toBeLessThan(text.indexOf('Second.'))
    expect(text).toContain('location 1 |')
    expect(text).toContain('location 2 |')
  })

  it('drops the parentheses when the book has no author', () => {
    const text = formatBookClippings({
      book: book({ author: null }),
      annotations: [annotation()],
    })
    expect(text.split('\n')[0]).toBe('The Selfish Gene')
  })
})

describe('formatAllClippings', () => {
  it('keeps each book together and orders books predictably', () => {
    const text = formatAllClippings([
      { book: book({ id: 'z', title: 'Zeta' }), annotations: [annotation({ text: 'zed' })] },
      { book: book({ id: 'a', title: 'Alpha' }), annotations: [annotation({ text: 'alpha' })] },
    ])
    expect(text.indexOf('alpha')).toBeLessThan(text.indexOf('zed'))
    expect(sortBooks([{ book: book({ title: 'B' }), annotations: [] }])).toHaveLength(1)
  })

  it('skips books with nothing highlighted rather than emitting a bare title', () => {
    const text = formatAllClippings([
      { book: book({ id: 'empty', title: 'Empty' }), annotations: [] },
      { book: book(), annotations: [annotation()] },
    ])
    expect(text).not.toContain('Empty')
  })
})

describe('formatTimestamp', () => {
  it('writes the Kindle shape in English', () => {
    expect(formatTimestamp('2016-03-26T14:59:39.000Z')).toMatch(
      /^\w+, \d{1,2} \w+ \d{4} \d{2}:\d{2}:\d{2}$/,
    )
  })

  it('keeps an unparseable timestamp instead of dropping it', () => {
    expect(formatTimestamp('not a date')).toBe('not a date')
  })
})

describe('clippingsFileName', () => {
  it('strips what a filesystem would choke on', () => {
    expect(clippingsFileName('A/B: C*?')).toBe('A B C.txt')
    expect(clippingsFileName('...hidden')).toBe('hidden.txt')
    expect(clippingsFileName('   ')).toBe('Untitled.txt')
    expect(clippingsFileName('x'.repeat(200)).length).toBeLessThanOrEqual(84)
  })
})
