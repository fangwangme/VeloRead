import { create } from 'zustand'
import { getStorage } from '../platform'
import type { BookRecord, Collection, ReadingProgress } from '../platform/types'
import { parseEpubMetadata } from '../epub/metadata'
import { compareCollections } from '../platform/sort'
import { newId } from '../platform/ids'
import type { MessageKey } from '../i18n/types'

export type View = { name: 'library' } | { name: 'reader'; bookId: string }

/**
 * The store has no access to the translate function — it is not a component —
 * so it reports *which* message to show and lets the view render it. Keeping
 * the key here is also what makes an error survive a language change.
 */
export interface LibraryError {
  key: MessageKey
  values?: Record<string, string | number>
}

interface LibraryState {
  books: BookRecord[]
  collections: Collection[]
  /** bookId -> collectionIds. */
  membership: Record<string, string[]>
  /** bookId -> where you left off, for the shelf's progress bars. */
  progress: Record<string, ReadingProgress>
  /** True until the first `load()` settles. */
  loading: boolean
  /** Filename currently being imported, or null. */
  importing: string | null
  error: LibraryError | null
  view: View

  load: () => Promise<void>
  importFiles: (files: File[]) => Promise<void>
  removeBook: (id: string) => Promise<void>
  createCollection: (name: string) => Promise<void>
  renameCollection: (id: string, name: string) => Promise<void>
  removeCollection: (id: string) => Promise<void>
  setBookCollections: (bookId: string, collectionIds: string[]) => Promise<void>
  openBook: (id: string) => void
  closeBook: () => void
  dismissError: () => void
}

export const useLibrary = create<LibraryState>((set, get) => ({
  books: [],
  collections: [],
  membership: {},
  progress: {},
  loading: true,
  importing: null,
  error: null,
  view: { name: 'library' },

  async load() {
    try {
      const storage = await getStorage()
      const [books, collections, membership, progress] = await Promise.all([
        storage.listBooks(),
        storage.listCollections(),
        storage.listCollectionMembership(),
        storage.listProgress(),
      ])
      set({ books, collections, membership, progress, loading: false })
    } catch (cause) {
      set({ loading: false, error: { key: 'library.error.open', values: { message: message(cause) } } })
    }
  },

  async importFiles(files) {
    const epubs = files.filter((file) => file.name.toLowerCase().endsWith('.epub'))
    if (epubs.length === 0) {
      set({ error: { key: 'library.error.onlyEpub' } })
      return
    }

    for (const file of epubs) {
      set({ importing: file.name, error: null })
      try {
        const storage = await getStorage()
        const data = new Uint8Array(await file.arrayBuffer())
        const metadata = await parseEpubMetadata(data)
        await storage.addBook({
          record: {
            id: newId(),
            title: metadata.title || stripExtension(file.name),
            author: metadata.author,
            language: metadata.language,
            coverMime: metadata.cover?.mime ?? null,
            fileSize: data.byteLength,
            addedAt: new Date().toISOString(),
            lastReadAt: null,
          },
          data,
          cover: metadata.cover?.data ?? null,
        })
      } catch (cause) {
        set({
          error: {
            key: 'library.error.import',
            values: { name: file.name, message: message(cause) },
          },
        })
      }
    }

    set({ importing: null })
    await get().load()
  },

  async removeBook(id) {
    try {
      const storage = await getStorage()
      await storage.deleteBook(id)
      const membership = { ...get().membership }
      delete membership[id]
      const progress = { ...get().progress }
      delete progress[id]
      set({ books: get().books.filter((book) => book.id !== id), membership, progress })
    } catch (cause) {
      set({ error: { key: 'library.error.delete', values: { message: message(cause) } } })
    }
  },

  async createCollection(name) {
    const trimmed = name.trim()
    if (trimmed.length === 0) return
    const now = new Date().toISOString()
    const collection: Collection = {
      id: newId(),
      name: trimmed,
      createdAt: now,
      updatedAt: now,
    }
    try {
      await (await getStorage()).saveCollection(collection)
      set({ collections: [...get().collections, collection].sort(compareCollections) })
    } catch (cause) {
      set({ error: { key: 'library.error.createCollection', values: { message: message(cause) } } })
    }
  },

  async renameCollection(id, name) {
    const trimmed = name.trim()
    const existing = get().collections.find((item) => item.id === id)
    if (!existing || trimmed.length === 0 || trimmed === existing.name) return
    const next: Collection = { ...existing, name: trimmed, updatedAt: new Date().toISOString() }
    try {
      await (await getStorage()).saveCollection(next)
      set({
        collections: get()
          .collections.map((item) => (item.id === id ? next : item))
          .sort(compareCollections),
      })
    } catch (cause) {
      set({ error: { key: 'library.error.renameCollection', values: { message: message(cause) } } })
    }
  },

  async removeCollection(id) {
    try {
      await (await getStorage()).deleteCollection(id)
      const membership: Record<string, string[]> = {}
      for (const [bookId, ids] of Object.entries(get().membership)) {
        const kept = ids.filter((item) => item !== id)
        if (kept.length > 0) membership[bookId] = kept
      }
      set({ collections: get().collections.filter((item) => item.id !== id), membership })
    } catch (cause) {
      set({ error: { key: 'library.error.deleteCollection', values: { message: message(cause) } } })
    }
  },

  async setBookCollections(bookId, collectionIds) {
    try {
      await (await getStorage()).setBookCollections(bookId, collectionIds)
      const membership = { ...get().membership }
      if (collectionIds.length > 0) membership[bookId] = collectionIds
      else delete membership[bookId]
      set({ membership })
    } catch (cause) {
      set({ error: { key: 'library.error.setCollections', values: { message: message(cause) } } })
    }
  },

  openBook(id) {
    set({ view: { name: 'reader', bookId: id } })
  },

  closeBook() {
    // Only the view changes here. The shelf order depends on lastReadAt, which
    // the reader stamps on its way out — it reloads the library itself once
    // that final write has landed, otherwise this would read the old order.
    set({ view: { name: 'library' } })
  },

  dismissError() {
    set({ error: null })
  },
}))

function stripExtension(filename: string): string {
  return filename.replace(/\.epub$/i, '')
}

function message(cause: unknown): string {
  return cause instanceof Error ? cause.message : String(cause)
}
