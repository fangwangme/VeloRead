import { useMemo, useRef, useState } from 'react'
import { useLibrary } from './store'
import { BookCover } from './BookCover'
import type { AppSettings, BookRecord } from '../platform/types'
import { StatsModal } from '../stats/StatsModal'
import { AppSettingsModal } from '../settings/AppSettingsModal'
import { IconBook, IconClose, IconCollection, IconImport, IconSettings, IconStats } from '../ui/icons'
import { ALL_BOOKS, BookCollectionMenu, CollectionBar, UNFILED } from './CollectionBar'
import { useConfirm } from '../ui/useConfirm'
import { useT } from '../i18n/useT'

const TOOLBAR_BUTTON_CLASS =
  'flex items-center gap-1.5 rounded-full border border-black/[0.12] bg-white/80 px-3.5 py-1.5 text-xs font-medium text-neutral-800 shadow-[0_1px_3px_rgba(0,0,0,0.06)] backdrop-blur-md transition hover:border-black/20 hover:bg-white focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue-500 active:scale-95 disabled:pointer-events-none disabled:opacity-50 dark:border-white/[0.08] dark:bg-white/[0.05] dark:text-neutral-200 dark:hover:bg-white/[0.1]'

export function Library({
  appSettings,
  onAppSettingsChange,
}: {
  appSettings: AppSettings
  onAppSettingsChange: (changes: Partial<AppSettings>) => Promise<void>
}) {
  const books = useLibrary((s) => s.books)
  const collections = useLibrary((s) => s.collections)
  const membership = useLibrary((s) => s.membership)
  const createCollection = useLibrary((s) => s.createCollection)
  const renameCollection = useLibrary((s) => s.renameCollection)
  const removeCollection = useLibrary((s) => s.removeCollection)
  const loading = useLibrary((s) => s.loading)
  const importing = useLibrary((s) => s.importing)
  const error = useLibrary((s) => s.error)
  const importFiles = useLibrary((s) => s.importFiles)
  const dismissError = useLibrary((s) => s.dismissError)

  const inputRef = useRef<HTMLInputElement>(null)
  const [dragging, setDragging] = useState(false)
  const [showStats, setShowStats] = useState(false)
  const [showSettings, setShowSettings] = useState(false)
  const [activeCollection, setActiveCollection] = useState<string>(ALL_BOOKS)
  const { confirm, confirmDialog } = useConfirm()
  const t = useT()

  const visibleBooks = useMemo(() => {
    if (activeCollection === ALL_BOOKS) return books
    if (activeCollection === UNFILED) {
      return books.filter((book) => (membership[book.id]?.length ?? 0) === 0)
    }
    return books.filter((book) => membership[book.id]?.includes(activeCollection))
  }, [activeCollection, books, membership])

  // A collection deleted elsewhere must not leave the shelf filtered to nothing.
  const filterExists =
    activeCollection === ALL_BOOKS ||
    activeCollection === UNFILED ||
    collections.some((collection) => collection.id === activeCollection)
  const effectiveFilter = filterExists ? activeCollection : ALL_BOOKS
  const shelf = filterExists ? visibleBooks : books

  function onDrop(event: React.DragEvent) {
    event.preventDefault()
    setDragging(false)
    void importFiles(Array.from(event.dataTransfer.files))
  }

  return (
    <div
      className="min-h-dvh bg-[#FBFBFA] text-neutral-900 dark:bg-[#121214] dark:text-neutral-100 transition-colors duration-200"
      onDragOver={(event) => {
        event.preventDefault()
        setDragging(true)
      }}
      onDragLeave={(event) => {
        if (!event.currentTarget.contains(event.relatedTarget as Node | null)) {
          setDragging(false)
        }
      }}
      onDrop={onDrop}
    >
      {/* Top Navbar. `data-tauri-drag-region` makes the bar itself behave like a
          title bar — the window has none, since it is drawn with an overlay
          title bar and a hidden title. Tauri only starts a drag when the
          mousedown lands on the element carrying the attribute, so the buttons
          and the file input below stay clickable. */}
      <header
        data-tauri-drag-region
        className="sticky top-0 z-30 flex items-center justify-between gap-4 px-8 pt-8 pb-5 backdrop-blur-md bg-[#FBFBFA]/80 dark:bg-[#121214]/80 border-b border-black/[0.07] dark:border-white/[0.04]"
      >
        <div data-tauri-drag-region>
          <h1 data-tauri-drag-region className="text-xl font-bold tracking-tight">
            {t('library.title')}
          </h1>
          {books.length > 0 && (
            <p className="mt-0.5 text-xs font-medium text-neutral-500 dark:text-neutral-400">
              {t.plural('library.bookCount', books.length)}
            </p>
          )}
        </div>
        <div className="flex items-center gap-2.5">
          <button
            type="button"
            className={TOOLBAR_BUTTON_CLASS}
            disabled={importing !== null}
            onClick={() => inputRef.current?.click()}
            title={
              importing
                ? t('library.importingHint', { name: importing })
                : t('library.importHint')
            }
          >
            <IconImport className="opacity-75" />
            <span>{t(importing ? 'library.importing' : 'library.import')}</span>
          </button>
          <button
            type="button"
            className={TOOLBAR_BUTTON_CLASS}
            onClick={() => setShowStats(true)}
            title={t('library.statsHint')}
          >
            <IconStats className="opacity-75" />
            <span>{t('library.stats')}</span>
          </button>
          <button
            type="button"
            className={TOOLBAR_BUTTON_CLASS}
            onClick={() => setShowSettings(true)}
            title={t('library.settingsHint')}
          >
            <IconSettings className="opacity-75" />
            <span>{t('library.settings')}</span>
          </button>
        </div>
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
        <div aria-live="polite" className="mx-8 mt-4 flex items-start justify-between gap-4 rounded-2xl border border-red-200 bg-red-50/80 px-4 py-3 text-xs text-red-800 dark:border-red-900/60 dark:bg-red-950/40 dark:text-red-300">
          <span>{t(error.key, error.values)}</span>
          <button type="button" className="shrink-0 underline font-medium" onClick={dismissError}>
            {t('library.dismissError')}
          </button>
        </div>
      )}

      {books.length > 0 && (
        <div className="px-8 pt-5">
          <CollectionBar
            collections={collections}
            membership={membership}
            books={books}
            activeId={effectiveFilter}
            onSelect={setActiveCollection}
            onCreate={(name) => void createCollection(name)}
            onRename={(id, name) => void renameCollection(id, name)}
            onDelete={(id) => {
              const collection = collections.find((item) => item.id === id)
              if (!collection) return
              void (async () => {
                const ok = await confirm({
                  title: t('collections.confirmDelete.title', { name: collection.name }),
                  body: t('collections.confirmDelete.body'),
                  confirmLabel: t('collections.confirmDelete.confirm'),
                  cancelLabel: t('common.cancel'),
                })
                if (ok) void removeCollection(id)
              })()
            }}
          />
        </div>
      )}

      {/* Main Bookshelf Grid */}
      <main className="px-8 pt-6 pb-20">
        {loading ? (
          <div className="flex items-center justify-center py-32 text-xs text-neutral-500 dark:text-neutral-400">
            {t('library.loading')}
          </div>
        ) : books.length === 0 ? (
          <EmptyState onPick={() => inputRef.current?.click()} />
        ) : shelf.length === 0 ? (
          <div className="py-24 text-center text-xs text-neutral-500 dark:text-neutral-400">
            {t('library.emptyCollection')}
          </div>
        ) : (
          <ul className="grid grid-cols-[repeat(auto-fill,minmax(9.5rem,1fr))] gap-x-7 gap-y-9">
            {shelf.map((book) => (
              <BookTile key={book.id} book={book} />
            ))}
          </ul>
        )}
      </main>

      {dragging && (
        <div className="pointer-events-none fixed inset-4 z-40 rounded-3xl border-2 border-dashed border-blue-500/80 bg-blue-500/[0.06] backdrop-blur-xs flex items-center justify-center">
          <div className="rounded-2xl bg-white/90 dark:bg-neutral-900/90 px-6 py-3 shadow-xl text-xs font-semibold text-blue-600 dark:text-blue-400">
            {t('library.dropHint')}
          </div>
        </div>
      )}

      {showStats && (
        <StatsModal
          dailyGoalMinutes={appSettings.dailyReadingGoalMinutes ?? 15}
          onClose={() => setShowStats(false)}
        />
      )}
      {showSettings && (
        <AppSettingsModal
          settings={appSettings}
          onChange={onAppSettingsChange}
          onClose={() => setShowSettings(false)}
        />
      )}
      {confirmDialog}
    </div>
  )
}

