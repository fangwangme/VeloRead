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
    ])
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
