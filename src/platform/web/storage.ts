import type {
  AppSettings,
  Bookmark,
  BookImport,
  BookRecord,
  BookSettings,
  ReadingProgress,
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
    }
    req.onsuccess = () => resolve(req.result)
    req.onerror = () => reject(req.error ?? new Error('Failed to open IndexedDB'))
  })
}

/**
 * Browser implementation of `StoragePort`, backed by IndexedDB.
 *
 * Book bytes and covers are stored as `ArrayBuffer` in their own object stores
 * so that listing the library never deserialises book payloads.
 */
export function createWebStorage(): StoragePort {
  let db: IDBDatabase | null = null

  function handle(): IDBDatabase {
    if (!db) throw new Error('Web storage used before init()')
    return db
  }

  async function readBytes(store: string, id: string): Promise<Uint8Array | null> {
    const tx = handle().transaction(store, 'readonly')
    const value = await request<ArrayBuffer | undefined>(tx.objectStore(store).get(id))
    return value ? new Uint8Array(value) : null
  }

  return {
    async init() {
      if (!db) db = await open()
    },

    async listBooks() {
      const tx = handle().transaction(BOOKS, 'readonly')
      const books = await request<BookRecord[]>(tx.objectStore(BOOKS).getAll())
      return books.sort(compareBooks)
    },

    async addBook({ record, data, cover }: BookImport) {
      const tx = handle().transaction([BOOKS, FILES, COVERS], 'readwrite')
      tx.objectStore(BOOKS).put(record)
      tx.objectStore(FILES).put(toArrayBuffer(data), record.id)
      if (cover) tx.objectStore(COVERS).put(toArrayBuffer(cover), record.id)
      await done(tx)
      return record
    },

    async deleteBook(id: string) {
      const tx = handle().transaction(
        [BOOKS, FILES, COVERS, PROGRESS, BOOK_SETTINGS, BOOKMARKS],
        'readwrite',
      )
      tx.objectStore(BOOKS).delete(id)
      tx.objectStore(FILES).delete(id)
      tx.objectStore(COVERS).delete(id)
      tx.objectStore(PROGRESS).delete(id)
      tx.objectStore(BOOK_SETTINGS).delete(id)

      // Delete all bookmarks belonging to this book
      const bookmarksStore = tx.objectStore(BOOKMARKS)
      const index = bookmarksStore.index('by_bookId')
      const bookmarks = await request<Bookmark[]>(index.getAll(id))
      for (const bm of bookmarks) {
        bookmarksStore.delete(bm.id)
      }

      await done(tx)
    },

    async readBookFile(id: string) {
      const bytes = await readBytes(FILES, id)
      if (!bytes) throw new Error(`No stored file for book ${id}`)
      return bytes
    },

    readCover(id: string) {
      return readBytes(COVERS, id)
    },

    async getProgress(bookId: string) {
      const tx = handle().transaction(PROGRESS, 'readonly')
      const row = await request<ReadingProgress | undefined>(tx.objectStore(PROGRESS).get(bookId))
      return row ?? null
    },

    async saveProgress(progress: ReadingProgress) {
      const tx = handle().transaction([PROGRESS, BOOKS], 'readwrite')
      tx.objectStore(PROGRESS).put(progress)
      const books = tx.objectStore(BOOKS)
      const book = await request<BookRecord | undefined>(books.get(progress.bookId))
      if (book) books.put({ ...book, lastReadAt: progress.updatedAt })
      await done(tx)
    },

    async getBookSettings(bookId: string) {
      const tx = handle().transaction(BOOK_SETTINGS, 'readonly')
      const row = await request<BookSettings | undefined>(tx.objectStore(BOOK_SETTINGS).get(bookId))
      return row ?? null
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
  }
}

/** Detach a possibly-shared buffer so IndexedDB stores exactly these bytes. */
function toArrayBuffer(bytes: Uint8Array): ArrayBuffer {
  return bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer
}
