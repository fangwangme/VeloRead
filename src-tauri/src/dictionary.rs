//! The English dictionary behind word lookup.
//!
//! Its own SQLite file next to `veloread.db`, never a table inside it. The
//! dictionary is a **read-only asset**: it is derived from a source file, it is
//! identical for every user, and it can be deleted and rebuilt without anyone
//! losing anything. Folding it into the library database would drag 100k rows
//! of prose through `veloread.db`'s `PRAGMA user_version` ladder, through every
//! backup of the user's own data, and would make "rebuild the dictionary" a
//! migration instead of a file deletion.
//!
//! The source (`dictionary.json`, a flat `{ word: definition }` object) is not
//! shipped in the bundle — the app is meant to stay small — and it is not read
//! at query time either. It is imported once into `dictionary.db`, streaming,
//! and every later lookup is a single indexed SELECT.

use std::fs;
use std::io::{BufReader, Read};
use std::path::{Path, PathBuf};
use std::sync::{
    atomic::{AtomicBool, Ordering},
    Mutex,
};
use std::time::Duration;

use rusqlite::Connection;
use sha2::{Digest, Sha256};
use tauri::{ipc::Channel, AppHandle, Manager, State};
use tokio::io::AsyncWriteExt;

pub use store::{DictDownload, DictDownloadProgress, DictEntry, DictLookup, DictStatus};

const DICTIONARY_ASSET_VERSION: &str = "dictionary-v1";
const DICTIONARY_ASSET_URL: &str =
    "https://github.com/fangwangme/VeloRead/releases/download/dictionary-v1/dictionary.db";
const DICTIONARY_ASSET_BYTES: u64 = 27_324_416;
const DICTIONARY_ASSET_ENTRIES: i64 = 102_217;
const DICTIONARY_ASSET_SHA256: &str =
    "a1a35b05a3367dd0b58f73dcb69109f8a014db8219917a242fb455f58058a6fa";

/// Dictionary storage, free of any Tauri types so the tests can drive it with
/// an in-memory connection.
pub mod store {
    use std::fmt;

    use rusqlite::{params, Connection, OptionalExtension};
    use serde::{Deserialize, Serialize};

    /// The dictionary file's own schema version, independent of the library
    /// database's. A bump here means "throw it away and import again", which is
    /// exactly what a derived asset should cost.
    pub const DICTIONARY_SCHEMA_VERSION: i32 = 1;

    /// How many entries the import last wrote, so the UI can say whether there
    /// is a dictionary without counting a hundred thousand rows of prose.
    const ENTRY_COUNT_KEY: &str = "entry_count";

    #[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
    #[serde(rename_all = "camelCase")]
    pub struct DictEntry {
        /// The headword that actually matched, which is not always what was
        /// typed: a lookup sends the inflected form and its reductions.
        pub word: String,
        pub definition: String,
    }

    #[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
    #[serde(rename_all = "camelCase")]
    pub struct DictStatus {
        /// True once there is a dictionary to query.
        pub ready: bool,
        pub entries: i64,
        /// The optional asset a desktop reader can install. Browser builds
        /// return null because they cannot open the downloaded SQLite file.
        #[serde(default)]
        pub download: Option<DictDownload>,
    }

    #[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
    #[serde(rename_all = "camelCase")]
    pub struct DictDownload {
        pub version: String,
        pub size_bytes: u64,
    }

    #[derive(Debug, Clone, PartialEq, Serialize)]
    #[serde(rename_all = "camelCase")]
    pub struct DictDownloadProgress {
        pub downloaded_bytes: u64,
        pub total_bytes: u64,
    }

