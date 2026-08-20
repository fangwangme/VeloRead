/**
 * Platform capability contracts.
 *
 * Per AGENTS.md the frontend never imports `invoke` directly: every native
 * capability goes through a port that has both a Tauri and a web implementation,
 * so `bun run dev` stays a usable target.
 */

import type { StyleId, StyleOverride } from '../reader/styles/types'

/** A book in the library, without its bytes. */
export interface BookRecord {
  id: string
  title: string
  author: string | null
  language: string | null
  /** Mime type of the stored cover image, or null when the EPUB had none. */
  coverMime: string | null
  /** Size of the stored `.epub` in bytes. */
  fileSize: number
  /** ISO-8601. */
  addedAt: string
  /** ISO-8601, null until the book has been opened. */
  lastReadAt: string | null
}

/** Everything needed to add a book: the record plus its payloads. */
export interface BookImport {
  record: BookRecord
  data: Uint8Array
  cover: Uint8Array | null
}

/** Where the reader left off in a book. */
export interface ReadingProgress {
  bookId: string
  /** EPUB CFI of the first visible position, or null before the first relocate. */
  cfi: string | null
  /** 0–1, best effort: 0 until epub.js has generated locations. */
  percentage: number
  /** ISO-8601. */
  updatedAt: string
}

/** Book-specific reading settings. */
export interface BookSettings {
  bookId: string
  styleId: StyleId
  overrides: StyleOverride
  flow?: 'paginated' | 'scrolled-doc'
  /** Per-book Pacer overrides. Undefined means follow the application default. */
  pacerWpm?: number
  pacerCpm?: number
  pacerChunkSize?: number
  pacerCjkCharCount?: number
  updatedAt: string
}

/** Global application settings. */
export interface AppSettings {
  defaultStyleId?: StyleId
  themeMode?: 'auto' | 'light' | 'dark'
  autoNightMode?: boolean
  pacerWpm?: number
  pacerCpm?: number
  pacerChunkSize?: number
  pacerCjkCharCount?: number
  dailyReadingGoalMinutes?: number
  flow?: 'paginated' | 'scrolled-doc'
}

/** User bookmark in a book. */
export interface Bookmark {
  id: string
  bookId: string
  cfi: string
  text: string
  createdAt: string
}

/** Navigation TOC item. */
export interface TocItem {
  id: string
  label: string
  href: string
  subitems?: TocItem[]
}

/** Active reading session slice (capped dwell per page). */
export interface ReadingSession {
  id: string
  bookId: string
  date: string // YYYY-MM-DD
  durationSeconds: number // active seconds (max 300s / 5 min per page)
  latinWordsRead: number
  cjkCharactersRead: number
  updatedAt: string
}

export interface DailyReadingStats {
  durationMinutes: number
  latinWordsRead: number
  cjkCharactersRead: number
}

/** Aggregated reading activity stats for heatmap and dashboard. */
export interface OverallReadingStats {
  totalDurationMinutes: number
  totalLatinWordsRead: number
  totalCjkCharactersRead: number
  totalBooksRead: number
  currentStreakDays: number
  dailyStats: Record<string, DailyReadingStats>
}

/**
 * Library persistence: book metadata, book bytes, cover bytes, reading position,
 * settings, bookmarks, reading statistics.
 */
export interface StoragePort {
  /** Open/create the underlying store. Idempotent. */
  init(): Promise<void>
  /** Newest-read first, then newest-added first. */
  listBooks(): Promise<BookRecord[]>
  addBook(input: BookImport): Promise<BookRecord>
  /** Removes the record, the stored file, the cover, progress, settings, bookmarks, and sessions. */
  deleteBook(id: string): Promise<void>
  readBookFile(id: string): Promise<Uint8Array>
  readCover(id: string): Promise<Uint8Array | null>
  getProgress(bookId: string): Promise<ReadingProgress | null>
  /** Upserts progress and stamps the book's `lastReadAt`. */
  saveProgress(progress: ReadingProgress): Promise<void>
  getBookSettings(bookId: string): Promise<BookSettings | null>
  saveBookSettings(settings: BookSettings): Promise<void>
  getAppSettings(): Promise<AppSettings>
  saveAppSettings(settings: Partial<AppSettings>): Promise<void>
  listBookmarks(bookId: string): Promise<Bookmark[]>
  addBookmark(bookmark: Bookmark): Promise<void>
  deleteBookmark(id: string): Promise<void>
  recordReadingSession(session: ReadingSession): Promise<void>
  getReadingStats(): Promise<OverallReadingStats>
}
