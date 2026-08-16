import type { PacerChunk } from './chunker'

export type PacerState = 'idle' | 'playing' | 'paused'

export interface PacerEngineOptions {
  wpm?: number
  onChunkChange?: (index: number, chunk: PacerChunk | null) => void
  onStateChange?: (state: PacerState) => void
  onPageTurnNeeded?: () => Promise<boolean>
}

export class PacerEngine {
  private chunks: PacerChunk[] = []
  private currentIndex: number = 0
  private state: PacerState = 'idle'
  private wpm: number = 250
  private timer: ReturnType<typeof setTimeout> | null = null
  private isTurningPage = false
  private destroyed = false

  private onChunkChange?: (index: number, chunk: PacerChunk | null) => void
  private onStateChange?: (state: PacerState) => void
  private onPageTurnNeeded?: () => Promise<boolean>

  constructor(options: PacerEngineOptions = {}) {
    this.wpm = options.wpm ?? 250
    this.onChunkChange = options.onChunkChange
    this.onStateChange = options.onStateChange
    this.onPageTurnNeeded = options.onPageTurnNeeded
  }

  public getChunks(): PacerChunk[] {
    return this.chunks
  }

  public getCurrentIndex(): number {
    return this.currentIndex
  }

  public getCurrentChunk(): PacerChunk | null {
    if (this.chunks.length === 0 || this.currentIndex < 0 || this.currentIndex >= this.chunks.length) {
      return null
    }
    return this.chunks[this.currentIndex]
  }

  public getState(): PacerState {
    return this.state
  }

  public getWpm(): number {
    return this.wpm
  }

  public setWpm(wpm: number) {
    this.wpm = Math.max(50, Math.min(1500, wpm))
  }

  public setChunks(chunks: PacerChunk[], preserveIndex = false) {
    this.chunks = chunks
    if (!preserveIndex || this.currentIndex >= chunks.length) {
      this.currentIndex = 0
    }
    if (this.chunks.length === 0) {
      this.clearTimer()
      this.state = 'idle'
      this.onStateChange?.(this.state)
      this.onChunkChange?.(0, null)
      return
    }

    this.onChunkChange?.(this.currentIndex, this.getCurrentChunk())

    // If was playing, continue next step
    if (this.state === 'playing') {
      this.scheduleNext()
    }
  }

  public play() {
    if (this.destroyed || this.chunks.length === 0) return
    if (this.state === 'playing') return

    this.state = 'playing'
    this.onStateChange?.(this.state)
    this.onChunkChange?.(this.currentIndex, this.getCurrentChunk())
    this.scheduleNext()
  }

  public pause() {
    if (this.destroyed) return
    this.clearTimer()
    if (this.state !== 'paused') {
      this.state = 'paused'
      this.onStateChange?.(this.state)
    }
  }

  public toggle() {
    if (this.state === 'playing') {
      this.pause()
    } else {
      this.play()
    }
  }

  public seek(index: number) {
    if (this.chunks.length === 0) return
    const target = Math.max(0, Math.min(this.chunks.length - 1, index))
    this.currentIndex = target
    this.onChunkChange?.(this.currentIndex, this.getCurrentChunk())
    if (this.state === 'playing') {
      this.scheduleNext()
    }
  }

  public nextChunk() {
    if (this.currentIndex < this.chunks.length - 1) {
      this.seek(this.currentIndex + 1)
    } else if (this.onPageTurnNeeded && !this.isTurningPage) {
      void this.handlePageEnd()
    }
  }

  public prevChunk() {
    if (this.currentIndex > 0) {
      this.seek(this.currentIndex - 1)
    }
  }

  private scheduleNext() {
    this.clearTimer()
    if (this.state !== 'playing' || this.destroyed || this.chunks.length === 0) return

    const current = this.getCurrentChunk()
    if (!current) return

    const dwell = current.dwellMs
    this.timer = setTimeout(() => {
      if (this.state !== 'playing' || this.destroyed) return
      if (this.currentIndex < this.chunks.length - 1) {
        this.currentIndex++
        this.onChunkChange?.(this.currentIndex, this.getCurrentChunk())
        this.scheduleNext()
      } else {
        void this.handlePageEnd()
      }
    }, dwell)
  }

  private async handlePageEnd() {
    if (this.isTurningPage || this.destroyed) return
    this.isTurningPage = true
    this.clearTimer()

    try {
      if (this.onPageTurnNeeded) {
        const hasNextPage = await this.onPageTurnNeeded()
        if (!hasNextPage && this.state === 'playing') {
          this.pause()
        }
      } else {
        this.pause()
      }
    } finally {
      this.isTurningPage = false
    }
  }

  private clearTimer() {
    if (this.timer) {
      clearTimeout(this.timer)
      this.timer = null
    }
  }

  public destroy() {
    this.destroyed = true
    this.clearTimer()
  }
}
