import { useCallback, useEffect, useRef, useState } from 'react'
import {
  dominantPacerUnit,
  groupWordsIntoChunks,
  type ChunkerOptions,
  type PacerChunk,
  type PacerUnitKind,
} from './chunker'
import { chunkToOverlayRect, type Rect } from './geometry'
import { PacerEngine, type PacerState } from './engine'
import type { ReaderHandle } from '../renderer'

interface UsePacerOptions {
  readerHandle: ReaderHandle | null
  containerRef: React.RefObject<HTMLDivElement | null>
  latinWpm: number
  cjkCpm: number
  latinChunkSize?: number
  cjkChunkSize?: number
  defaultUnit?: PacerUnitKind
  onPageConsumed?: () => void
  canAdvancePage?: () => boolean
  canCreditPage?: () => boolean
  accentColor?: string
}

export function usePacer({
  readerHandle,
  containerRef,
  latinWpm,
  cjkCpm,
  latinChunkSize = 3,
  cjkChunkSize = 4,
  defaultUnit = 'latin',
  onPageConsumed,
  canAdvancePage,
  canCreditPage,
}: UsePacerOptions) {
  const [pacerState, setPacerState] = useState<PacerState>('idle')
  const [currentChunk, setCurrentChunk] = useState<PacerChunk | null>(null)
  const [overlayRect, setOverlayRect] = useState<Rect | null>(null)
  const [totalChunks, setTotalChunks] = useState(0)
  const [chunkIndex, setChunkIndex] = useState(0)
  const [dominantUnit, setDominantUnit] = useState<PacerUnitKind>(defaultUnit)

  const engineRef = useRef<PacerEngine | null>(null)
  const configRef = useRef<ChunkerOptions>({
    latinWpm,
    cjkCpm,
    latinChunkSize,
    cjkChunkSize,
  })
  const defaultUnitRef = useRef(defaultUnit)
  const onPageConsumedRef = useRef(onPageConsumed)
  const canAdvancePageRef = useRef(canAdvancePage)
  const canCreditPageRef = useRef(canCreditPage)

  useEffect(() => {
    defaultUnitRef.current = defaultUnit
    onPageConsumedRef.current = onPageConsumed
    canAdvancePageRef.current = canAdvancePage
    canCreditPageRef.current = canCreditPage
  }, [defaultUnit, onPageConsumed, canAdvancePage, canCreditPage])

  const updateOverlay = useCallback(
    (chunk: PacerChunk | null, ensureVisible = true) => {
      if (!chunk || !containerRef.current || !readerHandle) {
        setOverlayRect(null)
        return
      }

      const iframe = readerHandle.getIframeElement()
      const container = containerRef.current
      if (!iframe) {
        setOverlayRect(null)
        return
      }

      if (ensureVisible) readerHandle.ensurePacerRectVisible(chunk.rect)

      const iframeRect = iframe.getBoundingClientRect()
      const containerRect = container.getBoundingClientRect()

      const rect = chunkToOverlayRect(chunk.rect, {
        iframeRect,
        containerRect,
        scrollLeft: container.scrollLeft,
        scrollTop: container.scrollTop,
      })
      setOverlayRect(rect)
    },
    [containerRef, readerHandle],
  )

  const recalculateGeometry = useCallback(
    (preserveIndex = true) => {
      if (!readerHandle) return
      const words = readerHandle.getVisibleWords()
      const config = configRef.current
      const chunks = groupWordsIntoChunks(words, config)
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
        if (mappedIndex !== null) engine.seek(mappedIndex)
        if (canCreditPageRef.current && !canCreditPageRef.current()) {
          engine.invalidatePageConsumption()
        }
        const current = engine.getCurrentChunk()
        setCurrentChunk(current)
        updateOverlay(current)
      }
    },
    [readerHandle, updateOverlay],
  )

  // Initialize engine
  useEffect(() => {
    let cancelled = false
    queueMicrotask(() => {
      if (cancelled) return
      setPacerState('idle')
      setCurrentChunk(null)
      setOverlayRect(null)
    })
    const engine = new PacerEngine({
      onChunkChange(index, chunk) {
        setChunkIndex(index)
        setCurrentChunk(chunk)
        updateOverlay(chunk)
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

          const config = configRef.current
          const chunks = groupWordsIntoChunks(words, config)
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
  }, [readerHandle, updateOverlay])

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

  const seek = useCallback((index: number) => {
    engineRef.current?.seek(index)
  }, [])

  const nextChunk = useCallback(() => {
    engineRef.current?.nextChunk()
  }, [])

  const prevChunk = useCallback(() => {
    engineRef.current?.prevChunk()
  }, [])

  /**
   * Move the reading cursor to the clicked text without changing whether the
   * Pacer is running. Seeking and playing are separate decisions: a click while
   * paused repositions the highlight and stays paused, a click while playing
   * keeps playing from the new position. Starting playback remains an explicit
   * user action (the play button or Space).
   */
  const seekToRange = useCallback((range: Range) => {
    const target = range.getClientRects()[0] ?? range.getBoundingClientRect()
    if (!target || (target.width === 0 && target.height === 0)) return false

    const engine = engineRef.current
    const chunks = engine?.getChunks() ?? []
    if (!engine || chunks.length === 0) return false

    const bestIndex = nearestChunkIndex(chunks, target)
    if (bestIndex === null) return false

    engine.seek(bestIndex)
    return true
  }, [])

  return {
    state: pacerState,
    isPlaying: pacerState === 'playing',
    currentChunk,
    chunkIndex,
    totalChunks,
    dominantUnit,
    overlayRect,
    speedWarning: (dominantUnit === 'cjk' ? cjkCpm : latinWpm) > 500,
    play,
    pause,
    toggle,
    invalidatePageConsumption,
    seek,
    nextChunk,
    prevChunk,
    seekToRange,
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
