import { useEffect, useState } from 'react'
import { getFs, getStorage } from '../platform'
import type { BookRecord, ExportFile } from '../platform/types'
import { useModalDialog } from '../ui/useModalDialog'
import { useT } from '../i18n/useT'
import type { MessageKey } from '../i18n/types'
import { IconClose, IconHighlight } from '../ui/icons'
import {
  clippingsFileName,
  formatAllClippings,
  formatBookClippings,
  sortBooks,
  type ClippingsBook,
} from './clippings'

type Mode = 'single' | 'perBook'
type Phase =
  | { name: 'loading' }
  | { name: 'ready' }
  | { name: 'working' }
  | { name: 'done'; location: string; revealable: boolean; files: number }
  | { name: 'failed'; message: string }

const BUNDLE_NAME = 'VeloRead Clippings'

/**
 * Getting highlights out of the app.
 *
 * The point of storing them in Kindle's format is that they can leave, so this
 * is deliberately one click and two shapes — everything in one document, or one
 * document per book — rather than a configurable export pipeline. Where they
 * land is the platform's business; this reports it and offers to show you.
 */
export function ExportModal({ onClose }: { onClose: () => void }) {
  const t = useT()
  const dialogRef = useModalDialog<HTMLDivElement>(onClose)
  const [entries, setEntries] = useState<ClippingsBook[]>([])
  const [phase, setPhase] = useState<Phase>({ name: 'loading' })

  useEffect(() => {
    let cancelled = false
    void (async () => {
      try {
        const storage = await getStorage()
        const books = await storage.listBooks()
        const collected = await Promise.all(
          books.map(async (book: BookRecord) => ({
            book,
            annotations: await storage.listAnnotations(book.id),
          })),
        )
        if (cancelled) return
        setEntries(collected.filter((entry) => entry.annotations.length > 0))
        setPhase({ name: 'ready' })
      } catch (cause) {
        if (!cancelled) setPhase({ name: 'failed', message: message(cause) })
      }
    })()
    return () => {
      cancelled = true
    }
  }, [])

  const total = entries.reduce((sum, entry) => sum + entry.annotations.length, 0)

  const run = async (mode: Mode) => {
    setPhase({ name: 'working' })
    try {
      const files: ExportFile[] =
        mode === 'single'
          ? [{ name: `${BUNDLE_NAME}.txt`, text: formatAllClippings(entries) }]
          : sortBooks(entries).map((entry) => ({
              name: clippingsFileName(entry.book.title),
              text: formatBookClippings(entry),
            }))

      const result = await (await getFs()).exportTextFiles(files, BUNDLE_NAME)
      setPhase({ ...result, name: 'done', files: files.length })
    } catch (cause) {
      setPhase({ name: 'failed', message: message(cause) })
    }
  }

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
        aria-labelledby="export-title"
        tabIndex={-1}
        className="relative z-10 w-full max-w-md rounded-3xl border border-black/[0.08] bg-white/96 p-6 shadow-[0_30px_70px_rgba(0,0,0,0.22)] backdrop-blur-3xl vr-animate-pop dark:border-white/[0.08] dark:bg-[#1C1C1E]/96 dark:text-neutral-100"
      >
        <div className="flex items-start justify-between gap-3">
          <div className="flex items-center gap-3">
            <span className="flex size-9 items-center justify-center rounded-xl bg-blue-500/10 text-blue-600 dark:bg-blue-400/15 dark:text-blue-400">
              <IconHighlight />
            </span>
            <div>
              <h2 id="export-title" className="text-base font-semibold tracking-tight">
                {t('export.title')}
              </h2>
              <p className="mt-0.5 text-xs text-neutral-500 dark:text-neutral-400">
                {phase.name === 'loading'
                  ? t('export.counting')
                  : `${t.plural('export.bookCount', entries.length)} · ${t.plural(
                      'export.highlightCount',
                      total,
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

        {phase.name === 'done' ? (
          <Result
            phase={phase}
            onReveal={() => void getFs().then((fs) => fs.reveal(phase.location))}
            onClose={onClose}
          />
        ) : phase.name === 'failed' ? (
          <p className="mt-5 rounded-2xl border border-red-200 bg-red-50 px-3.5 py-3 text-xs leading-relaxed text-red-700 dark:border-red-900/60 dark:bg-red-950/40 dark:text-red-300">
            {t('export.failed', { message: phase.message })}
          </p>
        ) : total === 0 && phase.name === 'ready' ? (
          <p className="mt-5 rounded-2xl border border-black/[0.06] bg-black/[0.02] px-3.5 py-4 text-center text-xs text-neutral-500 dark:border-white/[0.07] dark:bg-white/[0.025] dark:text-neutral-400">
            {t('export.empty')}
          </p>
        ) : (
          <div className="mt-5 space-y-2">
            <Choice
              title="export.single"
              hint="export.singleHint"
              disabled={phase.name !== 'ready'}
              onSelect={() => void run('single')}
            />
            <Choice
              title="export.perBook"
              hint="export.perBookHint"
              disabled={phase.name !== 'ready'}
              onSelect={() => void run('perBook')}
            />
            <p className="pt-1 text-[10px] leading-relaxed text-neutral-500 dark:text-neutral-400">
              {t('export.formatNote')}
            </p>
          </div>
        )}
      </div>
    </div>
  )
}

function Choice({
  title,
  hint,
  disabled,
  onSelect,
}: {
  title: MessageKey
  hint: MessageKey
  disabled: boolean
  onSelect: () => void
}) {
  const t = useT()
  return (
    <button
      type="button"
      onClick={onSelect}
      disabled={disabled}
      className="w-full rounded-2xl border border-black/[0.08] bg-black/[0.02] p-3.5 text-left transition hover:border-blue-500/50 hover:bg-blue-500/[0.04] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue-500 disabled:pointer-events-none disabled:opacity-50 dark:border-white/[0.08] dark:bg-white/[0.03] dark:hover:border-blue-400/50"
    >
      <span className="block text-xs font-medium text-neutral-800 dark:text-neutral-200">
        {t(title)}
      </span>
      <span className="mt-0.5 block text-[10px] leading-relaxed text-neutral-500 dark:text-neutral-400">
        {t(hint)}
      </span>
    </button>
  )
}

function Result({
  phase,
  onReveal,
  onClose,
}: {
  phase: { location: string; revealable: boolean; files: number }
  onReveal: () => void
  onClose: () => void
}) {
  const t = useT()
  return (
    <div className="mt-5">
      <p className="text-xs text-neutral-700 dark:text-neutral-300">
        {t(phase.files === 1 ? 'export.doneSingle' : 'export.donePerBook', { n: phase.files })}
      </p>
      <code className="mt-2 block overflow-x-auto rounded-xl border border-black/[0.08] bg-black/[0.03] px-3 py-2 font-mono text-[10px] text-neutral-600 dark:border-white/[0.08] dark:bg-white/[0.04] dark:text-neutral-300">
        {phase.location}
      </code>
      <div className="mt-4 flex justify-end gap-2">
        <button
          type="button"
          onClick={onClose}
          className="rounded-xl border border-black/[0.10] px-3.5 py-1.5 text-xs font-medium text-neutral-700 transition hover:bg-black/5 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue-500 dark:border-white/[0.10] dark:text-neutral-300 dark:hover:bg-white/10"
        >
          {t('common.close')}
        </button>
        {phase.revealable && (
          <button
            type="button"
            onClick={onReveal}
            className="rounded-xl bg-blue-600 px-3.5 py-1.5 text-xs font-medium text-white transition hover:bg-blue-700 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue-500"
          >
            {t('export.reveal')}
          </button>
        )}
      </div>
    </div>
  )
}

function message(cause: unknown): string {
  return cause instanceof Error ? cause.message : String(cause)
}
