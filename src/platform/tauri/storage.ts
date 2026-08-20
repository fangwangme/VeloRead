import { invoke } from '@tauri-apps/api/core'
import type {
  Annotation,
  AppSettings,
  Bookmark,
  BookImport,
  Collection,
  BookRecord,
  BookSettings,
  OverallReadingStats,
  ReadingProgress,
  ReadingSession,
  StoragePort,
} from '../types'
import { calculateCurrentStreak } from '../../stats/tracking'

/**
 * Tauri implementation of `StoragePort`.
 *
 * All SQLite access and all path construction live in Rust (see
 * `src-tauri/src/library.rs`); this module only marshals data across IPC.
 */
export function createTauriStorage(): StoragePort {
  // App settings are stored as one JSON value. Serialize read-merge-write
  // operations so rapid updates to different keys cannot overwrite each other.
  let appSettingsWrite: Promise<void> = Promise.resolve()

  return {
    init() {
      return invoke<void>('library_init')
    },

    listBooks() {
      return invoke<BookRecord[]>('library_list_books')
    },

    addBook({ record, data, cover }: BookImport) {
      return invoke<BookRecord>('library_add_book', {
        record,
        dataBase64: toBase64(data),
        coverBase64: cover ? toBase64(cover) : null,
      })
    },

    deleteBook(id: string) {
      return invoke<void>('library_delete_book', { id })
    },

    async readBookFile(id: string) {
      const buffer = await invoke<ArrayBuffer>('library_read_book_file', { id })
      return new Uint8Array(buffer)
    },

    async readCover(id: string) {
      const buffer = await invoke<ArrayBuffer>('library_read_cover', { id })
      // The command answers with an empty body when the book has no cover.
      return buffer.byteLength > 0 ? new Uint8Array(buffer) : null
    },

    getProgress(bookId: string) {
      return invoke<ReadingProgress | null>('library_get_progress', { bookId })
    },

    saveProgress(progress: ReadingProgress) {
      return invoke<void>('library_save_progress', { progress })
    },

    getBookSettings(bookId: string) {
      return invoke<BookSettings | null>('library_get_book_settings', { bookId })
    },

    saveBookSettings(settings: BookSettings) {
      return invoke<void>('library_save_book_settings', { settings })
    },

    async getAppSettings() {
      const raw = await invoke<string | null>('library_get_app_settings', { key: 'global' })
      if (!raw) return {}
      try {
        return JSON.parse(raw) as AppSettings
      } catch {
        return {}
      }
    },

    saveAppSettings(settings: Partial<AppSettings>) {
      const write = appSettingsWrite.then(async () => {
        const current = await this.getAppSettings()
        const merged = { ...current, ...settings }
        await invoke<void>('library_save_app_settings', {
          key: 'global',
          value: JSON.stringify(merged),
        })
      })
      appSettingsWrite = write.catch(() => undefined)
      return write
    },

    listBookmarks(bookId: string) {
      return invoke<Bookmark[]>('library_list_bookmarks', { bookId })
    },

    addBookmark(bookmark: Bookmark) {
      return invoke<void>('library_add_bookmark', { bookmark })
    },

    deleteBookmark(id: string) {
      return invoke<void>('library_delete_bookmark', { id })
    },

    listCollections() {
      return invoke<Collection[]>('library_list_collections')
    },

    saveCollection(collection: Collection) {
      return invoke<void>('library_save_collection', { collection })
    },

    deleteCollection(id: string) {
      return invoke<void>('library_delete_collection', { id })
    },

    setBookCollections(bookId: string, collectionIds: string[]) {
      return invoke<void>('library_set_book_collections', { bookId, collectionIds })
    },

    listCollectionMembership() {
      return invoke<Record<string, string[]>>('library_list_collection_membership')
    },

    listAnnotations(bookId: string) {
      return invoke<Annotation[]>('library_list_annotations', { bookId })
    },

    saveAnnotation(annotation: Annotation) {
      return invoke<void>('library_save_annotation', { annotation })
    },

    deleteAnnotation(id: string) {
      return invoke<void>('library_delete_annotation', { id })
    },

    recordReadingSession(session: ReadingSession) {
      return invoke<void>('library_record_reading_session', { session })
    },

    async getReadingStats() {
      const raw = await invoke<OverallReadingStats>('library_get_reading_stats')
      return {
        ...raw,
        currentStreakDays: calculateCurrentStreak(raw.dailyStats ?? {}),
      }
    },
  }
}

/** Chunked so a multi-megabyte book doesn't blow the argument limit of `apply`. */
function toBase64(bytes: Uint8Array): string {
  const CHUNK = 0x8000
  let binary = ''
  for (let i = 0; i < bytes.length; i += CHUNK) {
    binary += String.fromCharCode(...bytes.subarray(i, i + CHUNK))
  }
  return btoa(binary)
}
