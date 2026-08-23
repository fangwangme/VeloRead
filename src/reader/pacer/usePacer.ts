import { useCallback, useEffect, useRef, useState } from 'react'
import {
  dominantPacerUnit,
  groupWordsIntoChunks,
  isWholeLineChunkSize,
  DEFAULT_CJK_CHUNK_SIZE,
  DEFAULT_LATIN_CHUNK_SIZE,
  type ChunkerOptions,
  type PacerChunk,
  type PacerUnitKind,
  type WordItem,
} from './chunker'
import { chunkToOverlayRect, type Rect } from './geometry'
import { PacerEngine, type PacerState } from './engine'
import type { ReaderHandle } from '../renderer'

interface UsePacerOptions {
  readerHandle: ReaderHandle | null
  containerRef: React.RefObject<HTMLDivElement | null>
  latinWpm: number
  cjkCpm: number
  /** Words per chunk, or `PACER_CHUNK_SIZE_LINE` for one chunk per line. */
  latinChunkSize?: number
  /** Graphemes per chunk, or `PACER_CHUNK_SIZE_LINE`. */
  cjkChunkSize?: number
  defaultUnit?: PacerUnitKind
  onPageConsumed?: () => void
  canAdvancePage?: () => boolean
  canCreditPage?: () => boolean
  /**
   * The reading cursor moved because playback advanced or the reader explicitly
   * skipped a chunk with an arrow/swipe. Not called when the cursor is only
   * re-attached to the same words after a reflow or a page turn, so a paused
   * reader's stored position is never overwritten (docs/specs/pacer.md §8).
   */
  onCursorMove?: (chunk: PacerChunk) => void
}

