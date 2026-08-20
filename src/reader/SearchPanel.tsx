import { useEffect, useRef, useState } from 'react'
import type { SearchHit, SearchOptions } from './renderer'
import { IconClose, IconSearch } from '../ui/icons'
import { useModalDialog } from '../ui/useModalDialog'
import { useT } from '../i18n/useT'

interface SearchPanelProps {
  onSearch: (query: string, options: SearchOptions) => Promise<SearchHit[]>
  onNavigate: (cfi: string) => void
  onClose: () => void
}

type Status = 'idle' | 'searching' | 'done' | 'cancelled'

const MAX_HITS = 300

export function SearchPanel({ onSearch, onNavigate, onClose }: SearchPanelProps) {
  const [query, setQuery] = useState('')
  const [submitted, setSubmitted] = useState('')
  const [hits, setHits] = useState<SearchHit[]>([])
  const [status, setStatus] = useState<Status>('idle')
  const [progress, setProgress] = useState({ done: 0, total: 0 })
  const abortRef = useRef<AbortController | null>(null)
  const inputRef = useRef<HTMLInputElement>(null)
  const panelRef = useModalDialog<HTMLElement>(onClose)
  const t = useT()

  // Declared after useModalDialog, so this wins over the trap's first-focusable
  // rule: the point of opening this panel is to type.
  useEffect(() => {
    inputRef.current?.focus()
  }, [])

  // Abandon an in-flight scan when the panel closes, so a large book does not
  // keep loading spine sections after the user has moved on.
  useEffect(() => () => abortRef.current?.abort(), [])

  const run = async () => {
    const trimmed = query.trim()
    if (trimmed.length === 0) return

    abortRef.current?.abort()
    const controller = new AbortController()
    abortRef.current = controller

    setSubmitted(trimmed)
    setHits([])
    setProgress({ done: 0, total: 0 })
    setStatus('searching')

    try {
      const found = await onSearch(trimmed, {
        signal: controller.signal,
        limit: MAX_HITS,
        onProgress: (done, total) => {
          if (!controller.signal.aborted) setProgress({ done, total })
        },
      })
      // Only a *newer* search may discard this one's results. An aborted scan
      // still returns everything it found before stopping, and throwing that
      // away is what makes Stop feel like Cancel.
      if (controller !== abortRef.current) return
      setHits(found)
      setStatus(controller.signal.aborted ? 'cancelled' : 'done')
    } catch {
      if (controller !== abortRef.current) return
      setStatus(controller.signal.aborted ? 'cancelled' : 'done')
    }
  }

  const cancel = () => {
    // Status flips now so the button responds; the hits collected so far land
    // when the in-flight pass unwinds.
    abortRef.current?.abort()
    setStatus('cancelled')
  }

  const percent =
    progress.total > 0 ? Math.round((progress.done / progress.total) * 100) : 0

  return (
    <div className="fixed inset-0 z-50 overflow-hidden">
      <div
        className="fixed inset-0 bg-black/30 backdrop-blur-sm vr-animate-fade"
        onClick={onClose}
        aria-hidden="true"
      />

      <aside
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        tabIndex={-1}
        className="fixed inset-y-0 left-0 z-50 flex w-92 flex-col border-r border-black/[0.08] bg-white/92 shadow-[0_25px_60px_rgba(0,0,0,0.18)] backdrop-blur-2xl vr-animate-drawer dark:border-white/[0.08] dark:bg-[#1C1C1E]/92 dark:text-neutral-100"
        aria-label={t('search.title')}
      >
        <div className="border-b border-black/[0.06] px-5 py-4 dark:border-white/[0.06]">
          <div className="flex items-center justify-between gap-3">
            <h2 className="text-xs font-semibold tracking-wide text-neutral-700 dark:text-neutral-300">
              {t('search.title')}
            </h2>
            <button
              type="button"
              onClick={onClose}
              className="flex size-7 items-center justify-center rounded-full text-neutral-400 transition hover:bg-black/5 hover:text-neutral-700 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue-500 dark:hover:bg-white/10 dark:hover:text-neutral-200"
              aria-label={t('search.close')}
            >
              <IconClose />
            </button>
          </div>

          <form
            className="mt-3 flex items-center gap-2"
            onSubmit={(event) => {
              event.preventDefault()
              void run()
            }}
          >
            <div className="flex flex-1 items-center gap-2 rounded-xl border border-black/[0.08] bg-black/[0.03] px-2.5 py-1.5 focus-within:border-blue-500 focus-within:ring-2 focus-within:ring-blue-500/20 dark:border-white/[0.08] dark:bg-white/[0.04]">
              <IconSearch className="shrink-0 opacity-40" />
              <input
                ref={inputRef}
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                type="search"
                name="in-book-search"
                autoComplete="off"
                placeholder={t('search.placeholder')}
                aria-label={t('search.inputLabel')}
                className="w-full bg-transparent text-xs outline-none placeholder:text-neutral-400"
              />
            </div>
            {status === 'searching' ? (
              <button
                type="button"
                onClick={cancel}
                className="shrink-0 rounded-xl border border-black/[0.08] px-3 py-1.5 text-xs font-medium text-neutral-600 transition hover:bg-black/5 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue-500 dark:border-white/[0.08] dark:text-neutral-300 dark:hover:bg-white/10"
              >
                {t('search.stop')}
              </button>
            ) : (
              <button
                type="submit"
                disabled={query.trim().length === 0}
                className="shrink-0 rounded-xl bg-blue-600 px-3 py-1.5 text-xs font-medium text-white transition hover:bg-blue-700 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue-500 disabled:opacity-40"
              >
                {t('search.submit')}
              </button>
            )}
          </form>

          {/* Whole-book search has no index, so the pass is visible by design. */}
          {status === 'searching' && (
            <div className="mt-2.5" aria-live="polite">
              <div className="flex items-center justify-between text-[10px] text-neutral-400">
                <span>{t('search.scanning')}</span>
                <span className="font-mono">{percent}%</span>
              </div>
              <div className="mt-1 h-1 overflow-hidden rounded-full bg-black/[0.06] dark:bg-white/[0.08]">
                <div
                  className="h-full rounded-full bg-blue-600 transition-[width] duration-200 motion-reduce:transition-none dark:bg-blue-400"
                  style={{ width: `${percent}%` }}
                />
              </div>
            </div>
          )}

          {status !== 'searching' && submitted && (
            <p className="mt-2.5 text-[10px] text-neutral-400" aria-live="polite">
              {hits.length === 0
                ? t(status === 'cancelled' ? 'search.stopped' : 'search.noResults', {
                    query: submitted,
                  })
                : `${status === 'cancelled' ? t('search.stoppedPrefix') : ''}${t.plural(
                    'search.results',
                    hits.length,
                    { more: hits.length >= MAX_HITS ? '+' : '', query: submitted },
                  )}`}
              {status === 'cancelled' && hits.length > 0 && t('search.partialNote')}
              {hits.length >= MAX_HITS && t('search.capNote')}
            </p>
          )}
        </div>

        <div className="flex-1 overflow-y-auto p-4">
          {status === 'idle' && !submitted ? (
            <div className="space-y-2 py-20 text-center">
              <p className="text-xs text-neutral-400 dark:text-neutral-500">
                {t('search.idleTitle')}
              </p>
              <p className="mx-auto max-w-[220px] text-[11px] text-neutral-400/80">
                {t('search.idleHint')}
              </p>
            </div>
          ) : (
            <ul className="space-y-2">
              {hits.map((hit, index) => (
                <li key={`${hit.cfi}-${index}`}>
                  <button
                    type="button"
                    onClick={() => onNavigate(hit.cfi)}
                    className="w-full rounded-2xl border border-black/[0.06] bg-black/[0.02] p-3 text-left transition hover:border-blue-500/40 hover:bg-black/[0.04] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue-500 dark:border-white/[0.06] dark:bg-white/[0.03] dark:hover:border-blue-400/40 dark:hover:bg-white/[0.05]"
                  >
                    <p className="line-clamp-3 text-[11px] leading-relaxed text-neutral-700 dark:text-neutral-300">
                      {highlightMatch(hit.excerpt, submitted)}
                    </p>
                    {hit.chapterTitle && (
                      <p className="mt-1.5 line-clamp-1 text-[10px] text-neutral-400">
                        {hit.chapterTitle}
                      </p>
                    )}
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
      </aside>
    </div>
  )
}

/** Bold the matched term inside an excerpt without trusting it as markup. */
function highlightMatch(excerpt: string, query: string) {
  if (!query) return excerpt
  const lower = excerpt.toLowerCase()
  const needle = query.toLowerCase()
  const parts: React.ReactNode[] = []
  let cursor = 0

  for (;;) {
    const index = lower.indexOf(needle, cursor)
    if (index === -1 || needle.length === 0) break
    if (index > cursor) parts.push(excerpt.slice(cursor, index))
    parts.push(
      <mark
        key={`${index}`}
        className="rounded-xs bg-amber-200/70 px-0.5 font-medium text-neutral-900 dark:bg-amber-400/30 dark:text-amber-100"
      >
        {excerpt.slice(index, index + needle.length)}
      </mark>,
    )
    cursor = index + needle.length
  }
  parts.push(excerpt.slice(cursor))
  return parts
}
