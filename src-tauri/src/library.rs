//! Library persistence: book metadata and reading progress in SQLite, book
//! files and covers on disk under the app data directory.
//!
//! The frontend never sees a path or a SQL statement — it calls the commands
//! at the bottom of this file through `src/platform/tauri/storage.ts`.
//!
//! The SQL and path logic lives in `store` as plain functions over a
//! `&Connection` and a `&Path`, so it is exercised by the tests at the bottom
//! without standing up a Tauri app.

use std::fs;
use std::path::PathBuf;
use std::sync::Mutex;

use base64::engine::general_purpose::STANDARD as BASE64;
use base64::Engine as _;
use rusqlite::Connection;
use tauri::{ipc::Response, AppHandle, Manager, State};

use store::{
    book_file, Annotation, BookRecord, BookSettings, Bookmark, Collection, OverallReadingStats,
    ReadingProgress, ReadingSession, VocabularyEntry, VocabularyLookupInput, VocabularyWord,
};

/// Storage primitives, free of any Tauri types.
mod store {
    use std::path::{Path, PathBuf};

    use rusqlite::{params, Connection, OptionalExtension};
    use serde::{Deserialize, Serialize};

    pub const SCHEMA_VERSION: i32 = 6;

    #[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
    #[serde(rename_all = "camelCase")]
    pub struct BookRecord {
        pub id: String,
        pub title: String,
        pub author: Option<String>,
        pub language: Option<String>,
        pub cover_mime: Option<String>,
        pub file_size: i64,
        pub added_at: String,
        pub last_read_at: Option<String>,
    }

    #[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
    #[serde(rename_all = "camelCase")]
    pub struct ReadingProgress {
        pub book_id: String,
        pub cfi: Option<String>,
        pub percentage: f64,
        pub updated_at: String,
    }

    #[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
    #[serde(rename_all = "camelCase")]
    pub struct BookSettings {
        pub book_id: String,
        pub style_id: String,
        pub overrides: serde_json::Value,
        #[serde(skip_serializing_if = "Option::is_none")]
        pub flow: Option<String>,
        #[serde(skip_serializing_if = "Option::is_none")]
        pub pacer_wpm: Option<i64>,
        #[serde(skip_serializing_if = "Option::is_none")]
        pub pacer_cpm: Option<i64>,
        #[serde(skip_serializing_if = "Option::is_none")]
        pub pacer_chunk_size: Option<i64>,
        #[serde(skip_serializing_if = "Option::is_none")]
        pub pacer_cjk_char_count: Option<i64>,
        pub updated_at: String,
    }

    #[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
    #[serde(rename_all = "camelCase")]
    pub struct Bookmark {
        pub id: String,
        pub book_id: String,
        pub cfi: String,
        pub text: String,
        pub created_at: String,
    }

    /// A user-made shelf. Membership is a join table because a book can be
    /// filed under several collections at once.
    #[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
    #[serde(rename_all = "camelCase")]
    pub struct Collection {
        pub id: String,
        pub name: String,
        pub created_at: String,
        pub updated_at: String,
    }

    /// A highlighted passage and its optional note. Separate from `bookmarks`:
    /// a bookmark is a position, a highlight is a range of text kept on purpose.
    #[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
    #[serde(rename_all = "camelCase")]
    pub struct Annotation {
        pub id: String,
        pub book_id: String,
        pub cfi_range: String,
        pub text: String,
        #[serde(default)]
        pub note: String,
        pub color: String,
        pub chapter_title: Option<String>,
        #[serde(default = "default_annotation_source")]
        pub source: String,
        pub created_at: String,
        pub updated_at: String,
    }

    fn default_annotation_source() -> String {
        "local".to_string()
    }

    #[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
    #[serde(rename_all = "camelCase")]
    pub struct ReadingSession {
        pub id: String,
        pub book_id: String,
        pub date: String,
        pub duration_seconds: i64,
        pub latin_words_read: i64,
        pub cjk_characters_read: i64,
        pub updated_at: String,
    }

    /// One word the reader looked up, deduplicated by its stem.
    ///
    /// `word` keeps the form it was first met in; `stem` is what makes it one
    /// row, so `running` and `run` do not become two entries.
    #[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
    #[serde(rename_all = "camelCase")]
    pub struct VocabularyWord {
        pub id: String,
        pub word: String,
        pub stem: String,
        pub lang: String,
        pub status: String,
        pub created_at: String,
    }

    /// One occasion the word was looked up, with the sentence it was in.
    ///
    /// Its own table, as on a Kindle: the same word met in three books is three
    /// sentences worth keeping, and folding them into the word would lose two.
    #[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
    #[serde(rename_all = "camelCase")]
    pub struct VocabularyLookup {
        pub id: String,
        pub vocabulary_id: String,
        pub book_id: Option<String>,
        pub locator: Option<String>,
        pub sentence: String,
        pub created_at: String,
    }

    #[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
    #[serde(rename_all = "camelCase")]
    pub struct VocabularyEntry {
        pub word: VocabularyWord,
        pub lookups: Vec<VocabularyLookup>,
    }

    /// Everything one lookup needs. Both ids come from the frontend, as every
    /// other row's does; `word_id` is only used when the word is new.
    #[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
    #[serde(rename_all = "camelCase")]
    pub struct VocabularyLookupInput {
        pub word_id: String,
        pub lookup_id: String,
        pub word: String,
        pub stem: String,
        pub lang: String,
        pub book_id: Option<String>,
        pub locator: Option<String>,
        pub sentence: String,
        pub created_at: String,
    }

    #[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
    #[serde(rename_all = "camelCase")]
    pub struct DailyStat {
        pub duration_minutes: i64,
        pub latin_words_read: i64,
        pub cjk_characters_read: i64,
    }

    #[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
    #[serde(rename_all = "camelCase")]
    pub struct OverallReadingStats {
        pub total_duration_minutes: i64,
        pub total_latin_words_read: i64,
        pub total_cjk_characters_read: i64,
        pub total_books_read: i64,
        pub current_streak_days: i64,
        pub daily_stats: std::collections::HashMap<String, DailyStat>,
    }

    /// Book ids come from the webview, so they are checked before they are ever
    /// pasted into a path. Only the shape produced by `crypto.randomUUID()`
    /// passes, which leaves no room for separators, `..`, or absolute paths.
    pub fn book_file(dir: &Path, id: &str, extension: &str) -> Result<PathBuf, String> {
        let valid = !id.is_empty()
            && id.len() <= 64
            && id
                .chars()
                .all(|character| character.is_ascii_alphanumeric() || character == '-');
        if !valid {
            return Err(format!("invalid book id: {id:?}"));
        }
        Ok(dir.join(format!("{id}.{extension}")))
    }

    pub fn migrate(connection: &Connection) -> rusqlite::Result<()> {
        connection.execute_batch("PRAGMA journal_mode = WAL; PRAGMA foreign_keys = ON;")?;

        let version: i32 = connection.query_row("PRAGMA user_version", [], |row| row.get(0))?;
        if version < 1 {
            connection.execute_batch(
                "CREATE TABLE IF NOT EXISTS books (
                     id           TEXT PRIMARY KEY,
                     title        TEXT NOT NULL,
                     author       TEXT,
                     language     TEXT,
                     cover_mime   TEXT,
                     file_size    INTEGER NOT NULL,
                     added_at     TEXT NOT NULL,
                     last_read_at TEXT
                 );
                 CREATE TABLE IF NOT EXISTS reading_progress (
                     book_id    TEXT PRIMARY KEY REFERENCES books(id) ON DELETE CASCADE,
                     cfi        TEXT,
                     percentage REAL NOT NULL DEFAULT 0,
                     updated_at TEXT NOT NULL
                 );",
            )?;
        }

