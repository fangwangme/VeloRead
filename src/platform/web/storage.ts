import type { BookRecord, ReadingProgress, StoragePort } from '../types'
import { compareBooks } from '../sort'

const DB_NAME = 'veloread'
const DB_VERSION = 1

const BOOKS = 'books'
const FILES = 'files'
const COVERS = 'covers'
const PROGRESS = 'progress'

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

    async addBook({ record, data, cover }) {
      const tx = handle().transaction([BOOKS, FILES, COVERS], 'readwrite')
      tx.objectStore(BOOKS).put(record)
      tx.objectStore(FILES).put(toArrayBuffer(data), record.id)
      if (cover) tx.objectStore(COVERS).put(toArrayBuffer(cover), record.id)
      await done(tx)
      return record
    },

    async deleteBook(id) {
      const tx = handle().transaction([BOOKS, FILES, COVERS, PROGRESS], 'readwrite')
      tx.objectStore(BOOKS).delete(id)
      tx.objectStore(FILES).delete(id)
      tx.objectStore(COVERS).delete(id)
      tx.objectStore(PROGRESS).delete(id)
      await done(tx)
    },

    async readBookFile(id) {
      const bytes = await readBytes(FILES, id)
      if (!bytes) throw new Error(`No stored file for book ${id}`)
      return bytes
    },

    readCover(id) {
      return readBytes(COVERS, id)
    },

    async getProgress(bookId) {
      const tx = handle().transaction(PROGRESS, 'readonly')
      const row = await request<ReadingProgress | undefined>(tx.objectStore(PROGRESS).get(bookId))
      return row ?? null
    },

    async saveProgress(progress) {
      const tx = handle().transaction([PROGRESS, BOOKS], 'readwrite')
      tx.objectStore(PROGRESS).put(progress)
      const books = tx.objectStore(BOOKS)
      const book = await request<BookRecord | undefined>(books.get(progress.bookId))
      if (book) books.put({ ...book, lastReadAt: progress.updatedAt })
      await done(tx)
    },
  }
}

/** Detach a possibly-shared buffer so IndexedDB stores exactly these bytes. */
function toArrayBuffer(bytes: Uint8Array): ArrayBuffer {
  return bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer
}
