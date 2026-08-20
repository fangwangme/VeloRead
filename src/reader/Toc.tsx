import { useState } from 'react'
import type { Bookmark, TocItem } from '../platform/types'
import { IconBook, IconToc } from '../ui/icons'
import { resolveActiveTocId } from './tocActive'

interface TocProps {
  toc: TocItem[]
  bookmarks: Bookmark[]
  currentHref: string | null
  currentTocId: string | null
  currentCfi: string | null
  onNavigate: (hrefOrCfi: string) => void
  onAddBookmark: () => void
  onDeleteBookmark: (id: string) => void
  onClose: () => void
}

export function Toc({
  toc,
  bookmarks,
  currentHref,
  currentTocId,
  currentCfi,
  onNavigate,
  onAddBookmark,
  onDeleteBookmark,
  onClose,
}: TocProps) {
  const [tab, setTab] = useState<'toc' | 'bookmarks'>('toc')
  const activeTocId = resolveActiveTocId(toc, currentTocId, currentHref)

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
        className="fixed inset-y-0 left-0 z-50 flex w-92 flex-col border-r border-black/[0.08] bg-white/92 shadow-[0_25px_60px_rgba(0,0,0,0.18)] backdrop-blur-2xl dark:border-white/[0.08] dark:bg-[#1C1C1E]/92 dark:text-neutral-100 vr-animate-drawer"
        aria-label="目录与书签抽屉"
      >
        {/* Header */}
        <div className="flex items-center justify-between border-b border-black/[0.06] px-5 py-4 dark:border-white/[0.06]">
          {/* iOS Segmented Pill Switcher */}
          <div className="flex rounded-xl bg-black/[0.05] p-1 dark:bg-white/[0.08]">
            <button
              type="button"
              onClick={() => setTab('toc')}
              className={`flex items-center gap-1.5 rounded-lg px-3.5 py-1.5 text-xs font-medium transition-[color,background-color,box-shadow] ${
                tab === 'toc'
                  ? 'bg-white text-neutral-900 shadow-[0_1px_4px_rgba(0,0,0,0.08)] dark:bg-[#2C2C2E] dark:text-white font-semibold'
                  : 'text-neutral-500 hover:text-neutral-800 dark:text-neutral-400 dark:hover:text-white'
              }`}
            >
              <IconToc className="opacity-75" />
              <span>目录 ({toc.length})</span>
            </button>
            <button
              type="button"
              onClick={() => setTab('bookmarks')}
              className={`flex items-center gap-1.5 rounded-lg px-3.5 py-1.5 text-xs font-medium transition-[color,background-color,box-shadow] ${
                tab === 'bookmarks'
                  ? 'bg-white text-neutral-900 shadow-[0_1px_4px_rgba(0,0,0,0.08)] dark:bg-[#2C2C2E] dark:text-white font-semibold'
                  : 'text-neutral-500 hover:text-neutral-800 dark:text-neutral-400 dark:hover:text-white'
              }`}
            >
              <IconBook className="opacity-75" />
              <span>书签 ({bookmarks.length})</span>
            </button>
          </div>

          <button
            type="button"
            onClick={onClose}
            className="flex h-7 w-7 items-center justify-center rounded-full text-neutral-400 hover:bg-black/5 hover:text-neutral-700 dark:hover:bg-white/10 dark:hover:text-neutral-200 transition"
            aria-label="关闭抽屉"
          >
            ✕
          </button>
        </div>

        {/* Content Body */}
        <div className="flex-1 overflow-y-auto p-4 custom-scrollbar">
          {tab === 'toc' ? (
            <div className="space-y-1">
              {toc.length === 0 ? (
                <div className="py-20 text-center text-xs text-neutral-400 dark:text-neutral-500">
                  此书籍未内置目录结构
                </div>
              ) : (
                <TocList items={toc} activeTocId={activeTocId} onNavigate={onNavigate} depth={0} />
              )}
            </div>
          ) : (
            <div className="space-y-3">
              <div className="flex justify-between items-center pb-2.5 border-b border-black/[0.05] dark:border-white/[0.05]">
                <span className="text-xs text-neutral-500 dark:text-neutral-400 font-medium">
                  {bookmarks.length > 0 ? `共 ${bookmarks.length} 处已存书签` : '暂无书签'}
                </span>
                <button
                  type="button"
                  onClick={onAddBookmark}
                  disabled={!currentCfi}
                  className="rounded-full bg-blue-600 px-3.5 py-1.5 text-xs font-medium text-white shadow-xs transition hover:bg-blue-700 active:scale-95 disabled:opacity-40"
                >
                  + 添加书签
                </button>
              </div>

              {bookmarks.length === 0 ? (
                <div className="py-20 text-center space-y-2">
                  <p className="text-xs text-neutral-400 dark:text-neutral-500">
                    暂无书签记录
                  </p>
                  <p className="text-[11px] text-neutral-400/80 max-w-[200px] mx-auto">
                    在阅读中点击上方「+ 添加书签」快速记录当前页
                  </p>
                </div>
              ) : (
                bookmarks.map((bm) => (
                  <div
                    key={bm.id}
                    className="group relative flex flex-col justify-between rounded-2xl border border-black/[0.06] bg-black/[0.02] p-3.5 transition hover:border-blue-500/40 hover:bg-black/[0.04] dark:border-white/[0.06] dark:bg-white/[0.03] dark:hover:border-blue-400/40 dark:hover:bg-white/[0.05]"
                  >
                    <button
                      type="button"
                      onClick={() => onNavigate(bm.cfi)}
                      className="text-left text-xs font-medium leading-relaxed text-neutral-800 dark:text-neutral-200 line-clamp-3 hover:text-blue-600 dark:hover:text-blue-400 transition"
                    >
                      {bm.text || '书签位置'}
                    </button>
                    <div className="mt-3 flex items-center justify-between text-[10px] text-neutral-400 dark:text-neutral-500">
                      <span>{new Date(bm.createdAt).toLocaleDateString()}</span>
                      <button
                        type="button"
                        onClick={(e) => {
                          e.stopPropagation()
                          onDeleteBookmark(bm.id)
                        }}
                        className="text-red-500/80 hover:text-red-600 dark:text-red-400 opacity-0 group-hover:opacity-100 transition font-medium hover:underline"
                      >
                        删除
                      </button>
                    </div>
                  </div>
                ))
              )}
            </div>
          )}
        </div>
      </aside>
    </div>
  )
}

function TocList({
  items,
  activeTocId,
  onNavigate,
  depth,
}: {
  items: TocItem[]
  activeTocId: string | null
  onNavigate: (href: string) => void
  depth: number
}) {
  return (
    <ul
      className={`space-y-0.5 ${
        depth > 0 ? 'ml-3.5 border-l border-black/[0.08] pl-3 dark:border-white/[0.08]' : ''
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
                  : 'text-neutral-700 hover:bg-black/[0.04] dark:text-neutral-300 dark:hover:bg-white/[0.06]'
              }`}
            >
              <span className="line-clamp-1">{item.label.trim() || '未命名章节'}</span>
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
              />
            )}
          </li>
        )
      })}
    </ul>
  )
}
