mod exports;
mod library;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .manage(library::LibraryState::default())
        .invoke_handler(tauri::generate_handler![
            library::library_init,
            library::library_list_books,
            library::library_add_book,
            library::library_delete_book,
            library::library_read_book_file,
            library::library_read_cover,
            library::library_get_progress,
            library::library_save_progress,
            library::library_get_book_settings,
            library::library_save_book_settings,
            library::library_get_app_settings,
            library::library_save_app_settings,
            library::library_list_bookmarks,
            library::library_add_bookmark,
            library::library_delete_bookmark,
            library::library_list_collections,
            library::library_save_collection,
            library::library_delete_collection,
            library::library_set_book_collections,
            library::library_list_collection_membership,
            library::library_list_annotations,
            library::library_save_annotation,
            library::library_delete_annotation,
            library::library_record_reading_session,
            library::library_get_reading_stats,
            exports::export_text_files,
            exports::reveal_path,
        ])
        // Restores size, position and maximized state, and saves them on exit.
        // A reader is a window you size once for your eyes and expect to find
        // that way tomorrow.
        .plugin(tauri_plugin_window_state::Builder::default().build())
        .setup(|app| {
            if cfg!(debug_assertions) {
                app.handle().plugin(
                    tauri_plugin_log::Builder::default()
                        .level(log::LevelFilter::Info)
                        .build(),
                )?;
            }
            Ok(())
        })
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
