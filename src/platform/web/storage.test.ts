import { beforeEach, describe, expect, it } from 'vitest'
import { createWebStorage } from './storage'
import { buildFixtureEpub } from '../../test/fixture-epub'
import type { BookRecord, StoragePort } from '../types'

function record(overrides: Partial<BookRecord> = {}): BookRecord {
  return {
    id: crypto.randomUUID(),
    title: 'Fixture Book',
    author: 'Ada Fixture',
    language: 'en',
    coverMime: 'image/png',
    fileSize: 1234,
    addedAt: '2026-08-15T10:00:00.000Z',
    lastReadAt: null,
    ...overrides,
  }
}

async function freshStorage(): Promise<StoragePort> {
  const storage = createWebStorage()
  await storage.init()
  for (const book of await storage.listBooks()) await storage.deleteBook(book.id)
  return storage
}

describe('web storage port', () => {
  let storage: StoragePort

  beforeEach(async () => {
    storage = await freshStorage()
  })

  it('reads back a reading position exactly as it was written', async () => {
    const book = record()
    await storage.addBook({ record: book, data: new Uint8Array([1, 2, 3]), cover: null })

    expect(await storage.getProgress(book.id)).toBeNull()

    const progress = {
      bookId: book.id,
      cfi: 'epubcfi(/6/4[chapter1]!/4/2/6[para3]/1:120)',
      percentage: 0.4213,
      updatedAt: '2026-08-15T12:34:56.000Z',
    }
    await storage.saveProgress(progress)

    expect(await storage.getProgress(book.id)).toEqual(progress)
  })

  it('stamps lastReadAt when progress is saved, which reorders the shelf', async () => {
    const older = record({ addedAt: '2026-08-14T10:00:00.000Z', title: 'Older' })
    const newer = record({ addedAt: '2026-08-15T10:00:00.000Z', title: 'Newer' })
    await storage.addBook({ record: older, data: new Uint8Array([1]), cover: null })
    await storage.addBook({ record: newer, data: new Uint8Array([2]), cover: null })

    // Newest import first while nothing has been read.
    expect((await storage.listBooks()).map((book) => book.title)).toEqual(['Newer', 'Older'])

    await storage.saveProgress({
      bookId: older.id,
      cfi: 'epubcfi(/6/4!/4/2/2)',
      percentage: 0.1,
      updatedAt: '2026-08-15T20:00:00.000Z',
    })

    const shelf = await storage.listBooks()
    expect(shelf.map((book) => book.title)).toEqual(['Older', 'Newer'])
    expect(shelf[0].lastReadAt).toBe('2026-08-15T20:00:00.000Z')
  })

  it('round-trips book bytes and cover bytes', async () => {
    const epub = await buildFixtureEpub()
    const cover = new Uint8Array([137, 80, 78, 71])
    const book = record({ fileSize: epub.byteLength })

    await storage.addBook({ record: book, data: epub, cover })

    expect(await storage.readBookFile(book.id)).toEqual(epub)
    expect(await storage.readCover(book.id)).toEqual(cover)
  })

  it('saves and reads bookSettings and appSettings', async () => {
    const book = record()
    await storage.addBook({ record: book, data: new Uint8Array([1]), cover: null })

    expect(await storage.getBookSettings(book.id)).toBeNull()

    const bookSettings = {
      bookId: book.id,
      styleId: 'sepia' as const,
      overrides: { fontSizeStep: 1, justify: true },
      flow: 'paginated' as const,
      updatedAt: '2026-08-16T12:00:00.000Z',
    }
    await storage.saveBookSettings(bookSettings)
    expect(await storage.getBookSettings(book.id)).toEqual(bookSettings)

    await storage.saveAppSettings({ defaultStyleId: 'night', pacerWpm: 300 })
    expect(await storage.getAppSettings()).toEqual({ defaultStyleId: 'night', pacerWpm: 300 })
  })

  it('adds, lists, and deletes bookmarks', async () => {
    const book = record()
    await storage.addBook({ record: book, data: new Uint8Array([1]), cover: null })

    const bm1 = {
      id: 'bm-1',
      bookId: book.id,
      cfi: 'epubcfi(/6/2!/4/2)',
      text: 'First bookmark quote',
      createdAt: '2026-08-16T10:00:00.000Z',
    }
    const bm2 = {
      id: 'bm-2',
      bookId: book.id,
      cfi: 'epubcfi(/6/4!/4/10)',
      text: 'Second bookmark quote',
      createdAt: '2026-08-16T11:00:00.000Z',
    }

    await storage.addBookmark(bm1)
    await storage.addBookmark(bm2)

    expect(await storage.listBookmarks(book.id)).toEqual([bm1, bm2])

    await storage.deleteBookmark('bm-1')
    expect(await storage.listBookmarks(book.id)).toEqual([bm2])
  })

  it('leaves nothing behind after a delete', async () => {
    const book = record()
    await storage.addBook({ record: book, data: new Uint8Array([1, 2, 3]), cover: new Uint8Array([4]) })
    await storage.saveProgress({
      bookId: book.id,
      cfi: 'epubcfi(/6/4!/4/2/2)',
      percentage: 0.5,
      updatedAt: '2026-08-15T12:00:00.000Z',
    })
    await storage.saveBookSettings({
      bookId: book.id,
      styleId: 'sepia',
      overrides: {},
      updatedAt: '2026-08-15T12:00:00.000Z',
    })
    await storage.addBookmark({
      id: 'bm-1',
      bookId: book.id,
      cfi: 'epubcfi(/6/4!/4/2/2)',
      text: 'Bookmark',
      createdAt: '2026-08-15T12:00:00.000Z',
    })

    await storage.deleteBook(book.id)

    expect(await storage.listBooks()).toEqual([])
    expect(await storage.readCover(book.id)).toBeNull()
    expect(await storage.getProgress(book.id)).toBeNull()
    expect(await storage.getBookSettings(book.id)).toBeNull()
    expect(await storage.listBookmarks(book.id)).toEqual([])
    await expect(storage.readBookFile(book.id)).rejects.toThrow()
  })

  it('records reading sessions and calculates overall stats and streaks', async () => {
    const book = record()
    await storage.addBook({ record: book, data: new Uint8Array([1]), cover: null })

    const s1 = {
      id: 'sess-1',
      bookId: book.id,
      date: '2026-08-16',
      durationSeconds: 180,
      wordsRead: 800,
      updatedAt: '2026-08-16T10:00:00.000Z',
    }
    const s2 = {
      id: 'sess-2',
      bookId: book.id,
      date: '2026-08-16',
      durationSeconds: 120,
      wordsRead: 400,
      updatedAt: '2026-08-16T11:00:00.000Z',
    }

    await storage.recordReadingSession(s1)
    await storage.recordReadingSession(s2)

    const stats = await storage.getReadingStats()
    expect(stats.totalDurationMinutes).toBe(5)
    expect(stats.totalWordsRead).toBe(1200)
    expect(stats.totalBooksRead).toBe(1)
    expect(stats.dailyStats['2026-08-16'].durationMinutes).toBe(5)
    expect(stats.dailyStats['2026-08-16'].wordsRead).toBe(1200)
  })
})