    /// `entries` is a plain rowid table with a unique index on the headword
    /// rather than `WITHOUT ROWID`.
    ///
    /// A definition here is a whole paragraph of prose. In a `WITHOUT ROWID`
    /// table the payload lives inside the primary-key B-tree, so those
    /// paragraphs would sit between the keys the search has to walk and spill
    /// into overflow pages — a bigger tree to descend for every lookup. Keeping
    /// the text in the table and searching a separate index of bare words means
    /// the part being searched stays small.
    pub fn migrate(connection: &Connection) -> rusqlite::Result<()> {
        connection.execute_batch(
            "CREATE TABLE IF NOT EXISTS entries (
                 id         INTEGER PRIMARY KEY,
                 word       TEXT NOT NULL,
                 definition TEXT NOT NULL
             );
             CREATE UNIQUE INDEX IF NOT EXISTS idx_entries_word ON entries(word);
             CREATE TABLE IF NOT EXISTS meta (
                 key   TEXT PRIMARY KEY,
                 value TEXT NOT NULL
             );",
        )?;
        connection.execute_batch(&format!(
            "PRAGMA user_version = {DICTIONARY_SCHEMA_VERSION}"
        ))?;
        Ok(())
    }

    pub fn status(connection: &Connection) -> rusqlite::Result<DictStatus> {
        let entries = entry_count(connection)?;
        Ok(DictStatus {
            ready: entries > 0,
            entries,
            download: None,
        })
    }

    fn entry_count(connection: &Connection) -> rusqlite::Result<i64> {
        let stored: Option<String> = connection
            .query_row(
                "SELECT value FROM meta WHERE key = ?1",
                params![ENTRY_COUNT_KEY],
                |row| row.get(0),
            )
            .optional()?;
        match stored.and_then(|value| value.parse::<i64>().ok()) {
            Some(count) => Ok(count),
            // No stamp: either nothing was ever imported, or the file predates
            // the stamp. Counting the index is cheap enough to answer once.
            None => connection.query_row("SELECT COUNT(*) FROM entries", [], |row| row.get(0)),
        }
    }

    /// Headwords are matched lowercased, so `The` and `the` are one entry and a
    /// word at the start of a sentence is still findable.
    pub fn normalise(word: &str) -> String {
        word.trim().to_lowercase()
    }

    /// What the dictionary knows about one selected word.
    #[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
    #[serde(rename_all = "camelCase")]
    pub struct DictLookup {
        /// Every candidate that has an entry, in the order they were given.
        ///
        /// The definition comes from the first of them, but the stem comes from
        /// the most reduced one — those are two different questions, and
        /// answering both from one pass is why this is a list and not a single
        /// hit. `running` has its own entry *and* reduces to `run`: the reader
        /// should read the entry for `running`, while the vocabulary list must
        /// still file it under `run`.
        pub known: Vec<String>,
        pub entry: Option<DictEntry>,
    }

    /// Look one selected word up, having been given it and its reductions.
    ///
    /// The caller sends the word as selected first, followed by its reductions
    /// (see `src/vocabulary/lemma.ts`), so "look the original up first, and only
    /// then the stem" is expressed by the order of the list rather than by a
    /// round trip per form.
    pub fn lookup(connection: &Connection, candidates: &[String]) -> rusqlite::Result<DictLookup> {
        let mut statement =
            connection.prepare_cached("SELECT word, definition FROM entries WHERE word = ?1")?;
        let mut known = Vec::new();
        let mut entry = None;
        for candidate in candidates {
            let normalised = normalise(candidate);
            if normalised.is_empty() {
                continue;
            }
            let found = statement
                .query_row(params![normalised], |row| {
                    Ok(DictEntry {
                        word: row.get(0)?,
                        definition: row.get(1)?,
                    })
                })
                .optional()?;
            if let Some(found) = found {
                known.push(found.word.clone());
                if entry.is_none() {
                    entry = Some(found);
                }
            }
        }
        Ok(DictLookup { known, entry })
    }

    /// What went wrong importing the dictionary, in one string the UI can show.
    pub type ImportError = String;

    /// Stream `{ word: definition }` JSON straight into the table.
    ///
    /// Deserialised as a map visitor rather than into a `HashMap`: the source is
    /// 22 MB, and the whole point of this module is that the dictionary is never
    /// resident in memory. Building the map first would make the one moment the
    /// rule is broken the import itself.
    ///
    /// Existing entries are kept, so re-running an import over a populated file
    /// is a no-op rather than a rewrite.
    pub fn import_from_json<R: std::io::Read>(
        connection: &mut Connection,
        reader: R,
    ) -> Result<i64, ImportError> {
        migrate(connection)
            .map_err(|error| format!("could not prepare the dictionary: {error}"))?;

        let transaction = connection
            .transaction()
            .map_err(|error| format!("could not start the dictionary import: {error}"))?;

        {
            let statement = transaction
                .prepare("INSERT OR IGNORE INTO entries (word, definition) VALUES (?1, ?2)")
                .map_err(|error| format!("could not prepare the dictionary import: {error}"))?;
            let sink = EntrySink {
                statement,
                written: 0,
            };
            let mut deserialiser = serde_json::Deserializer::from_reader(reader);
            serde::de::Deserializer::deserialize_map(&mut deserialiser, sink)
                .map_err(|error| format!("could not read the dictionary source: {error}"))?;
        }

        let total: i64 = transaction
            .query_row("SELECT COUNT(*) FROM entries", [], |row| row.get(0))
            .map_err(|error| format!("could not count the dictionary: {error}"))?;
        transaction
            .execute(
                "INSERT INTO meta (key, value) VALUES (?1, ?2)
                 ON CONFLICT(key) DO UPDATE SET value = excluded.value",
                params![ENTRY_COUNT_KEY, total.to_string()],
            )
            .map_err(|error| format!("could not stamp the dictionary: {error}"))?;

        transaction
            .commit()
            .map_err(|error| format!("could not finish the dictionary import: {error}"))?;

        Ok(total)
    }

    /// Writes each `{ word: definition }` pair as serde hands it over.
    struct EntrySink<'a> {
        statement: rusqlite::Statement<'a>,
        written: i64,
    }

    impl<'de> serde::de::Visitor<'de> for EntrySink<'_> {
        type Value = i64;

        fn expecting(&self, formatter: &mut fmt::Formatter) -> fmt::Result {
            formatter.write_str("an object of headwords to definitions")
        }

        fn visit_map<A>(mut self, mut map: A) -> Result<Self::Value, A::Error>
        where
            A: serde::de::MapAccess<'de>,
        {
            while let Some((word, definition)) = map.next_entry::<String, String>()? {
                let headword = normalise(&word);
                if headword.is_empty() || definition.trim().is_empty() {
                    continue;
                }
                let changed = self
                    .statement
                    .execute(params![headword, definition.trim()])
                    .map_err(serde::de::Error::custom)?;
                self.written += changed as i64;
            }
            Ok(self.written)
        }
    }
}

