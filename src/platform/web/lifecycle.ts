import type { LifecyclePort } from '../types'

/**
 * Browser implementation of `LifecyclePort`.
 *
 * A page cannot delay its own unload, so the handlers get whatever the browser
 * gives them. `pagehide` is the reliable one on iOS and in the back/forward
 * cache; `beforeunload` covers a plain tab close. Both can fire for one exit, so
 * a handler has to be safe to run twice — flushing a queued write already is.
 */
export function createWebLifecycle(): LifecyclePort {
  return {
    onBeforeExit(handler) {
      const run = () => {
        void handler().catch(() => undefined)
      }
      window.addEventListener('pagehide', run)
      window.addEventListener('beforeunload', run)
      return () => {
        window.removeEventListener('pagehide', run)
        window.removeEventListener('beforeunload', run)
      }
    },
  }
}
