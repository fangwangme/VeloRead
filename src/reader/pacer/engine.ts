import type { PacerChunk } from './chunker'

export type PacerState = 'idle' | 'playing' | 'paused'

/**
 * Why the current chunk changed.
 *
 * The reading position may only be written when the reader actually moved:
 * `advance` is playback, `seek` is the reader asking for a position. `set` is
 * the cursor being re-attached to the same words after a reflow or a page turn,
 * which must not overwrite where the reader left off (docs/specs/pacer.md §8).
 */
export type ChunkChangeCause = 'advance' | 'seek' | 'set'

export interface PacerEngineOptions {
  onChunkChange?: (index: number, chunk: PacerChunk | null, cause: ChunkChangeCause) => void
  onStateChange?: (state: PacerState) => void
  onPageTurnNeeded?: (fullyConsumed: boolean) => Promise<boolean>
}

export class PacerEngine {
  private chunks: PacerChunk[] = []
  private currentIndex: number = 0
  private state: PacerState = 'idle'
  private timer: ReturnType<typeof setTimeout> | null = null
  private isTurningPage = false
  private traversalStartedAtFirstChunk = false
  private destroyed = false

  private onChunkChange?: (index: number, chunk: PacerChunk | null, cause: ChunkChangeCause) => void
  private onStateChange?: (state: PacerState) => void
  private onPageTurnNeeded?: (fullyConsumed: boolean) => Promise<boolean>

  constructor(options: PacerEngineOptions = {}) {
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

  public setChunks(chunks: PacerChunk[], preserveIndex = false) {
    this.chunks = chunks
    const resetIndex = !preserveIndex || this.currentIndex >= chunks.length
    if (resetIndex) {
      this.currentIndex = 0
      this.traversalStartedAtFirstChunk = !preserveIndex && this.state === 'playing'
    }
    if (this.chunks.length === 0) {
      this.clearTimer()
      this.state = 'idle'
      this.onStateChange?.(this.state)
      this.onChunkChange?.(0, null, 'set')
      return
    }

    this.onChunkChange?.(this.currentIndex, this.getCurrentChunk(), 'set')

    // If was playing, continue next step
    if (this.state === 'playing') {
      this.scheduleNext()
    }
  }

  public play() {
    if (this.destroyed || this.chunks.length === 0) return
    if (this.state === 'playing') return

    this.state = 'playing'
    if (this.currentIndex === 0) this.traversalStartedAtFirstChunk = true
    this.onStateChange?.(this.state)
    // Resuming re-announces the chunk the cursor is already on; it is not a move.
    this.onChunkChange?.(this.currentIndex, this.getCurrentChunk(), 'set')
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

  public invalidatePageConsumption() {
    this.traversalStartedAtFirstChunk = false
  }

  /**
   * Move the cursor. `cause` is `set` when the caller is only re-attaching the
   * cursor to the words it was already on, e.g. after a reflow.
   */
  public seek(index: number, cause: ChunkChangeCause = 'seek') {
    if (this.chunks.length === 0) return
    const target = Math.max(0, Math.min(this.chunks.length - 1, index))
    this.currentIndex = target
    // Public seeks are user-driven. Returning to the first chunk restarts a
    // truthful full-page traversal; every other jump invalidates it.
    this.traversalStartedAtFirstChunk = target === 0
    this.onChunkChange?.(this.currentIndex, this.getCurrentChunk(), cause)
    if (this.state === 'playing') {
      this.scheduleNext()
    }
  }

  public nextChunk() {
    if (this.currentIndex < this.chunks.length - 1) {
      this.seek(this.currentIndex + 1)
    } else if (this.onPageTurnNeeded && !this.isTurningPage) {
      this.traversalStartedAtFirstChunk = false
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
        this.onChunkChange?.(this.currentIndex, this.getCurrentChunk(), 'advance')
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
        const fullyConsumed = this.traversalStartedAtFirstChunk
        this.traversalStartedAtFirstChunk = false
        const hasNextPage = await this.onPageTurnNeeded(fullyConsumed)
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