/// Opened lazily, like the library database: a missing dictionary is a feature
/// that is unavailable, never a window that fails to appear.
pub struct DictionaryState {
    connection: Mutex<Option<Connection>>,
    installing: AtomicBool,
}

impl Default for DictionaryState {
    fn default() -> Self {
        Self {
            connection: Mutex::new(None),
            installing: AtomicBool::new(false),
        }
    }
}

impl DictionaryState {
    fn with_db<T>(
        &self,
        app: &AppHandle,
        body: impl FnOnce(&Connection) -> rusqlite::Result<T>,
    ) -> Result<T, String> {
        let mut guard = self
            .connection
            .lock()
            .map_err(|_| "dictionary lock was poisoned".to_string())?;

        if guard.is_none() {
            *guard = Some(open_database(app)?);
        }
        let connection = guard.as_ref().expect("connection opened above");
        body(connection).map_err(|error| error.to_string())
    }

    fn with_lookup_db<T>(
        &self,
        app: &AppHandle,
        body: impl FnOnce(&Connection) -> rusqlite::Result<T>,
    ) -> Result<T, String> {
        if self.installing.load(Ordering::Acquire) {
            return Err("dictionary download is in progress".to_string());
        }
        self.with_db(app, body)
    }

    fn begin_install(&self) -> Result<InstallLease<'_>, String> {
        self.installing
            .compare_exchange(false, true, Ordering::AcqRel, Ordering::Acquire)
            .map_err(|_| "dictionary download is already in progress".to_string())?;
        Ok(InstallLease { state: self })
    }

    fn status(&self, app: &AppHandle) -> Result<DictStatus, String> {
        if self.installing.load(Ordering::Acquire) {
            // The old connection stays closed while the verified file is being
            // installed, which is required for replacement on Windows. Status
            // itself needs no database handle and must remain available to the
            // progress UI and vocabulary modal.
            return Ok(downloadable(DictStatus {
                ready: false,
                entries: 0,
                download: None,
            }));
        }
        self.with_db(app, store::status).map(downloadable)
    }
}