        if version < 2 {
            // Check if column format exists on books before adding
            let has_format_col: bool = connection
                .prepare("SELECT format FROM books LIMIT 0")
                .is_ok();
            if !has_format_col {
                connection.execute_batch(
                    "ALTER TABLE books ADD COLUMN format TEXT NOT NULL DEFAULT 'epub';",
                )?;
            }

            let has_locator_col: bool = connection
                .prepare("SELECT locator FROM reading_progress LIMIT 0")
                .is_ok();
            if !has_locator_col {
                connection
                    .execute_batch("ALTER TABLE reading_progress ADD COLUMN locator TEXT;")?;
                connection.execute_batch(
                    "UPDATE reading_progress
                     SET locator = '{\"format\":\"epub\",\"cfi\":\"' || cfi || '\"}'
                     WHERE cfi IS NOT NULL AND locator IS NULL;",
                )?;
            }

            connection.execute_batch(
                "CREATE TABLE IF NOT EXISTS book_settings (
                     book_id              TEXT PRIMARY KEY REFERENCES books(id) ON DELETE CASCADE,
                     style_id             TEXT NOT NULL,
                     overrides            TEXT NOT NULL,
                     flow                 TEXT,
                     pacer_wpm            INTEGER,
                     pacer_cpm            INTEGER,
                     pacer_chunk_size     INTEGER,
                     pacer_cjk_char_count INTEGER,
                     updated_at           TEXT NOT NULL
                 );
                 CREATE TABLE IF NOT EXISTS app_settings (
                     key   TEXT PRIMARY KEY,
                     value TEXT NOT NULL
                 );
                 CREATE TABLE IF NOT EXISTS bookmarks (
                     id         TEXT PRIMARY KEY,
                     book_id    TEXT NOT NULL REFERENCES books(id) ON DELETE CASCADE,
                     cfi        TEXT NOT NULL,
                     text       TEXT NOT NULL,
                     created_at TEXT NOT NULL
                 );
                 CREATE TABLE IF NOT EXISTS reading_sessions (
                     id                  TEXT PRIMARY KEY,
                     book_id             TEXT NOT NULL REFERENCES books(id) ON DELETE CASCADE,
                     date                TEXT NOT NULL,
                     duration_seconds    INTEGER NOT NULL,
                     latin_words_read    INTEGER NOT NULL,
                     cjk_characters_read INTEGER NOT NULL,
                     updated_at          TEXT NOT NULL
                 );
                 CREATE INDEX IF NOT EXISTS idx_sessions_date ON reading_sessions(date);",
            )?;
        }

        // Pinned to 3, not SCHEMA_VERSION: this reset exists only because the
        // pre-v3 mixed word count cannot be split into words and CJK characters.
        // Left open-ended it would re-run on every future bump and delete real
        // settings and statistics along with it.
        if version > 0 && version < 3 {
            // The application is still in development. The old mixed count
            // cannot be mapped truthfully to words or CJK characters, so reset
            // only unpublished per-book settings and reading sessions. Books,
            // files, and reading progress remain intact.
            connection.execute_batch(
                "DROP TABLE IF EXISTS reading_sessions;
                 DROP TABLE IF EXISTS book_settings;
                 CREATE TABLE book_settings (
                     book_id              TEXT PRIMARY KEY REFERENCES books(id) ON DELETE CASCADE,
                     style_id             TEXT NOT NULL,
                     overrides            TEXT NOT NULL,
                     flow                 TEXT,
                     pacer_wpm            INTEGER,
                     pacer_cpm            INTEGER,
                     pacer_chunk_size     INTEGER,
                     pacer_cjk_char_count INTEGER,
                     updated_at           TEXT NOT NULL
                 );
                 CREATE TABLE reading_sessions (
                     id                  TEXT PRIMARY KEY,
                     book_id             TEXT NOT NULL REFERENCES books(id) ON DELETE CASCADE,
                     date                TEXT NOT NULL,
                     duration_seconds    INTEGER NOT NULL,
                     latin_words_read    INTEGER NOT NULL,
                     cjk_characters_read INTEGER NOT NULL,
                     updated_at          TEXT NOT NULL
                 );
                 CREATE INDEX idx_sessions_date ON reading_sessions(date);",
            )?;
        }

        connection.execute_batch(
            "CREATE TABLE IF NOT EXISTS annotations (
                 id            TEXT PRIMARY KEY,
                 book_id       TEXT NOT NULL REFERENCES books(id) ON DELETE CASCADE,
                 cfi_range     TEXT NOT NULL,
                 text          TEXT NOT NULL,
                 note          TEXT NOT NULL DEFAULT '',
                 color         TEXT NOT NULL,
                 chapter_title TEXT,
                 source        TEXT NOT NULL DEFAULT 'local',
                 created_at    TEXT NOT NULL,
                 updated_at    TEXT NOT NULL
             );
             CREATE INDEX IF NOT EXISTS idx_annotations_book
                 ON annotations(book_id, created_at);",
        )?;

        connection.execute_batch(
            "CREATE TABLE IF NOT EXISTS collections (
                 id         TEXT PRIMARY KEY,
                 name       TEXT NOT NULL,
                 created_at TEXT NOT NULL,
                 updated_at TEXT NOT NULL
             );
             CREATE TABLE IF NOT EXISTS collection_books (
                 collection_id TEXT NOT NULL REFERENCES collections(id) ON DELETE CASCADE,
                 book_id       TEXT NOT NULL REFERENCES books(id) ON DELETE CASCADE,
                 PRIMARY KEY (collection_id, book_id)
             );
             CREATE INDEX IF NOT EXISTS idx_collection_books_book
                 ON collection_books(book_id);",
        )?;

        // v6: the vocabulary builder. Two tables, per docs/specs/vocabulary.md:
        // one row per word, one row per time it was looked up.
        //
        // `book_id` is ON DELETE SET NULL, not CASCADE: removing a book from the
        // shelf must not remove what you learned from it. The sentence stays
        // even once its source is gone, because the sentence is the value.
        connection.execute_batch(
            "CREATE TABLE IF NOT EXISTS vocabulary (
                 id         TEXT PRIMARY KEY,
                 word       TEXT NOT NULL,
                 stem       TEXT NOT NULL,
                 lang       TEXT NOT NULL,
                 status     TEXT NOT NULL,
                 created_at TEXT NOT NULL,
                 UNIQUE(stem, lang)
             );
             CREATE TABLE IF NOT EXISTS vocabulary_lookups (
                 id            TEXT PRIMARY KEY,
                 vocabulary_id TEXT NOT NULL REFERENCES vocabulary(id) ON DELETE CASCADE,
                 book_id       TEXT REFERENCES books(id) ON DELETE SET NULL,
                 locator       TEXT,
                 sentence      TEXT NOT NULL,
                 created_at    TEXT NOT NULL
             );
             CREATE INDEX IF NOT EXISTS vocab_lookups_word
                 ON vocabulary_lookups(vocabulary_id, created_at DESC);",
        )?;

        connection.execute_batch(&format!("PRAGMA user_version = {SCHEMA_VERSION}"))?;
        Ok(())
    }

    /// Most recently read first, never-read books after them, then newest
    /// import first. Mirrors `compareBooks()` in `src/platform/sort.ts`.
    pub fn list_books(connection: &Connection) -> rusqlite::Result<Vec<BookRecord>> {
        let mut statement = connection.prepare(
            "SELECT id, title, author, language, cover_mime, file_size, added_at, last_read_at
             FROM books
             ORDER BY COALESCE(last_read_at, '') DESC, added_at DESC",
        )?;
        let rows = statement.query_map([], |row| {
            Ok(BookRecord {
                id: row.get(0)?,
                title: row.get(1)?,
                author: row.get(2)?,
                language: row.get(3)?,
                cover_mime: row.get(4)?,
                file_size: row.get(5)?,
                added_at: row.get(6)?,
                last_read_at: row.get(7)?,
            })
        })?;
        rows.collect()
    }

    pub fn insert_book(connection: &Connection, record: &BookRecord) -> rusqlite::Result<()> {
        connection.execute(
            "INSERT INTO books (id, title, author, language, cover_mime, file_size, added_at, last_read_at)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8)",
            params![
                record.id,
                record.title,
                record.author,
                record.language,
                record.cover_mime,
                record.file_size,
                record.added_at,
                record.last_read_at,
            ],
        )?;
        Ok(())
    }

    pub fn delete_book(connection: &Connection, id: &str) -> rusqlite::Result<()> {
        connection.execute(
            "DELETE FROM collection_books WHERE book_id = ?1",
            params![id],
        )?;
        connection.execute("DELETE FROM annotations WHERE book_id = ?1", params![id])?;
        connection.execute(
            "DELETE FROM reading_sessions WHERE book_id = ?1",
            params![id],
        )?;
        connection.execute("DELETE FROM bookmarks WHERE book_id = ?1", params![id])?;
        connection.execute("DELETE FROM book_settings WHERE book_id = ?1", params![id])?;
        connection.execute(
            "DELETE FROM reading_progress WHERE book_id = ?1",
            params![id],
        )?;
        connection.execute("DELETE FROM books WHERE id = ?1", params![id])?;
        Ok(())
    }

    pub fn get_progress(
        connection: &Connection,
        book_id: &str,
    ) -> rusqlite::Result<Option<ReadingProgress>> {
        connection
            .query_row(
                "SELECT book_id, cfi, percentage, updated_at FROM reading_progress WHERE book_id = ?1",
                params![book_id],
                |row| {
                    Ok(ReadingProgress {
                        book_id: row.get(0)?,
                        cfi: row.get(1)?,
                        percentage: row.get(2)?,
                        updated_at: row.get(3)?,
                    })
                },
            )
            .optional()
    }

    /// Every book's position in one query, so the shelf does not ask per book.
    pub fn list_progress(
        connection: &Connection,
    ) -> rusqlite::Result<std::collections::HashMap<String, ReadingProgress>> {
        let mut statement = connection
            .prepare("SELECT book_id, cfi, percentage, updated_at FROM reading_progress")?;
        let rows = statement.query_map([], |row| {
            Ok(ReadingProgress {
                book_id: row.get(0)?,
                cfi: row.get(1)?,
                percentage: row.get(2)?,
                updated_at: row.get(3)?,
            })
        })?;
        let mut all = std::collections::HashMap::new();
        for row in rows {
            let progress = row?;
            all.insert(progress.book_id.clone(), progress);
        }
        Ok(all)
    }

    /// Upserts the position and stamps the book's `last_read_at` with the same
    /// timestamp, which is what moves it to the front of the shelf.
    pub fn save_progress(
        connection: &Connection,
        progress: &ReadingProgress,
    ) -> rusqlite::Result<()> {
        connection.execute(
            "INSERT INTO reading_progress (book_id, cfi, percentage, updated_at)
             VALUES (?1, ?2, ?3, ?4)
             ON CONFLICT(book_id) DO UPDATE SET
                 cfi = excluded.cfi,
                 percentage = excluded.percentage,
                 updated_at = excluded.updated_at",
            params![
                progress.book_id,
                progress.cfi,
                progress.percentage,
                progress.updated_at
            ],
        )?;
        connection.execute(
            "UPDATE books SET last_read_at = ?2 WHERE id = ?1",
            params![progress.book_id, progress.updated_at],
        )?;
        Ok(())
    }

    pub fn get_book_settings(
        connection: &Connection,
        book_id: &str,
    ) -> rusqlite::Result<Option<BookSettings>> {
        connection
            .query_row(
                "SELECT book_id, style_id, overrides, flow,
                        pacer_wpm, pacer_cpm, pacer_chunk_size, pacer_cjk_char_count,
                        updated_at
                 FROM book_settings WHERE book_id = ?1",
                params![book_id],
                |row| {
                    let overrides_str: String = row.get(2)?;
                    let overrides_val: serde_json::Value =
                        serde_json::from_str(&overrides_str).unwrap_or(serde_json::Value::Null);
                    Ok(BookSettings {
                        book_id: row.get(0)?,
                        style_id: row.get(1)?,
                        overrides: overrides_val,
                        flow: row.get(3)?,
                        pacer_wpm: row.get(4)?,
                        pacer_cpm: row.get(5)?,
                        pacer_chunk_size: row.get(6)?,
                        pacer_cjk_char_count: row.get(7)?,
                        updated_at: row.get(8)?,
                    })
                },
            )
            .optional()
    }

    pub fn save_book_settings(
        connection: &Connection,
        settings: &BookSettings,
    ) -> rusqlite::Result<()> {
        let overrides_str = serde_json::to_string(&settings.overrides).unwrap_or_default();
        connection.execute(
            "INSERT INTO book_settings (
                 book_id, style_id, overrides, flow,
                 pacer_wpm, pacer_cpm, pacer_chunk_size, pacer_cjk_char_count,
                 updated_at
             )
             VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9)
             ON CONFLICT(book_id) DO UPDATE SET
                 style_id = excluded.style_id,
                 overrides = excluded.overrides,
                 flow = excluded.flow,
                 pacer_wpm = excluded.pacer_wpm,
                 pacer_cpm = excluded.pacer_cpm,
                 pacer_chunk_size = excluded.pacer_chunk_size,
                 pacer_cjk_char_count = excluded.pacer_cjk_char_count,
                 updated_at = excluded.updated_at",
            params![
                settings.book_id,
                settings.style_id,
                overrides_str,
                settings.flow,
                settings.pacer_wpm,
                settings.pacer_cpm,
                settings.pacer_chunk_size,
                settings.pacer_cjk_char_count,
                settings.updated_at
            ],
        )?;
        Ok(())
    }

    pub fn get_app_settings(
        connection: &Connection,
        key: &str,
    ) -> rusqlite::Result<Option<String>> {
        connection
            .query_row(
                "SELECT value FROM app_settings WHERE key = ?1",
                params![key],
                |row| row.get(0),
            )
            .optional()
    }

    pub fn save_app_settings(
        connection: &Connection,
        key: &str,
        value: &str,
    ) -> rusqlite::Result<()> {
        connection.execute(
            "INSERT INTO app_settings (key, value)
             VALUES (?1, ?2)
             ON CONFLICT(key) DO UPDATE SET value = excluded.value",
            params![key, value],
        )?;
        Ok(())
    }

    pub fn list_bookmarks(
        connection: &Connection,
        book_id: &str,
    ) -> rusqlite::Result<Vec<Bookmark>> {
        let mut statement = connection.prepare(
            "SELECT id, book_id, cfi, text, created_at
             FROM bookmarks
             WHERE book_id = ?1
             ORDER BY created_at ASC",
        )?;
        let rows = statement.query_map(params![book_id], |row| {
            Ok(Bookmark {
                id: row.get(0)?,
                book_id: row.get(1)?,
                cfi: row.get(2)?,
                text: row.get(3)?,
                created_at: row.get(4)?,
            })
        })?;
        rows.collect()
    }

    pub fn add_bookmark(connection: &Connection, bookmark: &Bookmark) -> rusqlite::Result<()> {
        connection.execute(
            "INSERT INTO bookmarks (id, book_id, cfi, text, created_at)
             VALUES (?1, ?2, ?3, ?4, ?5)
             ON CONFLICT(id) DO UPDATE SET
                 cfi = excluded.cfi,
                 text = excluded.text,
                 created_at = excluded.created_at",
            params![
                bookmark.id,
                bookmark.book_id,
                bookmark.cfi,
                bookmark.text,
                bookmark.created_at
            ],
        )?;
        Ok(())
    }

    pub fn delete_bookmark(connection: &Connection, id: &str) -> rusqlite::Result<()> {
        connection.execute("DELETE FROM bookmarks WHERE id = ?1", params![id])?;
        Ok(())
    }

    pub fn list_collections(connection: &Connection) -> rusqlite::Result<Vec<Collection>> {
        let mut statement = connection.prepare(
            "SELECT id, name, created_at, updated_at FROM collections ORDER BY name ASC, id ASC",
        )?;
        let rows = statement.query_map([], |row| {
            Ok(Collection {
                id: row.get(0)?,
                name: row.get(1)?,
                created_at: row.get(2)?,
                updated_at: row.get(3)?,
            })
        })?;
        rows.collect()
    }

    /// Upsert, so renaming a collection reuses this path.
    pub fn save_collection(
        connection: &Connection,
        collection: &Collection,
    ) -> rusqlite::Result<()> {
        connection.execute(
            "INSERT INTO collections (id, name, created_at, updated_at)
             VALUES (?1, ?2, ?3, ?4)
             ON CONFLICT(id) DO UPDATE SET
                 name = excluded.name,
                 updated_at = excluded.updated_at",
            params![
                collection.id,
                collection.name,
                collection.created_at,
                collection.updated_at
            ],
        )?;
        Ok(())
    }

    /// Deletes the shelf and its memberships. The books themselves stay.
    pub fn delete_collection(connection: &Connection, id: &str) -> rusqlite::Result<()> {
        connection.execute(
            "DELETE FROM collection_books WHERE collection_id = ?1",
            params![id],
        )?;
        connection.execute("DELETE FROM collections WHERE id = ?1", params![id])?;
        Ok(())
    }

    /// Replaces one book's membership set wholesale, in a transaction so a
    /// failure cannot leave the book filed under half the chosen shelves.
    pub fn set_book_collections(
        connection: &Connection,
        book_id: &str,
        collection_ids: &[String],
    ) -> rusqlite::Result<()> {
        // `unchecked_transaction` because the command layer hands out a shared
        // borrow; there is no second writer, the Mutex serializes access.
        let transaction = connection.unchecked_transaction()?;
        transaction.execute(
            "DELETE FROM collection_books WHERE book_id = ?1",
            params![book_id],
        )?;
        for collection_id in collection_ids {
            transaction.execute(
                "INSERT OR IGNORE INTO collection_books (collection_id, book_id)
                 VALUES (?1, ?2)",
                params![collection_id, book_id],
            )?;
        }
        transaction.commit()
    }

    pub fn list_collection_membership(
        connection: &Connection,
    ) -> rusqlite::Result<std::collections::HashMap<String, Vec<String>>> {
        let mut statement = connection
            .prepare("SELECT book_id, collection_id FROM collection_books ORDER BY book_id ASC")?;
        let rows = statement.query_map([], |row| {
            Ok((row.get::<_, String>(0)?, row.get::<_, String>(1)?))
        })?;

        let mut membership: std::collections::HashMap<String, Vec<String>> =
            std::collections::HashMap::new();
        for row in rows {
            let (book_id, collection_id) = row?;
            membership.entry(book_id).or_default().push(collection_id);
        }
        Ok(membership)
    }

    pub fn list_annotations(
        connection: &Connection,
        book_id: &str,
    ) -> rusqlite::Result<Vec<Annotation>> {
        let mut statement = connection.prepare(
            "SELECT id, book_id, cfi_range, text, note, color, chapter_title,
                    source, created_at, updated_at
             FROM annotations WHERE book_id = ?1
             ORDER BY created_at ASC, id ASC",
        )?;
        let rows = statement.query_map(params![book_id], |row| {
            Ok(Annotation {
                id: row.get(0)?,
                book_id: row.get(1)?,
                cfi_range: row.get(2)?,
                text: row.get(3)?,
                note: row.get(4)?,
                color: row.get(5)?,
                chapter_title: row.get(6)?,
                source: row.get(7)?,
                created_at: row.get(8)?,
                updated_at: row.get(9)?,
            })
        })?;
        rows.collect()
    }

    /// Upsert, so editing a note or recoloring a highlight reuses this path.
    pub fn save_annotation(
        connection: &Connection,
        annotation: &Annotation,
    ) -> rusqlite::Result<()> {
        connection.execute(
            "INSERT INTO annotations (
                 id, book_id, cfi_range, text, note, color, chapter_title,
                 source, created_at, updated_at
             )
             VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10)
             ON CONFLICT(id) DO UPDATE SET
                 cfi_range = excluded.cfi_range,
                 text = excluded.text,
                 note = excluded.note,
                 color = excluded.color,
                 chapter_title = excluded.chapter_title,
                 updated_at = excluded.updated_at",
            params![
                annotation.id,
                annotation.book_id,
                annotation.cfi_range,
                annotation.text,
                annotation.note,
                annotation.color,
                annotation.chapter_title,
                annotation.source,
                annotation.created_at,
                annotation.updated_at,
            ],
        )?;
        Ok(())
    }

    pub fn delete_annotation(connection: &Connection, id: &str) -> rusqlite::Result<()> {
        connection.execute("DELETE FROM annotations WHERE id = ?1", params![id])?;
        Ok(())
    }

    /// Record one lookup, creating the word the first time it is met.
    ///
    /// Deduplication is on `(stem, lang)` rather than on the word as written,
    /// so meeting `ran` after `running` adds a sentence to the entry that is
    /// already there instead of starting a third one. The stored `word` keeps
    /// the form it was first seen in — later encounters do not rewrite it,
    /// because the first sighting is the one the sentences belong to.
    pub fn record_vocabulary_lookup(
        connection: &Connection,
        input: &VocabularyLookupInput,
    ) -> rusqlite::Result<VocabularyWord> {
        let word = connection.query_row(
            "INSERT INTO vocabulary (id, word, stem, lang, status, created_at)
             VALUES (?1, ?2, ?3, ?4, 'learning', ?5)
             ON CONFLICT(stem, lang) DO UPDATE SET word = vocabulary.word
             RETURNING id, word, stem, lang, status, created_at",
            params![
                input.word_id,
                input.word,
                input.stem,
                input.lang,
                input.created_at,
            ],
            |row| {
                Ok(VocabularyWord {
                    id: row.get(0)?,
                    word: row.get(1)?,
                    stem: row.get(2)?,
                    lang: row.get(3)?,
                    status: row.get(4)?,
                    created_at: row.get(5)?,
                })
            },
        )?;

        connection.execute(
            "INSERT INTO vocabulary_lookups (
                 id, vocabulary_id, book_id, locator, sentence, created_at
             )
             VALUES (?1, ?2, ?3, ?4, ?5, ?6)
             ON CONFLICT(id) DO NOTHING",
            params![
                input.lookup_id,
                word.id,
                input.book_id,
                input.locator,
                input.sentence,
                input.created_at,
            ],
        )?;

        Ok(word)
    }

    /// Newest word first. Mirrored by `compareVocabulary()` in
    /// `src/vocabulary/sort.ts`, which the browser implementation uses — the two
    /// must return the same order for the same data.
    pub fn list_vocabulary(connection: &Connection) -> rusqlite::Result<Vec<VocabularyEntry>> {
        let mut statement = connection.prepare(
            "SELECT id, word, stem, lang, status, created_at
             FROM vocabulary
             ORDER BY created_at DESC, id DESC",
        )?;
        let words: Vec<VocabularyWord> = statement
            .query_map([], |row| {
                Ok(VocabularyWord {
                    id: row.get(0)?,
                    word: row.get(1)?,
                    stem: row.get(2)?,
                    lang: row.get(3)?,
                    status: row.get(4)?,
                    created_at: row.get(5)?,
                })
            })?
            .collect::<rusqlite::Result<_>>()?;

        let mut statement = connection.prepare(
            "SELECT id, vocabulary_id, book_id, locator, sentence, created_at
             FROM vocabulary_lookups
             ORDER BY created_at ASC, id ASC",
        )?;
        let mut by_word: std::collections::HashMap<String, Vec<VocabularyLookup>> =
            std::collections::HashMap::new();
        for row in statement.query_map([], |row| {
            Ok(VocabularyLookup {
                id: row.get(0)?,
                vocabulary_id: row.get(1)?,
                book_id: row.get(2)?,
                locator: row.get(3)?,
                sentence: row.get(4)?,
                created_at: row.get(5)?,
            })
        })? {
            let lookup = row?;
            by_word
                .entry(lookup.vocabulary_id.clone())
                .or_default()
                .push(lookup);
        }

        Ok(words
            .into_iter()
            .map(|word| VocabularyEntry {
                lookups: by_word.remove(&word.id).unwrap_or_default(),
                word,
            })
            .collect())
    }

    pub fn set_vocabulary_status(
        connection: &Connection,
        id: &str,
        status: &str,
    ) -> rusqlite::Result<()> {
        connection.execute(
            "UPDATE vocabulary SET status = ?2 WHERE id = ?1",
            params![id, status],
        )?;
        Ok(())
    }

    /// Removes the word and, by cascade, every sentence recorded for it.
    pub fn delete_vocabulary(connection: &Connection, id: &str) -> rusqlite::Result<()> {
        connection.execute("DELETE FROM vocabulary WHERE id = ?1", params![id])?;
        Ok(())
    }

    pub fn record_reading_session(
        connection: &Connection,
        session: &ReadingSession,
    ) -> rusqlite::Result<()> {
        connection.execute(
            "INSERT INTO reading_sessions (
                 id, book_id, date, duration_seconds,
                 latin_words_read, cjk_characters_read, updated_at
             )
             VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7)
             ON CONFLICT(id) DO UPDATE SET
                 duration_seconds = duration_seconds + excluded.duration_seconds,
                 latin_words_read = latin_words_read + excluded.latin_words_read,
                 cjk_characters_read = cjk_characters_read + excluded.cjk_characters_read,
                 updated_at = excluded.updated_at",
            params![
                session.id,
                session.book_id,
                session.date,
                session.duration_seconds,
                session.latin_words_read,
                session.cjk_characters_read,
                session.updated_at,
            ],
        )?;
        Ok(())
    }

    /// Minutes shown for a span of reading. Mirrors `roundedMinutes()` in
    /// `src/platform/web/storage.ts`: round to the nearest minute, but never
    /// round a session that happened down to zero.
    fn rounded_minutes(seconds: i64) -> i64 {
        if seconds <= 0 {
            0
        } else {
            std::cmp::max(1, (seconds + 30) / 60)
        }
    }

    pub fn get_reading_stats(connection: &Connection) -> rusqlite::Result<OverallReadingStats> {
        let mut stmt = connection.prepare(
            "SELECT date, SUM(duration_seconds), SUM(latin_words_read),
                    SUM(cjk_characters_read)
             FROM reading_sessions
             GROUP BY date
             ORDER BY date ASC",
        )?;

        let mut daily_stats = std::collections::HashMap::new();
        let mut total_duration_minutes: i64 = 0;
        let mut total_latin_words_read: i64 = 0;
        let mut total_cjk_characters_read: i64 = 0;

        let rows = stmt.query_map([], |row| {
            let date: String = row.get(0)?;
            let dur: i64 = row.get(1)?;
            let latin_words: i64 = row.get(2)?;
            let cjk_characters: i64 = row.get(3)?;
            Ok((date, dur, latin_words, cjk_characters))
        })?;

        for row in rows {
            let (date, dur, latin_words, cjk_characters) = row?;
            let duration_minutes = rounded_minutes(dur);
            // The grand total is the sum of the per-day minutes, not the
            // rounding of the grand total in seconds: the check-in calendar
            // shows the daily numbers, and a total that does not add up to them
            // reads as a bug in the stats.
            total_duration_minutes += duration_minutes;
            total_latin_words_read += latin_words;
            total_cjk_characters_read += cjk_characters;
            daily_stats.insert(
                date,
                DailyStat {
                    duration_minutes,
                    latin_words_read: latin_words,
                    cjk_characters_read: cjk_characters,
                },
            );
        }

        let total_books_read: i64 = connection
            .query_row(
                "SELECT COUNT(DISTINCT book_id) FROM reading_sessions",
                [],
                |row| row.get(0),
            )
            .unwrap_or(0);

        Ok(OverallReadingStats {
            total_duration_minutes,
            total_latin_words_read,
            total_cjk_characters_read,
            total_books_read,
            current_streak_days: 0,
            daily_stats,
        })
    }
}

