//! Library persistence: book metadata and reading progress in SQLite, book
//! files and covers on disk under the app data directory.
//!
//! The frontend never sees a path or a SQL statement — it calls the commands
//! below through `src/platform/tauri/storage.ts`.

use std::fs;
use std::path::PathBuf;
use std::sync::Mutex;

use base64::engine::general_purpose::STANDARD as BASE64;
use base64::Engine as _;
use rusqlite::{params, Connection, OptionalExtension};
use serde::{Deserialize, Serialize};
use tauri::{ipc::Response, AppHandle, Manager, State};

const SCHEMA_VERSION: i32 = 1;

#[derive(Debug, Serialize, Deserialize)]
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

#[derive(Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ReadingProgress {
    pub book_id: String,
    pub cfi: Option<String>,
    pub percentage: f64,
    pub updated_at: String,
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

/// Book ids come from the webview, so they are checked before they are ever
/// pasted into a path. Only the shape produced by `crypto.randomUUID()` passes,
/// which leaves no room for separators or `..`.
fn book_path(app: &AppHandle, id: &str, extension: &str) -> Result<PathBuf, String> {
    let valid = !id.is_empty()
        && id.len() <= 64
        && id
            .chars()
            .all(|character| character.is_ascii_alphanumeric() || character == '-');
    if !valid {
        return Err(format!("invalid book id: {id:?}"));
    }
    Ok(books_dir(app)?.join(format!("{id}.{extension}")))
}

fn open_database(app: &AppHandle) -> Result<Connection, String> {
    let dir = data_dir(app)?;
    fs::create_dir_all(&dir)
        .map_err(|error| format!("could not create {}: {error}", dir.display()))?;

    let connection = Connection::open(dir.join("veloread.db"))
        .map_err(|error| format!("could not open the library database: {error}"))?;
    migrate(&connection).map_err(|error| format!("could not migrate the library database: {error}"))?;
    Ok(connection)
}

fn migrate(connection: &Connection) -> rusqlite::Result<()> {
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

#[tauri::command]
pub fn library_init(app: AppHandle, state: State<'_, LibraryState>) -> Result<(), String> {
    state.with_db(&app, |_| Ok(()))
}

#[tauri::command]
pub fn library_list_books(
    app: AppHandle,
    state: State<'_, LibraryState>,
) -> Result<Vec<BookRecord>, String> {
    state.with_db(&app, |connection| {
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
    })
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
    state.with_db(&app, |connection| {
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
        )
    })?;

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
            connection.execute("DELETE FROM books WHERE id = ?1", params![record.id])
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

    state.with_db(&app, |connection| {
        connection.execute("DELETE FROM reading_progress WHERE book_id = ?1", params![id])?;
        connection.execute("DELETE FROM books WHERE id = ?1", params![id])?;
        Ok(())
    })
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
    state.with_db(&app, |connection| {
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
    })
}

#[tauri::command]
pub fn library_save_progress(
    app: AppHandle,
    state: State<'_, LibraryState>,
    progress: ReadingProgress,
) -> Result<(), String> {
    state.with_db(&app, |connection| {
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
    })
}
