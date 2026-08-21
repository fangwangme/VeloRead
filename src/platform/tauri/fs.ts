import { invoke } from '@tauri-apps/api/core'
import type { ExportFile, ExportResult, FsPort } from '../types'

/**
 * Tauri implementation of `FsPort`.
 *
 * Path construction and every write live in Rust (`src-tauri/src/exports.rs`);
 * this module only marshals across IPC, the same rule the storage port follows.
 */
export function createTauriFs(): FsPort {
  return {
    async exportTextFiles(files: ExportFile[], bundleName: string): Promise<ExportResult> {
      const location = await invoke<string>('export_text_files', { files, bundleName })
      return { location, revealable: true }
    },

    reveal(location: string) {
      return invoke<void>('reveal_path', { path: location })
    },
  }
}
