//! Exporting a note out of the vault: as Markdown or PDF, to a place the
//! person picks (#501).
//!
//! What an export holds — the bytes of each file, their names, the HTML a PDF
//! is made from — is the frontend's. The host asks where it goes, keeps each
//! write inside that place (`destinations.rs`), and turns HTML into a PDF with
//! the system's WebKit (`pdf.rs`). It never reads or changes the vault.

use std::time::Duration;

use tauri::ipc::{InvokeBody, Request, Response};
use tauri::{AppHandle, Runtime, State};
use tauri_plugin_dialog::DialogExt;
use tokio::sync::oneshot;

use crate::vault::off_main;
use crate::vault_files::header;

pub mod destinations;
pub mod pdf;
#[cfg(target_os = "macos")]
pub mod pdf_macos;

pub use destinations::ExportGrants;
use destinations::{DestinationRequest, Granted};

const DESTINATION_HEADER: &str = "atlas-export-destination";
const PATH_HEADER: &str = "atlas-export-path";
const PAGE_WIDTH_HEADER: &str = "atlas-page-width";
const PAGE_HEIGHT_HEADER: &str = "atlas-page-height";
const TIMEOUT_HEADER: &str = "atlas-timeout-ms";

/// Asks the person where an export goes, and holds that place for it. `None`
/// when they cancel.
#[tauri::command]
pub async fn export_choose_destination(
    app: AppHandle,
    grants: State<'_, ExportGrants>,
    request: DestinationRequest,
) -> Result<Option<Granted>, String> {
    request.check()?;
    // Waits on the blocking pool while the dialog is open, as `pick_vault`
    // does; the dialog plugin hops to the main thread on its own.
    let grant = off_main(move || choose(&app, request)).await?;
    grant.map(|grant| grants.insert(grant)).transpose()
}

fn choose(
    app: &AppHandle,
    request: DestinationRequest,
) -> Result<Option<destinations::Grant>, String> {
    let dialog = app.dialog().file();
    match request {
        DestinationRequest::File {
            suggested_name,
            extension,
            companion_suffix,
        } => {
            let Some(chosen) = dialog
                .set_file_name(&suggested_name)
                .add_filter(
                    destinations::filter_label(&extension),
                    &[extension.as_str()],
                )
                .blocking_save_file()
            else {
                return Ok(None);
            };
            let chosen = chosen
                .into_path()
                .map_err(|error| format!("unusable file: {error}"))?;
            destinations::grant_file(&chosen, &extension, companion_suffix.as_deref()).map(Some)
        }
        DestinationRequest::Folder { folder_name } => {
            let Some(picked) = dialog.blocking_pick_folder() else {
                return Ok(None);
            };
            let picked = picked
                .into_path()
                .map_err(|error| format!("unusable folder: {error}"))?;
            destinations::grant_folder(&picked, &folder_name).map(Some)
        }
    }
}

/// Writes the raw body as one file of an export. Which export, and the path
/// inside it, arrive as headers; see `destinations::write_into` for what is
/// refused. Answers with how many bytes were written.
#[tauri::command]
pub async fn export_write_file(
    grants: State<'_, ExportGrants>,
    request: Request<'_>,
) -> Result<u64, String> {
    let InvokeBody::Raw(bytes) = request.body() else {
        return Err("the file's bytes must be the body of the call".into());
    };
    if bytes.len() > destinations::MAX_FILE_BYTES {
        return Err(destinations::too_big());
    }
    let id = header(&request, DESTINATION_HEADER)?.ok_or("no export was named")?;
    let path = header(&request, PATH_HEADER)?.ok_or("no file path was given")?;
    let grant = grants.get(&id)?;
    // Copied once to be written on the blocking pool: the body is borrowed
    // from the request, which cannot leave this call.
    let bytes = bytes.clone();
    off_main(move || destinations::write_into(&grant, &path, &bytes)).await
}

/// Lets go of an export's destination. One already let go of is fine.
#[tauri::command]
pub fn export_finish(grants: State<'_, ExportGrants>, id: String) {
    grants.remove(&id);
}

/// Makes a PDF of the HTML in the raw body. The page size and the timeout
/// arrive as headers; see `pdf::pdf_spec` for what is refused.
#[tauri::command]
pub async fn export_render_pdf<R: Runtime>(
    app: AppHandle<R>,
    request: Request<'_>,
) -> Result<Response, String> {
    let InvokeBody::Raw(page) = request.body() else {
        return Err("the page must be the body of the call".into());
    };
    let args = pdf::PdfArgs {
        page_width: header(&request, PAGE_WIDTH_HEADER)?,
        page_height: header(&request, PAGE_HEIGHT_HEADER)?,
        timeout_ms: header(&request, TIMEOUT_HEADER)?,
    };
    let spec = pdf::pdf_spec(page, &args)?;
    // The webview gives up on its own at the timeout; this is only in case the
    // main thread never gets to it at all.
    let deadline = spec.timeout + Duration::from_secs(5);
    let (sender, receiver) = oneshot::channel();
    start_pdf(&app, spec, sender)?;
    let bytes = tokio::time::timeout(deadline, receiver)
        .await
        .map_err(|_| "the PDF took too long".to_string())?
        .map_err(|_| "the PDF was given up".to_string())??;
    Ok(Response::new(bytes))
}

type Done = oneshot::Sender<Result<Vec<u8>, String>>;

#[cfg(target_os = "macos")]
fn start_pdf<R: Runtime>(
    app: &AppHandle<R>,
    spec: pdf::PdfSpec,
    sender: Done,
) -> Result<(), String> {
    app.run_on_main_thread(move || {
        let Some(main) = objc2::MainThreadMarker::new() else {
            // Tauri runs this on the main thread; nothing else can make the view.
            let _ = sender.send(Err("not on the main thread".into()));
            return;
        };
        pdf_macos::start(
            main,
            spec,
            Box::new(move |result| {
                // The command stopped waiting (its own deadline): nobody to tell.
                let _ = sender.send(result);
            }),
        );
    })
    .map_err(|error| format!("cannot reach the main thread: {error}"))
}

#[cfg(not(target_os = "macos"))]
fn start_pdf<R: Runtime>(
    _app: &AppHandle<R>,
    _spec: pdf::PdfSpec,
    _sender: Done,
) -> Result<(), String> {
    Err("PDF export needs macOS".into())
}