struct InstallLease<'a> {
    state: &'a DictionaryState,
}

impl Drop for InstallLease<'_> {
    fn drop(&mut self) {
        self.state.installing.store(false, Ordering::Release);
    }
}

fn data_dir(app: &AppHandle) -> Result<PathBuf, String> {
    app.path()
        .app_data_dir()
        .map_err(|error| format!("no app data directory: {error}"))
}

fn open_database(app: &AppHandle) -> Result<Connection, String> {
    let dir = data_dir(app)?;
    fs::create_dir_all(&dir)
        .map_err(|error| format!("could not create {}: {error}", dir.display()))?;
    open_at(&dir.join("dictionary.db"))
}

fn open_at(path: &Path) -> Result<Connection, String> {
    let connection = Connection::open(path)
        .map_err(|error| format!("could not open the dictionary: {error}"))?;
    // Read-mostly and rebuildable: durability buys nothing here, and the import
    // is an order of magnitude faster without it.
    connection
        .execute_batch("PRAGMA journal_mode = WAL; PRAGMA synchronous = NORMAL;")
        .map_err(|error| format!("could not configure the dictionary: {error}"))?;
    store::migrate(&connection)
        .map_err(|error| format!("could not prepare the dictionary: {error}"))?;
    Ok(connection)
}

fn downloadable(mut status: DictStatus) -> DictStatus {
    if !status.ready {
        status.download = Some(DictDownload {
            version: DICTIONARY_ASSET_VERSION.to_string(),
            size_bytes: DICTIONARY_ASSET_BYTES,
        });
    }
    status
}

/// Open the dictionary. A missing asset is offered from the first lookup rather
/// than requiring the reader to find an application-data directory themselves.
#[tauri::command]
pub fn dict_init(app: AppHandle, state: State<'_, DictionaryState>) -> Result<DictStatus, String> {
    state.status(&app)
}

#[tauri::command]
pub fn dict_status(
    app: AppHandle,
    state: State<'_, DictionaryState>,
) -> Result<DictStatus, String> {
    state.status(&app)
}

/// Download and atomically install the versioned, pre-indexed dictionary.
///
/// The URL and digest are compiled into the app. A truncated response, a
/// replaced GitHub asset, a corrupt SQLite file, or a schema/count mismatch is
/// rejected before `dictionary.db` is touched.
#[tauri::command]
pub async fn dict_download(
    app: AppHandle,
    state: State<'_, DictionaryState>,
    on_progress: Channel<DictDownloadProgress>,
) -> Result<DictStatus, String> {
    let _lease = state.begin_install()?;

    {
        let mut guard = state
            .connection
            .lock()
            .map_err(|_| "dictionary lock was poisoned".to_string())?;
        if guard.is_none() {
            *guard = Some(open_database(&app)?);
        }
        let current = store::status(guard.as_ref().expect("opened above"))
            .map_err(|error| error.to_string())?;
        if current.ready {
            return Ok(current);
        }
        // No command may re-open it while the install lease is alive. Closing
        // it here also makes replacement work on Windows.
        *guard = None;
    }

    let dir = data_dir(&app)?;
    fs::create_dir_all(&dir)
        .map_err(|error| format!("could not create {}: {error}", dir.display()))?;
    let target = dir.join("dictionary.db");
    let partial = dir.join("dictionary.db.part");
    remove_database_files(&partial)?;

    let result = async {
        download_asset(&partial, &on_progress).await?;
        validate_asset(&partial)?;
        replace_database(&partial, &target)?;
        let connection = open_database(&app)?;
        let status = store::status(&connection).map_err(|error| error.to_string())?;
        *state
            .connection
            .lock()
            .map_err(|_| "dictionary lock was poisoned".to_string())? = Some(connection);
        Ok(status)
    }
    .await;

    if result.is_err() {
        let _ = remove_database_files(&partial);
    }
    result
}

