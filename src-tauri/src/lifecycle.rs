//! Giving the webview a chance to write its buffers before the app goes away.
//!
//! The reader keeps the reading position on a debounce and reading time in a
//! buffer. Both are flushed when you leave a book, but neither is when the
//! application itself goes away: WKWebView does not reliably run `beforeunload`.
//! So the shutdown is held here, the webview is asked to flush, and the exit
//! continues once it answers.
//!
//! The grace period is the important half. A webview that is wedged, crashed or
//! simply not listening must cost a moment on quit — never an app that cannot be
//! quit.
//!
//! **What this does not cover, measured on macOS 15 with Tauri 2.11:** Cmd+Q
//! (and any other `NSApplication` terminate, such as Quit from the Dock) reaches
//! the app as `RunEvent::Exit` alone — no `ExitRequested`, no window
//! `CloseRequested`. `Exit` carries no way to defer, so there is no window in
//! which to ask the webview for anything. Holding a quit would mean replacing
//! the standard Quit menu item or hooking `applicationShouldTerminate`, which is
//! a bigger decision than this hook. Until then the webview keeps its own
//! exposure small by writing often (see `CURSOR_SAVE_INTERVAL_MS` and the
//! session flush interval in `Reader.tsx`), and this handshake covers the paths
//! that do announce themselves: closing the window, and the browser build.

use std::sync::atomic::{AtomicBool, Ordering};
use std::thread;
use std::time::Duration;

use tauri::{AppHandle, Emitter, Manager};

/// Must match `BEFORE_EXIT_EVENT` in `src/platform/tauri/lifecycle.ts`.
pub const BEFORE_EXIT_EVENT: &str = "veloread://before-exit";

/// How long the shutdown waits for the webview to report back.
const FLUSH_GRACE_MS: u64 = 1500;

/// How often the grace period checks; small enough that a prompt answer is not
/// noticeably delayed by the polling itself.
const FLUSH_POLL_MS: u64 = 20;

#[derive(Default)]
pub struct ShutdownState {
    /// The webview has flushed, or has used up its grace period. Either way the
    /// next exit request goes straight through.
    done: AtomicBool,
    /// A grace period is already running; a second close request joins it rather
    /// than starting another.
    running: AtomicBool,
}

/// True once the webview is done (or out of time) and the app may exit.
pub fn is_shutdown_complete(app: &AppHandle) -> bool {
    app.state::<ShutdownState>().done.load(Ordering::SeqCst)
}

/// Ask the webview to flush, then exit once it answers or the grace period ends.
pub fn begin_shutdown(app: &AppHandle) {
    let state = app.state::<ShutdownState>();
    if state.running.swap(true, Ordering::SeqCst) {
        return;
    }

    let _ = app.emit(BEFORE_EXIT_EVENT, ());

    let handle = app.clone();
    thread::spawn(move || {
        let mut waited = 0;
        while waited < FLUSH_GRACE_MS && !is_shutdown_complete(&handle) {
            thread::sleep(Duration::from_millis(FLUSH_POLL_MS));
            waited += FLUSH_POLL_MS;
        }
        handle
            .state::<ShutdownState>()
            .done
            .store(true, Ordering::SeqCst);
        handle.exit(0);
    });
}

/// The webview reports its buffers are on disk. Sent once, in reply to
/// `BEFORE_EXIT_EVENT`; the waiting thread above finishes the exit.
#[tauri::command]
pub fn lifecycle_flush_complete(app: AppHandle) {
    app.state::<ShutdownState>()
        .done
        .store(true, Ordering::SeqCst);
}
