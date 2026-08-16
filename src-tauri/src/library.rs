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

use store::{book_file, BookRecord, ReadingProgress};

/// Storage primitives, free of any Tauri types.
mod store {
    use std::path::{Path, PathBuf};

    use rusqlite::{params, Connection, OptionalExtension};
    use serde::{Deserialize, Serialize};

    const SCHEMA_VERSION: i32 = 1;

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
        connection.execute("DELETE FROM reading_progress WHERE book_id = ?1", params![id])?;
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
        let _ = state.with_db(&app, |connection| store::delete_book(connection, &record.id));
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
pub fn library_save_progress(
    app: AppHandle,
    state: State<'_, LibraryState>,
    progress: ReadingProgress,
) -> Result<(), String> {
    state.with_db(&app, |connection| store::save_progress(connection, &progress))
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
        assert_eq!(version, 1);
        assert_eq!(list_books(&connection).unwrap(), vec![]);
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
        insert_book(&connection, &book("a1", "Fixture", "2026-08-15T10:00:00.000Z")).unwrap();

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
        insert_book(&connection, &book("a1", "Fixture", "2026-08-15T10:00:00.000Z")).unwrap();

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
            .query_row("SELECT COUNT(*) FROM reading_progress", [], |row| row.get(0))
            .unwrap();
        assert_eq!(rows, 1, "upsert must not accumulate rows");

        let stored = get_progress(&connection, "a1").unwrap().unwrap();
        assert_eq!(stored.percentage, 0.5);
        assert_eq!(stored.updated_at, "2026-08-15T12:30:00.000Z");
    }

    #[test]
    fn shelf_order_matches_the_web_implementation() {
        let connection = db();
        insert_book(&connection, &book("older", "Older", "2026-08-14T10:00:00.000Z")).unwrap();
        insert_book(&connection, &book("newer", "Newer", "2026-08-15T10:00:00.000Z")).unwrap();

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
    fn deleting_a_book_takes_its_progress_with_it() {
        let connection = db();
        insert_book(&connection, &book("a1", "Fixture", "2026-08-15T10:00:00.000Z")).unwrap();
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

        delete_book(&connection, "a1").expect("delete");

        assert_eq!(list_books(&connection).unwrap(), vec![]);
        assert_eq!(get_progress(&connection, "a1").unwrap(), None);
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

        assert_eq!(
            path,
            dir.join("a007137f-abd9-45f7-8e31-7c902c3bd091.epub")
        );
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
}