/// Opened lazily so a storage failure surfaces as a message in the UI rather
/// than a window that never appears.
#[derive(Default)]
pub struct LibraryState {
    connection: Mutex<Option<Connection>>,
}

impl LibraryState {
    /// Run `body` against the library database, opening it on first use.
    fn with_db<T>(
        &self,
        app: &AppHandle,
        body: impl FnOnce(&Connection) -> rusqlite::Result<T>,
    ) -> Result<T, String> {
        let mut guard = self
            .connection
            .lock()
            .map_err(|_| "library database lock was poisoned".to_string())?;

        if guard.is_none() {
            *guard = Some(open_database(app)?);
        }
        let connection = guard.as_ref().expect("connection opened above");
        body(connection).map_err(|error| error.to_string())
    }
}

fn data_dir(app: &AppHandle) -> Result<PathBuf, String> {
    app.path()
        .app_data_dir()
        .map_err(|error| format!("no app data directory: {error}"))
}

fn books_dir(app: &AppHandle) -> Result<PathBuf, String> {
    let dir = data_dir(app)?.join("library");
    fs::create_dir_all(&dir)
        .map_err(|error| format!("could not create {}: {error}", dir.display()))?;
    Ok(dir)
}

fn book_path(app: &AppHandle, id: &str, extension: &str) -> Result<PathBuf, String> {
    book_file(&books_dir(app)?, id, extension)
}

