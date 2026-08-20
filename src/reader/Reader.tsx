import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { getStorage } from '../platform'
import type {
  AppSettings,
  Bookmark,
  BookSettings,
  ReadingProgress,
  TocItem,
} from '../platform/types'
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
import {
  countReadingUnits,
  type PacerUnitKind,
  type ReadingUnitCounts,
} from './pacer/chunker'
import {
  localDateKey,
  shouldAccumulateReading,
  shouldCreditDepartedPage,
} from '../stats/tracking'
import { ReadingSessionBuffer } from '../stats/sessionBuffer'
import {
  IconArrowLeft,
  IconChevronLeft,
  IconChevronRight,
  IconPause,
  IconPlay,
  IconReturn,
  IconToc,
} from '../ui/icons'

const SAVE_DEBOUNCE_MS = 400
const RESIZE_DEBOUNCE_MS = 150
const AUTO_HIDE_CHROME_MS = 3200
const MAX_PAGE_DWELL_SECONDS = 300 // Max 5 minutes per page to prevent idle tracking

export function Reader({
  bookId,
  appSettings,
}: {
  bookId: string
  appSettings: AppSettings
}) {
  const closeBook = useLibrary((s) => s.closeBook)
  const book = useLibrary((s) => s.books.find((candidate) => candidate.id === bookId))
  const bookLanguage = book?.language

  const containerRef = useRef<HTMLDivElement>(null)
  const handleRef = useRef<ReaderHandle | null>(null)
  const initialAppSettingsRef = useRef(appSettings)
  const bookSettingsRef = useRef<BookSettings | null>(null)
  const bookSettingsWriteRef = useRef<Promise<void>>(Promise.resolve())
  const [handle, setHandle] = useState<ReaderHandle | null>(null)

  const [ready, setReady] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [location, setLocation] = useState<ReaderLocation | null>(null)
  const [percentage, setPercentage] = useState<number | null>(0)

  // Immersive Chrome / Controls Visibility
  const [chromeVisible, setChromeVisible] = useState(true)
  const hideChromeTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  // Settings & Style
  const [styleId, setStyleId] = useState<StyleId>('book')
  const [overrides, setOverrides] = useState<StyleOverride>({})
  const [flow, setFlow] = useState<'paginated' | 'scrolled-doc'>('paginated')

  // UI Panels
  const [showSettings, setShowSettings] = useState(false)
  const [showToc, setShowToc] = useState(false)
  const [toc, setToc] = useState<TocItem[]>([])
  const [bookmarks, setBookmarks] = useState<Bookmark[]>([])

  // Jump History (1-level)
  const [jumpOrigin, setJumpOrigin] = useState<string | null>(null)

  // Pacer state
  const [pacerWpm, setPacerWpm] = useState(appSettings.pacerWpm ?? 250)
  const [pacerCpm, setPacerCpm] = useState(appSettings.pacerCpm ?? 300)
  const [pacerChunkSize, setPacerChunkSize] = useState(appSettings.pacerChunkSize ?? 3)
  const [pacerCjkChunkSize, setPacerCjkChunkSize] = useState(appSettings.pacerCjkCharCount ?? 4)
  const [hasPacerOverride, setHasPacerOverride] = useState(false)
  const [showPacerControls, setShowPacerControls] = useState(false)

  // Active reading tracking refs
  const pageDwellSecondsRef = useRef(0)
  const errorRef = useRef<string | null>(null)
  const currentPageCountsRef = useRef<ReadingUnitCounts>({ latinWords: 0, cjkCharacters: 0 })
  const currentPageCfiRef = useRef<string | null>(null)
  const pagePacerConsumedRef = useRef(false)
  const layoutChangeSuppressedRef = useRef(false)
  const layoutSuppressionVersionRef = useRef(0)
  const layoutSuppressionTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const readerTrackableRef = useRef(false)

  // One serialized buffer per mounted book. App.tsx keys <Reader> by bookId, so
  // this component instance never outlives its book: the initializer runs once
  // and the bookId it captures stays the one these seconds were read against.
  const [sessionBuffer] = useState(
    () =>
      new ReadingSessionBuffer(async (snapshot) => {
        const now = new Date()
        const date = localDateKey(now)
        const storage = await getStorage()
        await storage.recordReadingSession({
          id: `sess-${bookId}-${date}`,
          bookId,
          date,
          durationSeconds: snapshot.durationSeconds,
          latinWordsRead: snapshot.latinWords,
          cjkCharactersRead: snapshot.cjkCharacters,
          updatedAt: now.toISOString(),
        })
      }),
  )

  const flushReadingSession = useCallback(
    () => sessionBuffer.flush().catch(() => undefined),
    [sessionBuffer],
  )

  const creditReadingUnits = useCallback(
    (counts: ReadingUnitCounts) => {
      sessionBuffer.addReadingUnits(counts.latinWords, counts.cjkCharacters)
    },
    [sessionBuffer],
  )

  const suppressLayoutTracking = useCallback(() => {
    const version = layoutSuppressionVersionRef.current + 1
    layoutSuppressionVersionRef.current = version
    layoutChangeSuppressedRef.current = true
    if (layoutSuppressionTimerRef.current) clearTimeout(layoutSuppressionTimerRef.current)
    layoutSuppressionTimerRef.current = setTimeout(() => {
      if (layoutSuppressionVersionRef.current === version) {
        layoutChangeSuppressedRef.current = false
      }
    }, 750)
  }, [])

  // System dark detection
  const [systemDark, setSystemDark] = useState(() =>
    typeof window !== 'undefined' && window.matchMedia?.('(prefers-color-scheme: dark)')?.matches
  )

  useEffect(() => {
    if (typeof window === 'undefined') return
    const mq = window.matchMedia('(prefers-color-scheme: dark)')
    const handler = (e: MediaQueryListEvent) => setSystemDark(e.matches)
    mq.addEventListener('change', handler)
    return () => mq.removeEventListener('change', handler)
  }, [])

  const isEffectiveDark =
    appSettings.themeMode === 'dark' ||
    ((appSettings.themeMode ?? 'auto') === 'auto' && systemDark)

  // Compute resolved style
  const resolvedStyle = useMemo(() => {
    const base = PRESETS[styleId] ?? PRESETS.book
    return resolveStyle(base, overrides, isEffectiveDark)
  }, [styleId, overrides, isEffectiveDark])

  const defaultPacerUnit: PacerUnitKind = /^(zh|ja|ko)/i.test(bookLanguage ?? '')
    ? 'cjk'
    : 'latin'

  // Pacer hook
  const pacer = usePacer({
    readerHandle: handle,
    containerRef,
    latinWpm: pacerWpm,
    cjkCpm: pacerCpm,
    latinChunkSize: pacerChunkSize,
    cjkChunkSize: pacerCjkChunkSize,
    defaultUnit: defaultPacerUnit,
    onPageConsumed: () => {
      pagePacerConsumedRef.current = true
    },
    canAdvancePage: () =>
      readerTrackableRef.current &&
      document.visibilityState === 'visible' &&
      document.hasFocus() &&
      !showSettingsRef.current &&
      !showTocRef.current,
    canCreditPage: () =>
      readerTrackableRef.current &&
      document.visibilityState === 'visible' &&
      document.hasFocus() &&
      !showSettingsRef.current &&
      !showTocRef.current &&
      !showPacerControlsRef.current,
    accentColor: resolvedStyle.palette.accent,
  })
  const pacerUsesCjkUnits = pacer.dominantUnit === 'cjk'
  const pacerSpeed = pacerUsesCjkUnits ? pacerCpm : pacerWpm
  const activePacerChunkSize = pacerUsesCjkUnits ? pacerCjkChunkSize : pacerChunkSize
  const pacerUnit = pacerUsesCjkUnits ? '字/分钟' : 'wpm'

  const pacerRef = useRef(pacer)
  const showSettingsRef = useRef(showSettings)
  const showTocRef = useRef(showToc)
  const showPacerControlsRef = useRef(showPacerControls)
  const pacerPopoverRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    pacerRef.current = pacer
    showSettingsRef.current = showSettings
    showTocRef.current = showToc
    showPacerControlsRef.current = showPacerControls
    errorRef.current = error
  })

  const blockingReaderPanelOpen = showSettings || showToc
  const readerControlsDisabled = !ready || blockingReaderPanelOpen
  const pageNavigationDisabled = readerControlsDisabled || pacer.isPlaying
  const pausePacer = pacer.pause

  // Pacer must never keep consuming text behind a panel or while the app is
  // hidden/unfocused. Resuming remains an explicit user action.
  useEffect(() => {
    if (blockingReaderPanelOpen) pausePacer()
  }, [blockingReaderPanelOpen, pausePacer])

  useEffect(() => {
    const pauseWhenInactive = () => {
      if (document.visibilityState === 'hidden' || !document.hasFocus()) {
        pacerRef.current.pause()
      }
    }
    document.addEventListener('visibilitychange', pauseWhenInactive)
    window.addEventListener('blur', pauseWhenInactive)
    return () => {
      document.removeEventListener('visibilitychange', pauseWhenInactive)
      window.removeEventListener('blur', pauseWhenInactive)
    }
  }, [])

  // Dismiss Pacer settings on click outside
  useEffect(() => {
    if (!showPacerControls) return

    const handlePointerDown = (e: MouseEvent | TouchEvent) => {
      if (pacerPopoverRef.current && !pacerPopoverRef.current.contains(e.target as Node)) {
        const target = e.target as HTMLElement | null
        if (target?.closest('[data-pacer-toggle]')) return
        setShowPacerControls(false)
      }
    }

    document.addEventListener('mousedown', handlePointerDown)
    document.addEventListener('touchstart', handlePointerDown)
    return () => {
      document.removeEventListener('mousedown', handlePointerDown)
      document.removeEventListener('touchstart', handlePointerDown)
    }
  }, [showPacerControls])

  // Measure-based maxWidth calculation that adapts to single vs double columns
  const measureMaxWidthPx = useMemo(() => {
    const isCjk = Boolean(resolvedStyle.body.isCjk)
    const ch = resolvedStyle.body.measureCh
    const fontSize = resolvedStyle.body.fontSizePx
    const singleMeasure = isCjk ? ch * fontSize : Math.round(ch * fontSize * 0.58)
    const spreadMode = overrides.spreadMode ?? 'auto'

    if (spreadMode === 'single') {
      return Math.max(600, singleMeasure + 80)
    }
    if (spreadMode === 'double') {
      return Math.max(1000, singleMeasure * 2 + 160)
    }
    // Auto mode: allow container to expand up to double column width for responsive 1-or-2 column adaptation
    return Math.max(680, Math.min(1480, singleMeasure * 2 + 160))
  }, [resolvedStyle, overrides.spreadMode])

  // Auto-hide chrome scheduler
  const pingActivity = () => {
    setChromeVisible(true)
    if (hideChromeTimerRef.current) {
      clearTimeout(hideChromeTimerRef.current)
    }
    if (showSettingsRef.current || showTocRef.current || showPacerControlsRef.current) {
      return
    }
    hideChromeTimerRef.current = setTimeout(() => {
      if (!showSettingsRef.current && !showTocRef.current && !showPacerControlsRef.current) {
        setChromeVisible(false)
      }
    }, AUTO_HIDE_CHROME_MS)
  }

  // Active reading second ticker with 5-minute page dwell limit & visibility pause.
  // Panel and error state are read through refs so toggling a panel cannot tear
  // down the interval: a rebuild both dropped the sub-second remainder and fired
  // an extra flush on every open/close.
  useEffect(() => {
    const flush = () => void sessionBuffer.flush().catch(() => undefined)

    const interval = setInterval(() => {
      if (
        !shouldAccumulateReading({
          ready: readerTrackableRef.current,
          hasError: Boolean(errorRef.current),
          visibilityState: document.visibilityState,
          windowFocused: document.hasFocus(),
          panelOpen:
            showSettingsRef.current || showTocRef.current || showPacerControlsRef.current,
        })
      ) {
        return
      }

      // Anti-idle check: capped at MAX_PAGE_DWELL_SECONDS (300s = 5 mins) per page
      if (pageDwellSecondsRef.current < MAX_PAGE_DWELL_SECONDS) {
        pageDwellSecondsRef.current += 1
        sessionBuffer.addSeconds(1)
      }
    }, 1000)

    // Flush session periodically every 15 seconds
    const flushInterval = setInterval(flush, 15000)

    const onVisibilityChange = () => {
      if (document.visibilityState === 'hidden') flush()
    }

    document.addEventListener('visibilitychange', onVisibilityChange)
    window.addEventListener('beforeunload', flush)

    return () => {
      clearInterval(interval)
      clearInterval(flushInterval)
      document.removeEventListener('visibilitychange', onVisibilityChange)
      window.removeEventListener('beforeunload', flush)
      flush()
    }
  }, [sessionBuffer])

  // Main reader lifecycle
  useEffect(() => {
    let cancelled = false
    let reader: ReaderHandle | null = null
    let saveTimer: ReturnType<typeof setTimeout> | undefined
    let unsaved: ReadingProgress | null = null
    let lastKnownPercentage: number | null = 0

    readerTrackableRef.current = false
    currentPageCfiRef.current = null
    currentPageCountsRef.current = { latinWords: 0, cjkCharacters: 0 }
    pagePacerConsumedRef.current = false
    pageDwellSecondsRef.current = 0

    async function flush() {
      clearTimeout(saveTimer)
      const progress = unsaved
      if (!progress) return
      try {
        await (await getStorage()).saveProgress(progress)
        // A newer relocation may arrive while this write is in flight. Only
        // clear the exact snapshot that was persisted; otherwise leave the
        // newer location queued for its own debounce/cleanup flush.
        if (unsaved === progress) unsaved = null
      } catch {
        // Non-fatal. Keep the last location queued so cleanup can retry it.
      }
    }

    async function flushAndRefreshShelf() {
      await flush()
      await flushReadingSession()
      await useLibrary.getState().load()
    }

    function onKeyDown(event: KeyboardEvent) {
      pingActivity()

      const target = event.target instanceof Element ? event.target : null
      const isInteractiveTarget = Boolean(
        target?.closest('input, textarea, select, button, a, [contenteditable="true"]'),
      )
      if (isInteractiveTarget && event.key !== 'Escape') return

      const blockingPanelOpen = showSettingsRef.current || showTocRef.current

      // Space: toggle Pacer (prevent scroll)
      if (event.code === 'Space' || event.key === ' ') {
        event.preventDefault()
        if (blockingPanelOpen || !readerTrackableRef.current) {
          pacerRef.current.pause()
        } else {
          pacerRef.current.toggle()
        }
        return
      }

      if (event.key === 'ArrowRight' || event.key === 'PageDown') {
        event.preventDefault()
        if (blockingPanelOpen) return
        if (pacerRef.current.isPlaying) {
          pacerRef.current.nextChunk()
        } else {
          void handleRef.current?.next()
        }
      } else if (event.key === 'ArrowLeft' || event.key === 'PageUp') {
        event.preventDefault()
        if (blockingPanelOpen) return
        if (pacerRef.current.isPlaying) {
          pacerRef.current.prevChunk()
        } else {
          void handleRef.current?.prev()
        }
      } else if (event.key === 'Escape') {
        event.preventDefault()
        if (showPacerControlsRef.current) {
          setShowPacerControls(false)
        } else if (showSettingsRef.current) {
          setShowSettings(false)
        } else if (showTocRef.current) {
          setShowToc(false)
        } else {
          closeBook()
        }
      } else if (event.key === 't' || event.key === 'T') {
        if (!showSettingsRef.current) {
          pacerRef.current.pause()
          setShowToc((v) => !v)
          setShowPacerControls(false)
        }
      } else if (event.key === 'a' || event.key === 'A') {
        if (!showTocRef.current) {
          pacerRef.current.pause()
          setShowSettings((v) => !v)
          setShowPacerControls(false)
        }
      }
    }

    window.addEventListener('keydown', onKeyDown)
    window.addEventListener('mousemove', pingActivity)

    void (async () => {
      try {
        const storage = await getStorage()
        const [data, savedProgress, savedSettings, savedBookmarks] = await Promise.all([
          storage.readBookFile(bookId),
          storage.getProgress(bookId),
          storage.getBookSettings(bookId),
          storage.listBookmarks(bookId),
        ])

        if (cancelled || !containerRef.current) return

        const isChinese = bookLanguage?.toLowerCase().startsWith('zh')
        let rawStyleId = savedSettings?.styleId as StyleId | 'night' | undefined
        if (rawStyleId === 'night') {
          rawStyleId = 'book'
        }
        const initialStyleId: StyleId = (rawStyleId && PRESETS[rawStyleId as StyleId] ? rawStyleId as StyleId : undefined) ?? (isChinese ? 'song' : 'book')
        const initialOverrides: StyleOverride = savedSettings?.overrides ?? {}
        const initialFlow = savedSettings?.flow ?? 'paginated'
        const initialAppSettings = initialAppSettingsRef.current
        const initialPacerWpm = savedSettings?.pacerWpm ?? initialAppSettings.pacerWpm ?? 250
        const initialPacerCpm = savedSettings?.pacerCpm ?? initialAppSettings.pacerCpm ?? 300
        const initialPacerChunkSize =
          savedSettings?.pacerChunkSize ?? initialAppSettings.pacerChunkSize ?? 3
        const initialPacerCjkChunkSize =
          savedSettings?.pacerCjkCharCount ?? initialAppSettings.pacerCjkCharCount ?? 4
        const hasSavedPacerOverride = Boolean(
          savedSettings &&
          (savedSettings.pacerWpm !== undefined ||
            savedSettings.pacerCpm !== undefined ||
            savedSettings.pacerChunkSize !== undefined ||
            savedSettings.pacerCjkCharCount !== undefined),
        )

        bookSettingsRef.current = {
          bookId,
          styleId: initialStyleId,
          overrides: initialOverrides,
          flow: initialFlow,
          pacerWpm: savedSettings?.pacerWpm,
          pacerCpm: savedSettings?.pacerCpm,
          pacerChunkSize: savedSettings?.pacerChunkSize,
          pacerCjkCharCount: savedSettings?.pacerCjkCharCount,
          updatedAt: savedSettings?.updatedAt ?? new Date().toISOString(),
        }

        setStyleId(initialStyleId)
        setOverrides(initialOverrides)
        setFlow(initialFlow)
        setBookmarks(savedBookmarks)
        setPacerWpm(initialPacerWpm)
        setPacerCpm(initialPacerCpm)
        setPacerChunkSize(initialPacerChunkSize)
        setPacerCjkChunkSize(initialPacerCjkChunkSize)
        setHasPacerOverride(hasSavedPacerOverride)

        lastKnownPercentage = savedProgress?.percentage ?? null
        setPercentage(lastKnownPercentage)

        const initialThemeMode = initialAppSettings.themeMode ?? 'auto'
        const isInitialDark = initialThemeMode === 'dark' || (initialThemeMode === 'auto' && (typeof window !== 'undefined' && window.matchMedia?.('(prefers-color-scheme: dark)')?.matches))
        const initialResolved = resolveStyle(
          PRESETS[initialStyleId] ?? PRESETS.book,
          initialOverrides,
          Boolean(isInitialDark)
        )

        reader = await createReader(containerRef.current, data, savedProgress?.cfi ?? null, {
          flow: initialFlow,
          spreadMode: initialOverrides.spreadMode ?? 'auto',
          style: initialResolved,
          onKeyDown,
          onClickText({ range }) {
            pingActivity()
            const panelWasOpen =
              showPacerControlsRef.current || showSettingsRef.current || showTocRef.current
            setShowPacerControls(false)
            setShowSettings(false)
            setShowToc(false)
            if (range && !panelWasOpen) pacerRef.current.seekToRange(range)
          },
          onLinkClick() {
            pingActivity()
            pacerRef.current.pause()
            setShowPacerControls(false)
            setShowSettings(false)
            setShowToc(false)
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

            const previousCfi = currentPageCfiRef.current
            const locationChanged = previousCfi !== loc.cfi
            if (locationChanged) {
              const layoutChangeSuppressed = layoutChangeSuppressedRef.current
              if (
                shouldCreditDepartedPage(
                  previousCfi,
                  loc.cfi,
                  pageDwellSecondsRef.current,
                  pagePacerConsumedRef.current,
                  layoutChangeSuppressed,
                )
              ) {
                creditReadingUnits(currentPageCountsRef.current)
              }

              currentPageCfiRef.current = loc.cfi
              pagePacerConsumedRef.current = false
              pageDwellSecondsRef.current = 0
            }

            // Measure visible words on the newly rendered page
            setTimeout(() => {
              if (reader && locationChanged) {
                currentPageCountsRef.current = countReadingUnits(reader.getViewportWords())
              }
              if (!pacerRef.current.isPlaying) {
                pacerRef.current.recalculateGeometry(false)
              }
            }, 60)
          },
        })

        if (cancelled) {
          reader.destroy()
          return
        }

        handleRef.current = reader
        setHandle(reader)
        readerTrackableRef.current = true

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
      readerTrackableRef.current = false
      window.removeEventListener('keydown', onKeyDown)
      window.removeEventListener('mousemove', pingActivity)
      if (hideChromeTimerRef.current) clearTimeout(hideChromeTimerRef.current)
      if (layoutSuppressionTimerRef.current) clearTimeout(layoutSuppressionTimerRef.current)

      // Credit the final visible page only when a real page was rendered and
      // the close was not caused by a layout-only relocation.
      if (
        currentPageCfiRef.current &&
        !layoutChangeSuppressedRef.current &&
        (pageDwellSecondsRef.current >= 3 || pagePacerConsumedRef.current)
      ) {
        creditReadingUnits(currentPageCountsRef.current)
      }

      void flushAndRefreshShelf()
      handleRef.current = null
      setHandle(null)
      reader?.destroy()
    }
  }, [bookId, bookLanguage, closeBook, creditReadingUnits, flushReadingSession])

  // Apply style updates
  useEffect(() => {
    if (handleRef.current && ready) {
      suppressLayoutTracking()
      handleRef.current.applyStyle(resolvedStyle)
      setTimeout(() => {
        pacerRef.current.recalculateGeometry()
      }, 50)
    }
  }, [resolvedStyle, ready, suppressLayoutTracking])

  // Serialize full-record book settings writes so rapid controls cannot
  // overwrite a neighboring key with stale React state.
  const saveCurrentSettings = (changes: Partial<BookSettings>) => {
    const current = bookSettingsRef.current
    if (!current) return
    const next: BookSettings = {
      ...current,
      ...changes,
      bookId,
      updatedAt: new Date().toISOString(),
    }
    bookSettingsRef.current = next
    const write = bookSettingsWriteRef.current
      .catch(() => undefined)
      .then(async () => {
        const storage = await getStorage()
        await storage.saveBookSettings(next)
      })
    bookSettingsWriteRef.current = write
    void write.catch(() => undefined)
  }

  const handleStyleSelect = (id: StyleId) => {
    setStyleId(id)
    saveCurrentSettings({ styleId: id })
  }

  const handleOverridesChange = (newOverrides: StyleOverride) => {
    const prevSpread = overrides.spreadMode ?? 'auto'
    const nextSpread = newOverrides.spreadMode ?? 'auto'
    setOverrides(newOverrides)
    if (prevSpread !== nextSpread && handleRef.current) {
      suppressLayoutTracking()
      void handleRef.current.setSpread(nextSpread).then(() => {
        setTimeout(() => {
          pacerRef.current.recalculateGeometry(false)
        }, 80)
      })
    }
    saveCurrentSettings({ overrides: newOverrides })
  }

  const handleFlowChange = async (newFlow: 'paginated' | 'scrolled-doc') => {
    setFlow(newFlow)
    if (handleRef.current) {
      suppressLayoutTracking()
      await handleRef.current.setFlow(newFlow)
      pacer.recalculateGeometry()
    }
    saveCurrentSettings({ flow: newFlow })
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
        suppressLayoutTracking()
        handleRef.current?.resize(width, height)
        pacerRef.current.recalculateGeometry()
      }, RESIZE_DEBOUNCE_MS)
    })
    observer.observe(container)

    return () => {
      clearTimeout(timer)
      observer.disconnect()
    }
  }, [suppressLayoutTracking])

  const updatePacerSpeed = (value: number) => {
    const maxRate = pacerUsesCjkUnits || activePacerChunkSize > 1 ? 1000 : 600
    const next = Math.max(100, Math.min(maxRate, value))
    if (pacerUsesCjkUnits) {
      setPacerCpm(next)
      saveCurrentSettings({ pacerCpm: next })
    } else {
      setPacerWpm(next)
      saveCurrentSettings({ pacerWpm: next })
    }
    setHasPacerOverride(true)
  }

  const updatePacerChunkSize = (value: number) => {
    if (pacerUsesCjkUnits) {
      setPacerCjkChunkSize(value)
      saveCurrentSettings({ pacerCjkCharCount: value })
    } else {
      const nextWpm = value === 1 && pacerWpm > 600 ? 600 : pacerWpm
      setPacerChunkSize(value)
      if (nextWpm !== pacerWpm) setPacerWpm(nextWpm)
      saveCurrentSettings({ pacerWpm: nextWpm, pacerChunkSize: value })
    }
    setHasPacerOverride(true)
  }

  const resetPacerToAppDefaults = () => {
    setPacerWpm(appSettings.pacerWpm ?? 250)
    setPacerCpm(appSettings.pacerCpm ?? 300)
    setPacerChunkSize(appSettings.pacerChunkSize ?? 3)
    setPacerCjkChunkSize(appSettings.pacerCjkCharCount ?? 4)
    setHasPacerOverride(false)
    saveCurrentSettings({
      pacerWpm: undefined,
      pacerCpm: undefined,
      pacerChunkSize: undefined,
      pacerCjkCharCount: undefined,
    })
  }

  const pacerSpeedTiers = pacerUsesCjkUnits
    ? [
        { label: '舒适', wpm: 200, sub: '200 字/分' },
        { label: '标准', wpm: 300, sub: '300 字/分' },
        { label: '进阶', wpm: 420, sub: '420 字/分' },
        { label: '极速', wpm: 600, sub: '600 字/分' },
      ]
    : [
        { label: '初学', wpm: 200, sub: '200 wpm' },
        { label: '母语', wpm: 300, sub: '300 wpm' },
        { label: '进阶', wpm: 420, sub: '420 wpm' },
        { label: '极速', wpm: 600, sub: '600 wpm' },
      ]

  const pacerChunkOptions = pacerUsesCjkUnits ? [2, 4, 6, 8, 10] : [1, 2, 3, 4, 5]
  const pacerMaxRate = pacerUsesCjkUnits || activePacerChunkSize > 1 ? 1000 : 600

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
        className={`fixed top-0 inset-x-0 z-30 flex items-center justify-between gap-4 px-6 pt-5 pb-3 transition-[opacity,transform] duration-300 motion-reduce:transition-none ${
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
            <IconArrowLeft className="opacity-70" />
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
              pacer.pause()
              setShowToc((v) => !v)
              setShowSettings(false)
              setShowPacerControls(false)
              setChromeVisible(true)
            }}
            disabled={!ready}
            title="目录与书签 (T)"
          >
            <IconToc className="opacity-70" />
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
              disabled={!ready || pacer.isPlaying}
              className="flex items-center gap-1.5 rounded-full bg-blue-500/15 px-3 py-1.5 text-xs font-medium text-blue-600 dark:text-blue-400 hover:bg-blue-500/25 transition active:scale-95 shadow-xs backdrop-blur-md"
              title={pacer.isPlaying ? '请先暂停自动阅读' : '返回跳转前的位置'}
            >
              <IconReturn />
              <span className="hidden sm:inline">返回原位</span>
            </button>
          )}

          {/* Aa Typography & Theme Settings Button */}
          <button
            type="button"
            className={`flex items-center justify-center rounded-full border px-3.5 py-1.5 text-xs font-serif font-bold backdrop-blur-md shadow-xs transition ${
              showSettings
                ? 'border-blue-500 bg-blue-50 text-blue-600 dark:bg-blue-950/80 dark:text-blue-400 font-bold shadow-xs'
                : 'border-black/10 bg-white/60 hover:bg-white hover:border-black/20 dark:border-white/10 dark:bg-black/40 dark:hover:bg-black/70'
            }`}
            onClick={() => {
              pacer.pause()
              setShowSettings((v) => !v)
              setShowToc(false)
              setShowPacerControls(false)
              setChromeVisible(true)
            }}
            disabled={!ready}
            title="排版与显示设置 (A)"
          >
            Aa
          </button>

          {/* Pacer Auto-Reading Segmented Capsule in Top-Right Toolbar */}
          <div className="flex items-center rounded-full border border-black/10 bg-white/60 dark:border-white/10 dark:bg-black/40 backdrop-blur-md p-0.5 shadow-xs">
            {/* Play/Pause Button */}
            <button
              type="button"
              onClick={pacer.toggle}
              disabled={readerControlsDisabled}
              className={`flex items-center gap-1.5 rounded-full px-3 py-1 text-xs font-medium transition active:scale-95 ${
                pacer.isPlaying
                  ? 'bg-amber-600 text-white shadow-xs'
                  : 'bg-blue-600 text-white hover:bg-blue-700 shadow-xs'
              }`}
              title={pacer.isPlaying ? '暂停自动阅读 (Space)' : '开启自动阅读 (Space)'}
            >
              {pacer.isPlaying ? <IconPause /> : <IconPlay />}
              <span className="hidden sm:inline font-medium">{pacer.isPlaying ? '暂停' : '自动阅读'}</span>
            </button>

            {/* Speed Pill trigger */}
            <button
              type="button"
              data-pacer-toggle="true"
              onClick={() => {
                if (!showPacerControls) pacer.invalidatePageConsumption()
                setShowPacerControls((v) => !v)
                setShowSettings(false)
                setShowToc(false)
                setChromeVisible(true)
              }}
              disabled={!ready}
              className={`flex items-center gap-1 rounded-full px-2.5 py-1 text-[11px] font-mono font-medium transition ${
                showPacerControls
                  ? 'bg-blue-50 text-blue-600 dark:bg-blue-950/80 dark:text-blue-400 font-semibold'
                  : 'text-neutral-700 dark:text-neutral-300 hover:bg-black/5 dark:hover:bg-white/10'
              }`}
              title="设置自动阅读速度与分块"
            >
              <span>{pacerSpeed} {pacerUsesCjkUnits ? '字/分' : 'wpm'}</span>
              {pacer.speedWarning && (
                <span className="h-1.5 w-1.5 rounded-full bg-amber-500 animate-pulse" title="极速模式" />
              )}
            </button>
          </div>
        </div>
      </header>

      {/* Main Reader Surface with generous reading margins */}
      <div className="relative min-h-0 flex-1 flex justify-center items-center overflow-hidden">
        {/* Click zones for page turns (Apple Books side tap) */}
        <div
          aria-hidden="true"
          className={`absolute inset-y-0 left-0 w-1/8 z-10 cursor-w-resize ${pageNavigationDisabled ? 'pointer-events-none' : ''}`}
          onClick={() => void handleRef.current?.prev()}
        />
        <div
          aria-hidden="true"
          className={`absolute inset-y-0 right-0 w-1/8 z-10 cursor-e-resize ${pageNavigationDisabled ? 'pointer-events-none' : ''}`}
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
              isDark={isEffectiveDark}
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

      {/* Bottom Floating Control & Page Turn Bar (Minimal, Apple Books style) */}
      <footer
        className={`fixed bottom-6 inset-x-0 z-30 flex items-center justify-between px-8 pointer-events-none transition-[opacity,transform] duration-300 motion-reduce:transition-none ${
          chromeVisible
            ? 'opacity-100 translate-y-0'
            : 'opacity-0 translate-y-3'
        }`}
      >
        <div className="pointer-events-auto">
          <button
            type="button"
            className="flex h-9 w-9 items-center justify-center rounded-full border border-black/10 bg-white/80 shadow-[0_2px_12px_rgba(0,0,0,0.08)] backdrop-blur-xl text-neutral-700 hover:bg-white hover:text-neutral-900 dark:border-white/10 dark:bg-black/60 dark:text-neutral-300 dark:hover:bg-black/90 dark:hover:text-white transition active:scale-95"
            onClick={() => void handleRef.current?.prev()}
            disabled={pageNavigationDisabled}
            title="上一页 (←)"
            aria-label="上一页"
          >
            <IconChevronLeft />
          </button>
        </div>

        <div className="pointer-events-auto rounded-full border border-black/10 bg-white/80 px-4 py-1.5 shadow-[0_2px_12px_rgba(0,0,0,0.08)] backdrop-blur-xl dark:border-white/10 dark:bg-black/60">
          <PositionInfo
            chapterTitle={location?.chapterTitle}
            pagesLeftInChapter={location?.pagesLeftInChapter}
            percentage={percentage}
          />
        </div>

        <div className="pointer-events-auto">
          <button
            type="button"
            className="flex h-9 w-9 items-center justify-center rounded-full border border-black/10 bg-white/80 shadow-[0_2px_12px_rgba(0,0,0,0.08)] backdrop-blur-xl text-neutral-700 hover:bg-white hover:text-neutral-900 dark:border-white/10 dark:bg-black/60 dark:text-neutral-300 dark:hover:bg-black/90 dark:hover:text-white transition active:scale-95"
            onClick={() => void handleRef.current?.next()}
            disabled={pageNavigationDisabled}
            title="下一页 (→)"
            aria-label="下一页"
          >
            <IconChevronRight />
          </button>
        </div>
      </footer>

      {/* Pacer Settings Popover (Anchored at top-right below toolbar) */}
      {showPacerControls && (
        <div
          ref={pacerPopoverRef}
          role="dialog"
          aria-labelledby="pacer-settings-title"
          className="absolute right-6 top-16 z-50 w-88 rounded-3xl border border-black/[0.08] bg-white/95 p-5 shadow-[0_25px_60px_rgba(0,0,0,0.18),0_2px_8px_rgba(0,0,0,0.06)] backdrop-blur-2xl dark:border-white/[0.08] dark:bg-[#1C1C1E]/95 dark:text-neutral-100 vr-animate-pop"
        >
          {/* Popover Header with Title and Explicit Close Button */}
          <div className="flex items-start justify-between gap-3 pb-3.5 border-b border-black/[0.06] dark:border-white/[0.06]">
            <div>
              <h3 id="pacer-settings-title" className="text-[11px] font-semibold tracking-wider text-neutral-500 dark:text-neutral-400 uppercase">
                本书自动阅读
              </h3>
              <p className="mt-1 text-[10px] text-neutral-400">
                当前页以{pacerUsesCjkUnits ? '中日韩字符' : '英文词语'}为主 · 混排内容会自动切换计速单位
              </p>
            </div>
            <div className="flex items-center gap-1.5">
              {hasPacerOverride && (
                <button
                  type="button"
                  onClick={resetPacerToAppDefaults}
                  className="rounded-lg px-2 py-1 text-[10px] font-medium text-blue-600 transition hover:bg-blue-500/10 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue-500 dark:text-blue-400"
                >
                  恢复默认
                </button>
              )}
              <button
                type="button"
                onClick={() => setShowPacerControls(false)}
                className="flex h-6 w-6 items-center justify-center rounded-full text-neutral-400 transition hover:bg-black/5 hover:text-neutral-700 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue-500 dark:hover:bg-white/10 dark:hover:text-neutral-200"
                aria-label="关闭设置"
              >
                ✕
              </button>
            </div>
          </div>

          <div className="mt-4 space-y-4 text-xs">
            {/* Speed Tier Presets */}
            <div>
              <div className="flex items-center justify-between mb-1.5">
                <span className="text-[10px] font-semibold uppercase tracking-wider text-neutral-400 dark:text-neutral-500">
                  速度档位
                </span>
                {pacer.speedWarning && (
                  <span className="flex items-center text-[10px] text-amber-600 dark:text-amber-400 font-medium">
                    <span className="inline-block h-1.5 w-1.5 rounded-full bg-amber-500 mr-1 animate-pulse" />
                    极速模式
                  </span>
                )}
              </div>
              <div className="grid grid-cols-4 gap-1.5">
                {pacerSpeedTiers.map((tier) => {
                  const isSelected = pacerSpeed === tier.wpm
                  return (
                    <button
                      key={tier.wpm}
                      type="button"
                      onClick={() => {
                        updatePacerSpeed(tier.wpm)
                      }}
                      className={`flex flex-col items-center justify-center py-2 px-1.5 rounded-2xl border transition focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue-500 ${
                        isSelected
                          ? 'border-blue-500/80 bg-blue-500/10 text-blue-600 dark:text-blue-400 font-semibold shadow-2xs'
                          : 'border-black/[0.06] dark:border-white/[0.06] bg-black/[0.02] dark:bg-white/[0.03] text-neutral-700 dark:text-neutral-300 hover:bg-black/[0.05] dark:hover:bg-white/[0.06]'
                      }`}
                      aria-pressed={isSelected}
                    >
                      <span className="text-[11px] font-medium">{tier.label}</span>
                      <span className="text-[9px] opacity-60 font-mono mt-0.5">{tier.sub}</span>
                    </button>
                  )
                })}
              </div>
            </div>

            {/* Slider & Direct Numeric Input */}
            <div>
              <div className="flex items-center justify-between mb-1.5">
                <span className="text-[10px] font-semibold uppercase tracking-wider text-neutral-400 dark:text-neutral-500">
                  微调速度 (输入或拖动)
                </span>
                <div className="flex items-center gap-1">
                  <input
                    key={`${pacerUsesCjkUnits ? 'cjk' : 'latin'}-${pacerSpeed}`}
                    type="number"
                    min={100}
                    max={pacerMaxRate}
                    step={10}
                    name="book-pacer-speed"
                    autoComplete="off"
                    inputMode="numeric"
                    aria-label={`本书自动阅读速度，单位${pacerUnit}`}
                    defaultValue={pacerSpeed}
                    onBlur={(event) => {
                      updatePacerSpeed(Number(event.currentTarget.value) || 100)
                    }}
                    onKeyDown={(event) => {
                      if (event.key === 'Enter') event.currentTarget.blur()
                    }}
                    className="w-14 rounded-lg border border-black/10 bg-black/[0.03] px-1.5 py-0.5 text-center font-mono text-xs font-bold text-neutral-900 focus-visible:border-blue-500 focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-blue-500 dark:border-white/10 dark:bg-white/[0.04] dark:text-white"
                  />
                  <span className="text-[10px] text-neutral-400 font-mono">{pacerUnit}</span>
                </div>
              </div>

              <div className="flex items-center gap-2.5">
                <button
                  type="button"
                  onClick={() => {
                    updatePacerSpeed(pacerSpeed - 20)
                  }}
                  className="flex h-7 w-7 items-center justify-center rounded-lg border border-black/10 text-xs font-bold transition hover:bg-black/5 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue-500 dark:border-white/10 dark:hover:bg-white/10"
                  title={`减少 20 ${pacerUnit}`}
                  aria-label={`减少 20 ${pacerUnit}`}
                >
                  -
                </button>
                <input
                  type="range"
                  min={100}
                  max={pacerMaxRate}
                  step={10}
                  value={pacerSpeed}
                  onChange={(e) => {
                    updatePacerSpeed(Number(e.target.value))
                  }}
                  aria-label={`本书自动阅读速度，单位${pacerUnit}`}
                  className="h-1.5 flex-1 cursor-pointer rounded-lg bg-black/10 accent-blue-600 focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-blue-500 dark:bg-white/10"
                />
                <button
                  type="button"
                  onClick={() => {
                    updatePacerSpeed(pacerSpeed + 20)
                  }}
                  className="flex h-7 w-7 items-center justify-center rounded-lg border border-black/10 text-xs font-bold transition hover:bg-black/5 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue-500 dark:border-white/10 dark:hover:bg-white/10"
                  title={`增加 20 ${pacerUnit}`}
                  aria-label={`增加 20 ${pacerUnit}`}
                >
                  +
                </button>
              </div>
            </div>

            {/* Chunk Size Selector */}
            <div className="pt-3 border-t border-black/[0.06] dark:border-white/[0.06] flex items-center justify-between">
              <span className="text-[10px] font-semibold uppercase tracking-wider text-neutral-400 dark:text-neutral-500">
                每次高亮{pacerUsesCjkUnits ? '字数' : '词数'}
              </span>
              <div className="flex rounded-xl bg-black/[0.04] p-1 dark:bg-white/[0.06]">
                {pacerChunkOptions.map((size) => (
                  <button
                    key={size}
                    type="button"
                    onClick={() => {
                      updatePacerChunkSize(size)
                    }}
                    className={`px-2.5 py-1 rounded-lg transition text-[11px] font-medium focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-blue-500 ${
                      activePacerChunkSize === size
                        ? 'bg-white text-neutral-900 shadow-[0_1px_3px_rgba(0,0,0,0.08)] dark:bg-[#2C2C2E] dark:text-white font-semibold'
                        : 'text-neutral-500 hover:text-neutral-900 dark:text-neutral-400 dark:hover:text-white'
                    }`}
                    aria-pressed={activePacerChunkSize === size}
                  >
                    {size}{pacerUsesCjkUnits ? '字' : '词'}
                  </button>
                ))}
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Settings Modal */}
      {showSettings && (
        <SettingsPanel
          currentStyleId={styleId}
          overrides={overrides}
          flow={flow}
          isDark={isEffectiveDark}
          onStyleSelect={handleStyleSelect}
          onOverridesChange={handleOverridesChange}
          onFlowChange={handleFlowChange}
          onClose={() => setShowSettings(false)}
        />
      )}

      {/* TOC & Bookmarks Drawer */}
      {showToc && (
        <Toc
          toc={toc}
          bookmarks={bookmarks}
          currentHref={location?.href ?? null}
          currentTocId={location?.tocId ?? null}
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
