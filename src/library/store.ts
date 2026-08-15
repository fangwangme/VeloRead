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
            id: newBookId(),
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
    // Only the view changes here. The shelf order depends on lastReadAt, which
    // the reader stamps on its way out — it reloads the library itself once
    // that final write has landed, otherwise this would read the old order.
    set({ view: { name: 'library' } })
  },

  dismissError() {
    set({ error: null })
  },
}))

/**
 * `crypto.randomUUID` is only defined in a secure context, and the id ends up
 * in a filename on the Tauri side, so a failure here would break importing
 * entirely. `getRandomValues` has no such restriction; both shapes satisfy the
 * `[A-Za-z0-9-]` check that Rust applies before touching the filesystem.
 */
function newBookId(): string {
  if (typeof crypto.randomUUID === 'function') return crypto.randomUUID()
  const bytes = crypto.getRandomValues(new Uint8Array(16))
  return Array.from(bytes, (byte) => byte.toString(16).padStart(2, '0')).join('')
}

function stripExtension(filename: string): string {
  return filename.replace(/\.epub$/i, '')
}

function message(cause: unknown): string {
  return cause instanceof Error ? cause.message : String(cause)
}
