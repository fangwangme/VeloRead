import ePub from 'epubjs'
import type { Book, Contents, Rendition } from 'epubjs'

export interface ReaderLocation {
  /** CFI of the first visible position on the current page. */
  cfi: string
  /**
   * 0–1, or null while epub.js is still generating locations in the
   * background. Null means "not known yet", never "at the beginning" — a
   * caller that persists it as 0 would walk a saved percentage back to zero
   * every time the book is opened.
   */
  percentage: number | null
  atStart: boolean
  atEnd: boolean
}

export interface ReaderOptions {
  /** Fired on every page turn, and once for the initial display. */
  onLocation?: (location: ReaderLocation) => void
  /**
   * Key events from inside the book iframe. epub.js renders pages into an
   * iframe, so window-level listeners never see them — the reader UI binds
   * both this and its own window handler.
   */
  onKeyDown?: (event: KeyboardEvent) => void
}

export interface ReaderHandle {
  next(): Promise<void>
  prev(): Promise<void>
  /** Re-layout at the given pixel size after the container changed. */
  resize(width: number, height: number): void
  destroy(): void
}

/**
 * The single place that talks to epub.js.
 *
 * epub.js has known CFI and pagination rough edges; keeping every call behind
 * this module is what makes swapping the rendering layer a contained decision
 * later on.
 */
export async function createReader(
  container: HTMLElement,
  data: Uint8Array,
  startCfi: string | null,
  options: ReaderOptions = {},
): Promise<ReaderHandle> {
  const book: Book = ePub(detach(data))
  const rendition: Rendition = book.renderTo(container, {
    width: '100%',
    height: '100%',
    flow: 'paginated',
    spread: 'none',
    // Book content is untrusted HTML; it has no reason to run scripts.
    allowScriptedContent: false,
  })

  const onKeyDown = options.onKeyDown
  if (onKeyDown) {
    rendition.hooks.content.register((contents: Contents) => {
      contents.document.addEventListener('keydown', onKeyDown as EventListener)
    })
  }

  // epub.js fills `book.locations` incrementally, so a non-empty list does not
  // mean the current CFI is in it yet — `percentageFromCfi` answers a truthful
  // looking 0 for anything it has not indexed. Only readings taken after
  // generation has finished can be trusted.
  let locationsReady = false

  rendition.on('relocated', (location: RelocatedEvent) => {
    options.onLocation?.({
      cfi: location.start.cfi,
      percentage: locationsReady ? percentageOf(book, location.start.cfi) : null,
      atStart: Boolean(location.atStart),
      atEnd: Boolean(location.atEnd),
    })
  })

  // `display(undefined)` opens the first page, which is what a fresh book wants.
  await rendition.display(startCfi ?? undefined)

  // Locations power the progress percentage and are expensive on a long book,
  // so they are generated after the first page is already on screen. A failure
  // here only costs the percentage, never the reading position.
  let destroyed = false
  void book.locations
    .generate(1000)
    .then(() => {
      if (destroyed) return
      locationsReady = true
      const current = rendition.location
      if (current?.start?.cfi) {
        options.onLocation?.({
          cfi: current.start.cfi,
          percentage: percentageOf(book, current.start.cfi),
          atStart: Boolean(current.atStart),
          atEnd: Boolean(current.atEnd),
        })
      }
    })
    .catch(() => {
      // The percentage stays unknown; the reading position is unaffected.
    })

  return {
    next: () => rendition.next(),
    prev: () => rendition.prev(),
    resize: (width, height) => rendition.resize(width, height),
    destroy() {
      destroyed = true
      rendition.destroy()
      book.destroy()
    },
  }
}

function percentageOf(book: Book, cfi: string): number | null {
  if (book.locations.length() === 0) return null
  const value = book.locations.percentageFromCfi(cfi)
  return Number.isFinite(value) ? value : null
}

/** epub.js wants a standalone ArrayBuffer, not a view into a shared one. */
function detach(bytes: Uint8Array): ArrayBuffer {
  return bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer
}

/**
 * epub.js ships no type for the `relocated` payload, only for `Location`
 * itself, so the shape this module relies on is spelled out here.
 */
interface RelocatedEvent {
  start: { cfi: string }
  atStart?: boolean
  atEnd?: boolean
}
