//! Build the dictionary database from its JSON source.
//!
//! The one-time import step, outside a running app. Handy on a machine where
//! the app itself cannot be run, and it is how the query latency in
//! `docs/specs/vocabulary.md` is measured against the real 102k-entry file.
//!
//!     cargo run --example dict-import -- <source.json> <dictionary.db>
//!
//! A cargo *example* rather than a second `[[bin]]`: `tauri build` picks the
//! application out of the crate's binaries, and a second one there makes it
//! pick the wrong one — it bundled this tool as VeloRead. Examples are built
//! and linted by `cargo clippy --all-targets` and `cargo test` just the same.
//!
//! The app does the same import itself the first time it finds a
//! `dictionary.json` beside its database — see `docs/usage/dictionary.md`.

use std::path::Path;
use std::process::ExitCode;

fn main() -> ExitCode {
    let arguments: Vec<String> = std::env::args().skip(1).collect();
    let [source, target] = arguments.as_slice() else {
        eprintln!("usage: dict-import <source.json> <dictionary.db>");
        return ExitCode::FAILURE;
    };

    let started = std::time::Instant::now();
    match veloread_lib::dictionary::import_file(Path::new(source), Path::new(target)) {
        Ok(entries) => {
            println!(
                "imported {entries} entries into {target} in {:.1}s",
                started.elapsed().as_secs_f64()
            );
            ExitCode::SUCCESS
        }
        Err(error) => {
            eprintln!("dict-import failed: {error}");
            ExitCode::FAILURE
        }
    }
}