async fn download_asset(
    destination: &Path,
    on_progress: &Channel<DictDownloadProgress>,
) -> Result<(), String> {
    let client = reqwest::Client::builder()
        .connect_timeout(Duration::from_secs(15))
        .timeout(Duration::from_secs(10 * 60))
        .user_agent(concat!("VeloRead/", env!("CARGO_PKG_VERSION")))
        .build()
        .map_err(|error| format!("could not prepare the dictionary download: {error}"))?;
    let mut response = client
        .get(DICTIONARY_ASSET_URL)
        .send()
        .await
        .map_err(|error| format!("could not download the dictionary: {error}"))?
        .error_for_status()
        .map_err(|error| format!("could not download the dictionary: {error}"))?;

    if let Some(length) = response.content_length() {
        if length != DICTIONARY_ASSET_BYTES {
            return Err(format!(
                "dictionary download announced {length} bytes; expected {DICTIONARY_ASSET_BYTES}"
            ));
        }
    }

    let mut file = tokio::fs::File::create(destination)
        .await
        .map_err(|error| format!("could not create {}: {error}", destination.display()))?;
    let mut downloaded = 0_u64;
    let mut last_reported = 0_u64;
    let _ = on_progress.send(DictDownloadProgress {
        downloaded_bytes: 0,
        total_bytes: DICTIONARY_ASSET_BYTES,
    });

    while let Some(chunk) = response
        .chunk()
        .await
        .map_err(|error| format!("dictionary download stopped early: {error}"))?
    {
        downloaded += chunk.len() as u64;
        if downloaded > DICTIONARY_ASSET_BYTES {
            return Err("dictionary download was larger than expected".to_string());
        }
        file.write_all(&chunk)
            .await
            .map_err(|error| format!("could not write {}: {error}", destination.display()))?;
        if downloaded - last_reported >= 256 * 1024 || downloaded == DICTIONARY_ASSET_BYTES {
            last_reported = downloaded;
            let _ = on_progress.send(DictDownloadProgress {
                downloaded_bytes: downloaded,
                total_bytes: DICTIONARY_ASSET_BYTES,
            });
        }
    }
    file.flush()
        .await
        .map_err(|error| format!("could not finish {}: {error}", destination.display()))?;

    if downloaded != DICTIONARY_ASSET_BYTES {
        return Err(format!(
            "dictionary download ended at {downloaded} bytes; expected {DICTIONARY_ASSET_BYTES}"
        ));
    }
    Ok(())
}

fn sha256_file(path: &Path) -> Result<String, String> {
    let file = fs::File::open(path)
        .map_err(|error| format!("could not read {}: {error}", path.display()))?;
    let mut reader = BufReader::with_capacity(1 << 20, file);
    let mut digest = Sha256::new();
    let mut buffer = [0_u8; 1 << 20];
    loop {
        let read = reader
            .read(&mut buffer)
            .map_err(|error| format!("could not read {}: {error}", path.display()))?;
        if read == 0 {
            break;
        }
        digest.update(&buffer[..read]);
    }
    Ok(format!("{:x}", digest.finalize()))
}

fn validate_asset(path: &Path) -> Result<(), String> {
    let size = fs::metadata(path)
        .map_err(|error| format!("could not inspect {}: {error}", path.display()))?
        .len();
    if size != DICTIONARY_ASSET_BYTES {
        return Err(format!(
            "downloaded dictionary is {size} bytes; expected {DICTIONARY_ASSET_BYTES}"
        ));
    }

    let digest = sha256_file(path)?;
    if digest != DICTIONARY_ASSET_SHA256 {
        return Err("downloaded dictionary failed its SHA-256 check".to_string());
    }

    validate_database_contents(path)
}

