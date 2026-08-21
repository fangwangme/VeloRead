/**
 * Platform capability contracts.
 *
 * Per AGENTS.md the frontend never imports `invoke` directly: every native
 * capability goes through a port that has both a Tauri and a web implementation,
 * so `bun run dev` stays a usable target.
 */

import type { StyleId, StyleOverride } from '../reader/styles/types'
import type { PacerHighlightShape } from '../reader/pacer/overlayStyle'
import type { LanguagePreference } from '../i18n/types'

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

/** Which typography profile a book uses. Decided by its `language` metadata. */
export type ScriptKey = 'latin' | 'cjk'

/**
 * Typography for one script.
 *
 * Per script rather than per book: what you want is a Chinese setup and an
 * English one, not to re-tune every title on the shelf. This mirrors the shape
 * the Pacer already had — one engine, two language profiles.
 */
export interface TypographyProfile {
  styleId: StyleId
  overrides: StyleOverride
}

/**
 * Book-specific reading settings.
 *
 * `styleId` / `overrides` / `flow` are no longer read: typography moved to
 * `AppSettings.typography`, keyed by script. They are still written so the row
 * stays valid against a schema that predates the move, and so the data is there
 * if per-book typography ever comes back.
 */
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

/**
 * Global application settings.
 *
 * The typography entries are *defaults for books that have no setting of their
 * own*, not a global override: changing typography inside a book saves it on
 * that book and updates these, so the next book you open starts where you left
 * off instead of resetting to the factory preset.
 */
export interface AppSettings {
  /** Typography, one profile per script. See `TypographyProfile`. */
  typography?: Partial<Record<ScriptKey, TypographyProfile>>
  themeMode?: 'auto' | 'light' | 'dark'
  /** UI language. `auto` follows the system. */
  language?: LanguagePreference
  autoNightMode?: boolean
  pacerWpm?: number
  pacerCpm?: number
  pacerChunkSize?: number
  pacerCjkCharCount?: number
  dailyReadingGoalMinutes?: number
  /** Paginated or scrolling, for every book — not a per-script choice. */
  flow?: 'paginated' | 'scrolled-doc'
  /**
   * Whether clicking a word moves the auto-reading cursor to it. On by default;
   * off for readers who want a click in the text to do nothing at all.
   */
  clickToPositionPacer?: boolean
  /** Pacer highlight appearance. A hex colour, or `auto` to follow the reading style accent. */
  pacerHighlightColor?: string
  pacerHighlightOpacity?: number
  pacerHighlightShape?: PacerHighlightShape
}

/** User bookmark in a book. */
export interface Bookmark {
  id: string
  bookId: string
  cfi: string
  text: string
  createdAt: string
}

/** Highlight colors offered in the reader. */
export type HighlightColor = 'yellow' | 'green' | 'blue' | 'pink' | 'purple'

/**
 * A highlighted passage, optionally carrying a note.
 *
 * Kept in its own table rather than folded into `Bookmark`: a bookmark is a
 * position, a highlight is a range of text the user chose to keep. One row holds
 * both the highlight and its note, because in this reader a note is always
 * attached to a passage — the Kindle export format splits them back into two
 * records at export time (see docs/specs/annotations.md).
 */
export interface Annotation {
  id: string
  bookId: string
  /** EPUB CFI range covering the selection. */
  cfiRange: string
  /** The passage as it read when it was highlighted. */
  text: string
  /** User note; empty string when the passage was only highlighted. */
  note: string
  color: HighlightColor
  /** Chapter label captured at creation, so the list reads well offline. */
  chapterTitle: string | null
  /**
   * Where the row came from. Imported Kindle rows cannot always be anchored to a
   * CFI, and the UI must not offer a jump button that does nothing.
   */
  source: 'local' | 'kindle-import'
  createdAt: string
  updatedAt: string
}

/**
 * A user-made shelf. A book can belong to several, so membership lives in its
 * own join rather than as a field on the book.
 */
export interface Collection {
  id: string
  name: string
  createdAt: string
  updatedAt: string
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

/** One text file to hand to the user. `name` is a bare filename, never a path. */
export interface ExportFile {
  name: string
  text: string
}

export interface ExportResult {
  /**
   * Where the files ended up, phrased for a person. A path on the desktop; the
   * browser can only say that a download started.
   */
  location: string
  /** True when the location is a real path the platform can reveal. */
  revealable: boolean
}

/**
 * Getting user data out of the app.
 *
 * Second of the three capability ports named in AGENTS.md. Deliberately narrow:
 * the app writes what the user asked for, where the platform puts downloads,
 * and does not otherwise touch the filesystem.
 */
export interface FsPort {
  /**
   * Write text files somewhere the user can find them.
   *
   * The desktop puts a single file straight into Downloads and several into a
   * folder named `bundleName`. The browser cannot write a folder, so several
   * files arrive as one zip of that name.
   */
  exportTextFiles(files: ExportFile[], bundleName: string): Promise<ExportResult>
  /** Show the export in the file manager. No-op where that is not possible. */
  reveal(location: string): Promise<void>
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
  /** Removes the record, the stored file, the cover, progress, settings, bookmarks, annotations, and sessions. */
  deleteBook(id: string): Promise<void>
  readBookFile(id: string): Promise<Uint8Array>
  readCover(id: string): Promise<Uint8Array | null>
  getProgress(bookId: string): Promise<ReadingProgress | null>
  /** bookId -> progress, so the shelf does not query once per book. */
  listProgress(): Promise<Record<string, ReadingProgress>>
  /** Upserts progress and stamps the book's `lastReadAt`. */
  saveProgress(progress: ReadingProgress): Promise<void>
  getBookSettings(bookId: string): Promise<BookSettings | null>
  saveBookSettings(settings: BookSettings): Promise<void>
  getAppSettings(): Promise<AppSettings>
  saveAppSettings(settings: Partial<AppSettings>): Promise<void>
  listBookmarks(bookId: string): Promise<Bookmark[]>
  addBookmark(bookmark: Bookmark): Promise<void>
  deleteBookmark(id: string): Promise<void>
  /** Oldest first, so the list follows reading order within a book. */
  /** By name in code-point order, matching SQLite's `ORDER BY name`. */
  listCollections(): Promise<Collection[]>
  /** Upsert: also used to rename. */
  saveCollection(collection: Collection): Promise<void>
  /** Removes the collection and every membership in it; books are untouched. */
  deleteCollection(id: string): Promise<void>
  /** Replaces this book's membership set wholesale. */
  setBookCollections(bookId: string, collectionIds: string[]): Promise<void>
  /** bookId -> collectionIds, for filtering the shelf without a query per book. */
  listCollectionMembership(): Promise<Record<string, string[]>>
  listAnnotations(bookId: string): Promise<Annotation[]>
  /** Upsert: also used to edit a note or recolor an existing highlight. */
  saveAnnotation(annotation: Annotation): Promise<void>
  deleteAnnotation(id: string): Promise<void>
  recordReadingSession(session: ReadingSession): Promise<void>
  getReadingStats(): Promise<OverallReadingStats>
}
