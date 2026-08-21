/**
 * In-memory accumulator for the active reading session.
 *
 * Time and reading units are counted continuously while the reader is active,
 * but persisted in occasional snapshots. That split is where reading stats are
 * easiest to corrupt, so the rules live here rather than inside the component:
 *
 * - writes are serialized into a single chain, so two flushes can never persist
 *   the same snapshot twice;
 * - the snapshot is read *inside* the chain, so a flush queued behind another
 *   one sees the already-decremented buffer;
 * - the buffer is decremented only by what a successful write persisted, so
 *   increments that arrived mid-write stay queued and a failed write loses
 *   nothing;
 * - counts carry the local day they were read on. Crossing midnight seals the
 *   old day into its own bucket instead of letting the flush stamp whatever day
 *   it happens to run on, which used to move the tail of an evening session
 *   onto tomorrow.
 */
export interface ReadingBufferSnapshot {
  /** Local date key (YYYY-MM-DD) these counts were read on. */
  date: string
  durationSeconds: number
  latinWords: number
  cjkCharacters: number
}

export function isEmptySnapshot(snapshot: ReadingBufferSnapshot): boolean {
  return (
    snapshot.durationSeconds <= 0 &&
    snapshot.latinWords <= 0 &&
    snapshot.cjkCharacters <= 0
  )
}

export class ReadingSessionBuffer {
  private date: string
  private durationSeconds = 0
  private latinWords = 0
  private cjkCharacters = 0
  /** Days closed by a rollover, oldest first, still waiting to be persisted. */
  private sealed: ReadingBufferSnapshot[] = []
  private chain: Promise<void> = Promise.resolve()
  private readonly write: (snapshot: ReadingBufferSnapshot) => Promise<void>

  constructor(write: (snapshot: ReadingBufferSnapshot) => Promise<void>, date: string) {
    this.write = write
    this.date = date
  }

  /**
   * Move the accumulator to a new local day. Whatever is buffered is sealed
   * under the day it was actually read on, so a session running across midnight
   * splits instead of landing wholesale on the new date.
   */
  setDate(date: string) {
    if (date === this.date) return
    const live = this.liveSnapshot()
    if (!isEmptySnapshot(live)) this.sealed.push(live)
    this.durationSeconds = 0
    this.latinWords = 0
    this.cjkCharacters = 0
    this.date = date
  }

  addSeconds(seconds: number) {
    if (seconds > 0) this.durationSeconds += seconds
  }

  addReadingUnits(latinWords: number, cjkCharacters: number) {
    if (latinWords > 0) this.latinWords += latinWords
    if (cjkCharacters > 0) this.cjkCharacters += cjkCharacters
  }

  /** The current day's bucket. Exposed for assertions and tests. */
  pending(): ReadingBufferSnapshot {
    return this.liveSnapshot()
  }

  /** Days already closed by a rollover but not yet written. */
  pendingSealed(): ReadingBufferSnapshot[] {
    return this.sealed.map((bucket) => ({ ...bucket }))
  }

  private liveSnapshot(): ReadingBufferSnapshot {
    return {
      date: this.date,
      durationSeconds: this.durationSeconds,
      latinWords: this.latinWords,
      cjkCharacters: this.cjkCharacters,
    }
  }

  /**
   * Remove the current day's counts from the buffer and hand them over. Taking
   * synchronously is what makes a queued flush see an empty buffer instead of
   * persisting the same numbers a second time.
   */
  private take(): ReadingBufferSnapshot {
    const snapshot = this.liveSnapshot()
    this.durationSeconds = 0
    this.latinWords = 0
    this.cjkCharacters = 0
    return snapshot
  }

  /**
   * Put a failed write's counts back where they belong. Not necessarily the
   * live bucket: midnight may have rolled over while the write was in flight,
   * in which case they belong to the sealed day they were read on.
   */
  private restore(snapshot: ReadingBufferSnapshot) {
    if (snapshot.date === this.date) {
      this.durationSeconds += snapshot.durationSeconds
      this.latinWords += snapshot.latinWords
      this.cjkCharacters += snapshot.cjkCharacters
      return
    }
    const existing = this.sealed.find((bucket) => bucket.date === snapshot.date)
    if (existing) {
      existing.durationSeconds += snapshot.durationSeconds
      existing.latinWords += snapshot.latinWords
      existing.cjkCharacters += snapshot.cjkCharacters
      return
    }
    this.sealed.push({ ...snapshot })
    // Date keys are YYYY-MM-DD, so this keeps the queue in reading order.
    this.sealed.sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0))
  }

  /**
   * Persist whatever is buffered, sealed days first. Safe to call concurrently
   * and repeatedly: every call joins the same serial chain, and a call that
   * finds an empty buffer resolves without writing.
   */
  flush(): Promise<void> {
    const next = this.chain.then(async () => {
      // Sealed days first, so the write order matches the reading order.
      while (this.sealed.length > 0) {
        const bucket = this.sealed.shift() as ReadingBufferSnapshot
        try {
          await this.write(bucket)
        } catch (cause) {
          this.restore(bucket)
          throw cause
        }
      }

      const snapshot = this.take()
      if (isEmptySnapshot(snapshot)) return

      try {
        await this.write(snapshot)
      } catch (cause) {
        this.restore(snapshot)
        throw cause
      }
    })

    // A rejected link must not poison every later flush, but the caller still
    // sees its own failure.
    this.chain = next.catch(() => undefined)
    return next
  }
}
