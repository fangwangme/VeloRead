import type { Annotation } from '../../platform/types'
import { highlightPalette } from './colors'
import { useModalDialog } from '../../ui/useModalDialog'
import { useConfirm } from '../../ui/useConfirm'
import { useLanguage, useT } from '../../i18n/useT'
import { IconClose, IconReturn, IconTrash } from '../../ui/icons'

/**
 * Reading one highlight without leaving the page you are on.
 *
 * Opening a highlight from the drawer used to mean jumping the book to it. That
 * answers "take me there", but the question is nearly always "what did I write
 * down?" — and the jump costs you your place to answer it. The card answers the
 * common question in place, and keeps the jump as an explicit button for the
 * times you do want to go.
 */
export function AnnotationCard({
  annotation,
  canJump,
  onJump,
  onDelete,
  onClose,
}: {
  annotation: Annotation
  /** Imported rows have no reliable anchor, so they get no jump button. */
  canJump: boolean
  onJump: () => void
  onDelete: () => void
  onClose: () => void
}) {
  const t = useT()
  const { locale } = useLanguage()
  const dialogRef = useModalDialog<HTMLDivElement>(onClose)
  const { confirm, confirmDialog } = useConfirm()
  const palette = highlightPalette(annotation.color)

  // Deleting is destructive, so it asks — the same question the drawer's row
  // asks, worded from the same keys.
  const confirmDelete = async () => {
    const ok = await confirm({
      title: t(
        annotation.note.trim()
          ? 'toc.confirmDeleteAnnotationWithNote.title'
          : 'toc.confirmDeleteAnnotation.title',
      ),
      body: annotation.text,
      confirmLabel: t('common.delete'),
      cancelLabel: t('common.cancel'),
    })
    if (ok) onDelete()
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-6">
      <div
        className="fixed inset-0 bg-black/25 backdrop-blur-[2px] vr-animate-fade"
        onClick={onClose}
        aria-hidden="true"
      />

      <div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby="annotation-card-title"
        tabIndex={-1}
        className="relative z-10 flex max-h-[70vh] w-full max-w-lg flex-col overflow-hidden rounded-3xl border border-black/[0.12] bg-[#FBFBFA]/97 shadow-[0_30px_70px_rgba(0,0,0,0.22)] backdrop-blur-2xl dark:border-white/[0.08] dark:bg-[#1C1C1E]/97 dark:text-neutral-100 vr-animate-pop"
      >
        <header className="flex items-start justify-between gap-4 border-b border-black/[0.08] px-5 py-4 dark:border-white/[0.06]">
          <div className="flex min-w-0 items-center gap-2.5">
            <span
              aria-hidden="true"
              className="size-2.5 shrink-0 rounded-full"
              style={{ backgroundColor: palette.swatch }}
            />
            <div className="min-w-0">
              <h2
                id="annotation-card-title"
                className="truncate text-sm font-semibold tracking-tight"
              >
                {annotation.chapterTitle || t('annotation.card.title')}
              </h2>
              <p className="mt-0.5 text-[11px] text-neutral-500 dark:text-neutral-400">
                {new Date(annotation.createdAt).toLocaleDateString(locale)}
                {!canJump && ` · ${t('toc.imported')}`}
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label={t('common.close')}
            className="flex size-7 shrink-0 items-center justify-center rounded-full border border-black/[0.12] text-neutral-500 transition hover:bg-black/5 hover:text-neutral-800 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue-500 dark:border-white/[0.10] dark:text-neutral-400 dark:hover:bg-white/10"
          >
            <IconClose />
          </button>
        </header>

        <div className="min-h-0 flex-1 overflow-y-auto px-5 py-4">
          <blockquote
            className="border-l-2 pl-3.5 font-serif text-[15px] leading-relaxed text-neutral-800 dark:text-neutral-100"
            style={{ borderColor: palette.swatch }}
          >
            {annotation.text}
          </blockquote>

          {annotation.note && (
            <div className="mt-4 rounded-2xl bg-black/[0.04] px-4 py-3 dark:bg-white/[0.05]">
              <p className="text-[10px] font-semibold uppercase tracking-wider text-neutral-500 dark:text-neutral-400">
                {t('annotation.card.note')}
              </p>
              <p className="mt-1.5 whitespace-pre-wrap text-[13px] leading-relaxed text-neutral-700 dark:text-neutral-200">
                {annotation.note}
              </p>
            </div>
          )}
        </div>

        <footer className="flex items-center justify-between gap-3 border-t border-black/[0.08] px-5 py-3.5 dark:border-white/[0.06]">
          <button
            type="button"
            onClick={() => void confirmDelete()}
            className="flex h-9 items-center gap-1.5 rounded-full px-3 text-xs font-medium text-neutral-500 transition hover:bg-red-500/10 hover:text-red-600 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-red-500 dark:text-neutral-400 dark:hover:text-red-400"
          >
            <IconTrash />
            <span>{t('common.delete')}</span>
          </button>

          {canJump ? (
            <button
              type="button"
              onClick={onJump}
              className="flex h-9 items-center gap-1.5 rounded-full bg-blue-600 px-4 text-xs font-medium text-white shadow-xs transition hover:bg-blue-700 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue-500 active:scale-95"
            >
              <IconReturn className="rotate-180" />
              <span>{t('annotation.card.jump')}</span>
            </button>
          ) : (
            <span className="text-[11px] text-neutral-500 dark:text-neutral-400">
              {t('toc.importedHint')}
            </span>
          )}
        </footer>
      </div>

      {confirmDialog}
    </div>
  )
}