export function usePacer({
  readerHandle,
  containerRef,
  latinWpm,
  cjkCpm,
  latinChunkSize = DEFAULT_LATIN_CHUNK_SIZE,
  cjkChunkSize = DEFAULT_CJK_CHUNK_SIZE,
  defaultUnit = 'latin',
  onPageConsumed,
  canAdvancePage,
  canCreditPage,
  onCursorMove,
}: UsePacerOptions) {
  const [pacerState, setPacerState] = useState<PacerState>('idle')
  const [currentChunk, setCurrentChunk] = useState<PacerChunk | null>(null)
  /**
   * One box per line the current chunk touches — two when its last word was
   * hyphenated across the line break, one otherwise.
   */
  const [overlayRects, setOverlayRects] = useState<Rect[]>([])
  const [overlayLineRect, setOverlayLineRect] = useState<Rect | null>(null)
  const [totalChunks, setTotalChunks] = useState(0)
  const [chunkIndex, setChunkIndex] = useState(0)
  const [dominantUnit, setDominantUnit] = useState<PacerUnitKind>(defaultUnit)

  const engineRef = useRef<PacerEngine | null>(null)
  const configRef = useRef<ChunkerOptions>({ latinWpm, cjkCpm, latinChunkSize, cjkChunkSize })
  const defaultUnitRef = useRef(defaultUnit)
  const onPageConsumedRef = useRef(onPageConsumed)
  const canAdvancePageRef = useRef(canAdvancePage)
  const canCreditPageRef = useRef(canCreditPage)
  const onCursorMoveRef = useRef(onCursorMove)

  useEffect(() => {
    defaultUnitRef.current = defaultUnit
    onPageConsumedRef.current = onPageConsumed
    canAdvancePageRef.current = canAdvancePage
    canCreditPageRef.current = canCreditPage
    onCursorMoveRef.current = onCursorMove
  }, [defaultUnit, onPageConsumed, canAdvancePage, canCreditPage, onCursorMove])

  /**
   * The chunker's settings for the words actually on this page.
   *
   * Two things are decided here rather than stored. The column pitch, because it
   * changes with the font size, the window width and the spread — all of which
   * already call `recalculateGeometry`. And whether a chunk is a whole line,
   * because that is one of the sizes and the size that applies is the one for
   * the script this page is mostly written in — the same profile the controls
   * are showing.
   */
  const chunkerConfig = useCallback(
    (words: WordItem[]): ChunkerOptions => {
      const config = configRef.current
      const unit = dominantPacerUnit(words, defaultUnitRef.current)
      const size = unit === 'cjk' ? config.cjkChunkSize : config.latinChunkSize
      return {
        ...config,
        // A size of "whole line" for the other script must not reach the chunker
        // as a limit of zero, which would put every word in a chunk of its own.
        latinChunkSize: isWholeLineChunkSize(config.latinChunkSize ?? 0)
          ? DEFAULT_LATIN_CHUNK_SIZE
          : config.latinChunkSize,
        cjkChunkSize: isWholeLineChunkSize(config.cjkChunkSize ?? 0)
          ? DEFAULT_CJK_CHUNK_SIZE
          : config.cjkChunkSize,
        wholeLine: isWholeLineChunkSize(size ?? 0),
        columnPitch: readerHandle?.getColumnPitch() ?? null,
      }
    },
    [readerHandle],
  )

  const updateOverlay = useCallback(
    (chunk: PacerChunk | null, ensureVisible = true) => {
      const clear = () => {
        setOverlayRects([])
        setOverlayLineRect(null)
      }
      if (!chunk || !containerRef.current || !readerHandle) {
        clear()
        return
      }

      const iframe = readerHandle.getIframeElement()
      const container = containerRef.current
      if (!iframe) {
        clear()
        return
      }

      if (ensureVisible) readerHandle.ensurePacerRectVisible(chunk.rect)

      const iframeRect = iframe.getBoundingClientRect()
      const containerRect = container.getBoundingClientRect()
      const metrics = {
        iframeRect,
        containerRect,
        scrollLeft: container.scrollLeft,
        scrollTop: container.scrollTop,
      }

      const boxes = chunk.lineBoxes.length > 0 ? chunk.lineBoxes : [chunk.rect]
      setOverlayRects(boxes.map((box) => chunkToOverlayRect(box, metrics)))
      setOverlayLineRect(chunkToOverlayRect(chunk.lineRect, metrics))
    },
    [containerRef, readerHandle],
  )

  const recalculateGeometry = useCallback(
    (preserveIndex = true) => {
      if (!readerHandle) return
      const words = readerHandle.getVisibleWords()
      const chunks = groupWordsIntoChunks(words, chunkerConfig(words))
      setDominantUnit(dominantPacerUnit(words, defaultUnitRef.current))
      setTotalChunks(chunks.length)

      const engine = engineRef.current
      if (engine) {
        const previous = preserveIndex ? engine.getCurrentChunk() : null
        const mappedIndex = previous
          ? chunkIndexContainingRange(chunks, previous.range) ??
            nearestChunkIndex(chunks, previous.rect)
          : null
        engine.setChunks(chunks, false)
        // Re-attaching the cursor to the words it was already on is not the
        // reader moving, so it must not rewrite the stored position.
        if (mappedIndex !== null) engine.seek(mappedIndex, 'set')
        if (canCreditPageRef.current && !canCreditPageRef.current()) {
          engine.invalidatePageConsumption()
        }
        const current = engine.getCurrentChunk()
        setCurrentChunk(current)
        updateOverlay(current)
      }
    },
    [chunkerConfig, readerHandle, updateOverlay],
  )

  // Initialize engine
  useEffect(() => {
    let cancelled = false
    queueMicrotask(() => {
      if (cancelled) return
      setPacerState('idle')
      setCurrentChunk(null)
      setOverlayRects([])
      setOverlayLineRect(null)
    })
    const engine = new PacerEngine({
      onChunkChange(index, chunk, cause) {
        setChunkIndex(index)
        setCurrentChunk(chunk)
        updateOverlay(chunk)
        if (chunk && (cause === 'advance' || cause === 'seek')) {
          onCursorMoveRef.current?.(chunk)
        }
      },
      onStateChange(state) {
        setPacerState(state)
      },
      async onPageTurnNeeded(fullyConsumed) {
        if (!readerHandle) return false
        // Do not advance or credit a page after the app has become inactive or
        // a reading panel has opened. The parent pauses synchronously too; this
        // guard covers a page-turn callback that was already queued.
        if (canAdvancePageRef.current && !canAdvancePageRef.current()) return false
        try {
          if (
            fullyConsumed &&
            (!canCreditPageRef.current || canCreditPageRef.current())
          ) {
            onPageConsumedRef.current?.()
          }
          const advanced = await readerHandle.advancePacerPage()
          if (!advanced) return false
          // Wait for new page DOM to render with active polling
          let words = readerHandle.getVisibleWords()
          if (words.length === 0) {
            for (let attempt = 0; attempt < 6; attempt++) {
              await new Promise((r) => setTimeout(r, 50 + attempt * 40))
              words = readerHandle.getVisibleWords()
              if (words.length > 0) break
            }
          } else {
            await new Promise((r) => setTimeout(r, 60))
            words = readerHandle.getVisibleWords()
          }

          const chunks = groupWordsIntoChunks(words, chunkerConfig(words))
          setDominantUnit(dominantPacerUnit(words, defaultUnitRef.current))
          setTotalChunks(chunks.length)
          if (chunks.length > 0) {
            engineRef.current?.setChunks(chunks, false)
            if (canCreditPageRef.current && !canCreditPageRef.current()) {
              engineRef.current?.invalidatePageConsumption()
            }
            return true
          }
          return false
        } catch {
          return false
        }
      },
    })

    engineRef.current = engine

    return () => {
      cancelled = true
      engine.destroy()
      engineRef.current = null
    }
  }, [chunkerConfig, readerHandle, updateOverlay])

  // Recalculate when either language profile changes.
  useEffect(() => {
    configRef.current = { latinWpm, cjkCpm, latinChunkSize, cjkChunkSize }
    if (engineRef.current) {
      recalculateGeometry()
    }
  }, [latinWpm, cjkCpm, latinChunkSize, cjkChunkSize, recalculateGeometry])

  // Keep the parent-document overlay attached to its chunk during smooth
  // scrolling. getBoundingClientRect() already includes the scroller offset.
  useEffect(() => {
    const scroller = readerHandle?.getScrollElement()
    if (!scroller) return
    const onScroll = () => updateOverlay(engineRef.current?.getCurrentChunk() ?? null, false)
    scroller.addEventListener('scroll', onScroll, { passive: true })
    return () => scroller.removeEventListener('scroll', onScroll)
  }, [readerHandle, updateOverlay])

  // Listen to fonts ready
  useEffect(() => {
    let cancelled = false
    void readerHandle?.fontsReady().then(() => {
      if (!cancelled) recalculateGeometry()
    })
    return () => {
      cancelled = true
    }
  }, [readerHandle, recalculateGeometry])

  const play = useCallback(() => {
    const engine = engineRef.current
    engine?.play()
    if (canCreditPageRef.current && !canCreditPageRef.current()) {
      engine?.invalidatePageConsumption()
    }
  }, [])

  const pause = useCallback(() => {
    engineRef.current?.pause()
  }, [])

  const toggle = useCallback(() => {
    const engine = engineRef.current
    engine?.toggle()
    if (engine?.getState() === 'playing' && canCreditPageRef.current && !canCreditPageRef.current()) {
      engine.invalidatePageConsumption()
    }
  }, [])

  const invalidatePageConsumption = useCallback(() => {
    engineRef.current?.invalidatePageConsumption()
  }, [])

  /**
   * Re-attach the cursor to its current word after typography reflows the same
   * visible page. This never restores a previous session or handles a click.
   * Returns false while the rebuilt chunks are not ready, so the caller can
   * retry after layout settles.
   */
  const seekToChunkRange = useCallback((range: Range) => {
    const engine = engineRef.current
    const chunks = engine?.getChunks() ?? []
    if (!engine || chunks.length === 0) return false
    const index = chunkIndexContainingRange(chunks, range)
    if (index === null) return false
    engine.seek(index, 'set')
    return true
  }, [])

  const nextChunk = useCallback(() => {
    engineRef.current?.nextChunk()
  }, [])

  const prevChunk = useCallback(() => {
    engineRef.current?.prevChunk()
  }, [])

  return {
    state: pacerState,
    isPlaying: pacerState === 'playing',
    currentChunk,
    chunkIndex,
    totalChunks,
    dominantUnit,
    overlayRects,
    overlayLineRect,
    speedWarning: (dominantUnit === 'cjk' ? cjkCpm : latinWpm) > 500,
    play,
    pause,
    toggle,
    invalidatePageConsumption,
    nextChunk,
    prevChunk,
    seekToChunkRange,
    recalculateGeometry,
  }
}

