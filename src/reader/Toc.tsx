import { useState } from 'react'
import type { Annotation, Bookmark, TocItem } from '../platform/types'
import { IconBookmark, IconClose, IconHighlight, IconPlus, IconToc, IconTrash } from '../ui/icons'
import { highlightPalette } from './annotations/colors'
import { resolveActiveTocId } from './tocActive'
import { useModalDialog } from '../ui/useModalDialog'
import { useConfirm } from '../ui/useConfirm'
import { useLanguage, useT } from '../i18n/useT'
import type { Translate } from '../i18n/types'

/** Apple Books organizes this drawer as Contents / Bookmarks / Highlights. */
type DrawerTab = 'toc' | 'bookmarks' | 'annotations'

interface TocProps {
  toc: TocItem[]
  bookmarks: Bookmark[]
  annotations: Annotation[]
  currentHref: string | null
  currentTocId: string | null
  currentCfi: string | null
  onNavigate: (hrefOrCfi: string) => void
  onAddBookmark: () => void
  onDeleteBookmark: (id: string) => void
  onNavigateToAnnotation: (annotation: Annotation) => void
  onDeleteAnnotation: (id: string) => void
  onClose: () => void
}

export function Toc({
  toc,
  bookmarks,
  annotations,
  currentHref,
  currentTocId,
  currentCfi,
  onNavigate,
  onAddBookmark,
  onDeleteBookmark,
  onNavigateToAnnotation,
  onDeleteAnnotation,
  onClose,
}: TocProps) {
  const [tab, setTab] = useState<DrawerTab>('toc')
  const activeTocId = resolveActiveTocId(toc, currentTocId, currentHref)
  const noteCount = annotations.filter((item) => item.note.trim().length > 0).length
  const drawerRef = useModalDialog<HTMLElement>(onClose)
  const { confirm, confirmDialog } = useConfirm()
  const t = useT()

  const confirmDeleteBookmark = async (bookmark: Bookmark) => {
    const ok = await confirm({
      title: t('toc.confirmDeleteBookmark.title'),
      body: bookmark.text || undefined,
      confirmLabel: t('common.delete'),
      cancelLabel: t('common.cancel'),
    })
    if (ok) onDeleteBookmark(bookmark.id)
  }

  const confirmDeleteAnnotation = async (annotation: Annotation) => {
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
    if (ok) onDeleteAnnotation(annotation.id)
  }

  return (
    <div className="fixed inset-0 z-50 overflow-hidden">
      {/* Backdrop with soft blur */}
      <div
        className="fixed inset-0 bg-black/30 backdrop-blur-sm vr-animate-fade"
        onClick={onClose}
        aria-hidden="true"
      />

      {/* Floating Left Drawer */}
      <aside
        ref={drawerRef}
        role="dialog"
        aria-modal="true"
        tabIndex={-1}
        className="fixed inset-y-0 left-0 z-50 flex w-92 flex-col border-r border-black/[0.12] bg-white/92 shadow-[0_25px_60px_rgba(0,0,0,0.18)] backdrop-blur-2xl dark:border-white/[0.08] dark:bg-[#1C1C1E]/92 dark:text-neutral-100 vr-animate-drawer"
        aria-label={t('toc.drawerLabel')}
      >
        {/* Header */}
        <div className="flex items-center justify-between border-b border-black/[0.10] px-5 py-4 dark:border-white/[0.06]">
          {/* iOS Segmented Pill Switcher */}
          <div className="flex rounded-xl bg-black/[0.07] p-1 dark:bg-white/[0.08]" role="tablist">
            {([
              { id: 'toc', label: t('toc.tab.toc'), count: toc.length, icon: <IconToc className="opacity-75" /> },
              { id: 'bookmarks', label: t('toc.tab.bookmarks'), count: bookmarks.length, icon: <IconBookmark className="opacity-75" /> },
              { id: 'annotations', label: t('toc.tab.annotations'), count: annotations.length, icon: <IconHighlight className="opacity-75" /> },
            ] as const).map((item) => (
              <button
                key={item.id}
                type="button"
                role="tab"
                aria-selected={tab === item.id}
                onClick={() => setTab(item.id)}
                className={`flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-medium transition-[color,background-color,box-shadow] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue-500 ${
                  tab === item.id
                    ? 'bg-white font-semibold text-neutral-900 shadow-[0_1px_4px_rgba(0,0,0,0.08)] dark:bg-[#2C2C2E] dark:text-white'
                    : 'text-neutral-500 hover:text-neutral-800 dark:text-neutral-400 dark:hover:text-white'
                }`}
              >
                {item.icon}
                <span>
                  {item.label} ({item.count})
                </span>
              </button>
            ))}
          </div>

          <button
            type="button"
            onClick={onClose}
            className="flex h-7 w-7 items-center justify-center rounded-full border border-black/[0.12] dark:border-white/[0.10] text-neutral-500 dark:text-neutral-400 hover:bg-black/5 hover:text-neutral-700 dark:hover:bg-white/10 dark:hover:text-neutral-200 transition"
            aria-label={t('toc.close')}
          >
            <IconClose />
          </button>
        </div>

        {/* Content Body */}
        <div className="flex-1 overflow-y-auto p-4 custom-scrollbar">
          {tab === 'toc' ? (
            <div className="space-y-1">
              {toc.length === 0 ? (
                <EmptyPanel title={t('toc.noToc')} />
              ) : (
                <TocList
                  items={toc}
                  activeTocId={activeTocId}
                  onNavigate={onNavigate}
                  depth={0}
                  t={t}
                />
              )}
            </div>
          ) : tab === 'bookmarks' ? (
            <div className="space-y-3">
              <div className="flex items-center justify-between border-b border-black/[0.08] pb-2.5 dark:border-white/[0.05]">
                <span className="text-xs font-medium text-neutral-500 dark:text-neutral-400">
                  {bookmarks.length > 0
                    ? t.plural('toc.bookmarkCount', bookmarks.length)
                    : t('toc.noBookmarks')}
                </span>
                <button
                  type="button"
                  onClick={onAddBookmark}
                  disabled={!currentCfi}
                  className="flex items-center gap-1 rounded-full bg-blue-600 px-3 py-1.5 text-xs font-medium text-white shadow-xs transition hover:bg-blue-700 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue-500 active:scale-95 disabled:opacity-40"
                >
                  <IconPlus />
                  <span>{t('toc.addBookmark')}</span>
                </button>
              </div>

              {bookmarks.length === 0 ? (
                <EmptyPanel
                  title={t('toc.noBookmarksTitle')}
                  hint={t('toc.noBookmarksHint')}
                />
              ) : (
                bookmarks.map((bm) => (
                  <ListCard
                    key={bm.id}
                    onOpen={() => onNavigate(bm.cfi)}
                    onDelete={() => void confirmDeleteBookmark(bm)}
                    deleteLabel={t('toc.deleteBookmarkLabel', {
                      text: bm.text || t('toc.bookmarkFallback'),
                    })}
                    createdAt={bm.createdAt}
                  >
                    <p className="line-clamp-3 text-xs font-medium leading-relaxed text-neutral-800 dark:text-neutral-200">
                      {bm.text || t('toc.bookmarkFallback')}
                    </p>
                  </ListCard>
                ))
              )}
            </div>
          ) : (
            <div className="space-y-3">
              <div className="flex items-center justify-between border-b border-black/[0.08] pb-2.5 dark:border-white/[0.05]">
                <span className="text-xs font-medium text-neutral-500 dark:text-neutral-400">
                  {annotations.length > 0
                    ? t.plural('toc.annotationCount', annotations.length)
                    : t('toc.noAnnotations')}
                </span>
                {noteCount > 0 && (
                  <span className="text-[10px] text-neutral-500 dark:text-neutral-400">
                    {t.plural('toc.noteCount', noteCount)}
                  </span>
                )}
              </div>

              {annotations.length === 0 ? (
                <EmptyPanel
                  title={t('toc.noAnnotationsTitle')}
                  hint={t('toc.noAnnotationsHint')}
                />
              ) : (
                annotations.map((annotation) => {
                  const palette = highlightPalette(annotation.color)
                  const imported = annotation.source !== 'local'
                  return (
                    <ListCard
                      key={annotation.id}
                      // Imported rows have no reliable anchor, so they are not
                      // given a jump affordance that would do nothing.
                      onOpen={imported ? undefined : () => onNavigateToAnnotation(annotation)}
                      onDelete={() => void confirmDeleteAnnotation(annotation)}
                      deleteLabel={t('toc.deleteAnnotationLabel', {
                        text: annotation.text.slice(0, 20),
                      })}
                      createdAt={annotation.createdAt}
                      meta={
                        imported ? (
                          <span title={t('toc.importedHint')}>{t('toc.imported')}</span>
                        ) : (
                          annotation.chapterTitle && (
                            <span className="line-clamp-1 max-w-40">{annotation.chapterTitle}</span>
                          )
                        )
                      }
                    >
                      <div className="flex gap-2.5">
                        <span
                          aria-hidden="true"
                          className="mt-0.5 w-1 shrink-0 rounded-full"
                          style={{ backgroundColor: palette.swatch }}
                        />
                        <div className="min-w-0">
                          <p className="line-clamp-4 text-xs leading-relaxed text-neutral-800 dark:text-neutral-200">
                            {annotation.text}
                          </p>
                          {annotation.note && (
                            <p className="mt-2 line-clamp-3 rounded-lg bg-black/[0.05] px-2 py-1.5 text-[11px] leading-relaxed text-neutral-600 dark:bg-white/[0.05] dark:text-neutral-300">
                              {annotation.note}
                            </p>
                          )}
                        </div>
                      </div>
                    </ListCard>
                  )
                })
              )}
            </div>
          )}
        </div>
      </aside>

      {confirmDialog}
    </div>
  )
}

