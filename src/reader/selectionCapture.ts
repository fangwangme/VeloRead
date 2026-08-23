/**
 * WebKit can finish committing a native text selection after the pointer event
 * which created it. A single synchronous `getSelection()` in `dblclick` is
 * therefore not a reliable signal that no selection exists.
 *
 * This queue gives one gesture a few short, bounded chances to read its final
 * selection. Starting a new gesture invalidates the previous queue, and
 * resolving through epub.js cancels the fallback so the caller still emits only
 * once.
 */
export class SelectionCaptureQueue<T> {
  private generation = 0
  private timer: ReturnType<typeof setTimeout> | null = null
  private readonly read: (source: T) => boolean
  private readonly onExhausted: (source: T) => void
  private readonly delays: readonly number[]

  constructor(
    read: (source: T) => boolean,
    onExhausted: (source: T) => void,
    delays: readonly number[] = SELECTION_CAPTURE_DELAYS_MS,
  ) {
    this.read = read
    this.onExhausted = onExhausted
    this.delays = delays
  }

  /** A new pointer/keyboard gesture supersedes every pending read. */
  begin() {
    this.generation += 1
    this.clearTimer()
  }

  /** Queue (or restart) capture for the current gesture. Never reads synchronously. */
  queue(source: T) {
    const generation = this.generation
    this.clearTimer()
    this.schedule(source, generation, 0)
  }

  /** Another path already emitted this selection. */
  resolved() {
    this.generation += 1
    this.clearTimer()
  }

  cancel() {
    this.resolved()
  }

  private schedule(source: T, generation: number, attempt: number) {
    const delay = this.delays[attempt]
    if (delay === undefined) {
      this.onExhausted(source)
      return
    }

    this.timer = setTimeout(() => {
      this.timer = null
      if (generation !== this.generation) return
      if (this.read(source)) return
      this.schedule(source, generation, attempt + 1)
    }, delay)
  }

  private clearTimer() {
    if (this.timer === null) return
    clearTimeout(this.timer)
    this.timer = null
  }
}

/**
 * Last-resort selection observation for WebKit ports which paint native text
 * selection but omit the DOM events epub.js listens for.
 */
export class SelectionPoller<T> {
  private timer: ReturnType<typeof setInterval> | null = null
  private readonly sources: () => readonly T[]
  private readonly read: (source: T) => boolean
  private readonly onEmpty: () => void
  private readonly intervalMs: number

  constructor(
    sources: () => readonly T[],
    read: (source: T) => boolean,
    onEmpty: () => void,
    intervalMs: number,
  ) {
    this.sources = sources
    this.read = read
    this.onEmpty = onEmpty
    this.intervalMs = intervalMs
  }

  start() {
    if (this.timer !== null) return
    this.timer = setInterval(() => this.poll(), this.intervalMs)
  }

  stop() {
    if (this.timer === null) return
    clearInterval(this.timer)
    this.timer = null
  }

  private poll() {
    for (const source of this.sources()) {
      if (this.read(source)) return
    }
    this.onEmpty()
  }
}

/** Total wait stays below a third of a second, while spanning WebKit's commit. */
export const SELECTION_CAPTURE_DELAYS_MS = [24, 64, 140] as const