fn open_database(app: &AppHandle) -> Result<Connection, String> {
    let dir = data_dir(app)?;
    fs::create_dir_all(&dir)
        .map_err(|error| format!("could not create {}: {error}", dir.display()))?;

    let connection = Connection::open(dir.join("veloread.db"))
        .map_err(|error| format!("could not open the library database: {error}"))?;
    store::migrate(&connection)
        .map_err(|error| format!("could not migrate the library database: {error}"))?;
    Ok(connection)
}

#[tauri::command]
pub fn library_init(app: AppHandle, state: State<'_, LibraryState>) -> Result<(), String> {
    state.with_db(&app, |_| Ok(()))
}

#[tauri::command]
pub fn library_list_books(
    app: AppHandle,
    state: State<'_, LibraryState>,
) -> Result<Vec<BookRecord>, String> {
    state.with_db(&app, store::list_books)
}

#[tauri::command]
pub fn library_add_book(
    app: AppHandle,
    state: State<'_, LibraryState>,
    record: BookRecord,
    data_base64: String,
    cover_base64: Option<String>,
) -> Result<BookRecord, String> {
    let data = BASE64
        .decode(data_base64)
        .map_err(|error| format!("book payload was not valid base64: {error}"))?;
    let cover = cover_base64
        .map(|encoded| BASE64.decode(encoded))
        .transpose()
        .map_err(|error| format!("cover payload was not valid base64: {error}"))?;

    let book_file = book_path(&app, &record.id, "epub")?;
    let cover_file = book_path(&app, &record.id, "cover")?;

    // The metadata row is claimed first, so a duplicate id fails here and the
    // rollback below can only ever remove files this call created.
    state.with_db(&app, |connection| store::insert_book(connection, &record))?;

    let written = fs::write(&book_file, &data)
        .map_err(|error| format!("could not write {}: {error}", book_file.display()))
        .and_then(|()| match &cover {
            Some(bytes) => fs::write(&cover_file, bytes)
                .map_err(|error| format!("could not write {}: {error}", cover_file.display())),
            None => Ok(()),
        });

    // A row pointing at a book that was never written is worse than no row.
    if let Err(error) = written {
        let _ = fs::remove_file(&book_file);
        let _ = fs::remove_file(&cover_file);
        let _ = state.with_db(&app, |connection| {
            store::delete_book(connection, &record.id)
        });
        return Err(error);
    }

    Ok(record)
}

#[tauri::command]
pub fn library_delete_book(
    app: AppHandle,
    state: State<'_, LibraryState>,
    id: String,
) -> Result<(), String> {
    // Files first: a leftover row is recoverable, a leftover file is invisible.
    let _ = fs::remove_file(book_path(&app, &id, "epub")?);
    let _ = fs::remove_file(book_path(&app, &id, "cover")?);

    state.with_db(&app, |connection| store::delete_book(connection, &id))
}