fn validate_database_contents(path: &Path) -> Result<(), String> {
    let connection = Connection::open_with_flags(
        path,
        rusqlite::OpenFlags::SQLITE_OPEN_READ_ONLY | rusqlite::OpenFlags::SQLITE_OPEN_NO_MUTEX,
    )
    .map_err(|error| format!("downloaded dictionary is not SQLite: {error}"))?;
    let version: i32 = connection
        .query_row("PRAGMA user_version", [], |row| row.get(0))
        .map_err(|error| format!("could not read the dictionary schema: {error}"))?;
    if version != store::DICTIONARY_SCHEMA_VERSION {
        return Err(format!(
            "dictionary schema is {version}; expected {}",
            store::DICTIONARY_SCHEMA_VERSION
        ));
    }
    let entries: i64 = connection
        .query_row("SELECT COUNT(*) FROM entries", [], |row| row.get(0))
        .map_err(|error| format!("could not count downloaded dictionary entries: {error}"))?;
    if entries != DICTIONARY_ASSET_ENTRIES {
        return Err(format!(
            "dictionary has {entries} entries; expected {DICTIONARY_ASSET_ENTRIES}"
        ));
    }
    let integrity: String = connection
        .query_row("PRAGMA quick_check", [], |row| row.get(0))
        .map_err(|error| format!("could not verify the dictionary: {error}"))?;
    if integrity != "ok" {
        return Err(format!(
            "downloaded dictionary failed SQLite validation: {integrity}"
        ));
    }
    Ok(())
}

fn replace_database(partial: &Path, target: &Path) -> Result<(), String> {
    // SQLite may have left companions beside the empty placeholder database.
    // They belong to that old inode and must never be replayed beside the
    // verified replacement.
    remove_database_companions(target)?;
    // Validation opens the partial SQLite database read-only. SQLite may still
    // create zero-byte WAL/SHM companions beside it; they are temporary state,
    // not release assets, and must not remain under the final app-data name.
    remove_database_companions(partial)?;

    // Unix rename replaces the old database atomically, which covers the
    // macOS product and Linux development builds. Windows cannot rename over
    // an existing file, so its already-closed empty placeholder is removed
    // first; losing that derived placeholder on a crash loses no user data.
    #[cfg(windows)]
    if target.exists() {
        fs::remove_file(target)
            .map_err(|error| format!("could not replace {}: {error}", target.display()))?;
    }
    fs::rename(partial, target)
        .map_err(|error| format!("could not install {}: {error}", target.display()))
}

fn remove_database_files(path: &Path) -> Result<(), String> {
    if path.exists() {
        fs::remove_file(path)
            .map_err(|error| format!("could not remove {}: {error}", path.display()))?;
    }
    remove_database_companions(path)
}

fn remove_database_companions(path: &Path) -> Result<(), String> {
    for suffix in ["-wal", "-shm"] {
        let mut name = path.as_os_str().to_os_string();
        name.push(suffix);
        let companion = PathBuf::from(name);
        if companion.exists() {
            fs::remove_file(&companion)
                .map_err(|error| format!("could not remove {}: {error}", companion.display()))?;
        }
    }
    Ok(())
}

#[tauri::command]
pub fn dict_lookup(
    app: AppHandle,
    state: State<'_, DictionaryState>,
    candidates: Vec<String>,
) -> Result<DictLookup, String> {
    state.with_lookup_db(&app, |connection| store::lookup(connection, &candidates))
}

/// Import a source file into a dictionary database at a chosen path.
///
/// Shared by the `dict-import` binary, which is how the dictionary is built
/// outside a running app (`bun run dict:import`).
pub fn import_file(source: &Path, target: &Path) -> Result<i64, String> {
    if let Some(parent) = target.parent() {
        fs::create_dir_all(parent)
            .map_err(|error| format!("could not create {}: {error}", parent.display()))?;
    }
    let mut connection = open_at(target)?;
    let file = fs::File::open(source)
        .map_err(|error| format!("could not read {}: {error}", source.display()))?;
    store::import_from_json(&mut connection, BufReader::with_capacity(1 << 20, file))
}

