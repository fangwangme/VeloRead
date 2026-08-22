import { describe, expect, it } from 'vitest'
import type { BookRecord } from '../platform/types'
import { formatVocabulary, type VocabularyExportEntry } from './export'

function book(id: string, title: string): BookRecord {
  return {
    id,
    title,
    author: 'Ada Fixture',
    language: 'en',
    coverMime: null,
    fileSize: 1,
    addedAt: '2026-08-20T09:00:00.000Z',
    lastReadAt: null,
  }
}

const BOOKS = { 'book-a': book('book-a', 'The Selfish Gene') }

const ENTRIES: VocabularyExportEntry[] = [
  {
    word: {
      id: 'w1',
      word: 'running',
      stem: 'run',
      lang: 'en',
      status: 'learning',
      createdAt: '2026-08-20T12:00:00.000Z',
    },
    // Real definitions are several paragraphs of prose, tabs and all.
    definition: 'To move swiftly.\n\nAlso:\tto flow.',
    lookups: [
      {
        id: 'l1',
        vocabularyId: 'w1',
        bookId: 'book-a',
        locator: '{"format":"epub","cfi":"epubcfi(/6/2!/4/2)"}',
        sentence: 'He kept running.',
        createdAt: '2026-08-20T12:00:00.000Z',
      },
      {
        id: 'l2',
        vocabularyId: 'w1',
        bookId: null,
        locator: null,
        sentence: 'She ran home.',
        createdAt: '2026-08-20T13:00:00.000Z',
      },
    ],
  },
  {
    word: {
      id: 'w2',
      word: 'anopheles',
      stem: 'anopheles',
      lang: 'en',
      status: 'known',
      createdAt: '2026-08-19T12:00:00.000Z',
    },
    definition: null,
    lookups: [],
  },
]

const format = () =>
  formatVocabulary({
    entries: ENTRIES,
    books: BOOKS,
    exportedAt: '2026-08-22T10:00:00.000Z',
  })

/**
 * The acceptance point from docs/specs/vocabulary.md §9: "the export can be
 * parsed by a simple script". This *is* that script — if the format ever stops
 * being trivially parseable, this stops working.
 */
function parse(text: string) {
  const records = text
    .split('\n==========\n')
    .slice(1)
    .filter((block) => block.trim().length > 0)
  return records.map((block) => {
    const fields: Record<string, string | undefined> = {}
    const sentences: string[][] = []
    for (const line of block.split('\n')) {
      const [name, ...values] = line.split('\t')
      if (name === 'SENTENCE') sentences.push(values)
      else fields[name] = values[0]
    }
    return { fields, sentences }
  })
}

describe('formatVocabulary', () => {
  it('names its own field order in the header', () => {
    const header = format().split('\n==========\n')[0]
    for (const field of ['WORD', 'STEM', 'LANG', 'STATUS', 'ADDED', 'DEFINITION', 'SENTENCE']) {
      expect(header).toContain(field)
    }
    expect(header).toContain('2026-08-22T10:00:00.000Z')
  })

  it('round-trips through a twenty-line parser', () => {
    const parsed = parse(format())

    expect(parsed).toHaveLength(2)
    expect(parsed[0].fields).toMatchObject({
      WORD: 'running',
      STEM: 'run',
      LANG: 'en',
      STATUS: 'learning',
      ADDED: '2026-08-20T12:00:00.000Z',
    })
    expect(parsed[1].fields).toMatchObject({ WORD: 'anopheles', STATUS: 'known' })
  })

  it('keeps every sentence, with the book it came from', () => {
    const [running] = parse(format())

    expect(running.sentences).toHaveLength(2)
    expect(running.sentences[0][0]).toBe('He kept running.')
    expect(running.sentences[0][1]).toBe('The Selfish Gene')
    expect(running.sentences[0][2]).toContain('epubcfi')
    // A sentence whose book has been removed keeps the sentence and loses only
    // the title — the sentence is the value.
    expect(running.sentences[1][0]).toBe('She ran home.')
    expect(running.sentences[1][1]).toBe('')
  })

  it('folds the whitespace inside a definition, so a record stays one line per field', () => {
    const [running] = parse(format())
    expect(running.fields.DEFINITION).toBe('To move swiftly. Also: to flow.')
  })

  it('leaves the definition line out when the dictionary had no entry', () => {
    const [, anopheles] = parse(format())
    expect(anopheles.fields.DEFINITION).toBeUndefined()
    expect(anopheles.sentences).toEqual([])
  })

  it('exports the whole list every time, with no "already exported" marking', () => {
    expect(format()).toBe(format())
  })
})