#[tauri::command]
pub fn library_read_book_file(app: AppHandle, id: String) -> Result<Response, String> {
    let path = book_path(&app, &id, "epub")?;
    let bytes =
        fs::read(&path).map_err(|error| format!("could not read {}: {error}", path.display()))?;
    Ok(Response::new(bytes))
}

/// Answers with an empty body when the book has no stored cover.
#[tauri::command]
pub fn library_read_cover(app: AppHandle, id: String) -> Result<Response, String> {
    let path = book_path(&app, &id, "cover")?;
    Ok(Response::new(fs::read(path).unwrap_or_default()))
}

#[tauri::command]
pub fn library_get_progress(
    app: AppHandle,
    state: State<'_, LibraryState>,
    book_id: String,
) -> Result<Option<ReadingProgress>, String> {
    state.with_db(&app, |connection| store::get_progress(connection, &book_id))
}

#[tauri::command]
pub fn library_list_progress(
    app: AppHandle,
    state: State<'_, LibraryState>,
) -> Result<std::collections::HashMap<String, ReadingProgress>, String> {
    state.with_db(&app, store::list_progress)
}

#[tauri::command]
pub fn library_save_progress(
    app: AppHandle,
    state: State<'_, LibraryState>,
    progress: ReadingProgress,
) -> Result<(), String> {
    state.with_db(&app, |connection| {
        store::save_progress(connection, &progress)
    })
}

#[tauri::command]
pub fn library_get_book_settings(
    app: AppHandle,
    state: State<'_, LibraryState>,
    book_id: String,
) -> Result<Option<BookSettings>, String> {
    state.with_db(&app, |connection| {
        store::get_book_settings(connection, &book_id)
    })
}

#[tauri::command]
pub fn library_save_book_settings(
    app: AppHandle,
    state: State<'_, LibraryState>,
    settings: BookSettings,
) -> Result<(), String> {
    state.with_db(&app, |connection| {
        store::save_book_settings(connection, &settings)
    })
}

#[tauri::command]
pub fn library_get_app_settings(
    app: AppHandle,
    state: State<'_, LibraryState>,
    key: String,
) -> Result<Option<String>, String> {
    state.with_db(&app, |connection| store::get_app_settings(connection, &key))
}

#[tauri::command]
pub fn library_save_app_settings(
    app: AppHandle,
    state: State<'_, LibraryState>,
    key: String,
    value: String,
) -> Result<(), String> {
    state.with_db(&app, |connection| {
        store::save_app_settings(connection, &key, &value)
    })
}

#[tauri::command]
pub fn library_list_bookmarks(
    app: AppHandle,
    state: State<'_, LibraryState>,
    book_id: String,
) -> Result<Vec<Bookmark>, String> {
    state.with_db(&app, |connection| {
        store::list_bookmarks(connection, &book_id)
    })
}

#[tauri::command]
pub fn library_add_bookmark(
    app: AppHandle,
    state: State<'_, LibraryState>,
    bookmark: Bookmark,
) -> Result<(), String> {
    state.with_db(&app, |connection| {
        store::add_bookmark(connection, &bookmark)
    })
}

#[tauri::command]
pub fn library_delete_bookmark(
    app: AppHandle,
    state: State<'_, LibraryState>,
    id: String,
) -> Result<(), String> {
    state.with_db(&app, |connection| store::delete_bookmark(connection, &id))
}

#[tauri::command]
pub fn library_list_collections(
    app: AppHandle,
    state: State<'_, LibraryState>,
) -> Result<Vec<Collection>, String> {
    state.with_db(&app, store::list_collections)
}

#[tauri::command]
pub fn library_save_collection(
    app: AppHandle,
    state: State<'_, LibraryState>,
    collection: Collection,
) -> Result<(), String> {
    state.with_db(&app, |connection| {
        store::save_collection(connection, &collection)
    })
}

#[tauri::command]
pub fn library_delete_collection(
    app: AppHandle,
    state: State<'_, LibraryState>,
    id: String,
) -> Result<(), String> {
    state.with_db(&app, |connection| store::delete_collection(connection, &id))
}

#[tauri::command]
pub fn library_set_book_collections(
    app: AppHandle,
    state: State<'_, LibraryState>,
    book_id: String,
    collection_ids: Vec<String>,
) -> Result<(), String> {
    state.with_db(&app, |connection| {
        store::set_book_collections(connection, &book_id, &collection_ids)
    })
}

#[tauri::command]
pub fn library_list_collection_membership(
    app: AppHandle,
    state: State<'_, LibraryState>,
) -> Result<std::collections::HashMap<String, Vec<String>>, String> {
    state.with_db(&app, store::list_collection_membership)
}

#[tauri::command]
pub fn library_list_annotations(
    app: AppHandle,
    state: State<'_, LibraryState>,
    book_id: String,
) -> Result<Vec<Annotation>, String> {
    state.with_db(&app, |connection| {
        store::list_annotations(connection, &book_id)
    })
}

#[tauri::command]
pub fn library_save_annotation(
    app: AppHandle,
    state: State<'_, LibraryState>,
    annotation: Annotation,
) -> Result<(), String> {
    state.with_db(&app, |connection| {
        store::save_annotation(connection, &annotation)
    })
}

#[tauri::command]
pub fn library_delete_annotation(
    app: AppHandle,
    state: State<'_, LibraryState>,
    id: String,
) -> Result<(), String> {
    state.with_db(&app, |connection| store::delete_annotation(connection, &id))
}

#[tauri::command]
pub fn library_list_vocabulary(
    app: AppHandle,
    state: State<'_, LibraryState>,
) -> Result<Vec<VocabularyEntry>, String> {
    state.with_db(&app, store::list_vocabulary)
}

#[tauri::command]
pub fn library_record_vocabulary_lookup(
    app: AppHandle,
    state: State<'_, LibraryState>,
    input: VocabularyLookupInput,
) -> Result<VocabularyWord, String> {
    state.with_db(&app, |connection| {
        store::record_vocabulary_lookup(connection, &input)
    })
}

#[tauri::command]
pub fn library_set_vocabulary_status(
    app: AppHandle,
    state: State<'_, LibraryState>,
    id: String,
    status: String,
) -> Result<(), String> {
    state.with_db(&app, |connection| {
        store::set_vocabulary_status(connection, &id, &status)
    })
}

#[tauri::command]
pub fn library_delete_vocabulary(
    app: AppHandle,
    state: State<'_, LibraryState>,
    id: String,
) -> Result<(), String> {
    state.with_db(&app, |connection| store::delete_vocabulary(connection, &id))
}

#[tauri::command]
pub fn library_record_reading_session(
    app: AppHandle,
    state: State<'_, LibraryState>,
    session: ReadingSession,
) -> Result<(), String> {
    state.with_db(&app, |connection| {
        store::record_reading_session(connection, &session)
    })
}

#[tauri::command]
pub fn library_get_reading_stats(
    app: AppHandle,
    state: State<'_, LibraryState>,
) -> Result<OverallReadingStats, String> {
    state.with_db(&app, store::get_reading_stats)
}

#[cfg(test)]
mod tests {
    use super::store::*;
    use rusqlite::Connection;
    use std::path::Path;

    fn db() -> Connection {
        let connection = Connection::open_in_memory().expect("open in-memory db");
        migrate(&connection).expect("migrate");
        connection
    }

    fn book(id: &str, title: &str, added_at: &str) -> BookRecord {
        BookRecord {
            id: id.to_string(),
            title: title.to_string(),
            author: Some("Ada Fixture".to_string()),
            language: Some("en".to_string()),
            cover_mime: Some("image/png".to_string()),
            file_size: 61737,
            added_at: added_at.to_string(),
            last_read_at: None,
        }
    }

    #[test]
    fn migrate_is_idempotent_and_stamps_the_schema_version() {
        let connection = db();
        migrate(&connection).expect("second migrate");

        let version: i32 = connection
            .query_row("PRAGMA user_version", [], |row| row.get(0))
            .expect("read user_version");
        assert_eq!(version, SCHEMA_VERSION);
        assert_eq!(list_books(&connection).unwrap(), vec![]);
    }

    #[test]
    fn migration_v1_to_current_preserves_old_data_and_enables_new_features() {
        let connection = Connection::open_in_memory().expect("open memory db");
        // Initialize as v1
        connection
            .execute_batch(
                "PRAGMA journal_mode = WAL; PRAGMA foreign_keys = ON;
             CREATE TABLE books (
                 id           TEXT PRIMARY KEY,
                 title        TEXT NOT NULL,
                 author       TEXT,
                 language     TEXT,
                 cover_mime   TEXT,
                 file_size    INTEGER NOT NULL,
                 added_at     TEXT NOT NULL,
                 last_read_at TEXT
             );
             CREATE TABLE reading_progress (
                 book_id    TEXT PRIMARY KEY REFERENCES books(id) ON DELETE CASCADE,
                 cfi        TEXT,
                 percentage REAL NOT NULL DEFAULT 0,
                 updated_at TEXT NOT NULL
             );
             PRAGMA user_version = 1;",
            )
            .expect("create v1 db");

        let record = book("v1_book", "Old Book", "2026-08-15T10:00:00.000Z");
        insert_book(&connection, &record).unwrap();
        save_progress(
            &connection,
            &ReadingProgress {
                book_id: "v1_book".to_string(),
                cfi: Some("epubcfi(/6/2!/4/2)".to_string()),
                percentage: 0.42,
                updated_at: "2026-08-15T11:00:00.000Z".to_string(),
            },
        )
        .unwrap();

        // Run all migrations to the current schema.
        migrate(&connection).expect("migrate from v1 to current");

        let version: i32 = connection
            .query_row("PRAGMA user_version", [], |row| row.get(0))
            .expect("read user_version");
        assert_eq!(version, SCHEMA_VERSION);

        // Verify old book and progress are still readable
        let books = list_books(&connection).unwrap();
        assert_eq!(
            books,
            vec![BookRecord {
                last_read_at: Some("2026-08-15T11:00:00.000Z".to_string()),
                ..record
            }]
        );

        let progress = get_progress(&connection, "v1_book").unwrap().unwrap();
        assert_eq!(progress.cfi, Some("epubcfi(/6/2!/4/2)".to_string()));
        assert_eq!(progress.percentage, 0.42);

        // Verify newer features work on the migrated database.
        let settings = BookSettings {
            book_id: "v1_book".to_string(),
            style_id: "sepia".to_string(),
            overrides: serde_json::json!({ "fontSizeStep": 1 }),
            flow: Some("paginated".to_string()),
            pacer_wpm: Some(280),
            pacer_cpm: Some(320),
            pacer_chunk_size: Some(3),
            pacer_cjk_char_count: Some(4),
            updated_at: "2026-08-16T10:00:00.000Z".to_string(),
        };
        save_book_settings(&connection, &settings).unwrap();
        assert_eq!(
            get_book_settings(&connection, "v1_book").unwrap(),
            Some(settings)
        );

        let bookmark = Bookmark {
            id: "bm1".to_string(),
            book_id: "v1_book".to_string(),
            cfi: "epubcfi(/6/2!/4/2)".to_string(),
            text: "Important note".to_string(),
            created_at: "2026-08-16T10:05:00.000Z".to_string(),
        };
        add_bookmark(&connection, &bookmark).unwrap();
        assert_eq!(
            list_bookmarks(&connection, "v1_book").unwrap(),
            vec![bookmark]
        );
    }

