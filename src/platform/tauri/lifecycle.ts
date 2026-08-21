import { invoke } from '@tauri-apps/api/core'
import { listen } from '@tauri-apps/api/event'
import type { LifecyclePort } from '../types'

/** Must match `BEFORE_EXIT_EVENT` in `src-tauri/src/lifecycle.rs`. */
const BEFORE_EXIT_EVENT = 'veloread://before-exit'

/**
 * Desktop implementation of `LifecyclePort`.
 *
 * Quitting is a handshake with the Rust side rather than a webview event: Tauri
 * holds the shutdown, this asks every handler to finish, and then reports back.
 * Rust gives up on us after a grace period, so a stuck handler costs a moment on
 * quit and never a window that will not close.
 *
 * One listener for the whole app, not one per subscriber: the reply must be sent
 * exactly once, and it must be sent even when nothing is subscribed — otherwise
 * quitting from the library would sit through the full grace period.
 */
export function createTauriLifecycle(): LifecyclePort {
  const handlers = new Set<() => Promise<void>>()

  void listen(BEFORE_EXIT_EVENT, async () => {
    try {
      await Promise.all([...handlers].map((handler) => handler().catch(() => undefined)))
    } finally {
      await invoke('lifecycle_flush_complete').catch(() => undefined)
    }
  })

  return {
    onBeforeExit(handler) {
      handlers.add(handler)
      return () => {
        handlers.delete(handler)
      }
    },
  }
}
