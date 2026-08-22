import { useEffect, useMemo, useState } from 'react'
import { getDict, getFs, getStorage } from '../platform'
import type { BookRecord, DictStatus, VocabularyEntry } from '../platform/types'
import { useModalDialog } from '../ui/useModalDialog'
import { useConfirm } from '../ui/useConfirm'
import { useT } from '../i18n/useT'
import { IconClose, IconTrash, IconVocabulary } from '../ui/icons'
import { lookupCandidates } from './lemma'
import { formatVocabulary, VOCABULARY_FILE_NAME, type VocabularyExportEntry } from './export'

type Phase =
  | { name: 'loading' }
  | { name: 'ready' }
  | { name: 'exporting' }
  | { name: 'exported'; location: string; revealable: boolean }
  | { name: 'failed'; message: string }

const ALL_BOOKS = '__all__'
/** Sentences whose book has been removed. They keep their value; the source is gone. */
const NO_BOOK = '__none__'

/**
 * The vocabulary list: every word looked up, with the sentences it was met in.
 *
 * Filed with the library rather than inside a book, beside reading stats and
 * settings, because vocabulary crosses books — the whole reason the sentences
 * live in their own table is that one word turns up in three of them.
 */
export function VocabularyModal({ onClose }: { onClose: () => void }) {
  const t = useT()
  const dialogRef = useModalDialog<HTMLDivElement>(onClose)
  const { confirm, confirmDialog } = useConfirm()
  const [entries, setEntries] = useState<VocabularyEntry[]>([])
  const [books, setBooks] = useState<Record<string, BookRecord>>({})
  const [dictionary, setDictionary] = useState<DictStatus | null>(null)
  const [filter, setFilter] = useState<string>(ALL_BOOKS)
  const [phase, setPhase] = useState<Phase>({ name: 'loading' })

  useEffect(() => {
    let cancelled = false
    void (async () => {
      try {
        const [dict, storage] = await Promise.all([getDict(), getStorage()])
        const [list, shelf, status] = await Promise.all([
          dict.listVocabulary(),
          storage.listBooks(),
          dict.status(),
        ])
        if (cancelled) return
        setEntries(list)
        setBooks(Object.fromEntries(shelf.map((book) => [book.id, book])))
        setDictionary(status)
        setPhase({ name: 'ready' })
      } catch (cause) {
        if (!cancelled) setPhase({ name: 'failed', message: message(cause) })
      }
    })()
    return () => {
      cancelled = true
    }
  }, [])

  /** Books that actually contributed a word, so the filter has no dead options. */
  const sources = useMemo(() => {
    const ids = new Set<string>()
    let orphans = false
    for (const entry of entries) {
      for (const lookup of entry.lookups) {
        if (lookup.bookId) ids.add(lookup.bookId)
        else orphans = true
      }
    }
    return { ids: [...ids], orphans }
  }, [entries])

  const visible = useMemo(() => {
    if (filter === ALL_BOOKS) return entries
    return entries.filter((entry) =>
      entry.lookups.some((lookup) =>
        filter === NO_BOOK ? lookup.bookId === null : lookup.bookId === filter,
      ),
    )
  }, [entries, filter])

  const remove = async (entry: VocabularyEntry) => {
    const confirmed = await confirm({
      title: t('vocab.confirmDelete.title', { word: entry.word.word }),
      body: t('vocab.confirmDelete.body'),
      confirmLabel: t('vocab.confirmDelete.confirm'),
      cancelLabel: t('common.cancel'),
    })
    if (!confirmed) return
    setEntries((current) => current.filter((item) => item.word.id !== entry.word.id))
    try {
      await (await getDict()).deleteWord(entry.word.id)
    } catch (cause) {
      setPhase({ name: 'failed', message: message(cause) })
    }
  }

  /**
   * Always the whole list, never only what the filter shows: an export is a
   * backup of the data, and one that silently dropped most of it would be worse
   * than none. Definitions are fetched here rather than stored on the rows —
   * the dictionary already holds them (see `export.ts`).
   */
  const exportAll = async () => {
    setPhase({ name: 'exporting' })
    try {
      const dict = await getDict()
      const withDefinitions: VocabularyExportEntry[] = await Promise.all(
        entries.map(async (entry) => ({
          ...entry,
          definition: (await dict.lookup(lookupCandidates(entry.word.stem))).entry?.definition ?? null,
        })),
      )
      const text = formatVocabulary({
        entries: withDefinitions,
        books,
        exportedAt: new Date().toISOString(),
      })
      const result = await (await getFs()).exportTextFiles(
        [{ name: VOCABULARY_FILE_NAME, text }],
        'VeloRead Vocabulary',
      )
      setPhase({ name: 'exported', ...result })
    } catch (cause) {
      setPhase({ name: 'failed', message: message(cause) })
    }
  }

  const totalLookups = entries.reduce((sum, entry) => sum + entry.lookups.length, 0)

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div
        className="fixed inset-0 bg-black/35 backdrop-blur-sm vr-animate-fade"
        onClick={onClose}
        aria-hidden="true"
      />
      <div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby="vocab-title"
        tabIndex={-1}
        className="relative z-10 flex max-h-[85vh] w-full max-w-2xl flex-col rounded-3xl border border-black/[0.08] bg-white/96 p-6 shadow-[0_30px_70px_rgba(0,0,0,0.22)] backdrop-blur-3xl vr-animate-pop dark:border-white/[0.08] dark:bg-[#1C1C1E]/96 dark:text-neutral-100"
      >
        <div className="flex items-start justify-between gap-3">
          <div className="flex items-center gap-3">
            <span className="flex size-9 items-center justify-center rounded-xl bg-blue-500/10 text-blue-600 dark:bg-blue-400/15 dark:text-blue-400">
              <IconVocabulary />
            </span>
            <div>
              <h2 id="vocab-title" className="text-base font-semibold tracking-tight">
                {t('vocab.title')}
              </h2>
              <p className="mt-0.5 text-xs text-neutral-500 dark:text-neutral-400">
                {phase.name === 'loading'
                  ? t('vocab.loading')
                  : `${t.plural('vocab.wordCount', entries.length)} · ${t.plural(
                      'vocab.lookupCount',
                      totalLookups,
                    )}`}
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label={t('common.close')}
            className="flex size-8 shrink-0 items-center justify-center rounded-full text-neutral-500 transition hover:bg-black/5 hover:text-neutral-700 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue-500 dark:text-neutral-400 dark:hover:bg-white/10"
          >
            <IconClose />
          </button>
        </div>

        <div className="mt-4 flex flex-wrap items-center justify-between gap-2">
          <label className="flex items-center gap-2 text-[11px] text-neutral-500 dark:text-neutral-400">
            <span>{t('vocab.filterLabel')}</span>
            <select
              value={filter}
              onChange={(event) => setFilter(event.target.value)}
              className="rounded-lg border border-black/[0.12] bg-black/[0.03] px-2 py-1 text-[11px] text-neutral-700 outline-none focus-visible:border-blue-500 dark:border-white/[0.10] dark:bg-white/[0.05] dark:text-neutral-200"
            >
              <option value={ALL_BOOKS}>{t('vocab.filterAll')}</option>
              {sources.ids.map((id) => (
                <option key={id} value={id}>
                  {books[id]?.title ?? t('vocab.filterUnknownBook')}
                </option>
              ))}
              {sources.orphans && (
                <option value={NO_BOOK}>{t('vocab.filterUnknownBook')}</option>
              )}
            </select>
          </label>

          <button
            type="button"
            onClick={() => void exportAll()}
            disabled={phase.name !== 'ready' || entries.length === 0}
            className="rounded-xl bg-blue-600 px-3.5 py-1.5 text-xs font-medium text-white transition hover:bg-blue-700 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue-500 disabled:pointer-events-none disabled:opacity-50"
          >
            {t(phase.name === 'exporting' ? 'vocab.exporting' : 'vocab.export')}
          </button>
        </div>

        {phase.name === 'failed' && (
          <p className="mt-3 rounded-2xl border border-red-200 bg-red-50 px-3.5 py-3 text-xs leading-relaxed text-red-700 dark:border-red-900/60 dark:bg-red-950/40 dark:text-red-300">
            {t('vocab.failed', { message: phase.message })}
          </p>
        )}

        {phase.name === 'exported' && (
          <div className="mt-3 rounded-2xl border border-black/[0.08] bg-black/[0.02] px-3.5 py-3 dark:border-white/[0.07] dark:bg-white/[0.025]">
            <p className="text-xs text-neutral-700 dark:text-neutral-300">{t('vocab.exported')}</p>
            <code className="mt-1 block overflow-x-auto font-mono text-[10px] text-neutral-600 dark:text-neutral-300">
              {phase.location}
            </code>
            {phase.revealable && (
              <button
                type="button"
                onClick={() => void getFs().then((fs) => fs.reveal(phase.location))}
                className="mt-2 rounded-lg border border-black/[0.10] px-2.5 py-1 text-[11px] font-medium text-neutral-700 transition hover:bg-black/5 dark:border-white/[0.10] dark:text-neutral-300 dark:hover:bg-white/10"
              >
                {t('export.reveal')}
              </button>
            )}
          </div>
        )}

        <div className="mt-4 min-h-0 flex-1 overflow-y-auto">
          {phase.name === 'loading' ? null : visible.length === 0 ? (
            <p className="rounded-2xl border border-black/[0.06] bg-black/[0.02] px-3.5 py-6 text-center text-xs text-neutral-500 dark:border-white/[0.07] dark:bg-white/[0.025] dark:text-neutral-400">
              {t(entries.length === 0 ? 'vocab.empty' : 'vocab.emptyFiltered')}
            </p>
          ) : (
            <ul className="space-y-2">
              {visible.map((entry) => (
                <WordRow
                  key={entry.word.id}
                  entry={entry}
                  books={books}
                  onDelete={() => void remove(entry)}
                />
              ))}
            </ul>
          )}
        </div>

        <p className="mt-3 border-t border-black/[0.08] pt-2.5 text-[10px] leading-relaxed text-neutral-500 dark:border-white/[0.06] dark:text-neutral-400">
          {dictionary?.ready
            ? t('vocab.dictionaryReady', { n: dictionary.entries.toLocaleString() })
            : t('vocab.dictionaryMissing')}
        </p>
      </div>
      {confirmDialog}
    </div>
  )
}

