import { useEffect, useMemo, useRef, useState } from 'react'
import { getStorage } from '../platform'
import type { Bookmark, BookSettings, ReadingProgress, TocItem } from '../platform/types'
import { useLibrary } from '../library/store'
import { createReader, type ReaderHandle, type ReaderLocation } from './renderer'
import { PRESETS } from './styles/presets'
import type { StyleId, StyleOverride } from './styles/types'
import { resolveStyle } from './styles/resolve'
import { SettingsPanel } from './SettingsPanel'
import { Toc } from './Toc'
import { PositionInfo } from './PositionInfo'
import { Overlay } from './pacer/Overlay'
import { usePacer } from './pacer/usePacer'

const SAVE_DEBOUNCE_MS = 400
const RESIZE_DEBOUNCE_MS = 150

export function Reader({ bookId }: { bookId: string }) {
  const closeBook = useLibrary((s) => s.closeBook)
  const book = useLibrary((s) => s.books.find((candidate) => candidate.id === bookId))
  const bookLanguage = book?.language

  const containerRef = useRef<HTMLDivElement>(null)
  const handleRef = useRef<ReaderHandle | null>(null)
  const [handle, setHandle] = useState<ReaderHandle | null>(null)

  const [ready, setReady] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [location, setLocation] = useState<ReaderLocation | null>(null)
  const [percentage, setPercentage] = useState<number | null>(0)

  // Settings & Style
  const [styleId, setStyleId] = useState<StyleId>('book')
  const [overrides, setOverrides] = useState<StyleOverride>({})
  const [flow, setFlow] = useState<'paginated' | 'scrolled-doc'>('paginated')
  const [autoNightMode, setAutoNightMode] = useState(false)

  // UI Panels
  const [showSettings, setShowSettings] = useState(false)
  const [showToc, setShowToc] = useState(false)
  const [toc, setToc] = useState<TocItem[]>([])
  const [bookmarks, setBookmarks] = useState<Bookmark[]>([])

  // Jump History (1-level)
  const [jumpOrigin, setJumpOrigin] = useState<string | null>(null)

  // Pacer state
  const [pacerWpm, setPacerWpm] = useState(250)
  const [pacerChunkSize, setPacerChunkSize] = useState(3)
  const [showPacerControls, setShowPacerControls] = useState(false)

  // Compute resolved style
  const resolvedStyle = useMemo(() => {
    // If auto night mode enabled and system is dark, force night preset base
    const isSystemDark =
      typeof window !== 'undefined' && window.matchMedia?.('(prefers-color-scheme: dark)')?.matches
    const effectiveStyleId = autoNightMode && isSystemDark ? 'night' : styleId
    const base = PRESETS[effectiveStyleId] ?? PRESETS.book
    return resolveStyle(base, overrides)
  }, [styleId, overrides, autoNightMode])

  // Pacer hook
  const pacer = usePacer({
    readerHandle: handle,
    containerRef,
    wpm: pacerWpm,
    chunkSize: pacerChunkSize,
    accentColor: resolvedStyle.palette.accent,
  })

  const pacerRef = useRef(pacer)
  const showSettingsRef = useRef(showSettings)
  const showTocRef = useRef(showToc)

  useEffect(() => {
    pacerRef.current = pacer
    showSettingsRef.current = showSettings
    showTocRef.current = showToc
  })

  // Measure-based maxWidth calculation
  const measureMaxWidthPx = useMemo(() => {
    const isCjk = Boolean(resolvedStyle.body.isCjk)
    const ch = resolvedStyle.body.measureCh
    const fontSize = resolvedStyle.body.fontSizePx
    return isCjk ? ch * fontSize : Math.round(ch * fontSize * 0.55)
  }, [resolvedStyle])

  // Main lifecycle
  useEffect(() => {
    let cancelled = false
    let reader: ReaderHandle | null = null
    let saveTimer: ReturnType<typeof setTimeout> | undefined
    let unsaved: ReadingProgress | null = null
    let lastKnownPercentage: number | null = 0

    async function flush() {
      clearTimeout(saveTimer)
      const progress = unsaved
      unsaved = null
      if (!progress) return
      try {
        await (await getStorage()).saveProgress(progress)
      } catch {
        // Non-fatal
      }
    }

    async function flushAndRefreshShelf() {
      await flush()
      await useLibrary.getState().load()
    }

    function onKeyDown(event: KeyboardEvent) {
      // Space: toggle Pacer (prevent scroll)
      if (event.code === 'Space' || event.key === ' ') {
        event.preventDefault()
        pacerRef.current.toggle()
        return
      }

      if (event.key === 'ArrowRight' || event.key === 'PageDown') {
        event.preventDefault()
        if (pacerRef.current.isPlaying) {
          pacerRef.current.nextChunk()
        } else {
          void handleRef.current?.next()
        }
      } else if (event.key === 'ArrowLeft' || event.key === 'PageUp') {
        event.preventDefault()
        if (pacerRef.current.isPlaying) {
          pacerRef.current.prevChunk()
        } else {
          void handleRef.current?.prev()
        }
      } else if (event.key === 'Escape') {
        event.preventDefault()
        if (showSettingsRef.current) {
          setShowSettings(false)
        } else if (showTocRef.current) {
          setShowToc(false)
        } else {
          closeBook()
        }
      } else if (event.key === 't' || event.key === 'T') {
        if (!showSettingsRef.current) {
          setShowToc((v) => !v)
        }
      } else if (event.key === 'a' || event.key === 'A') {
        if (!showTocRef.current) {
          setShowSettings((v) => !v)
        }
      }
    }

    window.addEventListener('keydown', onKeyDown)

    void (async () => {
      try {
        const storage = await getStorage()
        const [data, savedProgress, savedSettings, savedBookmarks, appSettings] = await Promise.all([
          storage.readBookFile(bookId),
          storage.getProgress(bookId),
          storage.getBookSettings(bookId),
          storage.listBookmarks(bookId),
          storage.getAppSettings(),
        ])

        if (cancelled || !containerRef.current) return

        // Determine default style: zh* -> song, else book
        const isChinese = bookLanguage?.toLowerCase().startsWith('zh')
        const initialStyleId: StyleId = savedSettings?.styleId ?? (isChinese ? 'song' : 'book')
        const initialOverrides: StyleOverride = savedSettings?.overrides ?? {}
        const initialFlow = savedSettings?.flow ?? 'paginated'

        setStyleId(initialStyleId)
        setOverrides(initialOverrides)
        setFlow(initialFlow)
        setBookmarks(savedBookmarks)
        if (appSettings.autoNightMode !== undefined) {
          setAutoNightMode(appSettings.autoNightMode)
        }
        if (appSettings.pacerWpm) setPacerWpm(appSettings.pacerWpm)
        if (appSettings.pacerChunkSize) setPacerChunkSize(appSettings.pacerChunkSize)

        lastKnownPercentage = savedProgress?.percentage ?? null
        setPercentage(lastKnownPercentage)

        const initialResolved = resolveStyle(
          PRESETS[initialStyleId] ?? PRESETS.book,
          initialOverrides,
        )

        reader = await createReader(containerRef.current, data, savedProgress?.cfi ?? null, {
          flow: initialFlow,
          style: initialResolved,
          onKeyDown,
          onLocation(loc) {
            if (cancelled) return
            setLocation(loc)
            if (loc.percentage !== null) {
              lastKnownPercentage = loc.percentage
              setPercentage(loc.percentage)
            }
            unsaved = {
              bookId,
              cfi: loc.cfi,
              percentage: lastKnownPercentage ?? 0,
              updatedAt: new Date().toISOString(),
            }
            clearTimeout(saveTimer)
            saveTimer = setTimeout(() => void flush(), SAVE_DEBOUNCE_MS)

            // Recalculate pacer geometry on page turn
            setTimeout(() => {
              pacerRef.current.recalculateGeometry()
            }, 50)
          },
        })

        if (cancelled) {
          reader.destroy()
          return
        }

        handleRef.current = reader
        setHandle(reader)

        // Load TOC
        void reader.getToc().then((items) => {
          if (!cancelled) setToc(items)
        })

        setReady(true)
      } catch (cause) {
        if (!cancelled) setError(cause instanceof Error ? cause.message : String(cause))
      }
    })()

    return () => {
      cancelled = true
      window.removeEventListener('keydown', onKeyDown)
      void flushAndRefreshShelf()
      handleRef.current = null
      setHandle(null)
      reader?.destroy()
    }
  }, [bookId, bookLanguage, closeBook])

  // Apply style updates
  useEffect(() => {
    if (handleRef.current && ready) {
      handleRef.current.applyStyle(resolvedStyle)
      // Recalculate Pacer positions after style applied
      setTimeout(() => {
        pacerRef.current.recalculateGeometry()
      }, 50)
    }
  }, [resolvedStyle, ready])

  // Save book settings changes
  const saveCurrentSettings = async (
    newStyleId: StyleId,
    newOverrides: StyleOverride,
    newFlow: 'paginated' | 'scrolled-doc',
  ) => {
    try {
      const storage = await getStorage()
      const bookSettings: BookSettings = {
        bookId,
        styleId: newStyleId,
        overrides: newOverrides,
        flow: newFlow,
        updatedAt: new Date().toISOString(),
      }
      await storage.saveBookSettings(bookSettings)
    } catch {
      // Non-fatal
    }
  }

  const handleStyleSelect = (id: StyleId) => {
    setStyleId(id)
    void saveCurrentSettings(id, overrides, flow)
  }

  const handleOverridesChange = (newOverrides: StyleOverride) => {
    setOverrides(newOverrides)
    void saveCurrentSettings(styleId, newOverrides, flow)
  }

  const handleFlowChange = async (newFlow: 'paginated' | 'scrolled-doc') => {
    setFlow(newFlow)
    if (handleRef.current) {
      await handleRef.current.setFlow(newFlow)
      pacer.recalculateGeometry()
    }
    void saveCurrentSettings(styleId, overrides, newFlow)
  }

  const handleAutoNightModeChange = async (enabled: boolean) => {
    setAutoNightMode(enabled)
    try {
      const storage = await getStorage()
      await storage.saveAppSettings({ autoNightMode: enabled })
    } catch {
      // Non-fatal
    }
  }

  const handleNavigate = (target: string) => {
    if (location?.cfi) {
      setJumpOrigin(location.cfi)
    }
    void handleRef.current?.display(target)
    setShowToc(false)
  }

  const handleJumpBack = () => {
    if (jumpOrigin) {
      void handleRef.current?.display(jumpOrigin)
      setJumpOrigin(null)
    }
  }

  const handleAddBookmark = async () => {
    if (!location?.cfi) return
    const excerpt = location.chapterTitle || `位置 ${Math.round((percentage ?? 0) * 100)}%`
    const newBm: Bookmark = {
      id: crypto.randomUUID(),
      bookId,
      cfi: location.cfi,
      text: excerpt,
      createdAt: new Date().toISOString(),
    }
    try {
      const storage = await getStorage()
      await storage.addBookmark(newBm)
      setBookmarks((prev) => [...prev, newBm])
    } catch {
      // Non-fatal
    }
  }

  const handleDeleteBookmark = async (id: string) => {
    try {
      const storage = await getStorage()
      await storage.deleteBookmark(id)
      setBookmarks((prev) => prev.filter((b) => b.id !== id))
    } catch {
      // Non-fatal
    }
  }

  // Window resize handler with deduplication
  useEffect(() => {
    const container = containerRef.current
    if (!container) return

    let applied = { width: container.clientWidth, height: container.clientHeight }
    let timer: ReturnType<typeof setTimeout> | undefined

    const observer = new ResizeObserver(() => {
      clearTimeout(timer)
      timer = setTimeout(() => {
        const width = container.clientWidth
        const height = container.clientHeight
        if (width === 0 || height === 0) return
        if (width === applied.width && height === applied.height) return
        applied = { width, height }
        handleRef.current?.resize(width, height)
        pacerRef.current.recalculateGeometry()
      }, RESIZE_DEBOUNCE_MS)
    })
    observer.observe(container)

    return () => {
      clearTimeout(timer)
      observer.disconnect()
    }
  }, [])

  return (
    <div
      className="flex h-dvh flex-col select-none transition-colors duration-200"
      style={{
        backgroundColor: resolvedStyle.palette.background,
        color: resolvedStyle.palette.text,
      }}
    >
      {/* Top Header Bar */}
      <header className="flex shrink-0 items-center justify-between gap-4 px-6 pt-6 pb-2 border-b border-black/5 dark:border-white/5">
        <div className="flex items-center gap-2">
          <button
            type="button"
            className="rounded-lg border border-black/10 px-3 py-1.5 text-xs font-medium transition hover:bg-black/5 dark:border-white/10 dark:hover:bg-white/5"
            onClick={closeBook}
          >
            ← 书库
          </button>
          <button
            type="button"
            className="rounded-lg border border-black/10 px-3 py-1.5 text-xs font-medium transition hover:bg-black/5 dark:border-white/10 dark:hover:bg-white/5"
            onClick={() => setShowToc((v) => !v)}
            title="目录与书签 (T)"
          >
            ☰ 目录
          </button>
        </div>

        <div className="min-w-0 flex-1 text-center">
          <p className="truncate text-xs font-semibold">{book?.title ?? '正在阅读'}</p>
          {location?.chapterTitle && (
            <p className="truncate text-[10px] opacity-75">{location.chapterTitle}</p>
          )}
        </div>

        <div className="flex items-center gap-2">
          {jumpOrigin && (
            <button
              type="button"
              onClick={handleJumpBack}
              className="rounded-lg bg-blue-500/20 px-2.5 py-1 text-xs font-medium text-blue-600 dark:text-blue-400 hover:bg-blue-500/30 transition"
              title="返回跳转前的位置"
            >
              ↩ 返回原位
            </button>
          )}
          <button
            type="button"
            className="rounded-lg border border-black/10 px-3 py-1.5 text-xs font-medium transition hover:bg-black/5 dark:border-white/10 dark:hover:bg-white/5"
            onClick={() => setShowSettings((v) => !v)}
            title="排版与显示设置 (A)"
          >
            Aa
          </button>
        </div>
      </header>

      {/* Main Reader Surface */}
      <div className="relative min-h-0 flex-1 flex justify-center items-center overflow-hidden">
        {/* Book Container with measure constraint */}
        <div
          style={{
            maxWidth: `${measureMaxWidthPx}px`,
            width: '100%',
            height: '100%',
          }}
          className="relative mx-auto h-full w-full px-4 py-2"
        >
          <div ref={containerRef} className="h-full w-full" />
          {/* Pacer Highlight Overlay */}
          <Overlay
            rect={pacer.overlayRect}
            animMs={pacer.currentChunk?.animMs}
            accentColor={resolvedStyle.palette.accent}
          />
        </div>

        {!ready && !error && (
          <p className="absolute inset-0 flex items-center justify-center text-xs opacity-60">
            正在载入书籍…
          </p>
        )}
        {error && (
          <div className="absolute inset-0 flex flex-col items-center justify-center gap-3 px-6 text-center">
            <p className="text-xs text-red-600 dark:text-red-400">无法打开此书籍: {error}</p>
            <button type="button" className="text-xs underline" onClick={closeBook}>
              返回书库
            </button>
          </div>
        )}
      </div>

      {/* Bottom Footer with Position Info & Pacer Bar */}
      <footer className="flex shrink-0 flex-col items-center justify-center gap-2 px-6 pt-2 pb-5 border-t border-black/5 dark:border-white/5 text-xs">
        {/* Pacer Control Bar */}
        <div className="flex items-center gap-3 w-full max-w-lg justify-between">
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={pacer.toggle}
              className="rounded-full bg-blue-600 px-3.5 py-1 text-xs font-medium text-white shadow-sm transition hover:bg-blue-700 flex items-center gap-1"
            >
              {pacer.isPlaying ? '❚❚ 暂停' : '▶ 自动阅读'}
            </button>

            <button
              type="button"
              onClick={() => setShowPacerControls((v) => !v)}
              className="rounded-md border border-black/10 px-2 py-1 text-[11px] hover:bg-black/5 dark:border-white/10 dark:hover:bg-white/5"
            >
              {pacerWpm} wpm · {pacerChunkSize}词
            </button>

            {pacer.speedWarning && (
              <span className="text-[10px] text-amber-600 dark:text-amber-400" title="超过 500 wpm 后理解率会显著下降">
                ⚠️ 极速模式（理解率或下降）
              </span>
            )}
          </div>

          <div className="flex items-center gap-2">
            <button
              type="button"
              className="rounded-md px-2.5 py-1 transition hover:bg-black/5 dark:hover:bg-white/5"
              onClick={() => void handleRef.current?.prev()}
              title="上一页 (←)"
            >
              ← 上一页
            </button>
            <button
              type="button"
              className="rounded-md px-2.5 py-1 transition hover:bg-black/5 dark:hover:bg-white/5"
              onClick={() => void handleRef.current?.next()}
              title="下一页 (→)"
            >
              下一页 →
            </button>
          </div>
        </div>

        {/* Extended Pacer Settings Bar */}
        {showPacerControls && (
          <div className="flex items-center gap-4 py-2 px-4 rounded-xl border border-black/10 dark:border-white/10 bg-black/5 dark:bg-white/5 text-[11px]">
            <div className="flex items-center gap-2">
              <span>速度:</span>
              <input
                type="range"
                min={100}
                max={1000}
                step={25}
                value={pacerWpm}
                onChange={(e) => {
                  const val = Number(e.target.value)
                  setPacerWpm(val)
                  void getStorage().then((s) => s.saveAppSettings({ pacerWpm: val }))
                }}
                className="w-24 accent-blue-600"
              />
              <span className="tabular-nums">{pacerWpm} wpm</span>
            </div>

            <div className="flex items-center gap-2">
              <span>词数/块:</span>
              <div className="flex rounded border border-black/10 dark:border-white/10 overflow-hidden">
                {[1, 2, 3, 4, 5].map((size) => (
                  <button
                    key={size}
                    type="button"
                    onClick={() => {
                      setPacerChunkSize(size)
                      void getStorage().then((s) => s.saveAppSettings({ pacerChunkSize: size }))
                    }}
                    className={`px-2 py-0.5 ${
                      pacerChunkSize === size
                        ? 'bg-blue-600 text-white font-semibold'
                        : 'hover:bg-black/5 dark:hover:bg-white/5'
                    }`}
                  >
                    {size}
                  </button>
                ))}
              </div>
            </div>
          </div>
        )}

        {/* Position Info */}
        <PositionInfo
          chapterTitle={location?.chapterTitle}
          pagesLeftInChapter={location?.pagesLeftInChapter}
          percentage={percentage}
        />
      </footer>

      {/* Settings Modal */}
      {showSettings && (
        <SettingsPanel
          currentStyleId={styleId}
          overrides={overrides}
          flow={flow}
          autoNightMode={autoNightMode}
          onStyleSelect={handleStyleSelect}
          onOverridesChange={handleOverridesChange}
          onFlowChange={handleFlowChange}
          onAutoNightModeChange={handleAutoNightModeChange}
          onClose={() => setShowSettings(false)}
        />
      )}

      {/* TOC & Bookmarks Drawer */}
      {showToc && (
        <Toc
          toc={toc}
          bookmarks={bookmarks}
          currentHref={location?.href ?? null}
          currentCfi={location?.cfi ?? null}
          onNavigate={handleNavigate}
          onAddBookmark={handleAddBookmark}
          onDeleteBookmark={handleDeleteBookmark}
          onClose={() => setShowToc(false)}
        />
      )}
    </div>
  )
}