    #[test]
    fn migration_v2_to_v3_resets_unpublished_settings_and_sessions() {
        let connection = Connection::open_in_memory().expect("open memory db");
        connection
            .execute_batch(
                "PRAGMA foreign_keys = ON;
                 CREATE TABLE books (
                     id TEXT PRIMARY KEY,
                     title TEXT NOT NULL,
                     author TEXT,
                     language TEXT,
                     cover_mime TEXT,
                     file_size INTEGER NOT NULL,
                     added_at TEXT NOT NULL,
                     last_read_at TEXT,
                     format TEXT NOT NULL DEFAULT 'epub'
                 );
                 CREATE TABLE book_settings (
                     book_id TEXT PRIMARY KEY REFERENCES books(id) ON DELETE CASCADE,
                     style_id TEXT NOT NULL,
                     overrides TEXT NOT NULL,
                     flow TEXT,
                     updated_at TEXT NOT NULL
                 );
                 CREATE TABLE reading_progress (
                     book_id TEXT PRIMARY KEY REFERENCES books(id) ON DELETE CASCADE,
                     cfi TEXT,
                     percentage REAL NOT NULL DEFAULT 0,
                     updated_at TEXT NOT NULL,
                     locator TEXT
                 );
                 CREATE TABLE reading_sessions (
                     id TEXT PRIMARY KEY,
                     book_id TEXT NOT NULL REFERENCES books(id) ON DELETE CASCADE,
                     date TEXT NOT NULL,
                     duration_seconds INTEGER NOT NULL,
                     words_read INTEGER NOT NULL,
                     updated_at TEXT NOT NULL
                 );
                 INSERT INTO books (id, title, file_size, added_at)
                 VALUES ('legacy-book', 'Legacy', 1, '2026-08-15T00:00:00Z');
                 INSERT INTO reading_progress (book_id, cfi, percentage, updated_at, locator)
                 VALUES (
                     'legacy-book', 'epubcfi(/6/2!/4/2)', 0.25,
                     '2026-08-15T00:00:30Z',
                     '{\"format\":\"epub\",\"cfi\":\"epubcfi(/6/2!/4/2)\"}'
                 );
                 INSERT INTO book_settings (book_id, style_id, overrides, flow, updated_at)
                 VALUES ('legacy-book', 'book', '{}', 'paginated', '2026-08-15T00:00:00Z');
                 INSERT INTO reading_sessions (
                     id, book_id, date, duration_seconds, words_read, updated_at
                 ) VALUES (
                     'legacy-session', 'legacy-book', '2026-08-15', 60, 77,
                     '2026-08-15T00:01:00Z'
                 );
                 PRAGMA user_version = 2;",
            )
            .expect("create v2 db");

        migrate(&connection).expect("migrate from v2 to v3");

        assert_eq!(get_book_settings(&connection, "legacy-book").unwrap(), None);
        assert_eq!(list_books(&connection).unwrap().len(), 1);
        assert_eq!(
            get_progress(&connection, "legacy-book")
                .unwrap()
                .expect("progress survives")
                .percentage,
            0.25
        );

        let stats = get_reading_stats(&connection).unwrap();
        assert_eq!(stats.total_duration_minutes, 0);
        assert_eq!(stats.total_latin_words_read, 0);
        assert_eq!(stats.total_cjk_characters_read, 0);
        assert_eq!(stats.total_books_read, 0);
    }

    #[test]
    fn a_book_round_trips_through_the_metadata_table() {
        let connection = db();
        let record = book("a1", "VeloRead Fixture", "2026-08-15T10:00:00.000Z");
        insert_book(&connection, &record).expect("insert");

        assert_eq!(list_books(&connection).unwrap(), vec![record]);
    }

    #[test]
    fn a_reading_position_reads_back_exactly_as_it_was_written() {
        let connection = db();
        insert_book(
            &connection,
            &book("a1", "Fixture", "2026-08-15T10:00:00.000Z"),
        )
        .unwrap();

        assert_eq!(get_progress(&connection, "a1").unwrap(), None);

        let progress = ReadingProgress {
            book_id: "a1".to_string(),
            cfi: Some("epubcfi(/6/2!/4/50/1:350)".to_string()),
            percentage: 0.2373,
            updated_at: "2026-08-15T12:34:56.000Z".to_string(),
        };
        save_progress(&connection, &progress).expect("save");

        assert_eq!(get_progress(&connection, "a1").unwrap(), Some(progress));
    }

    #[test]
    fn saving_progress_twice_updates_in_place() {
        let connection = db();
        insert_book(
            &connection,
            &book("a1", "Fixture", "2026-08-15T10:00:00.000Z"),
        )
        .unwrap();

        for (cfi, percentage, at) in [
            ("epubcfi(/6/2!/4/2/1:0)", 0.0, "2026-08-15T12:00:00.000Z"),
            ("epubcfi(/6/2!/4/50/1:350)", 0.5, "2026-08-15T12:30:00.000Z"),
        ] {
            save_progress(
                &connection,
                &ReadingProgress {
                    book_id: "a1".to_string(),
                    cfi: Some(cfi.to_string()),
                    percentage,
                    updated_at: at.to_string(),
                },
            )
            .expect("save");
        }

        let rows: i64 = connection
            .query_row("SELECT COUNT(*) FROM reading_progress", [], |row| {
                row.get(0)
            })
            .unwrap();
        assert_eq!(rows, 1, "upsert must not accumulate rows");

        let stored = get_progress(&connection, "a1").unwrap().unwrap();
        assert_eq!(stored.percentage, 0.5);
        assert_eq!(stored.updated_at, "2026-08-15T12:30:00.000Z");
    }

    #[test]
    fn shelf_order_matches_the_web_implementation() {
        let connection = db();
        insert_book(
            &connection,
            &book("older", "Older", "2026-08-14T10:00:00.000Z"),
        )
        .unwrap();
        insert_book(
            &connection,
            &book("newer", "Newer", "2026-08-15T10:00:00.000Z"),
        )
        .unwrap();

        // Nothing read yet: newest import first.
        let titles: Vec<_> = list_books(&connection)
            .unwrap()
            .into_iter()
            .map(|b| b.title)
            .collect();
        assert_eq!(titles, vec!["Newer", "Older"]);

        save_progress(
            &connection,
            &ReadingProgress {
                book_id: "older".to_string(),
                cfi: Some("epubcfi(/6/2!/4/2/1:0)".to_string()),
                percentage: 0.1,
                updated_at: "2026-08-15T20:00:00.000Z".to_string(),
            },
        )
        .unwrap();

        // Reading the older book moves it to the front and stamps last_read_at.
        let shelf = list_books(&connection).unwrap();
        assert_eq!(
            shelf.iter().map(|b| &b.title).collect::<Vec<_>>(),
            vec!["Older", "Newer"]
        );
        assert_eq!(
            shelf[0].last_read_at.as_deref(),
            Some("2026-08-15T20:00:00.000Z")
        );
    }

    #[test]
    fn deleting_a_book_takes_its_progress_settings_bookmarks_and_sessions_with_it() {
        let connection = db();
        insert_book(
            &connection,
            &book("a1", "Fixture", "2026-08-15T10:00:00.000Z"),
        )
        .unwrap();
        save_progress(
            &connection,
            &ReadingProgress {
                book_id: "a1".to_string(),
                cfi: Some("epubcfi(/6/2!/4/2/1:0)".to_string()),
                percentage: 0.1,
                updated_at: "2026-08-15T20:00:00.000Z".to_string(),
            },
        )
        .unwrap();
        save_book_settings(
            &connection,
            &BookSettings {
                book_id: "a1".to_string(),
                style_id: "night".to_string(),
                overrides: serde_json::json!({}),
                flow: None,
                pacer_wpm: None,
                pacer_cpm: None,
                pacer_chunk_size: None,
                pacer_cjk_char_count: None,
                updated_at: "2026-08-15T20:00:00.000Z".to_string(),
            },
        )
        .unwrap();
        add_bookmark(
            &connection,
            &Bookmark {
                id: "b1".to_string(),
                book_id: "a1".to_string(),
                cfi: "epubcfi(/6/2!/4/2/1:0)".to_string(),
                text: "Excerpt".to_string(),
                created_at: "2026-08-15T20:00:00.000Z".to_string(),
            },
        )
        .unwrap();
        save_annotation(
            &connection,
            &annotation("h1", "a1", "2026-08-15T20:00:00.000Z"),
        )
        .unwrap();
        record_reading_session(
            &connection,
            &ReadingSession {
                id: "s1".to_string(),
                book_id: "a1".to_string(),
                date: "2026-08-15".to_string(),
                duration_seconds: 60,
                latin_words_read: 200,
                cjk_characters_read: 0,
                updated_at: "2026-08-15T20:00:00.000Z".to_string(),
            },
        )
        .unwrap();

        delete_book(&connection, "a1").expect("delete");

        assert_eq!(list_books(&connection).unwrap(), vec![]);
        assert_eq!(get_progress(&connection, "a1").unwrap(), None);
        assert_eq!(get_book_settings(&connection, "a1").unwrap(), None);
        assert_eq!(list_bookmarks(&connection, "a1").unwrap(), vec![]);
        assert_eq!(list_annotations(&connection, "a1").unwrap(), vec![]);
        assert_eq!(get_reading_stats(&connection).unwrap().total_books_read, 0);
    }

