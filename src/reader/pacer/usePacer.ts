import { useCallback, useEffect, useRef, useState } from 'react'
import { groupWordsIntoChunks, type PacerChunk } from './chunker'
import { chunkToOverlayRect, type Rect } from './geometry'
import { PacerEngine, type PacerState } from './engine'
import type { ReaderHandle } from '../renderer'

interface UsePacerOptions {
  readerHandle: ReaderHandle | null
  containerRef: React.RefObject<HTMLDivElement | null>
  wpm: number
  chunkSize?: number
  cjkChunkSize?: number
  accentColor?: string
}

export function usePacer({
  readerHandle,
  containerRef,
  wpm,
  chunkSize = 3,
  cjkChunkSize = 8,
}: UsePacerOptions) {
  const [pacerState, setPacerState] = useState<PacerState>('idle')
  const [currentChunk, setCurrentChunk] = useState<PacerChunk | null>(null)
  const [overlayRect, setOverlayRect] = useState<Rect | null>(null)
  const [totalChunks, setTotalChunks] = useState(0)
  const [chunkIndex, setChunkIndex] = useState(0)

  const engineRef = useRef<PacerEngine | null>(null)
  const configRef = useRef({ wpm, chunkSize, cjkChunkSize })

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
      const chunks = groupWordsIntoChunks(words, { wpm, chunkSize, cjkChunkSize })
      setTotalChunks(chunks.length)

      const engine = engineRef.current
      if (engine) {
        engine.setWpm(wpm)
        engine.setChunks(chunks, preserveIndex)
        const current = engine.getCurrentChunk()
        setCurrentChunk(current)
        updateOverlay(current)
      }
    },
    [readerHandle, wpm, chunkSize, cjkChunkSize, updateOverlay],
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
      wpm: configRef.current.wpm,
      onChunkChange(index, chunk) {
        setChunkIndex(index)
        setCurrentChunk(chunk)
        updateOverlay(chunk)
      },
      onStateChange(state) {
        setPacerState(state)
      },
      async onPageTurnNeeded() {
        if (!readerHandle) return false
        try {
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
          setTotalChunks(chunks.length)
          if (chunks.length > 0) {
            engineRef.current?.setChunks(chunks, false)
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

  // Recalculate on wpm or chunkSize change
  useEffect(() => {
    configRef.current = { wpm, chunkSize, cjkChunkSize }
    if (engineRef.current) {
      engineRef.current.setWpm(wpm)
      recalculateGeometry()
    }
  }, [wpm, chunkSize, cjkChunkSize, recalculateGeometry])

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
    engineRef.current?.play()
  }, [])

  const pause = useCallback(() => {
    engineRef.current?.pause()
  }, [])

  const toggle = useCallback(() => {
    engineRef.current?.toggle()
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

  const seekToRange = useCallback((range: Range, startPlaying = true) => {
    const target = range.getClientRects()[0] ?? range.getBoundingClientRect()
    if (!target || (target.width === 0 && target.height === 0)) return false

    const engine = engineRef.current
    const chunks = engine?.getChunks() ?? []
    if (!engine || chunks.length === 0) return false

    const bestIndex = nearestChunkIndex(chunks, target)
    if (bestIndex === null) return false

    engine.seek(bestIndex)
    if (startPlaying) engine.play()
    return true
  }, [])

  return {
    state: pacerState,
    isPlaying: pacerState === 'playing',
    currentChunk,
    chunkIndex,
    totalChunks,
    overlayRect,
    speedWarning: wpm > 500,
    play,
    pause,
    toggle,
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
