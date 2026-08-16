import { useState } from 'react'
import type { Bookmark, TocItem } from '../platform/types'

interface TocProps {
  toc: TocItem[]
  bookmarks: Bookmark[]
  currentHref: string | null
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
  currentCfi,
  onNavigate,
  onAddBookmark,
  onDeleteBookmark,
  onClose,
}: TocProps) {
  const [tab, setTab] = useState<'toc' | 'bookmarks'>('toc')

  return (
    <>
      {/* Backdrop overlay for focus */}
      <div
        className="fixed inset-0 z-40 bg-black/20 backdrop-blur-xs transition-opacity duration-200"
        onClick={onClose}
        aria-hidden="true"
      />

      {/* Floating Side Drawer */}
      <div className="fixed inset-y-0 left-0 z-50 flex w-88 flex-col border-r border-black/10 bg-white/95 shadow-2xl backdrop-blur-2xl dark:border-white/10 dark:bg-neutral-900/95 dark:text-neutral-100 animate-in slide-in-from-left duration-200">
        <div className="flex items-center justify-between border-b border-black/5 px-5 py-4 dark:border-white/5">
          <div className="flex rounded-xl bg-black/[0.04] p-0.5 dark:bg-white/[0.06]">
            <button
              type="button"
              onClick={() => setTab('toc')}
              className={`rounded-lg px-3 py-1 text-xs font-semibold transition ${
                tab === 'toc'
                  ? 'bg-white text-neutral-900 shadow-xs dark:bg-neutral-800 dark:text-white'
                  : 'text-neutral-500 hover:text-neutral-800 dark:text-neutral-400 dark:hover:text-white'
              }`}
            >
              目录 ({toc.length})
            </button>
            <button
              type="button"
              onClick={() => setTab('bookmarks')}
              className={`rounded-lg px-3 py-1 text-xs font-semibold transition ${
                tab === 'bookmarks'
                  ? 'bg-white text-neutral-900 shadow-xs dark:bg-neutral-800 dark:text-white'
                  : 'text-neutral-500 hover:text-neutral-800 dark:text-neutral-400 dark:hover:text-white'
              }`}
            >
              书签 ({bookmarks.length})
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

        <div className="flex-1 overflow-y-auto p-4">
          {tab === 'toc' ? (
            <div className="space-y-1">
              {toc.length === 0 ? (
                <div className="py-16 text-center text-xs text-neutral-400">此书籍未提供目录导航</div>
              ) : (
                <TocList items={toc} currentHref={currentHref} onNavigate={onNavigate} depth={0} />
              )}
            </div>
          ) : (
            <div className="space-y-3">
              <div className="flex justify-between items-center pb-2.5 border-b border-black/5 dark:border-white/5">
                <span className="text-xs text-neutral-500 font-medium">已保存 {bookmarks.length} 处书签</span>
                <button
                  type="button"
                  onClick={onAddBookmark}
                  disabled={!currentCfi}
                  className="rounded-lg bg-blue-600 px-3 py-1.5 text-xs font-semibold text-white shadow-xs transition hover:bg-blue-700 active:scale-95 disabled:opacity-40"
                >
                  + 添加书签
                </button>
              </div>

              {bookmarks.length === 0 ? (
                <div className="py-16 text-center text-xs text-neutral-400">
                  暂无书签，点击上方按钮收藏当前页
                </div>
              ) : (
                bookmarks.map((bm) => (
                  <div
                    key={bm.id}
                    className="group flex flex-col justify-between rounded-xl border border-black/5 bg-black/[0.01] p-3.5 transition hover:border-blue-400/60 hover:bg-black/[0.03] dark:border-white/5 dark:bg-white/[0.02] dark:hover:border-blue-500/60 dark:hover:bg-white/[0.05]"
                  >
                    <button
                      type="button"
                      onClick={() => onNavigate(bm.cfi)}
                      className="text-left text-xs font-medium text-neutral-800 dark:text-neutral-200 line-clamp-3 hover:text-blue-600 dark:hover:text-blue-400 transition"
                    >
                      {bm.text || '书签位置'}
                    </button>
                    <div className="mt-2.5 flex items-center justify-between text-[10px] text-neutral-400">
                      <span>{new Date(bm.createdAt).toLocaleDateString()}</span>
                      <button
                        type="button"
                        onClick={(e) => {
                          e.stopPropagation()
                          onDeleteBookmark(bm.id)
                        }}
                        className="text-red-500 hover:text-red-600 opacity-0 group-hover:opacity-100 transition font-medium"
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
      </div>
    </>
  )
}

function TocList({
  items,
  currentHref,
  onNavigate,
  depth,
}: {
  items: TocItem[]
  currentHref: string | null
  onNavigate: (href: string) => void
  depth: number
}) {
  return (
    <ul className={`space-y-0.5 ${depth > 0 ? 'ml-3 border-l border-black/10 pl-2.5 dark:border-white/10' : ''}`}>
      {items.map((item) => {
        const isCurrent =
          currentHref &&
          (currentHref.endsWith(item.href) ||
            item.href.endsWith(currentHref) ||
            currentHref.split('#')[0] === item.href.split('#')[0])
        return (
          <li key={item.id || item.href}>
            <button
              type="button"
              onClick={() => onNavigate(item.href)}
              className={`group flex w-full items-center justify-between rounded-xl px-3 py-2 text-left text-xs transition ${
                isCurrent
                  ? 'bg-blue-50 font-semibold text-blue-700 dark:bg-blue-950/60 dark:text-blue-300'
                  : 'text-neutral-700 hover:bg-black/[0.04] dark:text-neutral-300 dark:hover:bg-white/[0.06]'
              }`}
            >
              <span className="line-clamp-1">{item.label.trim() || '未命名章节'}</span>
              {isCurrent && <span className="h-1.5 w-1.5 rounded-full bg-blue-600 dark:bg-blue-400" />}
            </button>
            {item.subitems && item.subitems.length > 0 && (
              <TocList items={item.subitems} currentHref={currentHref} onNavigate={onNavigate} depth={depth + 1} />
            )}
          </li>
        )
      })}
    </ul>
  )
}