    fn annotation(id: &str, book_id: &str, created_at: &str) -> Annotation {
        Annotation {
            id: id.to_string(),
            book_id: book_id.to_string(),
            cfi_range: "epubcfi(/6/4!/4/2,/1:0,/1:19)".to_string(),
            text: "the unexamined life".to_string(),
            note: String::new(),
            color: "yellow".to_string(),
            chapter_title: Some("Chapter 1".to_string()),
            source: "local".to_string(),
            created_at: created_at.to_string(),
            updated_at: created_at.to_string(),
        }
    }

    #[test]
    fn annotations_round_trip_in_reading_order_and_upsert_in_place() {
        let connection = db();
        insert_book(
            &connection,
            &book("a1", "Fixture", "2026-08-15T10:00:00.000Z"),
        )
        .unwrap();

        // Written newest-first on purpose: the list must follow reading order.
        save_annotation(
            &connection,
            &annotation("h2", "a1", "2026-08-16T09:00:00.000Z"),
        )
        .unwrap();
        save_annotation(
            &connection,
            &annotation("h1", "a1", "2026-08-15T09:00:00.000Z"),
        )
        .unwrap();

        let listed = list_annotations(&connection, "a1").unwrap();
        assert_eq!(
            listed
                .iter()
                .map(|item| item.id.as_str())
                .collect::<Vec<_>>(),
            vec!["h1", "h2"]
        );

        let edited = Annotation {
            note: "Socrates, Apology".to_string(),
            color: "blue".to_string(),
            updated_at: "2026-08-17T09:00:00.000Z".to_string(),
            ..annotation("h1", "a1", "2026-08-15T09:00:00.000Z")
        };
        save_annotation(&connection, &edited).unwrap();

        let listed = list_annotations(&connection, "a1").unwrap();
        assert_eq!(listed.len(), 2, "an edit must not create a second row");
        assert_eq!(listed[0], edited);

        delete_annotation(&connection, "h1").unwrap();
        assert_eq!(
            list_annotations(&connection, "a1")
                .unwrap()
                .iter()
                .map(|item| item.id.as_str())
                .collect::<Vec<_>>(),
            vec!["h2"]
        );
    }

    fn collection(id: &str, name: &str) -> Collection {
        Collection {
            id: id.to_string(),
            name: name.to_string(),
            created_at: "2026-08-20T10:00:00.000Z".to_string(),
            updated_at: "2026-08-20T10:00:00.000Z".to_string(),
        }
    }

    #[test]
    fn collections_file_a_book_under_several_shelves_and_replace_the_set() {
        let connection = db();
        insert_book(&connection, &book("a1", "One", "2026-08-15T10:00:00.000Z")).unwrap();
        save_collection(&connection, &collection("c2", "小说")).unwrap();
        save_collection(&connection, &collection("c1", "工作")).unwrap();

        // Sorted by name, so the shelf filter order does not depend on insert order.
        assert_eq!(
            list_collections(&connection)
                .unwrap()
                .iter()
                .map(|item| item.name.as_str())
                .collect::<Vec<_>>(),
            vec!["小说", "工作"]
        );

        set_book_collections(&connection, "a1", &["c1".to_string(), "c2".to_string()]).unwrap();
        let membership = list_collection_membership(&connection).unwrap();
        let mut shelves = membership.get("a1").cloned().unwrap_or_default();
        shelves.sort();
        assert_eq!(shelves, vec!["c1".to_string(), "c2".to_string()]);

        // Setting the membership replaces it rather than adding to it.
        set_book_collections(&connection, "a1", &["c2".to_string()]).unwrap();
        assert_eq!(
            list_collection_membership(&connection).unwrap().get("a1"),
            Some(&vec!["c2".to_string()])
        );

        // Re-applying the same set must not duplicate rows.
        set_book_collections(&connection, "a1", &["c2".to_string()]).unwrap();
        assert_eq!(
            list_collection_membership(&connection).unwrap().get("a1"),
            Some(&vec!["c2".to_string()])
        );
    }

    #[test]
    fn deleting_a_collection_keeps_its_books() {
        let connection = db();
        insert_book(&connection, &book("a1", "One", "2026-08-15T10:00:00.000Z")).unwrap();
        save_collection(&connection, &collection("c1", "工作")).unwrap();
        set_book_collections(&connection, "a1", &["c1".to_string()]).unwrap();

        delete_collection(&connection, "c1").unwrap();

        assert_eq!(list_collections(&connection).unwrap(), vec![]);
        assert!(list_collection_membership(&connection).unwrap().is_empty());
        assert_eq!(
            list_books(&connection).unwrap().len(),
            1,
            "the book survives"
        );
    }

    #[test]
    fn deleting_a_book_removes_it_from_its_collections() {
        let connection = db();
        insert_book(&connection, &book("a1", "One", "2026-08-15T10:00:00.000Z")).unwrap();
        save_collection(&connection, &collection("c1", "工作")).unwrap();
        set_book_collections(&connection, "a1", &["c1".to_string()]).unwrap();

        delete_book(&connection, "a1").expect("delete");

        assert!(list_collection_membership(&connection).unwrap().is_empty());
        assert_eq!(
            list_collections(&connection).unwrap().len(),
            1,
            "the shelf survives"
        );
    }

    #[test]
    fn annotations_stay_scoped_to_their_own_book() {
        let connection = db();
        insert_book(&connection, &book("a1", "One", "2026-08-15T10:00:00.000Z")).unwrap();
        insert_book(&connection, &book("a2", "Two", "2026-08-15T11:00:00.000Z")).unwrap();
        save_annotation(
            &connection,
            &annotation("h1", "a1", "2026-08-15T09:00:00.000Z"),
        )
        .unwrap();
        save_annotation(
            &connection,
            &annotation("h2", "a2", "2026-08-15T09:00:00.000Z"),
        )
        .unwrap();

        assert_eq!(list_annotations(&connection, "a1").unwrap().len(), 1);
        assert_eq!(list_annotations(&connection, "a2").unwrap()[0].id, "h2");
    }

