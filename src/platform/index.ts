import type { DictPort, FsPort, LifecyclePort, StoragePort } from './types'

/**
 * True inside the Tauri webview. Tauri v2 injects `__TAURI_INTERNALS__` before
 * any app script runs, so this is safe to call at module scope.
 */
export function isTauri(): boolean {
  return typeof window !== 'undefined' && '__TAURI_INTERNALS__' in window
}

let storage: Promise<StoragePort> | null = null

/**
 * The storage implementation for the current runtime, initialised once.
 *
 * The two implementations are behind dynamic imports so the web bundle never
 * pulls in `@tauri-apps/api` and vice versa.
 */
export function getStorage(): Promise<StoragePort> {
  if (!storage) {
    storage = (isTauri()
      ? import('./tauri/storage').then((m) => m.createTauriStorage())
      : import('./web/storage').then((m) => m.createWebStorage())
    ).then(async (port) => {
      await port.init()
      return port
    })
    // Don't cache a failed init: let the next caller retry.
    storage.catch(() => {
      storage = null
    })
  }
  return storage
}

let fs: Promise<FsPort> | null = null

/** The filesystem implementation for the current runtime. */
export function getFs(): Promise<FsPort> {
  if (!fs) {
    fs = isTauri()
      ? import('./tauri/fs').then((m) => m.createTauriFs())
      : import('./web/fs').then((m) => m.createWebFs())
    fs.catch(() => {
      fs = null
    })
  }
  return fs
}

let dict: Promise<DictPort> | null = null

/**
 * The dictionary and vocabulary implementation for the current runtime,
 * initialised once.
 *
 * `init()` is where the desktop folds a waiting `dictionary.json` into its
 * SQLite file, which can take a moment the first time and never again — so it
 * happens here, once, rather than on the first word anybody selects. A failure
 * is not cached: the browser has no dictionary to begin with, and the reader
 * must not lose the vocabulary list because one import went wrong.
 */
export function getDict(): Promise<DictPort> {
  if (!dict) {
    dict = (isTauri()
      ? import('./tauri/dict').then((m) => m.createTauriDict())
      : import('./web/dict').then((m) => m.createWebDict())
    ).then(async (port) => {
      await port.init()
      return port
    })
    dict.catch(() => {
      dict = null
    })
  }
  return dict
}

let lifecycle: Promise<LifecyclePort> | null = null

/**
 * The shutdown hook for the current runtime.
 *
 * Worth creating early even with nothing subscribed: on the desktop the port
 * owns the single listener that answers Rust's "are you flushed?", and an app
 * that never creates it makes every quit wait out the grace period.
 */
export function getLifecycle(): Promise<LifecyclePort> {
  if (!lifecycle) {
    lifecycle = isTauri()
      ? import('./tauri/lifecycle').then((m) => m.createTauriLifecycle())
      : import('./web/lifecycle').then((m) => m.createWebLifecycle())
    lifecycle.catch(() => {
      lifecycle = null
    })
  }
  return lifecycle
}

export type {
  BookRecord,
  BookImport,
  DictEntry,
  DictLookup,
  DictPort,
  DictStatus,
  ExportFile,
  ExportResult,
  FsPort,
  LifecyclePort,
  ReadingProgress,
  StoragePort,
  VocabularyEntry,
  VocabularyLookup,
  VocabularyLookupInput,
  VocabularyStatus,
  VocabularyWord,
} from './types'
