//! The local API: other tools on this machine talking to the running app.
//!
//! The host authenticates a request and forwards it; it decides nothing about
//! what the request means (ADR-0005, ADR-0016). The router that answers is the
//! TypeScript that runs the UI, reached through the `api-request` event and
//! answering through the `api_respond` command — both named in
//! `packages/application/src/api/contract.ts`.

#[cfg(test)]
mod adversarial_tests;
mod broker;
mod connection;
mod control;
mod request;
mod server;
#[cfg(test)]
mod server_tests;
mod vet;

use std::sync::{Arc, OnceLock};

use tauri::webview::{PageLoadEvent, PageLoadPayload};
use tauri::{AppHandle, Emitter, Manager, State, Webview};

use broker::Answer;
use control::{ApiControl, ApiStatusReport};
use server::Forward;

/// `API_REQUEST_EVENT` in the contract.
const API_REQUEST_EVENT: &str = "api-request";

/// The window whose router answers requests.
const MAIN_WINDOW: &str = "main";

/// Filled once at startup. It stays empty only if the app data directory could
/// not be read, and then every command says so instead of the app failing to
/// start over an optional feature.
#[derive(Default)]
pub struct ApiState(OnceLock<Result<ApiControl, String>>);

fn loaded_control<'a>(state: &'a State<'_, ApiState>) -> Result<&'a ApiControl, String> {
    match state.0.get() {
        Some(Ok(control)) => Ok(control),
        Some(Err(error)) => Err(format!("the API is unavailable: {error}")),
        None => Err("the API is not ready yet".to_string()),
    }
}

fn forward_to_webview(app: &AppHandle) -> Forward {
    let app = app.clone();
    Arc::new(move |request| {
        // Tauri 2.11's `emit_to` returns Ok when no webview has the label, which
        // would leave the caller waiting out the whole answer timeout.
        if app.get_webview_window(MAIN_WINDOW).is_none() {
            return Err(format!("there is no {MAIN_WINDOW} window to answer"));
        }
        app.emit_to(MAIN_WINDOW, API_REQUEST_EVENT, request)
            .map_err(|error| error.to_string())
    })
}

/// Loads the connection file and, if the API was left on, starts serving.
pub fn restore(app: &AppHandle) {
    let loaded = app
        .path()
        .app_data_dir()
        .map_err(|error| error.to_string())
        .and_then(ApiControl::load);
    if let Ok(control) = &loaded {
        if let Err(error) = control.resume(forward_to_webview(app)) {
            log::error!("the API could not be started: {error}");
        }
    }
    if let Err(error) = &loaded {
        log::error!("the API is unavailable: {error}");
    }
    // `restore` runs once, from setup; a second call would find the state
    // already filled and has nothing to add.
    let _ = app.state::<ApiState>().0.set(loaded);
}

#[tauri::command]
pub fn api_status(state: State<'_, ApiState>) -> Result<ApiStatusReport, String> {
    Ok(loaded_control(&state)?.status())
}

#[tauri::command]
pub fn api_set_enabled(
    app: AppHandle,
    state: State<'_, ApiState>,
    enabled: bool,
) -> Result<ApiStatusReport, String> {
    loaded_control(&state)?.set_enabled(enabled, forward_to_webview(&app))
}

/// Returns the new token.
#[tauri::command]
pub fn api_rotate_token(state: State<'_, ApiState>) -> Result<String, String> {
    loaded_control(&state)?.rotate_token()
}

#[tauri::command]
pub fn api_token(state: State<'_, ApiState>) -> Result<String, String> {
    Ok(loaded_control(&state)?.token())
}

/// The router in the main window started (`true`) or stopped (`false`)
/// listening. Until it listens, requests are refused at once rather than sent
/// to nothing.
#[tauri::command]
pub fn api_router_ready(state: State<'_, ApiState>, ready: bool) -> Result<(), String> {
    loaded_control(&state)?.set_router_ready(ready);
    Ok(())
}

/// A page load in the main window — a reload, most often — takes its router
/// away before the page can say so; the new page says when it listens again.
pub fn forget_router_on_page_load(webview: &Webview, payload: &PageLoadPayload<'_>) {
    if webview.label() != MAIN_WINDOW || payload.event() != PageLoadEvent::Started {
        return;
    }
    // Empty before `restore` has run, when there is no router to forget yet.
    if let Some(Ok(control)) = webview.state::<ApiState>().0.get() {
        control.set_router_ready(false);
    }
}

/// `ApiResponse` from the router. An id nobody is waiting on is ignored.
#[tauri::command]
pub fn api_respond(
    state: State<'_, ApiState>,
    id: String,
    status: u16,
    body: serde_json::Value,
) -> Result<(), String> {
    loaded_control(&state)?.respond(&id, Answer { status, body });
    Ok(())
}
