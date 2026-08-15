import { useEffect, useRef, useState } from 'react'
import { getStorage } from '../platform'
import type { ReadingProgress } from '../platform/types'
import { useLibrary } from '../library/store'
import { createReader, type ReaderHandle } from './renderer'

/** Wait this long after the last page turn before writing progress. */
const SAVE_DEBOUNCE_MS = 400
/** Wait this long after the last resize before re-paginating. */
const RESIZE_DEBOUNCE_MS = 150

export function Reader({ bookId }: { bookId: string }) {
  const closeBook = useLibrary((s) => s.closeBook)
  const book = useLibrary((s) => s.books.find((candidate) => candidate.id === bookId))

  const containerRef = useRef<HTMLDivElement>(null)
  const handleRef = useRef<ReaderHandle | null>(null)
  const [ready, setReady] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [percentage, setPercentage] = useState(0)

  useEffect(() => {
    let cancelled = false
    let handle: ReaderHandle | null = null
    let saveTimer: ReturnType<typeof setTimeout> | undefined
    let unsaved: ReadingProgress | null = null
    // Seeded from storage below, then only ever replaced by a real reading of
    // the percentage — never by the null epub.js reports before its locations
    // are ready.
    let lastKnownPercentage = 0

    async function flush() {
      clearTimeout(saveTimer)
      const progress = unsaved
      unsaved = null
      if (!progress) return
      try {
        await (await getStorage()).saveProgress(progress)
      } catch {
        // Losing one position write is not worth interrupting reading over;
        // the next page turn writes again.
      }
    }

    /** Refresh the shelf only once the last position write has landed. */
    async function flushAndRefreshShelf() {
      await flush()
      await useLibrary.getState().load()
    }

    // epub.js renders pages inside an iframe, so key events raised over the
    // text never reach `window`. The same handler is registered on both.
    function onKeyDown(event: KeyboardEvent) {
      if (event.key === 'ArrowRight' || event.key === 'PageDown') {
        event.preventDefault()
        void handleRef.current?.next()
      } else if (event.key === 'ArrowLeft' || event.key === 'PageUp') {
        event.preventDefault()
        void handleRef.current?.prev()
      } else if (event.key === 'Escape') {
        event.preventDefault()
        closeBook()
      }
    }

    window.addEventListener('keydown', onKeyDown)

    void (async () => {
      try {
        const storage = await getStorage()
        const [data, saved] = await Promise.all([
          storage.readBookFile(bookId),
          storage.getProgress(bookId),
        ])
        if (cancelled || !containerRef.current) return

        // Show the position we already knew about instead of flashing 0%.
        lastKnownPercentage = saved?.percentage ?? 0
        setPercentage(lastKnownPercentage)

        handle = await createReader(containerRef.current, data, saved?.cfi ?? null, {
          onKeyDown,
          onLocation(location) {
            // Leaving the reader before the book finished opening still lets
            // epub.js report its initial position. Writing that would move a
            // saved position back to wherever the first render landed.
            if (cancelled) return
            if (location.percentage !== null) {
              lastKnownPercentage = location.percentage
              setPercentage(location.percentage)
            }
            unsaved = {
              bookId,
              cfi: location.cfi,
              percentage: lastKnownPercentage,
              updatedAt: new Date().toISOString(),
            }
            clearTimeout(saveTimer)
            saveTimer = setTimeout(() => void flush(), SAVE_DEBOUNCE_MS)
          },
        })

        if (cancelled) {
          handle.destroy()
          handle = null
          return
        }
        handleRef.current = handle
        setReady(true)
      } catch (cause) {
        if (!cancelled) setError(cause instanceof Error ? cause.message : String(cause))
      }
    })()

    return () => {
      cancelled = true
      window.removeEventListener('keydown', onKeyDown)
      void flushAndRefreshShelf()
      handleRef.current = null
      handle?.destroy()
    }
  }, [bookId, closeBook])

  // Re-paginate after the window settles, not on every intermediate size.
  useEffect(() => {
    const container = containerRef.current
    if (!container) return

    // Seeded with the size the book is about to be rendered at, because
    // ResizeObserver always fires once on observe. Re-laying out at a size
    // epub.js already used costs a page of accuracy when restoring a CFI.
    let applied = { width: container.clientWidth, height: container.clientHeight }
    let timer: ReturnType<typeof setTimeout> | undefined

    const observer = new ResizeObserver(() => {
      clearTimeout(timer)
      timer = setTimeout(() => {
        const width = container.clientWidth
        const height = container.clientHeight
        if (width === 0 || height === 0) return
        if (width === applied.width && height === applied.height) return
        applied = { width, height }
        handleRef.current?.resize(width, height)
      }, RESIZE_DEBOUNCE_MS)
    })
    observer.observe(container)

    return () => {
      clearTimeout(timer)
      observer.disconnect()
    }
  }, [])

  return (
    <div className="flex h-dvh flex-col bg-neutral-50 text-neutral-900 dark:bg-neutral-950 dark:text-neutral-100">
      <header className="flex shrink-0 items-center gap-4 px-6 pt-9 pb-3">
        <button
          type="button"
          className="rounded-lg border border-neutral-300 px-3 py-1.5 text-sm transition hover:bg-neutral-100 dark:border-neutral-700 dark:hover:bg-neutral-900"
          onClick={closeBook}
        >
          ← Library
        </button>
        <div className="min-w-0 flex-1">
          <p className="truncate text-sm font-medium">{book?.title ?? 'Reading'}</p>
          {book?.author && <p className="truncate text-xs text-neutral-500">{book.author}</p>}
        </div>
        <span className="shrink-0 text-xs tabular-nums text-neutral-500">
          {Math.round(percentage * 100)}%
        </span>
      </header>

      {/*
        The page surface stays light in both colour schemes on purpose: EPUB
        stylesheets set their own (near-black) text colour and epub.js renders
        into a transparent iframe, so a dark surface here is black-on-black.
        Real themes — including a dark page — are their own issue.
      */}
      <div className="relative min-h-0 flex-1 bg-white text-black">
        <div ref={containerRef} className="h-full w-full px-6 pb-6" />

        {!ready && !error && (
          <p className="absolute inset-0 flex items-center justify-center text-sm text-neutral-500">
            Opening book…
          </p>
        )}
        {error && (
          <div className="absolute inset-0 flex flex-col items-center justify-center gap-3 px-6 text-center">
            <p className="text-sm text-red-700 dark:text-red-300">Could not open this book: {error}</p>
            <button type="button" className="text-sm underline" onClick={closeBook}>
              Back to library
            </button>
          </div>
        )}
      </div>

      <footer className="flex shrink-0 items-center justify-center gap-3 pb-5 text-xs text-neutral-500">
        <button
          type="button"
          className="rounded-md px-3 py-1 transition hover:bg-neutral-200 dark:hover:bg-neutral-800"
          onClick={() => void handleRef.current?.prev()}
        >
          ← Previous
        </button>
        <span className="select-none">Arrow keys turn pages · Esc closes</span>
        <button
          type="button"
          className="rounded-md px-3 py-1 transition hover:bg-neutral-200 dark:hover:bg-neutral-800"
          onClick={() => void handleRef.current?.next()}
        >
          Next →
        </button>
      </footer>
    </div>
  )
}