function BookTile({ book }: { book: BookRecord }) {
  const collections = useLibrary((s) => s.collections)
  const membership = useLibrary((s) => s.membership)
  const setBookCollections = useLibrary((s) => s.setBookCollections)
  const [menuOpen, setMenuOpen] = useState(false)
  const selected = membership[book.id] ?? []
  const openBook = useLibrary((s) => s.openBook)
  const removeBook = useLibrary((s) => s.removeBook)
  const { confirm, confirmDialog } = useConfirm()
  const t = useT()

  return (
    <li className="group relative">
      <button
        type="button"
        className="block w-full cursor-pointer rounded-lg text-left focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-blue-500"
        onClick={() => openBook(book.id)}
      >
        <div className="aspect-2/3 w-full rounded-lg shadow-[0_6px_18px_rgba(0,0,0,0.12),0_1px_3px_rgba(0,0,0,0.06)] transition-[transform,box-shadow] duration-200 group-hover:-translate-y-1.5 group-hover:shadow-[0_16px_32px_rgba(0,0,0,0.18),0_2px_6px_rgba(0,0,0,0.08)] motion-reduce:transition-none">
          <BookCover book={book} />
        </div>
        <p className="mt-2.5 line-clamp-2 text-xs font-semibold leading-snug tracking-tight text-neutral-800 dark:text-neutral-200 group-hover:text-blue-600 dark:group-hover:text-blue-400 transition">
          {book.title}
        </p>
        {book.author && (
          <p className="mt-0.5 line-clamp-1 text-[11px] text-neutral-500 dark:text-neutral-400">
            {book.author}
          </p>
        )}
      </button>

      {/* Hover actions: file into collections, or remove from the library */}
      <div className="absolute right-2 top-2 flex items-center gap-1">
        <button
          type="button"
          aria-label={t('library.tile.addToCollectionsLabel', { title: book.title })}
          title={t('library.tile.addToCollections')}
          aria-expanded={menuOpen}
          className={`size-6 items-center justify-center rounded-full bg-black/60 text-white shadow-sm backdrop-blur-md transition hover:bg-black/80 focus-visible:flex focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue-500 group-focus-within:flex group-hover:flex ${
            menuOpen ? 'flex' : 'hidden'
          }`}
          onClick={(e) => {
            e.stopPropagation()
            setMenuOpen((open) => !open)
          }}
        >
          <IconCollection width={12} height={12} />
        </button>
      </div>

      {menuOpen && (
        <BookCollectionMenu
          book={book}
          collections={collections}
          selected={selected}
          onToggle={(collectionId, next) => {
            const ids = next
              ? [...selected, collectionId]
              : selected.filter((id) => id !== collectionId)
            void setBookCollections(book.id, ids)
          }}
          onClose={() => setMenuOpen(false)}
        />
      )}

      {/* Quick delete button */}
      <button
        type="button"
        aria-label={t('library.tile.deleteLabel', { title: book.title })}
        className="absolute right-2 top-9 hidden size-6 items-center justify-center rounded-full bg-black/60 text-xs text-white shadow-sm backdrop-blur-md transition hover:bg-red-600 focus-visible:flex focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-red-500 group-focus-within:flex group-hover:flex"
        onClick={(e) => {
          e.stopPropagation()
          void (async () => {
            const ok = await confirm({
              title: t('library.confirmDelete.title', { title: book.title }),
              body: t('library.confirmDelete.body'),
              confirmLabel: t('library.confirmDelete.confirm'),
              cancelLabel: t('common.cancel'),
            })
            if (ok) void removeBook(book.id)
          })()
        }}
      >
        <IconClose width={12} height={12} />
      </button>
      {confirmDialog}
    </li>
  )
}

function EmptyState({ onPick }: { onPick: () => void }) {
  const t = useT()

  return (
    <div className="mt-12 flex flex-col items-center justify-center gap-3 rounded-3xl border border-dashed border-black/[0.12] dark:border-white/[0.08] bg-black/[0.02] dark:bg-white/[0.01] py-24 text-center px-6">
      <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-black/[0.06] dark:bg-white/[0.06] text-neutral-500 dark:text-neutral-400 mb-1">
        <IconBook className="size-5" />
      </div>
      <p className="text-sm font-semibold tracking-tight text-neutral-800 dark:text-neutral-200">
        {t('library.empty.title')}
      </p>
      <p className="max-w-xs text-xs text-neutral-500 dark:text-neutral-400 leading-relaxed">
        {t('library.empty.body')}
      </p>
      <button
        type="button"
        className="mt-2 rounded-full border border-black/[0.14] dark:border-white/[0.1] bg-white dark:bg-neutral-800 px-4 py-2 text-xs font-medium text-neutral-800 dark:text-neutral-200 shadow-2xs transition hover:bg-neutral-50 dark:hover:bg-neutral-700 active:scale-95"
        onClick={onPick}
      >
        {t('library.empty.pick')}
      </button>
    </div>
  )
}
