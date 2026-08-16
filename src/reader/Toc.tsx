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
    <div className="fixed inset-y-0 left-0 z-50 flex w-80 flex-col border-r border-neutral-200 bg-white/95 shadow-2xl backdrop-blur-md dark:border-neutral-800 dark:bg-neutral-900/95 dark:text-neutral-100">
      <div className="flex items-center justify-between border-b border-neutral-200 px-5 py-4 dark:border-neutral-800">
        <div className="flex gap-2">
          <button
            type="button"
            onClick={() => setTab('toc')}
            className={`rounded-lg px-3 py-1 text-xs font-semibold transition ${
              tab === 'toc'
                ? 'bg-neutral-900 text-white dark:bg-neutral-100 dark:text-neutral-900'
                : 'text-neutral-600 hover:bg-neutral-100 dark:text-neutral-400 dark:hover:bg-neutral-800'
            }`}
          >
            目录 ({toc.length})
          </button>
          <button
            type="button"
            onClick={() => setTab('bookmarks')}
            className={`rounded-lg px-3 py-1 text-xs font-semibold transition ${
              tab === 'bookmarks'
                ? 'bg-neutral-900 text-white dark:bg-neutral-100 dark:text-neutral-900'
                : 'text-neutral-600 hover:bg-neutral-100 dark:text-neutral-400 dark:hover:bg-neutral-800'
            }`}
          >
            书签 ({bookmarks.length})
          </button>
        </div>
        <button
          type="button"
          onClick={onClose}
          className="rounded-full p-1.5 text-neutral-400 hover:bg-neutral-100 hover:text-neutral-600 dark:hover:bg-neutral-800 dark:hover:text-neutral-200"
          aria-label="关闭抽屉"
        >
          ✕
        </button>
      </div>

      <div className="flex-1 overflow-y-auto p-4">
        {tab === 'toc' ? (
          <div className="space-y-1">
            {toc.length === 0 ? (
              <p className="py-8 text-center text-xs text-neutral-400">此书无目录信息</p>
            ) : (
              <TocList items={toc} currentHref={currentHref} onNavigate={onNavigate} depth={0} />
            )}
          </div>
        ) : (
          <div className="space-y-3">
            <div className="flex justify-between items-center pb-2 border-b border-neutral-100 dark:border-neutral-800">
              <span className="text-xs text-neutral-500">已保存 {bookmarks.length} 条书签</span>
              <button
                type="button"
                onClick={onAddBookmark}
                disabled={!currentCfi}
                className="rounded-md bg-blue-600 px-2.5 py-1 text-xs font-medium text-white transition hover:bg-blue-700 disabled:opacity-50"
              >
                + 添加当前页书签
              </button>
            </div>

            {bookmarks.length === 0 ? (
              <p className="py-8 text-center text-xs text-neutral-400">暂无书签，点击上方按钮添加</p>
            ) : (
              bookmarks.map((bm) => (
                <div
                  key={bm.id}
                  className="group flex flex-col justify-between rounded-lg border border-neutral-200 p-3 transition hover:border-blue-400 hover:bg-neutral-50 dark:border-neutral-800 dark:hover:border-blue-500 dark:hover:bg-neutral-800/50"
                >
                  <button
                    type="button"
                    onClick={() => onNavigate(bm.cfi)}
                    className="text-left text-xs text-neutral-800 dark:text-neutral-200 line-clamp-3 hover:underline"
                  >
                    {bm.text || '书签位置'}
                  </button>
                  <div className="mt-2 flex items-center justify-between text-[10px] text-neutral-400">
                    <span>{new Date(bm.createdAt).toLocaleDateString()}</span>
                    <button
                      type="button"
                      onClick={(e) => {
                        e.stopPropagation()
                        onDeleteBookmark(bm.id)
                      }}
                      className="text-red-500 hover:underline opacity-0 group-hover:opacity-100 transition"
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
    <ul className={`space-y-0.5 ${depth > 0 ? 'ml-3 border-l border-neutral-200 pl-2 dark:border-neutral-700' : ''}`}>
      {items.map((item) => {
        const isCurrent = currentHref && (currentHref.endsWith(item.href) || item.href.endsWith(currentHref))
        return (
          <li key={item.id || item.href}>
            <button
              type="button"
              onClick={() => onNavigate(item.href)}
              className={`w-full rounded-md px-2.5 py-1.5 text-left text-xs transition ${
                isCurrent
                  ? 'bg-blue-50 font-semibold text-blue-700 dark:bg-blue-950/40 dark:text-blue-400'
                  : 'text-neutral-700 hover:bg-neutral-100 dark:text-neutral-300 dark:hover:bg-neutral-800'
              }`}
            >
              <span className="line-clamp-1">{item.label.trim() || '未命名章节'}</span>
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
