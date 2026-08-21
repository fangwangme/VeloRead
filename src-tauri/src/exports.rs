//! Writing user data out of the app.
//!
//! Separate from `library`: that module owns the database and the book files
//! the app manages for itself. This one hands text to the user, and the only
//! thing it may touch is the destination they can already see in Finder.

use std::fs;
use std::path::PathBuf;

use serde::Deserialize;
use tauri::{AppHandle, Manager};

/// One file to write. `name` is a bare filename, never a path.
#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ExportFile {
    pub name: String,
    pub text: String,
}

/// Filenames come from book titles, which come from EPUB metadata, which is
/// arbitrary text from an untrusted file. Reject anything that is not a plain
/// name rather than trying to sanitise it into one.
fn safe_name(name: &str) -> Result<&str, String> {
    let invalid = name.is_empty()
        || name.len() > 128
        || name.starts_with('.')
        || name.contains('/')
        || name.contains('\\')
        || name.contains('\0')
        || name.contains("..");
    if invalid {
        return Err(format!("unsafe export filename: {name:?}"));
    }
    Ok(name)
}

fn downloads_dir(app: &AppHandle) -> Result<PathBuf, String> {
    app.path()
        .download_dir()
        .map_err(|error| format!("no Downloads folder: {error}"))
}

/// Write the files under Downloads and answer with where they landed.
///
/// A single file goes straight into Downloads, which is what you want when the
/// next step is dragging it into a notes app. Several go into a folder of their
/// own, because loose files scattered across Downloads is not a export anyone
/// wants to receive. Re-exporting overwrites the previous one on purpose: it is
/// the same data, and accumulating `(2)` copies helps nobody.
#[tauri::command]
pub fn export_text_files(
    app: AppHandle,
    files: Vec<ExportFile>,
    bundle_name: String,
) -> Result<String, String> {
    if files.is_empty() {
        return Err("nothing to export".to_string());
    }
    for file in &files {
        safe_name(&file.name)?;
    }

    let downloads = downloads_dir(&app)?;
    let target = if files.len() == 1 {
        downloads
    } else {
        let folder = downloads.join(safe_name(&bundle_name)?);
        fs::create_dir_all(&folder)
            .map_err(|error| format!("could not create {}: {error}", folder.display()))?;
        folder
    };

    for file in &files {
        let path = target.join(&file.name);
        fs::write(&path, &file.text)
            .map_err(|error| format!("could not write {}: {error}", path.display()))?;
    }

    let written = if files.len() == 1 {
        target.join(&files[0].name)
    } else {
        target
    };
    Ok(written.to_string_lossy().to_string())
}

/// Select the export in Finder, so "where did it go" is answered by showing it.
#[tauri::command]
pub fn reveal_path(path: String) -> Result<(), String> {
    #[cfg(target_os = "macos")]
    {
        std::process::Command::new("open")
            .args(["-R", &path])
            .status()
            .map_err(|error| format!("could not reveal {path}: {error}"))?;
    }
    #[cfg(not(target_os = "macos"))]
    {
        let _ = path;
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::safe_name;

    #[test]
    fn rejects_names_that_are_paths_or_hidden_files() {
        assert!(safe_name("The Selfish Gene.txt").is_ok());
        for bad in [
            "",
            "../escape.txt",
            "a/b.txt",
            "a\\b.txt",
            ".hidden",
            "with..dots",
        ] {
            assert!(safe_name(bad).is_err(), "should have rejected {bad:?}");
        }
    }

    #[test]
    fn rejects_absurdly_long_names() {
        assert!(safe_name(&"x".repeat(200)).is_err());
    }
}
