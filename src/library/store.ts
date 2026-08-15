import { create } from 'zustand'
import { getStorage } from '../platform'
import type { BookRecord } from '../platform/types'
import { parseEpubMetadata } from '../epub/metadata'

export type View = { name: 'library' } | { name: 'reader'; bookId: string }

interface LibraryState {
  books: BookRecord[]
  /** True until the first `load()` settles. */
  loading: boolean
  /** Filename currently being imported, or null. */
  importing: string | null
  error: string | null
  view: View

  load: () => Promise<void>
  importFiles: (files: File[]) => Promise<void>
  removeBook: (id: string) => Promise<void>
  openBook: (id: string) => void
  closeBook: () => void
  dismissError: () => void
}

export const useLibrary = create<LibraryState>((set, get) => ({
  books: [],
  loading: true,
  importing: null,
  error: null,
  view: { name: 'library' },

  async load() {
    try {
      const storage = await getStorage()
      set({ books: await storage.listBooks(), loading: false })
    } catch (cause) {
      set({ loading: false, error: `Could not open the library: ${message(cause)}` })
    }
  },

  async importFiles(files) {
    const epubs = files.filter((file) => file.name.toLowerCase().endsWith('.epub'))
    if (epubs.length === 0) {
      set({ error: 'Only .epub files can be imported.' })
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
            id: crypto.randomUUID(),
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
        set({ error: `Could not import "${file.name}": ${message(cause)}` })
      }
    }

    set({ importing: null })
    await get().load()
  },

  async removeBook(id) {
    try {
      const storage = await getStorage()
      await storage.deleteBook(id)
      set({ books: get().books.filter((book) => book.id !== id) })
    } catch (cause) {
      set({ error: `Could not delete the book: ${message(cause)}` })
    }
  },

  openBook(id) {
    set({ view: { name: 'reader', bookId: id } })
  },

  closeBook() {
    set({ view: { name: 'library' } })
    // The shelf order depends on lastReadAt, which the reader just moved.
    void get().load()
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
