import type {
  Annotation,
  AppSettings,
  Collection,
  Bookmark,
  BookImport,
  BookRecord,
  BookSettings,
  OverallReadingStats,
  ReadingProgress,
  ReadingSession,
  StoragePort,
} from '../types'
import { compareBooks, compareCollections } from '../sort'
import { calculateCurrentStreak } from '../../stats/tracking'

const DB_NAME = 'veloread'
const DB_VERSION = 5

/**
 * Up to this version the reading counts were a single mixed `wordsRead` that
 * cannot be split honestly into words and CJK characters, so upgrading past it
 * rebuilt the unpublished stores. The bound is pinned rather than written as
 * `< DB_VERSION`: leaving it open-ended would re-run the wipe on every future
 * schema bump and silently destroy real settings and statistics.
 */
const MIXED_WORD_COUNT_VERSION = 3

const BOOKS = 'books'
const FILES = 'files'
const COVERS = 'covers'
const PROGRESS = 'progress'
const BOOK_SETTINGS = 'book_settings'
const APP_SETTINGS = 'app_settings'
const BOOKMARKS = 'bookmarks'
const READING_SESSIONS = 'reading_sessions'
const ANNOTATIONS = 'annotations'
const COLLECTIONS = 'collections'
const COLLECTION_BOOKS = 'collection_books'

function roundedMinutes(seconds: number): number {
  if (seconds <= 0) return 0
  return Math.max(1, Math.round(seconds / 60))
}

function request<T>(req: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    req.onsuccess = () => resolve(req.result)
    req.onerror = () => reject(req.error ?? new Error('IndexedDB request failed'))
  })
}

function done(tx: IDBTransaction): Promise<void> {
  return new Promise((resolve, reject) => {
    tx.oncomplete = () => resolve()
    tx.onabort = () => reject(tx.error ?? new Error('IndexedDB transaction aborted'))
    tx.onerror = () => reject(tx.error ?? new Error('IndexedDB transaction failed'))
  })
}

function open(databaseName: string): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(databaseName, DB_VERSION)
    req.onupgradeneeded = (event) => {
      const db = req.result

      // This schema has not shipped. Mixed legacy reading counts cannot be
      // labelled honestly as either words or CJK characters, and the old
      // per-book settings do not contain the two language profiles. Reset only
      // those development stores; books, files, covers, and progress survive.
      if (event.oldVersion > 0 && event.oldVersion < MIXED_WORD_COUNT_VERSION) {
        if (db.objectStoreNames.contains(BOOK_SETTINGS)) db.deleteObjectStore(BOOK_SETTINGS)
        if (db.objectStoreNames.contains(READING_SESSIONS)) db.deleteObjectStore(READING_SESSIONS)
      }

      if (!db.objectStoreNames.contains(BOOKS)) db.createObjectStore(BOOKS, { keyPath: 'id' })
      if (!db.objectStoreNames.contains(FILES)) db.createObjectStore(FILES)
      if (!db.objectStoreNames.contains(COVERS)) db.createObjectStore(COVERS)
      if (!db.objectStoreNames.contains(PROGRESS)) db.createObjectStore(PROGRESS, { keyPath: 'bookId' })
      if (!db.objectStoreNames.contains(BOOK_SETTINGS)) db.createObjectStore(BOOK_SETTINGS, { keyPath: 'bookId' })
      if (!db.objectStoreNames.contains(APP_SETTINGS)) db.createObjectStore(APP_SETTINGS, { keyPath: 'key' })
      if (!db.objectStoreNames.contains(BOOKMARKS)) {
        const bookmarksStore = db.createObjectStore(BOOKMARKS, { keyPath: 'id' })
        bookmarksStore.createIndex('by_bookId', 'bookId', { unique: false })
      }
      if (!db.objectStoreNames.contains(READING_SESSIONS)) {
        const sessionsStore = db.createObjectStore(READING_SESSIONS, { keyPath: 'id' })
        sessionsStore.createIndex('by_date', 'date', { unique: false })
        sessionsStore.createIndex('by_bookId', 'bookId', { unique: false })
      }
      if (!db.objectStoreNames.contains(ANNOTATIONS)) {
        const annotationsStore = db.createObjectStore(ANNOTATIONS, { keyPath: 'id' })
        annotationsStore.createIndex('by_bookId', 'bookId', { unique: false })
      }
      if (!db.objectStoreNames.contains(COLLECTIONS)) {
        db.createObjectStore(COLLECTIONS, { keyPath: 'id' })
      }
      if (!db.objectStoreNames.contains(COLLECTION_BOOKS)) {
        // Composite key, so re-adding the same pair cannot duplicate a row.
        const membership = db.createObjectStore(COLLECTION_BOOKS, {
          keyPath: ['collectionId', 'bookId'],
        })
        membership.createIndex('by_bookId', 'bookId', { unique: false })
        membership.createIndex('by_collectionId', 'collectionId', { unique: false })
      }

    }
    req.onsuccess = () => resolve(req.result)
    req.onerror = () => reject(req.error ?? new Error('Failed to open IndexedDB'))
  })
}

