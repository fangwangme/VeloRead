import JSZip from 'jszip'
import type { ExportFile, ExportResult, FsPort } from '../types'

/**
 * Browser implementation of `FsPort`.
 *
 * A page cannot write a folder, so several files leave as one zip. It also
 * cannot learn where the browser put them — `location` is therefore a label the
 * caller shows, not a path, and `revealable` is false.
 */
export function createWebFs(): FsPort {
  return {
    async exportTextFiles(files: ExportFile[], bundleName: string): Promise<ExportResult> {
      if (files.length === 0) throw new Error('nothing to export')

      if (files.length === 1) {
        download(new Blob([files[0].text], { type: 'text/plain;charset=utf-8' }), files[0].name)
        return { location: files[0].name, revealable: false }
      }

      const zip = new JSZip()
      for (const file of files) zip.file(file.name, file.text)
      const archive = `${bundleName}.zip`
      download(await zip.generateAsync({ type: 'blob' }), archive)
      return { location: archive, revealable: false }
    },

    async reveal() {
      // A page has no file manager to talk to.
    },
  }
}

function download(blob: Blob, name: string) {
  const url = URL.createObjectURL(blob)
  const link = document.createElement('a')
  link.href = url
  link.download = name
  document.body.append(link)
  link.click()
  link.remove()
  // Freed on the next turn: revoking synchronously can cancel the download in
  // some browsers before it has read the blob.
  setTimeout(() => URL.revokeObjectURL(url), 10_000)
}
