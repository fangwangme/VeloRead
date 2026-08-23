import { useEffect, useRef, useState, type ReactNode } from 'react'
import type { Annotation, HighlightColor, VocabularyStatus } from '../../platform/types'
import { HIGHLIGHT_COLORS } from './colors'
import { IconCheck, IconCopy, IconNote, IconSearch, IconTrash, IconVocabulary } from '../../ui/icons'
import { useT } from '../../i18n/useT'
import type { MessageKey } from '../../i18n/types'

export interface HighlightDraft {
  /** Present when editing a stored highlight, absent for a fresh selection. */
  annotation: Annotation | null
  cfiRange: string
  text: string
  rect: { left: number; top: number; width: number; height: number }
}

/**
 * What the dictionary had to say about the selected word.
 *
 * `unavailable` is not an error: the browser build has no dictionary at all,
 * and the popover says so plainly instead of pretending the word is unknown.
 */
export type DefinitionState =
  | { status: 'loading' }
  | { status: 'found'; word: string; definition: string }
  | { status: 'missing'; word: string }
  | { status: 'unavailable'; download: DictionaryDownloadState | null }

export type DictionaryDownloadState =
  | { status: 'available'; sizeBytes: number }
  | { status: 'downloading'; downloadedBytes: number; totalBytes: number }
  | { status: 'failed'; sizeBytes: number; message: string }

interface HighlightPopoverProps {
  draft: HighlightDraft
  /** Container box, so the popover can be kept inside the reading area. */
  bounds: { width: number; height: number }
  /**
   * The definition area's content, or null when the selection is not a single
   * word. Null means the area is not rendered — never that it is rendered
   * empty. See the note on structure below.
   */
  definition: DefinitionState | null
  /** Whether the word is already in the vocabulary list, and how. */
  vocabulary: VocabularyStatus | 'none'
  onApply: (color: HighlightColor, note: string) => void
  onDelete: () => void
  onClose: () => void
  /** Cycles none → learning → known → none. */
  onVocabularyChange: (next: VocabularyStatus | 'none') => void
  /** Search the whole book for this selection. */
  onSearch: () => void
  onCopy: () => void
  /** Install the offline dictionary, when the desktop offers one. */
  onDownloadDictionary: () => void
}

const POPOVER_WIDTH = 288
const GAP = 10

/**
 * Heights the anchoring maths assumes. They hold because the definition area
 * scrolls inside a fixed maximum rather than growing with the entry — a
 * dictionary paragraph can run for hundreds of words.
 */
const BASE_HEIGHT = 132
const DEFINITION_HEIGHT = 208
const NOTE_HEIGHT = 108

/**
 * The reader's selection popover: what the word means, and what to do next.
 *
 * **Fixed structure, optional content.** The definition area is always at the
 * top, and for a selection that is not a single word it is *not rendered at
 * all* — a sentence has no dictionary entry, and an empty box saying so is
 * furniture. What must not change is the action row: the same buttons in the
 * same order, whatever was selected. A button that moves depending on how much
 * text you happened to select is a button you can never learn the position of,
 * so the ones that do not apply are disabled in place rather than removed. That
 * is why deleting a highlight is a permanently present, sometimes-disabled
 * button, where it used to appear and disappear.
 *
 * **The popover is a hub, not a destination.** Everything here can be done
 * without reselecting: save the word, highlight the passage, write a note,
 * search the book, copy. The rule was already in this file — picking a colour
 * saves but keeps the popover open — and the new actions follow it.
 */
