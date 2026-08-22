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
use std::io::BufReader;
use std::path::{Path, PathBuf};
use std::sync::Mutex;

use rusqlite::Connection;
use tauri::{AppHandle, Manager, State};

pub use store::{DictEntry, DictLookup, DictStatus};

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
#[derive(Default)]
pub struct DictionaryState {
    connection: Mutex<Option<Connection>>,
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

/// Where a user drops the source to have it imported on next start.
fn source_path(app: &AppHandle) -> Result<PathBuf, String> {
    Ok(data_dir(app)?.join("dictionary.json"))
}

/// Open the dictionary, importing the source once if one is waiting.
///
/// The import is here rather than in a build step because the source is not
/// part of the bundle: the app is under 30 MB precisely because it does not
/// carry 22 MB of prose around, so the dictionary arrives beside the database
/// and is folded in the first time the app looks for it. See
/// `docs/usage/dictionary.md`.
#[tauri::command]
pub fn dict_init(app: AppHandle, state: State<'_, DictionaryState>) -> Result<DictStatus, String> {
    let current = state.with_db(&app, store::status)?;
    if current.ready {
        return Ok(current);
    }

    let source = source_path(&app)?;
    if !source.exists() {
        return Ok(current);
    }

    let mut guard = state
        .connection
        .lock()
        .map_err(|_| "dictionary lock was poisoned".to_string())?;
    let connection = guard.as_mut().ok_or("dictionary was not opened")?;
    let file = fs::File::open(&source)
        .map_err(|error| format!("could not read {}: {error}", source.display()))?;
    let entries = store::import_from_json(connection, BufReader::with_capacity(1 << 20, file))?;
    Ok(DictStatus {
        ready: entries > 0,
        entries,
    })
}

#[tauri::command]
pub fn dict_status(
    app: AppHandle,
    state: State<'_, DictionaryState>,
) -> Result<DictStatus, String> {
    state.with_db(&app, store::status)
}

#[tauri::command]
pub fn dict_lookup(
    app: AppHandle,
    state: State<'_, DictionaryState>,
    candidates: Vec<String>,
) -> Result<DictLookup, String> {
    state.with_db(&app, |connection| store::lookup(connection, &candidates))
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
                entries: 0
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