    #[test]
    fn an_annotation_payload_without_optional_fields_still_deserializes() {
        // The webview drops undefined keys, so `note` and `source` can be absent.
        let parsed: Annotation = serde_json::from_str(
            r#"{"id":"h1","bookId":"a1","cfiRange":"epubcfi(/6/4!/4/2,/1:0,/1:5)",
                "text":"hello","color":"yellow","chapterTitle":null,
                "createdAt":"2026-08-15T09:00:00.000Z","updatedAt":"2026-08-15T09:00:00.000Z"}"#,
        )
        .expect("deserialize");
        assert_eq!(parsed.note, "");
        assert_eq!(parsed.source, "local");
    }

    #[test]
    fn a_duplicate_id_is_rejected_rather_than_overwriting() {
        let connection = db();
        let record = book("a1", "First", "2026-08-15T10:00:00.000Z");
        insert_book(&connection, &record).unwrap();

        let clash = book("a1", "Second", "2026-08-15T11:00:00.000Z");
        assert!(insert_book(&connection, &clash).is_err());

        // The original row must be untouched — the add_book rollback relies on it.
        assert_eq!(list_books(&connection).unwrap(), vec![record]);
    }

    #[test]
    fn book_file_accepts_a_uuid_and_stays_inside_the_library_directory() {
        let dir = Path::new("/tmp/veloread-library");
        let path = book_file(dir, "a007137f-abd9-45f7-8e31-7c902c3bd091", "epub").unwrap();

        assert_eq!(path, dir.join("a007137f-abd9-45f7-8e31-7c902c3bd091.epub"));
        assert!(path.starts_with(dir));
    }

    #[test]
    fn book_file_rejects_every_id_that_could_escape_the_library_directory() {
        let dir = Path::new("/tmp/veloread-library");
        for id in [
            "",
            "..",
            "../../etc/passwd",
            "a/b",
            "a\\b",
            "/absolute",
            "with space",
            "semi;colon",
            "dot.dot",
            "unicode\u{2044}slash",
            &"x".repeat(65),
        ] {
            assert!(
                book_file(dir, id, "epub").is_err(),
                "id {id:?} should have been rejected"
            );
        }
    }

    #[test]
    fn reading_sessions_record_and_aggregate_stats() {
        let connection = db();
        let record = book("a1", "Test Book", "2026-08-15T10:00:00.000Z");
        insert_book(&connection, &record).unwrap();

        let s1 = ReadingSession {
            id: "s1".into(),
            book_id: "a1".into(),
            date: "2026-08-16".into(),
            duration_seconds: 120,
            latin_words_read: 500,
            cjk_characters_read: 120,
            updated_at: "2026-08-16T12:00:00Z".into(),
        };
        record_reading_session(&connection, &s1).unwrap();

        let s2 = ReadingSession {
            id: "s1".into(),
            book_id: "a1".into(),
            date: "2026-08-16".into(),
            duration_seconds: 60,
            latin_words_read: 250,
            cjk_characters_read: 80,
            updated_at: "2026-08-16T12:05:00Z".into(),
        };
        record_reading_session(&connection, &s2).unwrap();

        let stats = get_reading_stats(&connection).unwrap();
        assert_eq!(stats.total_duration_minutes, 3);
        assert_eq!(stats.total_latin_words_read, 750);
        assert_eq!(stats.total_cjk_characters_read, 200);
        assert_eq!(stats.total_books_read, 1);
        assert_eq!(
            stats
                .daily_stats
                .get("2026-08-16")
                .unwrap()
                .duration_minutes,
            3
        );
        let daily = stats.daily_stats.get("2026-08-16").unwrap();
        assert_eq!(daily.latin_words_read, 750);
        assert_eq!(daily.cjk_characters_read, 200);
    }

    fn lookup_input(
        word_id: &str,
        lookup_id: &str,
        word: &str,
        stem: &str,
        book_id: Option<&str>,
        sentence: &str,
        created_at: &str,
    ) -> VocabularyLookupInput {
        VocabularyLookupInput {
            word_id: word_id.to_string(),
            lookup_id: lookup_id.to_string(),
            word: word.to_string(),
            stem: stem.to_string(),
            lang: "en".to_string(),
            book_id: book_id.map(str::to_string),
            locator: Some("{\"format\":\"epub\",\"cfi\":\"epubcfi(/6/2!/4/2)\"}".to_string()),
            sentence: sentence.to_string(),
            created_at: created_at.to_string(),
        }
    }

    /// The migration the vocabulary tables arrived in: a database already at
    /// version 5 must gain them without losing a row of what was there.
    #[test]
    fn migration_v5_to_current_adds_vocabulary_and_keeps_every_row() {
        let connection = db();
        assert_eq!(SCHEMA_VERSION, 6, "this test is about the step from 5 to 6");

        // Fill a v5-shaped database and stamp it back to 5.
        let record = book("v5_book", "Older Book", "2026-08-20T10:00:00.000Z");
        insert_book(&connection, &record).unwrap();
        save_progress(
            &connection,
            &ReadingProgress {
                book_id: "v5_book".to_string(),
                cfi: Some("epubcfi(/6/4!/4/2)".to_string()),
                percentage: 0.31,
                updated_at: "2026-08-20T11:00:00.000Z".to_string(),
            },
        )
        .unwrap();
        save_annotation(
            &connection,
            &Annotation {
                id: "v5_note".to_string(),
                book_id: "v5_book".to_string(),
                cfi_range: "epubcfi(/6/4!/4/2,/1:0,/1:9)".to_string(),
                text: "kept text".to_string(),
                note: "kept note".to_string(),
                color: "yellow".to_string(),
                chapter_title: Some("One".to_string()),
                source: "local".to_string(),
                created_at: "2026-08-20T11:05:00.000Z".to_string(),
                updated_at: "2026-08-20T11:05:00.000Z".to_string(),
            },
        )
        .unwrap();
        save_collection(
            &connection,
            &Collection {
                id: "v5_shelf".to_string(),
                name: "Shelf".to_string(),
                created_at: "2026-08-20T11:06:00.000Z".to_string(),
                updated_at: "2026-08-20T11:06:00.000Z".to_string(),
            },
        )
        .unwrap();
        set_book_collections(&connection, "v5_book", &["v5_shelf".to_string()]).unwrap();
        connection
            .execute_batch(
                "DROP TABLE IF EXISTS vocabulary_lookups;
                 DROP TABLE IF EXISTS vocabulary;
                 PRAGMA user_version = 5;",
            )
            .unwrap();

        migrate(&connection).expect("migrate from v5 to current");

        let version: i32 = connection
            .query_row("PRAGMA user_version", [], |row| row.get(0))
            .unwrap();
        assert_eq!(version, SCHEMA_VERSION);

        // Nothing that was there before was touched.
        assert_eq!(list_books(&connection).unwrap().len(), 1);
        assert_eq!(
            get_progress(&connection, "v5_book").unwrap().unwrap().cfi,
            Some("epubcfi(/6/4!/4/2)".to_string())
        );
        assert_eq!(list_annotations(&connection, "v5_book").unwrap().len(), 1);
        assert_eq!(list_collections(&connection).unwrap().len(), 1);
        assert_eq!(
            list_collection_membership(&connection)
                .unwrap()
                .get("v5_book")
                .unwrap(),
            &vec!["v5_shelf".to_string()]
        );

        // And both new tables are usable.
        assert_eq!(list_vocabulary(&connection).unwrap(), vec![]);
        record_vocabulary_lookup(
            &connection,
            &lookup_input(
                "w1",
                "l1",
                "running",
                "run",
                Some("v5_book"),
                "He kept running.",
                "2026-08-20T12:00:00.000Z",
            ),
        )
        .unwrap();
        assert_eq!(list_vocabulary(&connection).unwrap().len(), 1);
    }

    #[test]
    fn one_word_in_two_books_is_one_entry_with_both_sentences() {
        let connection = db();
        insert_book(
            &connection,
            &book("book_a", "A", "2026-08-20T10:00:00.000Z"),
        )
        .unwrap();
        insert_book(
            &connection,
            &book("book_b", "B", "2026-08-20T10:00:01.000Z"),
        )
        .unwrap();

        // The same stem met as two different inflections, in two books.
        record_vocabulary_lookup(
            &connection,
            &lookup_input(
                "w1",
                "l1",
                "running",
                "run",
                Some("book_a"),
                "He kept running.",
                "2026-08-20T12:00:00.000Z",
            ),
        )
        .unwrap();
        let second = record_vocabulary_lookup(
            &connection,
            &lookup_input(
                "w2",
                "l2",
                "ran",
                "run",
                Some("book_b"),
                "She ran home.",
                "2026-08-20T13:00:00.000Z",
            ),
        )
        .unwrap();

        // Deduplicated on the stem, so the second lookup joined the first entry
        // rather than minting `w2`, and the first form met is the one kept.
        assert_eq!(second.id, "w1");
        assert_eq!(second.word, "running");

        let entries = list_vocabulary(&connection).unwrap();
        assert_eq!(entries.len(), 1);
        assert_eq!(entries[0].word.stem, "run");
        assert_eq!(entries[0].lookups.len(), 2);
        let sentences: Vec<&str> = entries[0]
            .lookups
            .iter()
            .map(|lookup| lookup.sentence.as_str())
            .collect();
        assert_eq!(sentences, vec!["He kept running.", "She ran home."]);
        let books: Vec<Option<&str>> = entries[0]
            .lookups
            .iter()
            .map(|lookup| lookup.book_id.as_deref())
            .collect();
        assert_eq!(books, vec![Some("book_a"), Some("book_b")]);
    }

    #[test]
    fn deleting_a_book_keeps_its_words_and_only_forgets_where_they_came_from() {
        let connection = db();
        insert_book(
            &connection,
            &book("book_a", "A", "2026-08-20T10:00:00.000Z"),
        )
        .unwrap();
        insert_book(
            &connection,
            &book("book_b", "B", "2026-08-20T10:00:01.000Z"),
        )
        .unwrap();
        record_vocabulary_lookup(
            &connection,
            &lookup_input(
                "w1",
                "l1",
                "running",
                "run",
                Some("book_a"),
                "He kept running.",
                "2026-08-20T12:00:00.000Z",
            ),
        )
        .unwrap();
        record_vocabulary_lookup(
            &connection,
            &lookup_input(
                "w2",
                "l2",
                "obviation",
                "obviation",
                Some("book_b"),
                "The obviation of doubt.",
                "2026-08-20T13:00:00.000Z",
            ),
        )
        .unwrap();

        delete_book(&connection, "book_a").unwrap();

        let entries = list_vocabulary(&connection).unwrap();
        assert_eq!(entries.len(), 2, "the words survive the book");
        let orphaned = entries
            .iter()
            .find(|entry| entry.word.stem == "run")
            .expect("run is still there");
        assert_eq!(orphaned.lookups.len(), 1);
        assert_eq!(orphaned.lookups[0].book_id, None, "ON DELETE SET NULL");
        assert_eq!(orphaned.lookups[0].sentence, "He kept running.");

        let untouched = entries
            .iter()
            .find(|entry| entry.word.stem == "obviation")
            .expect("the other book is unaffected");
        assert_eq!(untouched.lookups[0].book_id, Some("book_b".to_string()));
    }

    #[test]
    fn a_word_can_be_marked_known_and_removed_with_its_sentences() {
        let connection = db();
        insert_book(
            &connection,
            &book("book_a", "A", "2026-08-20T10:00:00.000Z"),
        )
        .unwrap();
        record_vocabulary_lookup(
            &connection,
            &lookup_input(
                "w1",
                "l1",
                "running",
                "run",
                Some("book_a"),
                "He kept running.",
                "2026-08-20T12:00:00.000Z",
            ),
        )
        .unwrap();

        assert_eq!(
            list_vocabulary(&connection).unwrap()[0].word.status,
            "learning"
        );
        set_vocabulary_status(&connection, "w1", "known").unwrap();
        assert_eq!(
            list_vocabulary(&connection).unwrap()[0].word.status,
            "known"
        );

        delete_vocabulary(&connection, "w1").unwrap();
        assert_eq!(list_vocabulary(&connection).unwrap(), vec![]);
        let orphans: i64 = connection
            .query_row("SELECT COUNT(*) FROM vocabulary_lookups", [], |row| {
                row.get(0)
            })
            .unwrap();
        assert_eq!(orphans, 0, "the sentences go with the word");
    }

    #[test]
    fn vocabulary_lists_newest_first() {
        let connection = db();
        for (index, (word, at)) in [
            ("alpha", "2026-08-20T10:00:00.000Z"),
            ("beta", "2026-08-20T11:00:00.000Z"),
            ("gamma", "2026-08-20T09:00:00.000Z"),
        ]
        .iter()
        .enumerate()
        {
            record_vocabulary_lookup(
                &connection,
                &lookup_input(
                    &format!("w{index}"),
                    &format!("l{index}"),
                    word,
                    word,
                    None,
                    "A sentence.",
                    at,
                ),
            )
            .unwrap();
        }

        let order: Vec<String> = list_vocabulary(&connection)
            .unwrap()
            .into_iter()
            .map(|entry| entry.word.word)
            .collect();
        assert_eq!(order, vec!["beta", "alpha", "gamma"]);
    }
}
