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
 *
 * Browser callers use it as a bounded, gesture-specific fallback. Tauri can
 * opt into continuous observation because its packaged WebView may omit both
 * selection and pointer notifications. In that mode the caller must keep
 * already-observed CFIs idempotent across empty polls.
 */
export class SelectionPoller<T> {
  private timer: ReturnType<typeof setInterval> | null = null
  private attempts = 0
  private readonly sources: () => readonly T[]
  private readonly read: (source: T) => boolean
  private readonly onExhausted: () => void
  private readonly intervalMs: number
  private readonly maxAttempts: number | null
  private readonly stopOnSelection: boolean

  constructor(
    sources: () => readonly T[],
    read: (source: T) => boolean,
    onExhausted: () => void,
    intervalMs: number,
    maxAttempts: number | null = SELECTION_POLL_ATTEMPTS,
    stopOnSelection = true,
  ) {
    this.sources = sources
    this.read = read
    this.onExhausted = onExhausted
    this.intervalMs = intervalMs
    this.maxAttempts = maxAttempts
    this.stopOnSelection = stopOnSelection
  }

  start() {
    this.stop()
    this.attempts = 0
    this.timer = setInterval(() => this.poll(), this.intervalMs)
  }

  stop() {
    if (this.timer === null) return
    clearInterval(this.timer)
    this.timer = null
  }

  private poll() {
    for (const source of this.sources()) {
      if (this.read(source)) {
        if (this.stopOnSelection) this.stop()
        return
      }
    }
    if (this.maxAttempts === null) return
    this.attempts += 1
    if (this.attempts >= this.maxAttempts) {
      this.stop()
      this.onExhausted()
    }
  }
}

/** Total wait stays below a third of a second, while spanning WebKit's commit. */
export const SELECTION_CAPTURE_DELAYS_MS = [24, 64, 140] as const

/** One further second for ports whose native selection commits unusually late. */
export const SELECTION_POLL_ATTEMPTS = 10
