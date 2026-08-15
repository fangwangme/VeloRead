import { invoke } from '@tauri-apps/api/core'
import type { BookRecord, ReadingProgress, StoragePort } from '../types'

/**
 * Tauri implementation of `StoragePort`.
 *
 * All SQLite access and all path construction live in Rust (see
 * `src-tauri/src/library.rs`); this module only marshals data across IPC.
 *
 * Payload conventions, chosen because Tauri v2 only sends a raw body when the
 * *entire* argument list is a buffer:
 * - reads return `tauri::ipc::Response`, which arrives here as an `ArrayBuffer`
 * - writes send base64, which costs ~33% on a once-per-book import but keeps the
 *   command signature ordinary (a `Vec<u8>` argument would be JSON-encoded as a
 *   multi-million element number array)
 */
export function createTauriStorage(): StoragePort {
  return {
    init() {
      return invoke<void>('library_init')
    },

    listBooks() {
      return invoke<BookRecord[]>('library_list_books')
    },

    addBook({ record, data, cover }) {
      return invoke<BookRecord>('library_add_book', {
        record,
        dataBase64: toBase64(data),
        coverBase64: cover ? toBase64(cover) : null,
      })
    },

    deleteBook(id) {
      return invoke<void>('library_delete_book', { id })
    },

    async readBookFile(id) {
      const buffer = await invoke<ArrayBuffer>('library_read_book_file', { id })
      return new Uint8Array(buffer)
    },

    async readCover(id) {
      const buffer = await invoke<ArrayBuffer>('library_read_cover', { id })
      // The command answers with an empty body when the book has no cover.
      return buffer.byteLength > 0 ? new Uint8Array(buffer) : null
    },

    getProgress(bookId) {
      return invoke<ReadingProgress | null>('library_get_progress', { bookId })
    },

    saveProgress(progress) {
      return invoke<void>('library_save_progress', { progress })
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
