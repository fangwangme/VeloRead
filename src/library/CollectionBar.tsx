import { useEffect, useRef, useState } from 'react'
import type { BookRecord, Collection } from '../platform/types'
import { IconPlus, IconTrash } from '../ui/icons'
import { useT } from '../i18n/useT'
import type { Translate } from '../i18n/types'

export const ALL_BOOKS = '__all__'
export const UNFILED = '__unfiled__'

interface CollectionBarProps {
  collections: Collection[]
  membership: Record<string, string[]>
  books: BookRecord[]
  activeId: string
  onSelect: (id: string) => void
  onCreate: (name: string) => void
  onRename: (id: string, name: string) => void
  onDelete: (id: string) => void
}

/**
 * Shelf filter. Collections are optional organisation, so All always exists and
 * Unfiled only appears when something is actually unfiled — an empty bucket the
 * user can never fill is noise.
 */
export function CollectionBar({
  collections,
  membership,
  books,
  activeId,
  onSelect,
  onCreate,
  onRename,
  onDelete,
}: CollectionBarProps) {
  const [creating, setCreating] = useState(false)
  const [draft, setDraft] = useState('')
  const [editingId, setEditingId] = useState<string | null>(null)
  const [editDraft, setEditDraft] = useState('')
  const inputRef = useRef<HTMLInputElement>(null)
  const editRef = useRef<HTMLInputElement>(null)
  const t = useT()

  useEffect(() => {
    if (creating) inputRef.current?.focus()
  }, [creating])

  useEffect(() => {
    if (editingId) editRef.current?.focus()
  }, [editingId])

  const counts = new Map<string, number>()
  let unfiled = 0
  for (const book of books) {
    const ids = membership[book.id] ?? []
    if (ids.length === 0) unfiled += 1
    for (const id of ids) counts.set(id, (counts.get(id) ?? 0) + 1)
  }

  const commitCreate = () => {
    const name = draft.trim()
    if (name) onCreate(name)
    setDraft('')
    setCreating(false)
  }

  const commitRename = (id: string) => {
    const name = editDraft.trim()
    if (name) onRename(id, name)
    setEditingId(null)
  }

  return (
    <div className="flex flex-wrap items-center gap-1.5" role="group" aria-label={t('collections.filterLabel')}>
      <Chip
        label={t('collections.all')}
        count={books.length}
        active={activeId === ALL_BOOKS}
        onSelect={() => onSelect(ALL_BOOKS)}
        t={t}
      />
      {unfiled > 0 && (
        <Chip
          label={t('collections.unfiled')}
          count={unfiled}
          active={activeId === UNFILED}
          onSelect={() => onSelect(UNFILED)}
          t={t}
        />
      )}

      {collections.map((collection) =>
        editingId === collection.id ? (
          <input
            key={collection.id}
            ref={editRef}
            value={editDraft}
            onChange={(event) => setEditDraft(event.target.value)}
            onBlur={() => commitRename(collection.id)}
            onKeyDown={(event) => {
              if (event.key === 'Enter') commitRename(collection.id)
              if (event.key === 'Escape') setEditingId(null)
            }}
            aria-label={t('collections.renameLabel', { name: collection.name })}
            className="w-28 rounded-full border border-blue-500 bg-white px-3 py-1.5 text-xs outline-none dark:bg-[#1C1C1E]"
          />
        ) : (
          <Chip
            key={collection.id}
            label={collection.name}
            count={counts.get(collection.id) ?? 0}
            active={activeId === collection.id}
            onSelect={() => onSelect(collection.id)}
            t={t}
            onRename={() => {
              setEditDraft(collection.name)
              setEditingId(collection.id)
            }}
            onDelete={() => onDelete(collection.id)}
          />
        ),
      )}

      {creating ? (
        <input
          ref={inputRef}
          value={draft}
          onChange={(event) => setDraft(event.target.value)}
          onBlur={commitCreate}
          onKeyDown={(event) => {
            if (event.key === 'Enter') commitCreate()
            if (event.key === 'Escape') {
              setDraft('')
              setCreating(false)
            }
          }}
          placeholder={t('collections.namePlaceholder')}
          aria-label={t('collections.newNameLabel')}
          className="w-28 rounded-full border border-blue-500 bg-white px-3 py-1.5 text-xs outline-none dark:bg-[#1C1C1E]"
        />
      ) : (
        <button
          type="button"
          onClick={() => setCreating(true)}
          className="flex items-center gap-1 rounded-full border border-dashed border-black/15 px-3 py-1.5 text-xs font-medium text-neutral-500 transition hover:border-black/30 hover:text-neutral-800 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue-500 dark:border-white/15 dark:text-neutral-400 dark:hover:border-white/30 dark:hover:text-neutral-200"
        >
          <IconPlus />
          <span>{t('collections.new')}</span>
        </button>
      )}
    </div>
  )
}