export function HighlightPopover({
  draft,
  bounds,
  definition,
  vocabulary,
  onApply,
  onDelete,
  onClose,
  onVocabularyChange,
  onSearch,
  onCopy,
  onDownloadDictionary,
}: HighlightPopoverProps) {
  const t = useT()
  const existing = draft.annotation
  const [color, setColor] = useState<HighlightColor>(existing?.color ?? 'yellow')
  const [note, setNote] = useState(existing?.note ?? '')
  const [noteOpen, setNoteOpen] = useState(Boolean(existing?.note))
  const [copied, setCopied] = useState(false)
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
  const estimatedHeight =
    BASE_HEIGHT + (definition ? DEFINITION_HEIGHT : 0) + (noteOpen ? NOTE_HEIGHT : 0)
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

  const nextVocabularyStatus: VocabularyStatus | 'none' =
    vocabulary === 'none' ? 'learning' : vocabulary === 'learning' ? 'known' : 'none'

  const vocabularyLabel: MessageKey =
    vocabulary === 'learning'
      ? 'vocab.markKnown'
      : vocabulary === 'known'
        ? 'vocab.remove'
        : 'vocab.add'

  const copy = () => {
    onCopy()
    setCopied(true)
    window.setTimeout(() => setCopied(false), 1200)
  }

  return (
    <div
      ref={panelRef}
      role="dialog"
      aria-label={t(existing ? 'highlight.editLabel' : 'highlight.newLabel')}
      style={{ left: `${Math.round(left)}px`, top: `${Math.round(top)}px`, width: `${POPOVER_WIDTH}px` }}
      className="absolute z-40 rounded-2xl border border-black/[0.12] bg-white/97 p-3 shadow-[0_20px_50px_rgba(0,0,0,0.2),0_2px_8px_rgba(0,0,0,0.06)] backdrop-blur-2xl dark:border-white/[0.08] dark:bg-[#1C1C1E]/97 dark:text-neutral-100 vr-animate-pop"
      onMouseDown={(event) => event.stopPropagation()}
    >
      {definition ? (
        <Definition state={definition} onDownload={onDownloadDictionary} />
      ) : (
        <p className="line-clamp-2 border-b border-black/[0.10] pb-2 text-[11px] leading-relaxed text-neutral-500 dark:border-white/[0.06] dark:text-neutral-400">
          {draft.text}
        </p>
      )}

      <div className="mt-2.5 flex items-center gap-1.5">
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

      {/*
        The action row. Same buttons, same order, whatever was selected — the
        component test in this folder asserts exactly that.
      */}
      <div
        data-testid="popover-actions"
        className="mt-2.5 flex items-center justify-between gap-1 border-t border-black/[0.10] pt-2.5 dark:border-white/[0.06]"
      >
        <Action
          name="vocabulary"
          label={vocabularyLabel}
          // A sentence cannot go in a vocabulary list, so this is off for one —
          // in place, not missing.
          disabled={definition === null}
          active={vocabulary !== 'none'}
          onClick={() => onVocabularyChange(nextVocabularyStatus)}
          icon={vocabulary === 'known' ? <IconCheck /> : <IconVocabulary />}
        />
        <Action
          name="note"
          label="highlight.note"
          active={noteOpen || note.length > 0}
          expanded={noteOpen}
          onClick={() => setNoteOpen((open) => !open)}
          icon={<IconNote />}
        />
        <Action name="search" label="highlight.search" onClick={onSearch} icon={<IconSearch />} />
        <Action
          name="copy"
          label={copied ? 'highlight.copied' : 'highlight.copy'}
          active={copied}
          onClick={copy}
          icon={copied ? <IconCheck /> : <IconCopy />}
        />
        <Action
          name="delete"
          label="highlight.delete"
          // Present even with nothing to delete, so the four buttons beside it
          // never shift.
          disabled={!existing}
          destructive
          onClick={onDelete}
          icon={<IconTrash />}
        />
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
            className="w-full resize-none rounded-xl border border-black/[0.12] bg-black/[0.035] px-2.5 py-2 text-[11px] leading-relaxed outline-none focus-visible:border-blue-500 focus-visible:ring-2 focus-visible:ring-blue-500/20 dark:border-white/[0.08] dark:bg-white/[0.04]"
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

/**
 * The definition area. Always the top of the popover when it is rendered at
 * all, and it scrolls rather than grows: a Webster entry can run for a page, and
 * a popover that changes height with the word would move the actions under it.
 */
function Definition({
  state,
  onDownload,
}: {
  state: DefinitionState
  onDownload: () => void
}) {
  const t = useT()
  const progress =
    state.status === 'unavailable' && state.download?.status === 'downloading'
      ? Math.min(100, Math.round((state.download.downloadedBytes / state.download.totalBytes) * 100))
      : null
  return (
    <div
      data-testid="popover-definition"
      className="max-h-48 overflow-y-auto border-b border-black/[0.10] pb-2 dark:border-white/[0.06]"
    >
      {state.status === 'found' ? (
        <>
          <p className="text-[13px] font-semibold tracking-tight">{state.word}</p>
          <p className="mt-1 text-[11px] leading-relaxed text-neutral-600 dark:text-neutral-300">
            {state.definition}
          </p>
        </>
      ) : state.status === 'unavailable' ? (
        <div className="text-[11px] leading-relaxed text-neutral-500 dark:text-neutral-400">
          <p>{t(state.download ? 'vocab.dictionaryDownloadHint' : 'vocab.noDictionary')}</p>
          {state.download?.status === 'downloading' ? (
            <div className="mt-2" aria-live="polite">
              <div className="h-1.5 overflow-hidden rounded-full bg-black/[0.08] dark:bg-white/[0.10]">
                <div
                  className="h-full rounded-full bg-blue-600 transition-[width]"
                  style={{ width: `${progress ?? 0}%` }}
                />
              </div>
              <p className="mt-1">{t('vocab.dictionaryDownloading', { n: progress ?? 0 })}</p>
            </div>
          ) : (
            <>
              {state.download?.status === 'failed' && (
                <p className="mt-1 text-red-600 dark:text-red-400">
                  {t('vocab.dictionaryDownloadFailed')}
                </p>
              )}
              {state.download && (
                <button
                  type="button"
                  data-testid="dictionary-download"
                  onClick={onDownload}
                  className="mt-2 rounded-lg bg-blue-600 px-2.5 py-1 text-[11px] font-medium text-white transition hover:bg-blue-700 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue-500"
                >
                  {t(
                    state.download.status === 'failed'
                      ? 'vocab.dictionaryRetry'
                      : 'vocab.dictionaryDownload',
                    { size: formatMegabytes(state.download.sizeBytes) },
                  )}
                </button>
              )}
            </>
          )}
        </div>
      ) : (
        <p className="text-[11px] leading-relaxed text-neutral-500 dark:text-neutral-400">
          {state.status === 'loading'
            ? t('vocab.looking')
            : t('vocab.notFound', { word: state.word })}
        </p>
      )}
    </div>
  )
}

function formatMegabytes(bytes: number): string {
  return `${(bytes / 1_000_000).toFixed(1)} MB`
}

function Action({
  name,
  label,
  icon,
  active = false,
  disabled = false,
  destructive = false,
  expanded,
  onClick,
}: {
  name: string
  label: MessageKey
  icon?: ReactNode
  active?: boolean
  disabled?: boolean
  destructive?: boolean
  expanded?: boolean
  onClick: () => void
}) {
  const t = useT()
  const tone = destructive
    ? 'text-neutral-500 hover:bg-red-500/10 hover:text-red-600 dark:text-neutral-400 dark:hover:text-red-400'
    : active
      ? 'bg-blue-500/10 text-blue-600 dark:text-blue-400'
      : 'text-neutral-500 hover:bg-black/5 dark:text-neutral-400 dark:hover:bg-white/10'
  return (
    <button
      type="button"
      data-action={name}
      onClick={onClick}
      disabled={disabled}
      title={t(label)}
      aria-label={t(label)}
      aria-expanded={expanded}
      className={`flex h-7 flex-1 items-center justify-center gap-1 rounded-lg px-1 text-[11px] font-medium transition focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue-500 disabled:pointer-events-none disabled:opacity-35 ${tone}`}
    >
      {icon ?? <span aria-hidden="true">{t(label)}</span>}
    </button>
  )
}
