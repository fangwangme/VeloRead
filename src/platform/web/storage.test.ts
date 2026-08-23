import { beforeEach, describe, expect, it } from 'vitest'
import { createWebStorage, openVeloreadDb } from './storage'
import { buildFixtureEpub } from '../../test/fixture-epub'
import type { Annotation, Collection, BookRecord, StoragePort } from '../types'

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
  // Collections outlive their books, so clearing books alone leaks them between tests.
  for (const collection of await storage.listCollections()) {
    await storage.deleteCollection(collection.id)
  }
  return storage
}

async function seedDevelopmentV2Database(name: string): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    const request = indexedDB.open(name, 2)
    request.onupgradeneeded = () => {
      const db = request.result
      const books = db.createObjectStore('books', { keyPath: 'id' })
      const files = db.createObjectStore('files')
      const covers = db.createObjectStore('covers')
      const progress = db.createObjectStore('progress', { keyPath: 'bookId' })
      const settings = db.createObjectStore('book_settings', { keyPath: 'bookId' })
      const appSettings = db.createObjectStore('app_settings', { keyPath: 'key' })
      const bookmarks = db.createObjectStore('bookmarks', { keyPath: 'id' })
      bookmarks.createIndex('by_bookId', 'bookId', { unique: false })
      const sessions = db.createObjectStore('reading_sessions', { keyPath: 'id' })
      sessions.createIndex('by_date', 'date', { unique: false })
      sessions.createIndex('by_bookId', 'bookId', { unique: false })
      books.add({
        id: 'development-book',
        title: 'Development Book',
        author: null,
        language: 'en',
        coverMime: null,
        fileSize: 10,
        addedAt: '2026-08-14T09:00:00.000Z',
        lastReadAt: null,
      })
      files.put(new Uint8Array([1, 2, 3]).buffer, 'development-book')
      covers.put(new Uint8Array([4, 5]).buffer, 'development-book')
      progress.add({
        bookId: 'development-book',
        cfi: 'epubcfi(/6/2!/4/2)',
        percentage: 0.25,
        updatedAt: '2026-08-14T09:30:00.000Z',
      })
      settings.add({
        bookId: 'development-book',
        styleId: 'book',
        overrides: {},
        updatedAt: '2026-08-14T09:30:00.000Z',
      })
      appSettings.add({ key: 'global', value: { themeMode: 'dark', dailyReadingGoalMinutes: 20 } })
      bookmarks.add({
        id: 'development-bookmark',
        bookId: 'development-book',
        cfi: 'epubcfi(/6/2!/4/2)',
        text: 'Keep this bookmark',
        createdAt: '2026-08-14T09:45:00.000Z',
      })
      sessions.add({
        id: 'development-session',
        bookId: 'development-book',
        date: '2026-08-14',
        durationSeconds: 60,
        wordsRead: 77,
        updatedAt: '2026-08-14T10:00:00.000Z',
      })
    }
    request.onsuccess = () => {
      request.result.close()
      resolve()
    }
    request.onerror = () => reject(request.error)
  })
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
      pacerWpm: 280,
      pacerCpm: 320,
      pacerChunkSize: 3,
      pacerCjkCharCount: 4,
      updatedAt: '2026-08-16T12:00:00.000Z',
    }
    await storage.saveBookSettings(bookSettings)
    expect(await storage.getBookSettings(book.id)).toEqual(bookSettings)

    await storage.saveAppSettings({
      typography: { latin: { styleId: 'sepia', overrides: { fontSizeStep: 1 } } },
      pacerWpm: 300,
      pacerCpm: 320,
      pacerChunkSize: 3,
      pacerCjkCharCount: 4,
      dailyReadingGoalMinutes: 20,
    })
    await storage.saveAppSettings({ themeMode: 'dark' })
    expect(await storage.getAppSettings()).toEqual({
      typography: { latin: { styleId: 'sepia', overrides: { fontSizeStep: 1 } } },
      pacerWpm: 300,
      pacerCpm: 320,
      pacerChunkSize: 3,
      pacerCjkCharCount: 4,
      dailyReadingGoalMinutes: 20,
      themeMode: 'dark',
    })
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

  it('files a book under several collections and replaces the set wholesale', async () => {
    const storage = await freshStorage()
    const book = record()
    await storage.addBook({ record: book, data: await buildFixtureEpub(), cover: null })

    const shelf = (id: string, name: string): Collection => ({
      id,
      name,
      createdAt: '2026-08-20T10:00:00.000Z',
      updatedAt: '2026-08-20T10:00:00.000Z',
    })
    await storage.saveCollection(shelf('c2', '小说'))
    await storage.saveCollection(shelf('c1', '工作'))

    // Code-point order, matching SQLite's ORDER BY name on the Tauri target.
    expect((await storage.listCollections()).map((item) => item.name)).toEqual(['小说', '工作'])

    await storage.setBookCollections(book.id, ['c1', 'c2'])
    expect((await storage.listCollectionMembership())[book.id]?.sort()).toEqual(['c1', 'c2'])

    // Replaces rather than adds, and re-applying must not duplicate a row.
    await storage.setBookCollections(book.id, ['c2'])
    await storage.setBookCollections(book.id, ['c2'])
    expect((await storage.listCollectionMembership())[book.id]).toEqual(['c2'])

    await storage.saveCollection({ ...shelf('c2', '小说'), name: '文学' })
    expect((await storage.listCollections()).find((item) => item.id === 'c2')?.name).toBe('文学')
  })

  it('keeps books when a collection is deleted, and vice versa', async () => {
    const storage = await freshStorage()
    const book = record()
    await storage.addBook({ record: book, data: await buildFixtureEpub(), cover: null })
    await storage.saveCollection({
      id: 'c1',
      name: '工作',
      createdAt: '2026-08-20T10:00:00.000Z',
      updatedAt: '2026-08-20T10:00:00.000Z',
    })
    await storage.setBookCollections(book.id, ['c1'])

    await storage.deleteCollection('c1')
    expect(await storage.listCollections()).toEqual([])
    expect(await storage.listCollectionMembership()).toEqual({})
    expect((await storage.listBooks()).length).toBe(1)
  })

  it('saves, edits, lists, and deletes annotations', async () => {
    const storage = await freshStorage()
    const book = record()
    await storage.addBook({ record: book, data: await buildFixtureEpub(), cover: null })

    const highlight: Annotation = {
      id: 'ann-1',
      bookId: book.id,
      cfiRange: 'epubcfi(/6/4!/4/2,/1:0,/1:24)',
      text: 'the unexamined life',
      note: '',
      color: 'yellow',
      chapterTitle: 'Chapter 1',
      source: 'local',
      createdAt: '2026-08-20T10:00:00.000Z',
      updatedAt: '2026-08-20T10:00:00.000Z',
    }
    const later: Annotation = {
      ...highlight,
      id: 'ann-2',
      text: 'a second passage',
      color: 'green',
      createdAt: '2026-08-20T11:00:00.000Z',
      updatedAt: '2026-08-20T11:00:00.000Z',
    }

    await storage.saveAnnotation(later)
    await storage.saveAnnotation(highlight)

    // Oldest first, so the list follows reading order rather than write order.
    expect((await storage.listAnnotations(book.id)).map((item) => item.id)).toEqual([
      'ann-1',
      'ann-2',
    ])

    await storage.saveAnnotation({
      ...highlight,
      note: 'Socrates, Apology',
      color: 'blue',
      updatedAt: '2026-08-20T12:00:00.000Z',
    })
    const [edited] = await storage.listAnnotations(book.id)
    expect(edited.note).toBe('Socrates, Apology')
    expect(edited.color).toBe('blue')
    expect(await storage.listAnnotations(book.id)).toHaveLength(2)

    await storage.deleteAnnotation('ann-1')
    expect((await storage.listAnnotations(book.id)).map((item) => item.id)).toEqual(['ann-2'])
  })

  it('keeps annotations scoped to their own book', async () => {
    const storage = await freshStorage()
    const first = record()
    const second = record()
    const data = await buildFixtureEpub()
    await storage.addBook({ record: first, data, cover: null })
    await storage.addBook({ record: second, data, cover: null })

    const base: Omit<Annotation, 'id' | 'bookId'> = {
      cfiRange: 'epubcfi(/6/4!/4/2,/1:0,/1:5)',
      text: 'hello',
      note: '',
      color: 'yellow',
      chapterTitle: null,
      source: 'local',
      createdAt: '2026-08-20T10:00:00.000Z',
      updatedAt: '2026-08-20T10:00:00.000Z',
    }
    await storage.saveAnnotation({ ...base, id: 'a', bookId: first.id })
    await storage.saveAnnotation({ ...base, id: 'b', bookId: second.id })

    expect((await storage.listAnnotations(first.id)).map((item) => item.id)).toEqual(['a'])
    expect((await storage.listAnnotations(second.id)).map((item) => item.id)).toEqual(['b'])
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
    await storage.saveAnnotation({
      id: 'ann-delete',
      bookId: book.id,
      cfiRange: 'epubcfi(/6/4!/4/2,/1:0,/1:5)',
      text: 'Highlight',
      note: 'note',
      color: 'yellow',
      chapterTitle: null,
      source: 'local',
      createdAt: '2026-08-15T12:00:00.000Z',
      updatedAt: '2026-08-15T12:00:00.000Z',
    })
    await storage.saveCollection({
      id: 'col-delete',
      name: '待删除',
      createdAt: '2026-08-15T12:00:00.000Z',
      updatedAt: '2026-08-15T12:00:00.000Z',
    })
    await storage.setBookCollections(book.id, ['col-delete'])
    await storage.recordReadingSession({
      id: 'sess-delete',
      bookId: book.id,
      date: '2026-08-15',
      durationSeconds: 1,
      latinWordsRead: 3,
      cjkCharactersRead: 0,
      updatedAt: '2026-08-15T12:00:01.000Z',
    })

    await storage.deleteBook(book.id)

    expect(await storage.listBooks()).toEqual([])
    expect(await storage.readCover(book.id)).toBeNull()
    expect(await storage.getProgress(book.id)).toBeNull()
    expect(await storage.getBookSettings(book.id)).toBeNull()
    expect(await storage.listBookmarks(book.id)).toEqual([])
    expect(await storage.listAnnotations(book.id)).toEqual([])
    expect(await storage.listCollectionMembership()).toEqual({})
    expect((await storage.getReadingStats()).totalBooksRead).toBe(0)
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
      latinWordsRead: 800,
      cjkCharactersRead: 120,
      updatedAt: '2026-08-16T10:00:00.000Z',
    }
    const s2 = {
      id: 'sess-2',
      bookId: book.id,
      date: '2026-08-16',
      durationSeconds: 120,
      latinWordsRead: 400,
      cjkCharactersRead: 80,
      updatedAt: '2026-08-16T11:00:00.000Z',
    }

    await storage.recordReadingSession(s1)
    await storage.recordReadingSession(s2)

    const stats = await storage.getReadingStats()
    expect(stats.totalDurationMinutes).toBe(5)
    expect(stats.totalLatinWordsRead).toBe(1200)
    expect(stats.totalCjkCharactersRead).toBe(200)
    expect(stats.totalBooksRead).toBe(1)
    expect(stats.dailyStats['2026-08-16'].durationMinutes).toBe(5)
    expect(stats.dailyStats['2026-08-16'].latinWordsRead).toBe(1200)
    expect(stats.dailyStats['2026-08-16'].cjkCharactersRead).toBe(200)
  })

  it('reports a non-zero total for a positive sub-minute session', async () => {
    const book = record()
    await storage.addBook({ record: book, data: new Uint8Array([1]), cover: null })
    await storage.recordReadingSession({
      id: 'sess-short',
      bookId: book.id,
      date: '2026-08-16',
      durationSeconds: 1,
      latinWordsRead: 2,
      cjkCharactersRead: 0,
      updatedAt: '2026-08-16T10:00:00.000Z',
    })

    const stats = await storage.getReadingStats()
    expect(stats.totalDurationMinutes).toBe(1)
    expect(stats.dailyStats['2026-08-16'].durationMinutes).toBe(1)
  })

  it('resets unpublished v2 settings and stats while preserving books and progress', async () => {
    const databaseName = `veloread-v2-${crypto.randomUUID()}`
    await seedDevelopmentV2Database(databaseName)
    const upgraded = createWebStorage(databaseName)
    await upgraded.init()

    expect((await upgraded.listBooks()).map((book) => book.id)).toEqual(['development-book'])
    expect(await upgraded.readBookFile('development-book')).toEqual(new Uint8Array([1, 2, 3]))
    expect(await upgraded.readCover('development-book')).toEqual(new Uint8Array([4, 5]))
    expect(await upgraded.getProgress('development-book')).toMatchObject({ percentage: 0.25 })
    expect(await upgraded.getAppSettings()).toEqual({ themeMode: 'dark', dailyReadingGoalMinutes: 20 })
    expect((await upgraded.listBookmarks('development-book')).map((bookmark) => bookmark.id)).toEqual([
      'development-bookmark',
    ])
    expect(await upgraded.getBookSettings('development-book')).toBeNull()
    expect(await upgraded.getReadingStats()).toMatchObject({
      totalDurationMinutes: 0,
      totalLatinWordsRead: 0,
      totalCjkCharactersRead: 0,
      totalBooksRead: 0,
      dailyStats: {},
    })
  })
})

describe('web database lifecycle', () => {
  it('closes an old connection when a newer schema requests versionchange', async () => {
    const name = `veloread-versionchange-${crypto.randomUUID()}`
    await openVeloreadDb(name)

    const upgraded = await new Promise<IDBDatabase>((resolve, reject) => {
      const request = indexedDB.open(name, 999)
      request.onsuccess = () => resolve(request.result)
      request.onerror = () => reject(request.error)
      request.onblocked = () => reject(new Error('the VeloRead connection blocked its upgrade'))
    })

    expect(upgraded.version).toBe(999)
    upgraded.close()
    indexedDB.deleteDatabase(name)
  })

  it('reports when an upgrade is blocked by a foreign open connection', async () => {
    const name = `veloread-blocked-${crypto.randomUUID()}`
    const blocker = await new Promise<IDBDatabase>((resolve, reject) => {
      const request = indexedDB.open(name, 1)
      request.onsuccess = () => resolve(request.result)
      request.onerror = () => reject(request.error)
    })

    await expect(openVeloreadDb(name)).rejects.toThrow('blocked by another open VeloRead tab')
    blocker.close()
    indexedDB.deleteDatabase(name)
  })
})
