import type {
  AppSettings,
  Bookmark,
  BookImport,
  BookRecord,
  BookSettings,
  OverallReadingStats,
  ReadingProgress,
  ReadingSession,
  StoragePort,
} from '../types'
import { compareBooks } from '../sort'

const DB_NAME = 'veloread'
const DB_VERSION = 2

const BOOKS = 'books'
const FILES = 'files'
const COVERS = 'covers'
const PROGRESS = 'progress'
const BOOK_SETTINGS = 'book_settings'
const APP_SETTINGS = 'app_settings'
const BOOKMARKS = 'bookmarks'
const READING_SESSIONS = 'reading_sessions'

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

function open(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION)
    req.onupgradeneeded = () => {
      const db = req.result
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
    }
    req.onsuccess = () => resolve(req.result)
    req.onerror = () => reject(req.error ?? new Error('Failed to open IndexedDB'))
  })
}

/**
 * Browser implementation of `StoragePort`, backed by IndexedDB.
 */
export function createWebStorage(): StoragePort {
  let db: IDBDatabase | null = null

  function handle(): IDBDatabase {
    if (!db) throw new Error('storage port used before init()')
    return db
  }

  return {
    async init() {
      if (!db) db = await open()
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
        [BOOKS, FILES, COVERS, PROGRESS, BOOK_SETTINGS, BOOKMARKS, READING_SESSIONS],
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

    async recordReadingSession(session: ReadingSession) {
      const tx = handle().transaction(READING_SESSIONS, 'readwrite')
      const store = tx.objectStore(READING_SESSIONS)
      const existing = await request<ReadingSession | undefined>(store.get(session.id))
      if (existing) {
        store.put({
          ...existing,
          durationSeconds: existing.durationSeconds + session.durationSeconds,
          wordsRead: existing.wordsRead + session.wordsRead,
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
      const dailyWords: Record<string, number> = {}
      let totalDurationSeconds = 0
      let totalWordsRead = 0
      const distinctBooks = new Set<string>()

      for (const s of sessions) {
        totalDurationSeconds += s.durationSeconds
        totalWordsRead += s.wordsRead
        distinctBooks.add(s.bookId)

        dailySeconds[s.date] = (dailySeconds[s.date] ?? 0) + s.durationSeconds
        dailyWords[s.date] = (dailyWords[s.date] ?? 0) + s.wordsRead
      }

      const dailyStats: Record<string, { durationMinutes: number; wordsRead: number }> = {}
      for (const date of Object.keys(dailySeconds)) {
        const secs = dailySeconds[date]
        dailyStats[date] = {
          durationMinutes: secs >= 30 ? Math.max(1, Math.round(secs / 60)) : (secs > 0 ? 1 : 0),
          wordsRead: dailyWords[date] ?? 0,
        }
      }

      // Calculate streak
      let streak = 0
      const cur = new Date()
      let curStr = cur.toISOString().slice(0, 10)

      if (dailyStats[curStr] && dailyStats[curStr].durationMinutes > 0) {
        streak++
        cur.setDate(cur.getDate() - 1)
      } else {
        cur.setDate(cur.getDate() - 1)
        curStr = cur.toISOString().slice(0, 10)
        if (dailyStats[curStr] && dailyStats[curStr].durationMinutes > 0) {
          streak++
          cur.setDate(cur.getDate() - 1)
        }
      }

      while (streak > 0) {
        curStr = cur.toISOString().slice(0, 10)
        if (dailyStats[curStr] && dailyStats[curStr].durationMinutes > 0) {
          streak++
          cur.setDate(cur.getDate() - 1)
        } else {
          break
        }
      }

      return {
        totalDurationMinutes: Math.round(totalDurationSeconds / 60),
        totalWordsRead,
        totalBooksRead: distinctBooks.size,
        currentStreakDays: streak,
        dailyStats,
      }
    },
  }
}

/** Detach a possibly-shared buffer so IndexedDB stores exactly these bytes. */
function toArrayBuffer(bytes: Uint8Array): ArrayBuffer {
  return bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer
}