function Chip({
  label,
  count,
  active,
  onSelect,
  onRename,
  onDelete,
  t,
}: {
  label: string
  count: number
  active: boolean
  onSelect: () => void
  onRename?: () => void
  onDelete?: () => void
  t: Translate
}) {
  return (
    <span
      className={`group inline-flex items-center rounded-full border text-xs font-medium transition ${
        active
          ? 'border-blue-500 bg-blue-500/10 text-blue-600 dark:text-blue-400'
          : 'border-black/[0.08] bg-white/70 text-neutral-600 hover:border-black/20 dark:border-white/[0.08] dark:bg-white/[0.04] dark:text-neutral-300 dark:hover:border-white/25'
      }`}
    >
      <button
        type="button"
        onClick={onSelect}
        onDoubleClick={onRename}
        title={onRename ? t('collections.chipHint', { name: label }) : label}
        className="rounded-full px-3 py-1.5 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue-500"
      >
        {label}
        <span className="ml-1.5 font-mono text-[10px] opacity-50">{count}</span>
      </button>
      {onDelete && (
        <button
          type="button"
          onClick={() => onDelete()}
          aria-label={t('collections.deleteLabel', { name: label })}
          title={t('collections.deleteHint')}
          className="mr-1.5 flex size-5 items-center justify-center rounded-full text-neutral-400 opacity-0 transition hover:bg-red-500/10 hover:text-red-600 focus-visible:opacity-100 focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-red-500 group-focus-within:opacity-100 group-hover:opacity-100 dark:hover:text-red-400"
        >
          <IconTrash width={11} height={11} />
        </button>
      )}
    </span>
  )
}

interface BookCollectionMenuProps {
  book: BookRecord
  collections: Collection[]
  selected: string[]
  onToggle: (collectionId: string, next: boolean) => void
  onClose: () => void
}

/** Per-book membership picker, opened from the tile. */
export function BookCollectionMenu({
  book,
  collections,
  selected,
  onToggle,
  onClose,
}: BookCollectionMenuProps) {
  const panelRef = useRef<HTMLDivElement>(null)
  const t = useT()

  useEffect(() => {
    const onPointerDown = (event: MouseEvent) => {
      if (panelRef.current && !panelRef.current.contains(event.target as Node)) onClose()
    }
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose()
    }
    document.addEventListener('mousedown', onPointerDown)
    document.addEventListener('keydown', onKeyDown)
    return () => {
      document.removeEventListener('mousedown', onPointerDown)
      document.removeEventListener('keydown', onKeyDown)
    }
  }, [onClose])

  return (
    <div
      ref={panelRef}
      role="dialog"
      aria-label={t('collections.menuLabel', { title: book.title })}
      className="absolute right-0 top-8 z-30 w-44 rounded-2xl border border-black/[0.08] bg-white/97 p-1.5 shadow-[0_18px_40px_rgba(0,0,0,0.18)] backdrop-blur-2xl vr-animate-pop dark:border-white/[0.08] dark:bg-[#1C1C1E]/97"
    >
      {collections.length === 0 ? (
        <p className="px-2.5 py-3 text-center text-[11px] leading-relaxed text-neutral-400">
          {t('collections.menuEmpty')}
          <br />
          {t('collections.menuEmptyHint')}
        </p>
      ) : (
        <ul className="max-h-56 overflow-y-auto">
          {collections.map((collection) => {
            const checked = selected.includes(collection.id)
            return (
              <li key={collection.id}>
                <label className="flex cursor-pointer items-center gap-2 rounded-xl px-2.5 py-1.5 text-[11px] transition hover:bg-black/[0.04] dark:hover:bg-white/[0.06]">
                  <input
                    type="checkbox"
                    checked={checked}
                    onChange={(event) => onToggle(collection.id, event.target.checked)}
                    className="size-3.5 accent-blue-600"
                  />
                  <span className="line-clamp-1 text-neutral-700 dark:text-neutral-300">
                    {collection.name}
                  </span>
                </label>
              </li>
            )
          })}
        </ul>
      )}
    </div>
  )
}