function TocList({
  items,
  activeTocId,
  onNavigate,
  depth,
  t,
}: {
  items: TocItem[]
  activeTocId: string | null
  onNavigate: (href: string) => void
  depth: number
  t: Translate
}) {
  return (
    <ul
      className={`space-y-0.5 ${
        depth > 0 ? 'ml-3.5 border-l border-black/[0.12] pl-3 dark:border-white/[0.08]' : ''
      }`}
    >
      {items.map((item) => {
        const isCurrent = activeTocId === item.id
        return (
          <li key={item.id || item.href}>
            <button
              type="button"
              onClick={() => onNavigate(item.href)}
              className={`group flex w-full items-center justify-between rounded-xl px-3 py-2 text-left text-xs transition ${
                isCurrent
                  ? 'bg-blue-500/10 font-semibold text-blue-600 dark:bg-blue-400/15 dark:text-blue-400 shadow-2xs'
                  : 'text-neutral-700 hover:bg-black/[0.06] dark:text-neutral-300 dark:hover:bg-white/[0.06]'
              }`}
            >
              <span className="line-clamp-1">
                {item.label.trim() || t('toc.untitledChapter')}
              </span>
              {isCurrent && (
                <span className="h-1.5 w-1.5 rounded-full bg-blue-600 dark:bg-blue-400 shrink-0 ml-2" />
              )}
            </button>
            {item.subitems && item.subitems.length > 0 && (
              <TocList
                items={item.subitems}
                activeTocId={activeTocId}
                onNavigate={onNavigate}
                depth={depth + 1}
                t={t}
              />
            )}
          </li>
        )
      })}
    </ul>
  )
}