export function nearestChunkIndex(
  chunks: PacerChunk[],
  target: { left: number; top: number; width: number; height: number },
): number | null {
  if (chunks.length === 0) return null
  let bestIndex = 0
  let bestScore = Number.POSITIVE_INFINITY
  for (let index = 0; index < chunks.length; index++) {
    const rect = chunks[index].rect
    const inside =
      target.left >= rect.left &&
      target.left <= rect.left + rect.width &&
      target.top >= rect.top - rect.height &&
      target.top <= rect.top + rect.height * 2
    const dx = target.left - rect.left
    const dy = target.top - rect.top
    const score = inside ? -1 : dx * dx + dy * dy * 4
    if (score < bestScore) {
      bestScore = score
      bestIndex = index
    }
  }
  return bestIndex
}

export function chunkIndexContainingRange(
  chunks: PacerChunk[],
  targetRange?: Range,
): number | null {
  if (!targetRange) return null
  for (let index = 0; index < chunks.length; index++) {
    const chunkRange = chunks[index].range
    if (!chunkRange) continue
    try {
      if (chunkRange.isPointInRange(targetRange.startContainer, targetRange.startOffset)) {
        return index
      }
    } catch {
      // A flow change may replace the iframe document. Geometry is the safe
      // fallback when old and new ranges no longer share a document.
      return null
    }
  }
  return null
}
