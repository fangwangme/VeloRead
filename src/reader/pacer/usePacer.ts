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
  accentColor?: string
}

export function usePacer({
  readerHandle,
  containerRef,
  wpm,
  chunkSize = 3,
}: UsePacerOptions) {
  const [pacerState, setPacerState] = useState<PacerState>('idle')
  const [currentChunk, setCurrentChunk] = useState<PacerChunk | null>(null)
  const [overlayRect, setOverlayRect] = useState<Rect | null>(null)
  const [totalChunks, setTotalChunks] = useState(0)
  const [chunkIndex, setChunkIndex] = useState(0)

  const engineRef = useRef<PacerEngine | null>(null)

  const updateOverlay = useCallback(
    (chunk: PacerChunk | null) => {
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

  const recalculateGeometry = useCallback(() => {
    if (!readerHandle) return
    const words = readerHandle.getVisibleWords()
    const chunks = groupWordsIntoChunks(words, { wpm, chunkSize })
    setTotalChunks(chunks.length)

    const engine = engineRef.current
    if (engine) {
      engine.setWpm(wpm)
      engine.setChunks(chunks, true)
      const current = engine.getCurrentChunk()
      setCurrentChunk(current)
      updateOverlay(current)
    }
  }, [readerHandle, wpm, chunkSize, updateOverlay])

  // Initialize engine
  useEffect(() => {
    const engine = new PacerEngine({
      wpm,
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
          await readerHandle.next()
          // Wait for next page to settle
          await new Promise((r) => setTimeout(r, 100))
          const words = readerHandle.getVisibleWords()
          const chunks = groupWordsIntoChunks(words, { wpm, chunkSize })
          setTotalChunks(chunks.length)
          engineRef.current?.setChunks(chunks, false)
          return chunks.length > 0
        } catch {
          return false
        }
      },
    })

    engineRef.current = engine

    return () => {
      engine.destroy()
      engineRef.current = null
    }
  }, [readerHandle, wpm, chunkSize, updateOverlay])

  // Recalculate on wpm or chunkSize change
  useEffect(() => {
    if (engineRef.current) {
      engineRef.current.setWpm(wpm)
      recalculateGeometry()
    }
  }, [wpm, chunkSize, recalculateGeometry])

  // Listen to fonts ready
  useEffect(() => {
    if (typeof document !== 'undefined' && 'fonts' in document) {
      void document.fonts.ready.then(() => {
        recalculateGeometry()
      })
    }
  }, [recalculateGeometry])

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
    recalculateGeometry,
  }
}
