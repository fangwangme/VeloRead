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
const AUTO_HIDE_CHROME_MS = 3200

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

  // Immersive Chrome / Controls Visibility (Apple Books auto-hiding navigation)
  const [chromeVisible, setChromeVisible] = useState(true)
  const hideChromeTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)

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
  const showPacerControlsRef = useRef(showPacerControls)

  useEffect(() => {
    pacerRef.current = pacer
    showSettingsRef.current = showSettings
    showTocRef.current = showToc
    showPacerControlsRef.current = showPacerControls
  })

  // Measure-based maxWidth calculation
  const measureMaxWidthPx = useMemo(() => {
    const isCjk = Boolean(resolvedStyle.body.isCjk)
    const ch = resolvedStyle.body.measureCh
    const fontSize = resolvedStyle.body.fontSizePx
    return isCjk ? ch * fontSize : Math.round(ch * fontSize * 0.55)
  }, [resolvedStyle])

  // Auto-hide chrome scheduler
  const pingActivity = () => {
    setChromeVisible(true)
    if (hideChromeTimerRef.current) {
      clearTimeout(hideChromeTimerRef.current)
    }
    // Don't hide if any modal / drawer is open
    if (showSettingsRef.current || showTocRef.current || showPacerControlsRef.current) {
      return
    }
    hideChromeTimerRef.current = setTimeout(() => {
      if (!showSettingsRef.current && !showTocRef.current && !showPacerControlsRef.current) {
        setChromeVisible(false)
      }
    }, AUTO_HIDE_CHROME_MS)
  }

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
      // Any keypress reveals navigation
      pingActivity()

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
    window.addEventListener('mousemove', pingActivity)

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
          onClickText() {
            pingActivity()
          },
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
        pingActivity()
      } catch (cause) {
        if (!cancelled) setError(cause instanceof Error ? cause.message : String(cause))
      }
    })()

    return () => {
      cancelled = true
      window.removeEventListener('keydown', onKeyDown)
      window.removeEventListener('mousemove', pingActivity)
      if (hideChromeTimerRef.current) clearTimeout(hideChromeTimerRef.current)
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

  // Background gradient atmosphere
  const isDarkTheme =
    styleId === 'night' ||
    (autoNightMode &&
      typeof window !== 'undefined' &&
      window.matchMedia?.('(prefers-color-scheme: dark)')?.matches)

  return (
    <div
      className="relative flex h-dvh flex-col select-none transition-colors duration-300 font-sans overflow-hidden"
      style={{
        backgroundColor: resolvedStyle.palette.background,
        color: resolvedStyle.palette.text,
      }}
      onMouseMove={pingActivity}
    >
      {/* Top Header Bar with Apple Books floating glass aesthetic & Auto-hide */}
      <header
        className={`fixed top-0 inset-x-0 z-30 flex items-center justify-between gap-4 px-6 pt-5 pb-3 transition-all duration-300 ${
          chromeVisible
            ? 'opacity-100 translate-y-0 pointer-events-auto'
            : 'opacity-0 -translate-y-4 pointer-events-none'
        }`}
        style={{
          background: `linear-gradient(to bottom, ${resolvedStyle.palette.background}F0 70%, transparent 100%)`,
        }}
      >
        <div className="flex items-center gap-2">
          <button
            type="button"
            className="flex items-center gap-1.5 rounded-full border border-black/10 bg-white/60 px-3.5 py-1.5 text-xs font-medium backdrop-blur-md shadow-xs transition hover:bg-white hover:border-black/20 dark:border-white/10 dark:bg-black/40 dark:hover:bg-black/70"
            onClick={closeBook}
          >
            <span>←</span>
            <span>书库</span>
          </button>
          <button
            type="button"
            className={`flex items-center gap-1.5 rounded-full border px-3.5 py-1.5 text-xs font-medium backdrop-blur-md shadow-xs transition ${
              showToc
                ? 'border-blue-500 bg-blue-50 text-blue-600 dark:bg-blue-950/80 dark:text-blue-400'
                : 'border-black/10 bg-white/60 hover:bg-white hover:border-black/20 dark:border-white/10 dark:bg-black/40 dark:hover:bg-black/70'
            }`}
            onClick={() => {
              setShowToc((v) => !v)
              setChromeVisible(true)
            }}
            title="目录与书签 (T)"
          >
            <span>☰</span>
            <span>目录</span>
          </button>
        </div>

        <div className="min-w-0 flex-1 text-center px-4">
          <p className="truncate text-xs font-semibold tracking-tight opacity-90">
            {book?.title ?? '正在阅读'}
          </p>
          {location?.chapterTitle && (
            <p className="truncate text-[10px] opacity-60 tracking-normal mt-0.5">{location.chapterTitle}</p>
          )}
        </div>

        <div className="flex items-center gap-2">
          {jumpOrigin && (
            <button
              type="button"
              onClick={handleJumpBack}
              className="flex items-center gap-1 rounded-full bg-blue-500/15 px-3 py-1.5 text-xs font-medium text-blue-600 dark:text-blue-400 hover:bg-blue-500/25 transition active:scale-95 shadow-xs backdrop-blur-md"
              title="返回跳转前的位置"
            >
              <span>↩</span>
              <span>返回原位</span>
            </button>
          )}
          <button
            type="button"
            className={`flex items-center justify-center rounded-full border px-3.5 py-1.5 text-xs font-serif font-bold backdrop-blur-md shadow-xs transition ${
              showSettings
                ? 'border-blue-500 bg-blue-50 text-blue-600 dark:bg-blue-950/80 dark:text-blue-400'
                : 'border-black/10 bg-white/60 hover:bg-white hover:border-black/20 dark:border-white/10 dark:bg-black/40 dark:hover:bg-black/70'
            }`}
            onClick={() => {
              setShowSettings((v) => !v)
              setChromeVisible(true)
            }}
            title="排版与显示设置 (A)"
          >
            Aa
          </button>
        </div>
      </header>

      {/* Main Reader Surface with generous reading margins */}
      <div className="relative min-h-0 flex-1 flex justify-center items-center overflow-hidden">
        {/* Click zones for page turns (Apple Books side tap) */}
        <div
          aria-hidden="true"
          className="absolute inset-y-0 left-0 w-1/8 z-10 cursor-w-resize"
          onClick={() => void handleRef.current?.prev()}
        />
        <div
          aria-hidden="true"
          className="absolute inset-y-0 right-0 w-1/8 z-10 cursor-e-resize"
          onClick={() => void handleRef.current?.next()}
        />

        {/* Book Container with measure constraint and generous breathing margins */}
        <div
          style={{
            maxWidth: `${measureMaxWidthPx}px`,
            width: '100%',
            height: '100%',
          }}
          className="relative mx-auto h-full w-full px-8 py-8 md:px-12 md:py-10"
        >
          <div ref={containerRef} className="relative h-full w-full">
            {/* Pacer Highlight Overlay */}
            <Overlay
              rect={pacer.overlayRect}
              animMs={pacer.currentChunk?.animMs}
              accentColor={resolvedStyle.palette.accent}
              isDark={isDarkTheme}
            />
          </div>
        </div>

        {!ready && !error && (
          <div className="absolute inset-0 flex flex-col items-center justify-center gap-2 text-xs opacity-50">
            <div className="h-4 w-4 animate-spin rounded-full border-2 border-current border-t-transparent" />
            <span>正在载入排版…</span>
          </div>
        )}
        {error && (
          <div className="absolute inset-0 flex flex-col items-center justify-center gap-3 px-6 text-center">
            <p className="text-xs text-red-600 dark:text-red-400">无法打开此书籍: {error}</p>
            <button type="button" className="text-xs underline font-medium" onClick={closeBook}>
              返回书库
            </button>
          </div>
        )}
      </div>

      {/* Bottom Quiet Footer (Always softly visible at bottom edge) */}
      <div className="fixed bottom-2 inset-x-0 z-20 flex justify-center pointer-events-none">
        <PositionInfo
          chapterTitle={location?.chapterTitle}
          pagesLeftInChapter={location?.pagesLeftInChapter}
          percentage={percentage}
        />
      </div>

      {/* Bottom Floating Control Bar (Auto-hiding interactive pill) */}
      <footer
        className={`fixed bottom-8 inset-x-0 z-30 flex flex-col items-center justify-center gap-2 px-6 transition-all duration-300 ${
          chromeVisible
            ? 'opacity-100 translate-y-0 pointer-events-auto'
            : 'opacity-0 translate-y-4 pointer-events-none'
        }`}
      >
        {/* Pacer Control Floating Capsule */}
        <div className="flex items-center gap-3 rounded-full border border-black/10 bg-white/85 px-4 py-1.5 shadow-[0_8px_30px_rgba(0,0,0,0.12)] backdrop-blur-xl dark:border-white/10 dark:bg-neutral-900/85">
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={pacer.toggle}
              className={`flex items-center gap-1.5 rounded-full px-4 py-1.5 text-xs font-semibold transition active:scale-95 shadow-xs ${
                pacer.isPlaying
                  ? 'bg-amber-600 text-white hover:bg-amber-700'
                  : 'bg-blue-600 text-white hover:bg-blue-700'
              }`}
            >
              <span>{pacer.isPlaying ? '❚❚' : '▶'}</span>
              <span>{pacer.isPlaying ? '暂停' : '自动阅读'}</span>
            </button>

            <button
              type="button"
              onClick={() => {
                setShowPacerControls((v) => !v)
                setChromeVisible(true)
              }}
              className="rounded-full border border-black/10 px-3 py-1 text-[11px] font-medium hover:bg-black/5 dark:border-white/10 dark:hover:bg-white/10 transition"
            >
              {pacerWpm} wpm · {pacerChunkSize}词
            </button>

            {pacer.speedWarning && (
              <span className="text-[10px] text-amber-600 dark:text-amber-400 font-medium" title="超过 500 wpm 后理解率会显著下降">
                ⚠️ 极速模式
              </span>
            )}
          </div>

          <div className="flex items-center gap-1">
            <button
              type="button"
              className="rounded-full p-1.5 text-neutral-600 hover:bg-black/5 hover:text-neutral-900 dark:text-neutral-400 dark:hover:bg-white/10 dark:hover:text-white transition"
              onClick={() => void handleRef.current?.prev()}
              title="上一页 (←)"
            >
              ◀
            </button>
            <button
              type="button"
              className="rounded-full p-1.5 text-neutral-600 hover:bg-black/5 hover:text-neutral-900 dark:text-neutral-400 dark:hover:bg-white/10 dark:hover:text-white transition"
              onClick={() => void handleRef.current?.next()}
              title="下一页 (→)"
            >
              ▶
            </button>
          </div>
        </div>

        {/* Extended Pacer Settings Bar */}
        {showPacerControls && (
          <div className="flex items-center gap-4 py-2.5 px-5 rounded-2xl border border-black/10 dark:border-white/10 bg-white/90 dark:bg-neutral-900/90 shadow-xl backdrop-blur-xl text-[11px] animate-in fade-in zoom-in-95 duration-100">
            <div className="flex items-center gap-2">
              <span className="font-medium opacity-80">速度:</span>
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
                className="w-24 accent-blue-600 cursor-pointer"
              />
              <span className="tabular-nums font-mono font-semibold">{pacerWpm} wpm</span>
            </div>

            <div className="h-3 w-px bg-black/10 dark:bg-white/10" />

            <div className="flex items-center gap-2">
              <span className="font-medium opacity-80">词数/块:</span>
              <div className="flex rounded-lg border border-black/10 dark:border-white/10 overflow-hidden bg-black/[0.02] dark:bg-white/[0.02]">
                {[1, 2, 3, 4, 5].map((size) => (
                  <button
                    key={size}
                    type="button"
                    onClick={() => {
                      setPacerChunkSize(size)
                      void getStorage().then((s) => s.saveAppSettings({ pacerChunkSize: size }))
                    }}
                    className={`px-2.5 py-0.5 transition font-medium ${
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
