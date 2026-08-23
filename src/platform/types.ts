/**
 * Platform capability contracts.
 *
 * Per AGENTS.md the frontend never imports `invoke` directly: every native
 * capability goes through a port that has both a Tauri and a web implementation,
 * so `bun run dev` stays a usable target.
 */

import type { StyleId, StyleOverride } from '../reader/styles/types'
import type { PacerCursorMode, PacerHighlightShape } from '../reader/pacer/overlayStyle'
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
  /** Pacer highlight appearance. A hex colour, or `auto` to follow the reading style accent. */
  pacerHighlightColor?: string
  pacerHighlightOpacity?: number
  pacerHighlightShape?: PacerHighlightShape
  /** How much of the page the auto-reading cursor covers. Defaults to `chunk`. */
  pacerCursorMode?: PacerCursorMode
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
 * Being told the application is about to go away.
 *
 * Not one of the three capability ports named in AGENTS.md, but the same rule
 * applies: the reader must not reach for a Tauri window itself. It exists
 * because `beforeunload` is not a shutdown hook on the desktop — WKWebView
 * barely fires it — so the last debounced write of the reading position and the
 * buffered reading time were lost every time the app went away.
 *
 * It covers the exits that announce themselves: closing the window on the
 * desktop, and `pagehide` in the browser. macOS Cmd+Q announces nothing that can
 * be deferred (see `src-tauri/src/lifecycle.rs`), so the reader also keeps how
 * much it can lose small rather than relying on this alone.
 */
export interface LifecyclePort {
  /**
   * Run `handler` while the app is closing but still alive. Returns an
   * unsubscribe.
   *
   * The desktop holds the shutdown until every handler has settled, within a
   * grace period it enforces itself; the browser cannot hold anything, so a
   * handler there gets whatever time the page has left.
   */
  onBeforeExit(handler: () => Promise<void>): () => void
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

/** Status of a word in the vocabulary list. */
export type VocabularyStatus = 'learning' | 'known'

/**
 * One word the reader looked up.
 *
 * `word` keeps the form it was first met in, `stem` is what makes it one row:
 * meeting `ran` after `running` adds a sentence to the entry that is already
 * there rather than starting a third one. See docs/specs/vocabulary.md §5.
 */
export interface VocabularyWord {
  id: string
  word: string
  stem: string
  lang: string
  status: VocabularyStatus
  createdAt: string
}

/**
 * One occasion a word was looked up, with the sentence it was in.
 *
 * Its own record, as on a Kindle: the same word met in three books is three
 * sentences worth keeping. `bookId` is null once the book has been removed from
 * the library — the sentence outlives its source, because the sentence is the
 * value.
 */
export interface VocabularyLookup {
  id: string
  vocabularyId: string
  bookId: string | null
  /** JSON Locator of where the word was, or null when it cannot be anchored. */
  locator: string | null
  sentence: string
  createdAt: string
}

export interface VocabularyEntry {
  word: VocabularyWord
  lookups: VocabularyLookup[]
}

/** Everything one lookup needs recorded. Both ids are minted by the caller. */
export interface VocabularyLookupInput {
  wordId: string
  lookupId: string
  word: string
  stem: string
  lang: string
  bookId: string | null
  locator: string | null
  sentence: string
  createdAt: string
}

/** A dictionary entry: one headword, one paragraph of prose. */
export interface DictEntry {
  /**
   * The headword that matched, which is not always what was selected — a
   * lookup asks about the word and its reductions.
   */
  word: string
  definition: string
}

/**
 * What the dictionary knows about one selected word.
 *
 * `known` is every candidate that has an entry. The definition comes from the
 * first, the stem from the most reduced — two different questions, answered
 * from one pass. See `src/vocabulary/lemma.ts`.
 */
export interface DictLookup {
  known: string[]
  entry: DictEntry | null
}

/** Whether there is a dictionary to query at all. */
export interface DictStatus {
  ready: boolean
  entries: number
  /** Versioned offline asset offered by the desktop; null in a browser. */
  download: DictDownload | null
}

export interface DictDownload {
  version: string
  sizeBytes: number
}

export interface DictDownloadProgress {
  downloadedBytes: number
  totalBytes: number
}

/**
 * Looking words up, and the vocabulary list that comes of it.
 *
 * Third of the three capability ports named in AGENTS.md. Both halves are here
 * because they are one feature: a lookup is what creates a vocabulary row, and
 * a component that could reach one but not the other would have to know which
 * platform it was on to do the obvious thing.
 *
 * Export is deliberately *not* a method: the list leaves through
 * `FsPort.exportTextFiles()`, formatted by `src/vocabulary/export.ts`, exactly
 * as highlights do. `listVocabulary()` is what feeds it.
 */
export interface DictPort {
  /** Open the installed dictionary and report whether the desktop can download it. */
  init(): Promise<DictStatus>
  status(): Promise<DictStatus>
  /** Download, validate and atomically install the desktop dictionary. */
  download(onProgress: (progress: DictDownloadProgress) => void): Promise<DictStatus>
  /**
   * Look one word up. `candidates` is the word as selected followed by its
   * reductions, and the answer says which of them the dictionary knows.
   */
  lookup(candidates: string[]): Promise<DictLookup>
  /** Newest word first. */
  listVocabulary(): Promise<VocabularyEntry[]>
  /** Adds the sentence to the word's entry, creating the word if it is new. */
  recordLookup(input: VocabularyLookupInput): Promise<VocabularyWord>
  setWordStatus(id: string, status: VocabularyStatus): Promise<void>
  /** Removes the word and every sentence recorded for it. */
  deleteWord(id: string): Promise<void>
}