/**
 * Browser implementation of `StoragePort`, backed by IndexedDB.
 */
export function createWebStorage(databaseName = DB_NAME): StoragePort {
  let db: IDBDatabase | null = null

  function handle(): IDBDatabase {
    if (!db) throw new Error('storage port used before init()')
    return db
  }

  return {
    async init() {
      if (!db) db = await open(databaseName)
    },

    async listBooks() {
      const tx = handle().transaction(BOOKS, 'readonly')
      const records = await request<BookRecord[]>(tx.objectStore(BOOKS).getAll())
      return records.sort(compareBooks)
    },

    async addBook({ record, data, cover }: BookImport) {
      const tx = handle().transaction([BOOKS, FILES, COVERS], 'readwrite')
      tx.objectStore(BOOKS).add(record)
      tx.objectStore(FILES).put(toArrayBuffer(data), record.id)
      if (cover) {
        tx.objectStore(COVERS).put(toArrayBuffer(cover), record.id)
      } else {
        tx.objectStore(COVERS).delete(record.id)
      }
      await done(tx)
      return record
    },

    async deleteBook(id: string) {
      const tx = handle().transaction(
        [
          BOOKS,
          FILES,
          COVERS,
          PROGRESS,
          BOOK_SETTINGS,
          BOOKMARKS,
          ANNOTATIONS,
          COLLECTION_BOOKS,
          READING_SESSIONS,
        ],
        'readwrite',
      )
      tx.objectStore(BOOKS).delete(id)
      tx.objectStore(FILES).delete(id)
      tx.objectStore(COVERS).delete(id)
      tx.objectStore(PROGRESS).delete(id)
      tx.objectStore(BOOK_SETTINGS).delete(id)

      // Delete bookmarks for this book
      const bookmarksStore = tx.objectStore(BOOKMARKS)
      const bmIndex = bookmarksStore.index('by_bookId')
      const bookmarks = await request<Bookmark[]>(bmIndex.getAll(id))
      for (const bm of bookmarks) {
        bookmarksStore.delete(bm.id)
      }

      // Delete annotations for this book
      const annotationsStore = tx.objectStore(ANNOTATIONS)
      const annotationIndex = annotationsStore.index('by_bookId')
      const annotations = await request<Annotation[]>(annotationIndex.getAll(id))
      for (const annotation of annotations) {
        annotationsStore.delete(annotation.id)
      }

      // Drop this book from every collection it was filed under
      const membershipStore = tx.objectStore(COLLECTION_BOOKS)
      const membershipIndex = membershipStore.index('by_bookId')
      const memberships = await request<{ collectionId: string; bookId: string }[]>(
        membershipIndex.getAll(id),
      )
      for (const membership of memberships) {
        membershipStore.delete([membership.collectionId, membership.bookId])
      }

      // Delete sessions for this book
      const sessionsStore = tx.objectStore(READING_SESSIONS)
      const sessIndex = sessionsStore.index('by_bookId')
      const sessions = await request<ReadingSession[]>(sessIndex.getAll(id))
      for (const sess of sessions) {
        sessionsStore.delete(sess.id)
      }

      await done(tx)
    },

    async readBookFile(id: string) {
      const tx = handle().transaction(FILES, 'readonly')
      const buffer = await request<ArrayBuffer | undefined>(tx.objectStore(FILES).get(id))
      if (!buffer) throw new Error(`book payload for ${id} not found in storage`)
      return new Uint8Array(buffer)
    },

    async readCover(id: string) {
      const tx = handle().transaction(COVERS, 'readonly')
      const buffer = await request<ArrayBuffer | undefined>(tx.objectStore(COVERS).get(id))
      return buffer ? new Uint8Array(buffer) : null
    },

    async getProgress(bookId: string) {
      const tx = handle().transaction(PROGRESS, 'readonly')
      const progress = await request<ReadingProgress | undefined>(tx.objectStore(PROGRESS).get(bookId))
      return progress ?? null
    },

    async saveProgress(progress: ReadingProgress) {
      const tx = handle().transaction([PROGRESS, BOOKS], 'readwrite')
      tx.objectStore(PROGRESS).put(progress)

      const booksStore = tx.objectStore(BOOKS)
      const book = await request<BookRecord | undefined>(booksStore.get(progress.bookId))
      if (book) {
        booksStore.put({ ...book, lastReadAt: progress.updatedAt })
      }

      await done(tx)
    },

    async getBookSettings(bookId: string) {
      const tx = handle().transaction(BOOK_SETTINGS, 'readonly')
      const settings = await request<BookSettings | undefined>(tx.objectStore(BOOK_SETTINGS).get(bookId))
      return settings ?? null
    },

    async saveBookSettings(settings: BookSettings) {
      const tx = handle().transaction(BOOK_SETTINGS, 'readwrite')
      tx.objectStore(BOOK_SETTINGS).put(settings)
      await done(tx)
    },

    async getAppSettings() {
      const tx = handle().transaction(APP_SETTINGS, 'readonly')
      const row = await request<{ key: string; value: AppSettings } | undefined>(
        tx.objectStore(APP_SETTINGS).get('global'),
      )
      return row?.value ?? {}
    },

    async saveAppSettings(settings: Partial<AppSettings>) {
      const tx = handle().transaction(APP_SETTINGS, 'readwrite')
      const store = tx.objectStore(APP_SETTINGS)
      const current = (await request<{ key: string; value: AppSettings } | undefined>(store.get('global')))?.value ?? {}
      store.put({ key: 'global', value: { ...current, ...settings } })
      await done(tx)
    },

    async listBookmarks(bookId: string) {
      const tx = handle().transaction(BOOKMARKS, 'readonly')
      const index = tx.objectStore(BOOKMARKS).index('by_bookId')
      const bookmarks = await request<Bookmark[]>(index.getAll(bookId))
      return bookmarks.sort((a, b) => a.createdAt.localeCompare(b.createdAt))
    },

    async addBookmark(bookmark: Bookmark) {
      const tx = handle().transaction(BOOKMARKS, 'readwrite')
      tx.objectStore(BOOKMARKS).put(bookmark)
      await done(tx)
    },

    async deleteBookmark(id: string) {
      const tx = handle().transaction(BOOKMARKS, 'readwrite')
      tx.objectStore(BOOKMARKS).delete(id)
      await done(tx)
    },

    async listCollections() {
      const tx = handle().transaction(COLLECTIONS, 'readonly')
      const collections = await request<Collection[]>(tx.objectStore(COLLECTIONS).getAll())
      return collections.sort(compareCollections)
    },

    async saveCollection(collection: Collection) {
      const tx = handle().transaction(COLLECTIONS, 'readwrite')
      tx.objectStore(COLLECTIONS).put(collection)
      await done(tx)
    },

    async deleteCollection(id: string) {
      const tx = handle().transaction([COLLECTIONS, COLLECTION_BOOKS], 'readwrite')
      tx.objectStore(COLLECTIONS).delete(id)
      const membershipStore = tx.objectStore(COLLECTION_BOOKS)
      const memberships = await request<{ collectionId: string; bookId: string }[]>(
        membershipStore.index('by_collectionId').getAll(id),
      )
      for (const membership of memberships) {
        membershipStore.delete([membership.collectionId, membership.bookId])
      }
      await done(tx)
    },

    async setBookCollections(bookId: string, collectionIds: string[]) {
      const tx = handle().transaction(COLLECTION_BOOKS, 'readwrite')
      const store = tx.objectStore(COLLECTION_BOOKS)
      const existing = await request<{ collectionId: string; bookId: string }[]>(
        store.index('by_bookId').getAll(bookId),
      )
      const wanted = new Set(collectionIds)
      for (const membership of existing) {
        if (!wanted.has(membership.collectionId)) {
          store.delete([membership.collectionId, membership.bookId])
        }
      }
      for (const collectionId of wanted) {
        store.put({ collectionId, bookId })
      }
      await done(tx)
    },

    async listCollectionMembership() {
      const tx = handle().transaction(COLLECTION_BOOKS, 'readonly')
      const rows = await request<{ collectionId: string; bookId: string }[]>(
        tx.objectStore(COLLECTION_BOOKS).getAll(),
      )
      const membership: Record<string, string[]> = {}
      for (const row of rows) {
        ;(membership[row.bookId] ??= []).push(row.collectionId)
      }
      return membership
    },

    async listAnnotations(bookId: string) {
      const tx = handle().transaction(ANNOTATIONS, 'readonly')
      const index = tx.objectStore(ANNOTATIONS).index('by_bookId')
      const annotations = await request<Annotation[]>(index.getAll(bookId))
      return annotations.sort((a, b) => a.createdAt.localeCompare(b.createdAt))
    },

    async saveAnnotation(annotation: Annotation) {
      const tx = handle().transaction(ANNOTATIONS, 'readwrite')
      tx.objectStore(ANNOTATIONS).put(annotation)
      await done(tx)
    },

    async deleteAnnotation(id: string) {
      const tx = handle().transaction(ANNOTATIONS, 'readwrite')
      tx.objectStore(ANNOTATIONS).delete(id)
      await done(tx)
    },

    async recordReadingSession(session: ReadingSession) {
      const tx = handle().transaction(READING_SESSIONS, 'readwrite')
      const store = tx.objectStore(READING_SESSIONS)
      const existing = await request<ReadingSession | undefined>(store.get(session.id))
      if (existing) {
        store.put({
          ...existing,
          durationSeconds: existing.durationSeconds + session.durationSeconds,
          latinWordsRead: (existing.latinWordsRead ?? 0) + session.latinWordsRead,
          cjkCharactersRead: (existing.cjkCharactersRead ?? 0) + session.cjkCharactersRead,
          updatedAt: session.updatedAt,
        })
      } else {
        store.put(session)
      }
      await done(tx)
    },

    async getReadingStats(): Promise<OverallReadingStats> {
      const tx = handle().transaction(READING_SESSIONS, 'readonly')
      const sessions = await request<ReadingSession[]>(tx.objectStore(READING_SESSIONS).getAll())

      const dailySeconds: Record<string, number> = {}
      const dailyLatinWords: Record<string, number> = {}
      const dailyCjkCharacters: Record<string, number> = {}
      let totalLatinWordsRead = 0
      let totalCjkCharactersRead = 0
      const distinctBooks = new Set<string>()

      for (const s of sessions) {
        totalLatinWordsRead += s.latinWordsRead
        totalCjkCharactersRead += s.cjkCharactersRead
        distinctBooks.add(s.bookId)

        dailySeconds[s.date] = (dailySeconds[s.date] ?? 0) + s.durationSeconds
        dailyLatinWords[s.date] = (dailyLatinWords[s.date] ?? 0) + s.latinWordsRead
        dailyCjkCharacters[s.date] = (dailyCjkCharacters[s.date] ?? 0) + s.cjkCharactersRead
      }

      const dailyStats: OverallReadingStats['dailyStats'] = {}
      for (const date of Object.keys(dailySeconds)) {
        const secs = dailySeconds[date]
        dailyStats[date] = {
          durationMinutes: roundedMinutes(secs),
          latinWordsRead: dailyLatinWords[date] ?? 0,
          cjkCharactersRead: dailyCjkCharacters[date] ?? 0,
        }
      }

      // Sum the per-day minutes rather than rounding the grand total: the
      // check-in calendar shows the daily numbers, and a total that does not
      // add up to them reads as a bug in the stats.
      const totalDurationMinutes = Object.values(dailyStats).reduce(
        (sum, day) => sum + day.durationMinutes,
        0,
      )

      return {
        totalDurationMinutes,
        totalLatinWordsRead,
        totalCjkCharactersRead,
        totalBooksRead: distinctBooks.size,
        currentStreakDays: calculateCurrentStreak(dailyStats),
        dailyStats,
      }
    },
  }
}

/** Detach a possibly-shared buffer so IndexedDB stores exactly these bytes. */
function toArrayBuffer(bytes: Uint8Array): ArrayBuffer {
  return bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer
}
