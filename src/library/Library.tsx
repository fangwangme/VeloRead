import { useRef, useState } from 'react'
import { useLibrary } from './store'
import { BookCover } from './BookCover'
import type { BookRecord } from '../platform/types'

export function Library() {
  const books = useLibrary((s) => s.books)
  const loading = useLibrary((s) => s.loading)
  const importing = useLibrary((s) => s.importing)
  const error = useLibrary((s) => s.error)
  const importFiles = useLibrary((s) => s.importFiles)
  const dismissError = useLibrary((s) => s.dismissError)

  const inputRef = useRef<HTMLInputElement>(null)
  const [dragging, setDragging] = useState(false)

  function onDrop(event: React.DragEvent) {
    event.preventDefault()
    setDragging(false)
    void importFiles(Array.from(event.dataTransfer.files))
  }

  return (
    <div
      className="min-h-dvh bg-neutral-50 text-neutral-900 dark:bg-neutral-950 dark:text-neutral-100"
      onDragOver={(event) => {
        event.preventDefault()
        setDragging(true)
      }}
      onDragLeave={(event) => {
        // dragleave also fires when the pointer moves onto a child element,
        // which would flicker the overlay off and on across the whole shelf.
        if (!event.currentTarget.contains(event.relatedTarget as Node | null)) {
          setDragging(false)
        }
      }}
      onDrop={onDrop}
    >
      <header className="flex items-center justify-between gap-4 px-8 pt-12 pb-6">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">VeloRead</h1>
          <p className="text-sm text-neutral-500">
            {books.length > 0 ? `${books.length} book${books.length > 1 ? 's' : ''}` : 'Your library'}
          </p>
        </div>
        <button
          type="button"
          className="rounded-lg bg-neutral-900 px-4 py-2 text-sm font-medium text-white transition hover:bg-neutral-700 disabled:opacity-50 dark:bg-neutral-100 dark:text-neutral-900 dark:hover:bg-neutral-300"
          disabled={importing !== null}
          onClick={() => inputRef.current?.click()}
        >
          {importing ? `Importing ${importing}…` : 'Add EPUB'}
        </button>
        <input
          ref={inputRef}
          type="file"
          accept=".epub,application/epub+zip"
          multiple
          className="hidden"
          onChange={(event) => {
            void importFiles(Array.from(event.target.files ?? []))
            event.target.value = ''
          }}
        />
      </header>

      {error && (
        <div className="mx-8 mb-6 flex items-start justify-between gap-4 rounded-lg border border-red-300 bg-red-50 px-4 py-3 text-sm text-red-800 dark:border-red-900 dark:bg-red-950 dark:text-red-200">
          <span>{error}</span>
          <button type="button" className="shrink-0 underline" onClick={dismissError}>
            Dismiss
          </button>
        </div>
      )}

      <main className="px-8 pb-16">
        {loading ? (
          <p className="text-sm text-neutral-500">Opening library…</p>
        ) : books.length === 0 ? (
          <EmptyState onPick={() => inputRef.current?.click()} />
        ) : (
          <ul className="grid grid-cols-[repeat(auto-fill,minmax(9rem,1fr))] gap-x-6 gap-y-8">
            {books.map((book) => (
              <BookTile key={book.id} book={book} />
            ))}
          </ul>
        )}
      </main>

      {dragging && (
        <div className="pointer-events-none fixed inset-4 rounded-2xl border-2 border-dashed border-neutral-400 bg-neutral-900/5 dark:bg-neutral-100/5" />
      )}
    </div>
  )
}

function BookTile({ book }: { book: BookRecord }) {
  const openBook = useLibrary((s) => s.openBook)
  const removeBook = useLibrary((s) => s.removeBook)

  return (
    <li className="group relative">
      <button
        type="button"
        className="block w-full cursor-pointer text-left"
        onClick={() => openBook(book.id)}
      >
        <div className="aspect-2/3 w-full overflow-hidden rounded-md bg-neutral-200 shadow-sm transition group-hover:shadow-md dark:bg-neutral-800">
          <BookCover book={book} />
        </div>
        <p className="mt-2 line-clamp-2 text-sm font-medium">{book.title}</p>
        {book.author && <p className="line-clamp-1 text-xs text-neutral-500">{book.author}</p>}
      </button>
      <button
        type="button"
        aria-label={`Delete ${book.title}`}
        className="absolute top-1.5 right-1.5 hidden size-7 rounded-full bg-neutral-900/70 text-sm text-white group-hover:block hover:bg-red-600"
        onClick={() => {
          if (confirm(`Delete "${book.title}" from the library?`)) void removeBook(book.id)
        }}
      >
        ×
      </button>
    </li>
  )
}

function EmptyState({ onPick }: { onPick: () => void }) {
  return (
    <div className="mt-16 flex flex-col items-center gap-3 rounded-2xl border-2 border-dashed border-neutral-300 py-20 text-center dark:border-neutral-700">
      <p className="text-lg font-medium">No books yet</p>
      <p className="max-w-sm text-sm text-neutral-500">
        Drop an <code>.epub</code> anywhere on this window, or pick one from your disk. Books are
        copied into VeloRead's own library folder.
      </p>
      <button
        type="button"
        className="mt-2 rounded-lg border border-neutral-300 px-4 py-2 text-sm font-medium transition hover:bg-neutral-100 dark:border-neutral-700 dark:hover:bg-neutral-900"
        onClick={onPick}
      >
        Choose a file
      </button>
    </div>
  )
}
