import { useEffect, useRef, useState } from 'react'
import type { Annotation, HighlightColor } from '../../platform/types'
import { HIGHLIGHT_COLORS } from './colors'
import { IconTrash } from '../../ui/icons'
import { useT } from '../../i18n/useT'

export interface HighlightDraft {
  /** Present when editing a stored highlight, absent for a fresh selection. */
  annotation: Annotation | null
  cfiRange: string
  text: string
  rect: { left: number; top: number; width: number; height: number }
}

interface HighlightPopoverProps {
  draft: HighlightDraft
  /** Container box, so the popover can be kept inside the reading area. */
  bounds: { width: number; height: number }
  onApply: (color: HighlightColor, note: string) => void
  onDelete: () => void
  onClose: () => void
}

const POPOVER_WIDTH = 288
const GAP = 10

export function HighlightPopover({
  draft,
  bounds,
  onApply,
  onDelete,
  onClose,
}: HighlightPopoverProps) {
  const t = useT()
  const existing = draft.annotation
  const [color, setColor] = useState<HighlightColor>(existing?.color ?? 'yellow')
  const [note, setNote] = useState(existing?.note ?? '')
  const [noteOpen, setNoteOpen] = useState(Boolean(existing?.note))
  const panelRef = useRef<HTMLDivElement>(null)
  const noteRef = useRef<HTMLTextAreaElement>(null)

  useEffect(() => {
    if (noteOpen) noteRef.current?.focus()
  }, [noteOpen])

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.preventDefault()
        event.stopPropagation()
        onClose()
      }
    }
    // Capture, so the reader's own Escape handling does not close the book first.
    document.addEventListener('keydown', onKeyDown, true)
    return () => document.removeEventListener('keydown', onKeyDown, true)
  }, [onClose])

  // Anchor above the selection when there is room, otherwise below it, and keep
  // the panel inside the reading area on both axes.
  const estimatedHeight = noteOpen ? 240 : 132
  const preferAbove = draft.rect.top > estimatedHeight + GAP
  const top = preferAbove
    ? draft.rect.top - estimatedHeight - GAP
    : Math.min(draft.rect.top + draft.rect.height + GAP, Math.max(0, bounds.height - estimatedHeight))
  const left = Math.max(
    GAP,
    Math.min(
      draft.rect.left + draft.rect.width / 2 - POPOVER_WIDTH / 2,
      Math.max(GAP, bounds.width - POPOVER_WIDTH - GAP),
    ),
  )

  const apply = (nextColor: HighlightColor, nextNote: string) => {
    onApply(nextColor, nextNote.trim())
  }

  /**
   * Picking a colour saves but keeps the popover open, so a note can follow
   * without reselecting. Saving from the note editor is the end of the
   * interaction and closes it — otherwise Save leaves the panel sitting there
   * with no sign anything happened.
   */
  const applyAndClose = () => {
    apply(color, note)
    onClose()
  }

  return (
    <div
      ref={panelRef}
      role="dialog"
      aria-label={t(existing ? 'highlight.editLabel' : 'highlight.newLabel')}
      style={{ left: `${Math.round(left)}px`, top: `${Math.round(top)}px`, width: `${POPOVER_WIDTH}px` }}
      className="absolute z-40 rounded-2xl border border-black/[0.08] bg-white/97 p-3 shadow-[0_20px_50px_rgba(0,0,0,0.2),0_2px_8px_rgba(0,0,0,0.06)] backdrop-blur-2xl dark:border-white/[0.08] dark:bg-[#1C1C1E]/97 dark:text-neutral-100 vr-animate-pop"
      onMouseDown={(event) => event.stopPropagation()}
    >
      <p className="line-clamp-2 border-b border-black/[0.06] pb-2 text-[11px] leading-relaxed text-neutral-500 dark:border-white/[0.06] dark:text-neutral-400">
        {draft.text}
      </p>

      <div className="mt-2.5 flex items-center justify-between gap-2">
        <div className="flex items-center gap-1.5">
          {HIGHLIGHT_COLORS.map((option) => (
            <button
              key={option.id}
              type="button"
              onClick={() => {
                setColor(option.id)
                apply(option.id, note)
              }}
              aria-label={t('highlight.colorLabel', { color: t(option.labelKey) })}
              aria-pressed={color === option.id}
              style={{ backgroundColor: option.swatch }}
              className={`size-6 rounded-full transition focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue-500 ${
                color === option.id
                  ? 'ring-2 ring-neutral-900/70 ring-offset-2 ring-offset-white dark:ring-white/80 dark:ring-offset-[#1C1C1E]'
                  : 'hover:scale-110'
              }`}
            />
          ))}
        </div>

        <div className="flex items-center gap-1">
          <button
            type="button"
            onClick={() => setNoteOpen((open) => !open)}
            className={`rounded-lg px-2 py-1 text-[11px] font-medium transition focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue-500 ${
              noteOpen || note
                ? 'bg-blue-500/10 text-blue-600 dark:text-blue-400'
                : 'text-neutral-500 hover:bg-black/5 dark:text-neutral-400 dark:hover:bg-white/10'
            }`}
            aria-expanded={noteOpen}
          >
            {t('highlight.note')}
          </button>
          {existing && (
            <button
              type="button"
              onClick={onDelete}
              aria-label={t('highlight.delete')}
              className="flex size-7 items-center justify-center rounded-lg text-neutral-400 transition hover:bg-red-500/10 hover:text-red-600 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-red-500 dark:hover:text-red-400"
            >
              <IconTrash />
            </button>
          )}
        </div>
      </div>

      {noteOpen && (
        <div className="mt-2.5">
          <textarea
            ref={noteRef}
            value={note}
            onChange={(event) => setNote(event.target.value)}
            rows={3}
            placeholder={t('highlight.notePlaceholder')}
            aria-label={t('highlight.noteLabel')}
            className="w-full resize-none rounded-xl border border-black/[0.08] bg-black/[0.02] px-2.5 py-2 text-[11px] leading-relaxed outline-none focus-visible:border-blue-500 focus-visible:ring-2 focus-visible:ring-blue-500/20 dark:border-white/[0.08] dark:bg-white/[0.04]"
          />
          <div className="mt-2 flex justify-end gap-1.5">
            <button
              type="button"
              onClick={onClose}
              className="rounded-lg px-2.5 py-1 text-[11px] font-medium text-neutral-500 transition hover:bg-black/5 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue-500 dark:text-neutral-400 dark:hover:bg-white/10"
            >
              {t('common.cancel')}
            </button>
            <button
              type="button"
              onClick={applyAndClose}
              className="rounded-lg bg-blue-600 px-2.5 py-1 text-[11px] font-medium text-white transition hover:bg-blue-700 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue-500"
            >
              {t('highlight.save')}
            </button>
          </div>
        </div>
      )}
    </div>
  )
}
