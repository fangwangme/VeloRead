import { useRef, useState } from 'react'
import { useLibrary } from './store'
import { BookCover } from './BookCover'
import type { AppSettings, BookRecord } from '../platform/types'
import { StatsModal } from '../stats/StatsModal'
import { AppSettingsModal } from '../settings/AppSettingsModal'
import { IconSettings, IconStats } from '../ui/icons'

export function Library({
  appSettings,
  onAppSettingsChange,
}: {
  appSettings: AppSettings
  onAppSettingsChange: (changes: Partial<AppSettings>) => Promise<void>
}) {
  const books = useLibrary((s) => s.books)
  const loading = useLibrary((s) => s.loading)
  const importing = useLibrary((s) => s.importing)
  const error = useLibrary((s) => s.error)
  const importFiles = useLibrary((s) => s.importFiles)
  const dismissError = useLibrary((s) => s.dismissError)

  const inputRef = useRef<HTMLInputElement>(null)
  const [dragging, setDragging] = useState(false)
  const [showStats, setShowStats] = useState(false)
  const [showSettings, setShowSettings] = useState(false)

  function onDrop(event: React.DragEvent) {
    event.preventDefault()
    setDragging(false)
    void importFiles(Array.from(event.dataTransfer.files))
  }

  return (
    <div
      className="min-h-dvh bg-[#FBFBFA] text-neutral-900 dark:bg-[#121214] dark:text-neutral-100 transition-colors duration-200"
      onDragOver={(event) => {
        event.preventDefault()
        setDragging(true)
      }}
      onDragLeave={(event) => {
        if (!event.currentTarget.contains(event.relatedTarget as Node | null)) {
          setDragging(false)
        }
      }}
      onDrop={onDrop}
    >
      {/* Top Navbar */}
      <header className="sticky top-0 z-30 flex items-center justify-between gap-4 px-8 pt-8 pb-5 backdrop-blur-md bg-[#FBFBFA]/80 dark:bg-[#121214]/80 border-b border-black/[0.04] dark:border-white/[0.04]">
        <div>
          <h1 className="text-xl font-bold tracking-tight">书库</h1>
          <p className="text-xs text-neutral-500 dark:text-neutral-400 mt-0.5 font-medium">
            {books.length > 0 ? `已收录 ${books.length} 本图书` : '藏书阁'}
          </p>
        </div>
        <div className="flex items-center gap-2.5">
          <button
            type="button"
            className="flex items-center gap-1.5 rounded-full border border-black/[0.08] bg-white/80 px-3.5 py-1.5 text-xs font-medium text-neutral-800 shadow-[0_1px_3px_rgba(0,0,0,0.06)] backdrop-blur-md transition hover:bg-white hover:border-black/20 dark:border-white/[0.08] dark:bg-white/[0.05] dark:text-neutral-200 dark:hover:bg-white/[0.1] active:scale-95"
            onClick={() => setShowSettings(true)}
            title="调整应用外观与阅读目标"
          >
            <IconSettings className="opacity-75" />
            <span>应用设置</span>
          </button>
          <button
            type="button"
            className="flex items-center gap-1.5 rounded-full border border-black/[0.08] bg-white/80 px-3.5 py-1.5 text-xs font-medium text-neutral-800 shadow-[0_1px_3px_rgba(0,0,0,0.06)] backdrop-blur-md transition hover:bg-white hover:border-black/20 dark:border-white/[0.08] dark:bg-white/[0.05] dark:text-neutral-200 dark:hover:bg-white/[0.1] active:scale-95"
            onClick={() => setShowStats(true)}
            title="查看阅读数据与热力图"
          >
            <IconStats className="opacity-75" />
            <span>阅读统计</span>
          </button>
          <button
            type="button"
            className="rounded-full bg-neutral-900 px-4 py-1.5 text-xs font-medium text-white shadow-[0_1px_4px_rgba(0,0,0,0.12)] transition hover:bg-neutral-800 disabled:opacity-50 dark:bg-neutral-100 dark:text-neutral-900 dark:hover:bg-neutral-200 active:scale-95"
            disabled={importing !== null}
            onClick={() => inputRef.current?.click()}
          >
            {importing ? `导入中 ${importing}…` : '+ 导入 EPUB'}
          </button>
        </div>
        <input
          ref={inputRef}
          type="file"
          accept=".epub,application/epub+zip"
          multiple
          className="hidden"
          onChange={(event) => {
            void importFiles(Array.from(event.target.files ?? []))
            event.target.value = ''
          }}
        />
      </header>

      {error && (
        <div className="mx-8 mt-4 flex items-start justify-between gap-4 rounded-2xl border border-red-200 bg-red-50/80 px-4 py-3 text-xs text-red-800 dark:border-red-900/60 dark:bg-red-950/40 dark:text-red-300">
          <span>{error}</span>
          <button type="button" className="shrink-0 underline font-medium" onClick={dismissError}>
            忽略
          </button>
        </div>
      )}

      {/* Main Bookshelf Grid */}
      <main className="px-8 pt-6 pb-20">
        {loading ? (
          <div className="flex items-center justify-center py-32 text-xs text-neutral-400">
            正在载入书库…
          </div>
        ) : books.length === 0 ? (
          <EmptyState onPick={() => inputRef.current?.click()} />
        ) : (
          <ul className="grid grid-cols-[repeat(auto-fill,minmax(9.5rem,1fr))] gap-x-7 gap-y-9">
            {books.map((book) => (
              <BookTile key={book.id} book={book} />
            ))}
          </ul>
        )}
      </main>

      {dragging && (
        <div className="pointer-events-none fixed inset-4 z-40 rounded-3xl border-2 border-dashed border-blue-500/80 bg-blue-500/[0.06] backdrop-blur-xs flex items-center justify-center">
          <div className="rounded-2xl bg-white/90 dark:bg-neutral-900/90 px-6 py-3 shadow-xl text-xs font-semibold text-blue-600 dark:text-blue-400">
            释放鼠标即可导入书籍
          </div>
        </div>
      )}

      {showStats && (
        <StatsModal
          dailyGoalMinutes={appSettings.dailyReadingGoalMinutes ?? 15}
          onClose={() => setShowStats(false)}
        />
      )}
      {showSettings && (
        <AppSettingsModal
          settings={appSettings}
          onChange={onAppSettingsChange}
          onClose={() => setShowSettings(false)}
        />
      )}
    </div>
  )
}