#[cfg(test)]
mod tests {
    use super::store::*;
    use rusqlite::Connection;

    fn imported(json: &str) -> Connection {
        let mut connection = Connection::open_in_memory().expect("open in-memory dictionary");
        import_from_json(&mut connection, json.as_bytes()).expect("import");
        connection
    }

    #[test]
    fn imports_a_flat_word_to_definition_object() {
        let connection = imported(r#"{"run":"To move swiftly.","Ash":"A tree."}"#);

        let status = status(&connection).unwrap();
        assert_eq!(status.entries, 2);
        assert!(status.ready);

        let entry = lookup(&connection, &["run".to_string()])
            .unwrap()
            .entry
            .unwrap();
        assert_eq!(entry.definition, "To move swiftly.");
        // Headwords are stored lowercased, so a capitalised word still resolves.
        assert!(lookup(&connection, &["ash".to_string()])
            .unwrap()
            .entry
            .is_some());
        assert!(lookup(&connection, &["ASH".to_string()])
            .unwrap()
            .entry
            .is_some());
    }

    #[test]
    fn reads_from_the_first_known_candidate_and_reports_all_of_them() {
        let connection = imported(r#"{"run":"To move swiftly.","running":"Act of running."}"#);

        // The word as selected wins the definition when it is itself a
        // headword, but the reduction is still reported so it can be the stem.
        let found = lookup(&connection, &["running".to_string(), "run".to_string()]).unwrap();
        assert_eq!(found.entry.unwrap().word, "running");
        assert_eq!(found.known, vec!["running".to_string(), "run".to_string()]);

        // Otherwise the reduction answers, and says which form it matched.
        let found = lookup(&connection, &["runs".to_string(), "run".to_string()]).unwrap();
        assert_eq!(found.entry.unwrap().word, "run");
        assert_eq!(found.known, vec!["run".to_string()]);

        let missing = lookup(&connection, &["zzz".to_string()]).unwrap();
        assert!(missing.entry.is_none());
        assert!(missing.known.is_empty());
    }

    #[test]
    fn an_empty_dictionary_is_not_ready() {
        let connection = Connection::open_in_memory().unwrap();
        migrate(&connection).unwrap();
        assert_eq!(
            status(&connection).unwrap(),
            DictStatus {
                ready: false,
                entries: 0,
                download: None,
            }
        );
        assert!(lookup(&connection, &["run".to_string()])
            .unwrap()
            .entry
            .is_none());
    }

    #[test]
    fn a_second_import_keeps_what_is_already_there() {
        let mut connection = Connection::open_in_memory().unwrap();
        import_from_json(&mut connection, r#"{"run":"First."}"#.as_bytes()).unwrap();
        let total = import_from_json(
            &mut connection,
            r#"{"run":"Second.","ash":"A tree."}"#.as_bytes(),
        )
        .unwrap();

        assert_eq!(total, 2);
        let entry = lookup(&connection, &["run".to_string()])
            .unwrap()
            .entry
            .unwrap();
        assert_eq!(entry.definition, "First.");
    }

    #[test]
    fn installing_an_asset_replaces_the_placeholder_and_its_wal_files() {
        let directory = std::env::temp_dir().join(format!(
            "veloread-dict-replace-{}-{:?}",
            std::process::id(),
            std::thread::current().id()
        ));
        std::fs::create_dir_all(&directory).unwrap();
        let target = directory.join("dictionary.db");
        let partial = directory.join("dictionary.db.part");
        std::fs::write(&target, b"placeholder").unwrap();
        std::fs::write(directory.join("dictionary.db-wal"), b"wal").unwrap();
        std::fs::write(directory.join("dictionary.db-shm"), b"shm").unwrap();
        std::fs::write(&partial, b"verified asset").unwrap();
        std::fs::write(directory.join("dictionary.db.part-wal"), b"part wal").unwrap();
        std::fs::write(directory.join("dictionary.db.part-shm"), b"part shm").unwrap();

        super::replace_database(&partial, &target).unwrap();

        assert_eq!(std::fs::read(&target).unwrap(), b"verified asset");
        assert!(!partial.exists());
        assert!(!directory.join("dictionary.db-wal").exists());
        assert!(!directory.join("dictionary.db-shm").exists());
        assert!(!directory.join("dictionary.db.part-wal").exists());
        assert!(!directory.join("dictionary.db.part-shm").exists());
        std::fs::remove_dir_all(directory).unwrap();
    }

    /// The real acceptance number from the issue: the full 102,217-entry
    /// dictionary, queried out of SQLite, under 50 ms.
    ///
    /// The source is a local asset that is deliberately not in the repository
    /// (`AGENTS.md`), so this reports and skips when it is absent rather than
    /// failing a checkout that cannot possibly pass it. Point it at the file
    /// with `VELOREAD_DICTIONARY_JSON=<path> cargo test -- --nocapture`.
    #[test]
    fn lookup_latency_on_the_full_dictionary_stays_under_the_target() {
        let Ok(source) = std::env::var("VELOREAD_DICTIONARY_JSON") else {
            eprintln!(
                "skipped: set VELOREAD_DICTIONARY_JSON to the dictionary source to measure latency"
            );
            return;
        };

        let directory =
            std::env::temp_dir().join(format!("veloread-dict-bench-{}", std::process::id()));
        std::fs::create_dir_all(&directory).expect("create bench directory");
        let target = directory.join("dictionary.db");
        let _ = std::fs::remove_file(&target);

        let started = std::time::Instant::now();
        let entries = super::import_file(std::path::Path::new(&source), &target).expect("import");
        let import_seconds = started.elapsed().as_secs_f64();
        // The locally generated file need not be byte-for-byte identical after
        // a future SQLite/rusqlite update. Release downloads still enforce the
        // pinned size and digest; this import/latency test verifies the durable
        // schema, entry-count and integrity contract instead.
        super::validate_database_contents(&target).expect("the imported dictionary is valid");

        let connection = Connection::open(&target).expect("open imported dictionary");

        // Query the words that are actually in there, plus misses and inflected
        // forms, so the numbers are not a single hot row measured over and over.
        let mut statement = connection
            .prepare("SELECT word FROM entries ORDER BY id")
            .unwrap();
        let words: Vec<String> = statement
            .query_map([], |row| row.get::<_, String>(0))
            .unwrap()
            .map(|word| word.unwrap())
            .collect();
        drop(statement);

        let mut samples: Vec<f64> = Vec::new();
        let step = (words.len() / 2000).max(1);
        for word in words.iter().step_by(step) {
            // A hit on the word as selected.
            let started = std::time::Instant::now();
            let found = lookup(&connection, std::slice::from_ref(word)).unwrap();
            samples.push(started.elapsed().as_secs_f64() * 1000.0);
            assert!(found.entry.is_some(), "{word} should be in the dictionary");

            // A miss that falls through every candidate — the worst shape a
            // real lookup can have.
            let started = std::time::Instant::now();
            lookup(
                &connection,
                &[
                    format!("{word}zzq"),
                    format!("{word}zz"),
                    format!("{word}z"),
                ],
            )
            .unwrap();
            samples.push(started.elapsed().as_secs_f64() * 1000.0);
        }

        samples.sort_by(|a, b| a.partial_cmp(b).unwrap());
        let p50 = samples[samples.len() / 2];
        let p99 = samples[samples.len() * 99 / 100];
        let worst = *samples.last().unwrap();
        let size = std::fs::metadata(&target).map(|m| m.len()).unwrap_or(0);

        eprintln!(
            "dictionary: {entries} entries, imported in {import_seconds:.1}s, db {:.1} MB\n\
             lookup over {} samples: p50 {p50:.3} ms, p99 {p99:.3} ms, worst {worst:.3} ms",
            size as f64 / 1_048_576.0,
            samples.len(),
        );

        let _ = std::fs::remove_dir_all(&directory);
        assert!(
            worst < 50.0,
            "worst lookup was {worst:.3} ms, target is 50 ms"
        );
    }
}