function EmptyPanel({ title, hint }: { title: string; hint?: string }) {
  return (
    <div className="space-y-2 py-20 text-center">
      <p className="text-xs text-neutral-500 dark:text-neutral-400">{title}</p>
      {hint && <p className="mx-auto max-w-[200px] text-[11px] text-neutral-500/90 dark:text-neutral-400/80">{hint}</p>}
    </div>
  )
}

function ListCard({
  children,
  meta,
  createdAt,
  onOpen,
  onDelete,
  deleteLabel,
}: {
  children: React.ReactNode
  meta?: React.ReactNode
  createdAt: string
  /** Omitted when the entry cannot be located, so no dead jump target is shown. */
  onOpen?: () => void
  onDelete: () => void
  deleteLabel: string
}) {
  const { locale } = useLanguage()

  return (
    <div className="group relative rounded-2xl border border-black/[0.10] bg-black/[0.035] p-3.5 transition hover:border-blue-500/40 hover:bg-black/[0.06] dark:border-white/[0.06] dark:bg-white/[0.03] dark:hover:border-blue-400/40 dark:hover:bg-white/[0.05]">
      {onOpen ? (
        <button
          type="button"
          onClick={onOpen}
          className="block w-full rounded-lg text-left transition hover:opacity-80 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue-500"
        >
          {children}
        </button>
      ) : (
        <div>{children}</div>
      )}
      <div className="mt-3 flex items-center justify-between gap-2 text-[10px] text-neutral-500 dark:text-neutral-400">
        <span className="flex min-w-0 items-center gap-2">
          <span>{new Date(createdAt).toLocaleDateString(locale)}</span>
          {meta}
        </span>
        <button
          type="button"
          onClick={onDelete}
          aria-label={deleteLabel}
          className="flex size-6 items-center justify-center rounded-lg text-neutral-500 dark:text-neutral-400 opacity-0 transition hover:bg-red-500/10 hover:text-red-600 focus-visible:opacity-100 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-red-500 group-focus-within:opacity-100 group-hover:opacity-100 dark:hover:text-red-400"
        >
          <IconTrash />
        </button>
      </div>
    </div>
  )
}
