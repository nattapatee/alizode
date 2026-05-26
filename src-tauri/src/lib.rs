mod commands;
mod core;
mod permission;
mod store;
mod util;

use core::acp::AcpRegistry;
use core::inter_lane::InterLaneCoordinator;
use permission::engine::PermissionEngine;
use store::db::Database;
use std::path::PathBuf;
use std::sync::Arc;
use tauri::Manager;
use tokio::sync::Mutex;

pub struct AppState {
    pub data_dir: PathBuf,
    pub db: Arc<Mutex<Database>>,
    pub permissions: Arc<Mutex<PermissionEngine>>,
    pub coordinator: Arc<std::sync::Mutex<InterLaneCoordinator>>,
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_shell::init())
        .plugin(tauri_plugin_dialog::init())
        .setup(|app| {
            let data_dir = app
                .path()
                .app_data_dir()
                .expect("failed to resolve app data dir");
            std::fs::create_dir_all(&data_dir)?;
            let db = Database::open(&data_dir)?;
            db.run_migrations()?;
            let db = Arc::new(Mutex::new(db));
            let permissions = Arc::new(Mutex::new(PermissionEngine::new()));

            app.manage(Arc::new(AcpRegistry::new()));
            let coordinator = Arc::new(std::sync::Mutex::new(InterLaneCoordinator::new()));
            app.manage(AppState {
                data_dir: data_dir.clone(),
                db,
                permissions,
                coordinator,
            });
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            commands::agent::agent_list,
            commands::workspace::workspace_list,
            commands::workspace::workspace_create,
            commands::workspace::workspace_rename,
            commands::workspace::workspace_update_cwd,
            commands::workspace::workspace_delete,
            commands::workspace::mcp_bridge_descriptor,
            commands::workspace::load_project_mcp_servers,
            commands::lane::lane_list,
            commands::lane::lane_create,
            commands::lane::lane_delete,
            commands::lane::lane_send_user,
            commands::lane::lane_stop,
            commands::lane::lane_set_main,
            commands::lane::lane_events,
            commands::lane::lane_update_model,
            commands::lane::lane_export_session,
            commands::library::scan_markdown_files,
            commands::library::read_text_file,
            commands::library::list_directory,
            commands::library::write_text_file,
            commands::memory::memory_get,
            commands::memory::memory_set,
            commands::memory::memory_list,
            commands::permission::permission_decide,
            commands::permission::permission_clear_cache,
            commands::inter_lane::inter_lane_register,
            commands::inter_lane::inter_lane_unregister,
            commands::inter_lane::inter_lane_set_status,
            commands::inter_lane::inter_lane_on_stop,
            commands::inter_lane::inter_lane_deliver,
            commands::inter_lane::inter_lane_mention_fan_out,
            commands::inter_lane::inter_lane_list,
            commands::inter_lane::inter_lane_cancel,
            core::acp::acp_list_backends,
            core::acp::acp_spawn,
            core::acp::acp_initialize,
            core::acp::acp_set_mcp_servers,
            core::acp::acp_session_new,
            core::acp::acp_session_list,
            core::acp::acp_session_resume,
            core::acp::acp_session_load,
            core::acp::acp_prompt,
            core::acp::acp_set_config_option,
            core::acp::acp_cancel,
            core::acp::acp_permission_response,
            core::acp::acp_fs_write_response,
            core::acp::acp_dispose,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
