mod exports;
mod library;
mod lifecycle;

use tauri::Manager;

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
            library::library_list_progress,
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
            lifecycle::lifecycle_flush_complete,
        ])
        .manage(lifecycle::ShutdownState::default())
        // Closing the window is a quit for a single-window reader, and both
        // paths have to give the webview its moment to write what it is holding.
        .on_window_event(|window, event| {
            if let tauri::WindowEvent::CloseRequested { api, .. } = event {
                let app = window.app_handle();
                if !lifecycle::is_shutdown_complete(app) {
                    api.prevent_close();
                    lifecycle::begin_shutdown(app);
                }
            }
        })
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
        .build(tauri::generate_context!())
        .expect("error while building tauri application")
        .run(|app, event| {
            // `code` is set when the exit was asked for programmatically — which
            // is what the flush itself does once it is finished. Only a user
            // quit (Cmd+Q, the menu) is worth holding.
            if let tauri::RunEvent::ExitRequested { api, code, .. } = &event {
                if code.is_none() && !lifecycle::is_shutdown_complete(app) {
                    api.prevent_exit();
                    lifecycle::begin_shutdown(app);
                }
            }
        });
}
