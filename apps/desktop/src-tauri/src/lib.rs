mod activity;
mod api;
mod git_process;
mod http;
mod index;
mod model_http;
mod model_process;
mod navigation;
mod opener;
mod secrets;
mod sqlite_source;
// Public for its integration test, which pictures a real page on the main thread.
#[doc(hidden)]
pub mod page_snapshot;
mod vault;
mod vault_entries;
mod vault_files;
mod watcher;

/// Reports a failure the webview caught before the app could handle it itself.
/// Without this a script error leaves a blank window and no trace of why.
#[tauri::command]
fn report_error(message: String) {
    log::error!("webview: {message}");
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .plugin(navigation::guard())
        .manage(vault::VaultState::default())
        .manage(index::IndexState::default())
        .manage(index::QueryState::default())
        .manage(watcher::WatcherState::default())
        .manage(api::ApiState::default())
        .manage(secrets::SecretState::default())
        .manage(sqlite_source::SqliteGrants::default())
        .manage(model_process::ModelProcesses::default())
        .manage(git_process::GitHost::default())
        .invoke_handler(tauri::generate_handler![
            report_error,
            activity::activity_append,
            activity::activity_read,
            activity::activity_replace,
            http::http_get,
            model_http::model_http_post,
            model_process::model_process_start,
            model_process::model_process_cancel,
            git_process::git_run,
            git_process::git_run_in,
            git_process::git_pick_clone_folder,
            git_process::git_folder_on_disk,
            git_process::gh_repo_create,
            git_process::this_mac_name,
            git_process::git_sync_file_read,
            git_process::git_sync_file_write,
            git_process::gh_repo_list,
            secrets::secret_list,
            secrets::secret_set,
            secrets::secret_bind,
            secrets::secret_delete,
            sqlite_source::sqlite_source_query,
            sqlite_source::pick_sqlite_file,
            vault::pick_vault,
            vault::open_vault,
            vault::current_vault,
            vault::list_directory,
            vault::list_notes,
            index::index_open,
            index::index_clear,
            index::index_manifest,
            index::index_put,
            index::index_remove,
            index::index_search,
            index::index_backlinks,
            index::index_notes_of_type,
            index::index_rebuild_views,
            index::index_query,
            index::index_stats,
            watcher::watch_vault,
            vault::read_text_file,
            vault::read_notes,
            vault::read_binary_file,
            vault::write_text_file,
            vault_files::write_binary_file,
            opener::open_url,
            page_snapshot::snapshot_page,
            vault::create_note,
            vault_entries::create_folder,
            vault_entries::move_entry,
            vault_entries::trash_entry,
            api::api_status,
            api::api_set_enabled,
            api::api_rotate_token,
            api::api_token,
            api::api_respond,
            api::api_router_ready,
        ])
        .on_page_load(api::forget_router_on_page_load)
        .setup(|app| {
            if cfg!(debug_assertions) {
                app.handle().plugin(
                    tauri_plugin_log::Builder::default()
                        .level(log::LevelFilter::Debug)
                        // Replace the defaults rather than adding to them: the
                        // default set already includes the log directory, and
                        // adding it again writes every record to the file twice.
                        .clear_targets()
                        .target(tauri_plugin_log::Target::new(
                            tauri_plugin_log::TargetKind::Stdout,
                        ))
                        .target(tauri_plugin_log::Target::new(
                            tauri_plugin_log::TargetKind::LogDir { file_name: None },
                        ))
                        .build(),
                )?;
            }
            api::restore(app.handle());
            Ok(())
        })
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