function BookTile({ book }: { book: BookRecord }) {
  const openBook = useLibrary((s) => s.openBook)
  const removeBook = useLibrary((s) => s.removeBook)

  return (
    <li className="group relative">
      <button
        type="button"
        className="block w-full cursor-pointer text-left focus:outline-none"
        onClick={() => openBook(book.id)}
      >
        <div className="aspect-2/3 w-full rounded-lg shadow-[0_6px_18px_rgba(0,0,0,0.12),0_1px_3px_rgba(0,0,0,0.06)] transition-all duration-200 group-hover:-translate-y-1.5 group-hover:shadow-[0_16px_32px_rgba(0,0,0,0.18),0_2px_6px_rgba(0,0,0,0.08)]">
          <BookCover book={book} />
        </div>
        <p className="mt-2.5 line-clamp-2 text-xs font-semibold leading-snug tracking-tight text-neutral-800 dark:text-neutral-200 group-hover:text-blue-600 dark:group-hover:text-blue-400 transition">
          {book.title}
        </p>
        {book.author && (
          <p className="mt-0.5 line-clamp-1 text-[11px] text-neutral-400 dark:text-neutral-500">
            {book.author}
          </p>
        )}
      </button>

      {/* Quick delete button */}
      <button
        type="button"
        aria-label={`删除 ${book.title}`}
        className="absolute top-2 right-2 hidden size-6 rounded-full bg-black/60 text-xs text-white backdrop-blur-md group-hover:flex items-center justify-center hover:bg-red-600 transition shadow-sm"
        onClick={(e) => {
          e.stopPropagation()
          if (confirm(`确定从书库移除《${book.title}》吗？`)) void removeBook(book.id)
        }}
      >
        ✕
      </button>
    </li>
  )
}

function EmptyState({ onPick }: { onPick: () => void }) {
  return (
    <div className="mt-12 flex flex-col items-center justify-center gap-3 rounded-3xl border border-dashed border-black/[0.08] dark:border-white/[0.08] bg-black/[0.01] dark:bg-white/[0.01] py-24 text-center px-6">
      <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-black/[0.04] dark:bg-white/[0.06] text-neutral-400 dark:text-neutral-500 mb-1">
        📖
      </div>
      <p className="text-sm font-semibold tracking-tight text-neutral-800 dark:text-neutral-200">
        书库空空如也
      </p>
      <p className="max-w-xs text-xs text-neutral-400 dark:text-neutral-500 leading-relaxed">
        将 <code>.epub</code> 电子书拖拽到此处，或点击下方按钮从本地选取书籍。
      </p>
      <button
        type="button"
        className="mt-2 rounded-full border border-black/[0.1] dark:border-white/[0.1] bg-white dark:bg-neutral-800 px-4 py-2 text-xs font-medium text-neutral-800 dark:text-neutral-200 shadow-2xs transition hover:bg-neutral-50 dark:hover:bg-neutral-700 active:scale-95"
        onClick={onPick}
      >
        选择文件
      </button>
    </div>
  )
}
