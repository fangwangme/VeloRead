import { beforeEach, describe, expect, it } from 'vitest'
import { createWebDict } from './dict'
import { createWebStorage } from './storage'
import type { BookRecord, DictPort, StoragePort, VocabularyLookupInput } from '../types'

function record(id: string, title: string): BookRecord {
  return {
    id,
    title,
    author: 'Ada Fixture',
    language: 'en',
    coverMime: null,
    fileSize: 1234,
    addedAt: '2026-08-20T10:00:00.000Z',
    lastReadAt: null,
  }
}

function lookupInput(overrides: Partial<VocabularyLookupInput> = {}): VocabularyLookupInput {
  return {
    wordId: crypto.randomUUID(),
    lookupId: crypto.randomUUID(),
    word: 'running',
    stem: 'run',
    lang: 'en',
    bookId: null,
    locator: '{"format":"epub","cfi":"epubcfi(/6/2!/4/2)"}',
    sentence: 'He kept running.',
    createdAt: '2026-08-20T12:00:00.000Z',
    ...overrides,
  }
}

let dict: DictPort
let storage: StoragePort

beforeEach(async () => {
  storage = createWebStorage()
  await storage.init()
  dict = createWebDict()
  await dict.init()
  for (const entry of await dict.listVocabulary()) await dict.deleteWord(entry.word.id)
  for (const book of await storage.listBooks()) await storage.deleteBook(book.id)
})

describe('the browser dictionary', () => {
  it('says plainly that it has none, rather than that the word is unknown', async () => {
    // 22 MB cannot be indexed on disk in a page, and loading it into memory is
    // the regression the desktop build exists to avoid.
    expect(await dict.status()).toEqual({ ready: false, entries: 0 })
    expect(await dict.lookup(['running', 'run'])).toEqual({ known: [], entry: null })
  })
})

describe('the browser vocabulary list', () => {
  it('records a word with the sentence it was in', async () => {
    const word = await dict.recordLookup(lookupInput())

    const entries = await dict.listVocabulary()
    expect(entries).toHaveLength(1)
    expect(entries[0].word).toEqual(word)
    expect(entries[0].word.status).toBe('learning')
    expect(entries[0].lookups[0].sentence).toBe('He kept running.')
  })

  it('files one word met in two books as one entry with both sentences', async () => {
    await storage.addBook({
      record: record('book-a', 'A'),
      data: new Uint8Array([1]),
      cover: null,
    })
    await storage.addBook({
      record: record('book-b', 'B'),
      data: new Uint8Array([1]),
      cover: null,
    })

    const first = await dict.recordLookup(
      lookupInput({ bookId: 'book-a', word: 'running', stem: 'run' }),
    )
    const second = await dict.recordLookup(
      lookupInput({
        bookId: 'book-b',
        word: 'ran',
        stem: 'run',
        sentence: 'She ran home.',
        createdAt: '2026-08-20T13:00:00.000Z',
      }),
    )

    // Deduplicated on the stem, and the form first met is the one kept — the
    // same rule `UNIQUE(stem, lang)` enforces on the desktop.
    expect(second.id).toBe(first.id)
    expect(second.word).toBe('running')

    const [entry] = await dict.listVocabulary()
    expect(entry.lookups.map((lookup) => lookup.sentence)).toEqual([
      'He kept running.',
      'She ran home.',
    ])
    expect(entry.lookups.map((lookup) => lookup.bookId)).toEqual(['book-a', 'book-b'])
  })

  it('keeps the words when their book is deleted, and only forgets the source', async () => {
    await storage.addBook({
      record: record('book-a', 'A'),
      data: new Uint8Array([1]),
      cover: null,
    })
    await dict.recordLookup(lookupInput({ bookId: 'book-a' }))

    await storage.deleteBook('book-a')

    const [entry] = await dict.listVocabulary()
    expect(entry.word.stem).toBe('run')
    expect(entry.lookups).toHaveLength(1)
    expect(entry.lookups[0].bookId).toBeNull()
    expect(entry.lookups[0].sentence).toBe('He kept running.')
  })

  it('marks a word known and removes it with its sentences', async () => {
    const word = await dict.recordLookup(lookupInput())

    await dict.setWordStatus(word.id, 'known')
    expect((await dict.listVocabulary())[0].word.status).toBe('known')

    await dict.deleteWord(word.id)
    expect(await dict.listVocabulary()).toEqual([])
  })

  it('lists the newest word first, as the SQLite implementation does', async () => {
    for (const [stem, at] of [
      ['alpha', '2026-08-20T10:00:00.000Z'],
      ['beta', '2026-08-20T11:00:00.000Z'],
      ['gamma', '2026-08-20T09:00:00.000Z'],
    ]) {
      await dict.recordLookup(lookupInput({ word: stem, stem, createdAt: at }))
    }

    const order = (await dict.listVocabulary()).map((entry) => entry.word.word)
    expect(order).toEqual(['beta', 'alpha', 'gamma'])
  })
})