function WordRow({
  entry,
  books,
  onDelete,
}: {
  entry: VocabularyEntry
  books: Record<string, BookRecord>
  onDelete: () => void
}) {
  const t = useT()
  return (
    <li className="rounded-2xl border border-black/[0.07] bg-black/[0.015] px-3.5 py-3 dark:border-white/[0.07] dark:bg-white/[0.025]">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="flex items-baseline gap-2">
            <span className="text-sm font-semibold tracking-tight">{entry.word.word}</span>
            {entry.word.stem !== entry.word.word && (
              <span className="text-[11px] text-neutral-500 dark:text-neutral-400">
                {entry.word.stem}
              </span>
            )}
            <span
              className={`rounded-full px-1.5 py-px text-[10px] font-medium ${
                entry.word.status === 'known'
                  ? 'bg-green-500/12 text-green-700 dark:text-green-400'
                  : 'bg-blue-500/10 text-blue-600 dark:text-blue-400'
              }`}
            >
              {t(entry.word.status === 'known' ? 'vocab.status.known' : 'vocab.status.learning')}
            </span>
          </p>
        </div>
        <button
          type="button"
          onClick={onDelete}
          aria-label={t('vocab.deleteLabel', { word: entry.word.word })}
          className="flex size-7 shrink-0 items-center justify-center rounded-lg text-neutral-500 transition hover:bg-red-500/10 hover:text-red-600 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-red-500 dark:text-neutral-400 dark:hover:text-red-400"
        >
          <IconTrash />
        </button>
      </div>

      {entry.lookups.length > 0 && (
        <ul className="mt-2 space-y-1.5">
          {entry.lookups.map((lookup) => (
            <li key={lookup.id} className="text-[11px] leading-relaxed">
              <span className="text-neutral-600 dark:text-neutral-300">{lookup.sentence}</span>
              <span className="ml-1.5 text-neutral-400 dark:text-neutral-500">
                {lookup.bookId
                  ? (books[lookup.bookId]?.title ?? t('vocab.filterUnknownBook'))
                  : t('vocab.filterUnknownBook')}
              </span>
            </li>
          ))}
        </ul>
      )}
    </li>
  )
}

function message(cause: unknown): string {
  return cause instanceof Error ? cause.message : String(cause)
}
