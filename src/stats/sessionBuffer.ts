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
 *   nothing.
 */
export interface ReadingBufferSnapshot {
  durationSeconds: number
  latinWords: number
  cjkCharacters: number
}

const EMPTY: ReadingBufferSnapshot = {
  durationSeconds: 0,
  latinWords: 0,
  cjkCharacters: 0,
}

export function isEmptySnapshot(snapshot: ReadingBufferSnapshot): boolean {
  return (
    snapshot.durationSeconds <= 0 &&
    snapshot.latinWords <= 0 &&
    snapshot.cjkCharacters <= 0
  )
}

export class ReadingSessionBuffer {
  private durationSeconds = 0
  private latinWords = 0
  private cjkCharacters = 0
  private chain: Promise<void> = Promise.resolve()
  private readonly write: (snapshot: ReadingBufferSnapshot) => Promise<void>

  constructor(write: (snapshot: ReadingBufferSnapshot) => Promise<void>) {
    this.write = write
  }

  addSeconds(seconds: number) {
    if (seconds > 0) this.durationSeconds += seconds
  }

  addReadingUnits(latinWords: number, cjkCharacters: number) {
    if (latinWords > 0) this.latinWords += latinWords
    if (cjkCharacters > 0) this.cjkCharacters += cjkCharacters
  }

  /** What is still waiting to be persisted. Exposed for assertions and tests. */
  pending(): ReadingBufferSnapshot {
    return {
      durationSeconds: this.durationSeconds,
      latinWords: this.latinWords,
      cjkCharacters: this.cjkCharacters,
    }
  }

  /**
   * Persist whatever is buffered. Safe to call concurrently and repeatedly:
   * every call joins the same serial chain, and a call that finds an empty
   * buffer resolves without writing.
   */
  flush(): Promise<void> {
    const next = this.chain.then(async () => {
      const snapshot = this.pending()
      if (isEmptySnapshot(snapshot)) return

      await this.write(snapshot)

      this.durationSeconds = Math.max(0, this.durationSeconds - snapshot.durationSeconds)
      this.latinWords = Math.max(0, this.latinWords - snapshot.latinWords)
      this.cjkCharacters = Math.max(0, this.cjkCharacters - snapshot.cjkCharacters)
    })

    // A rejected link must not poison every later flush, but the caller still
    // sees its own failure.
    this.chain = next.catch(() => undefined)
    return next
  }
}

export { EMPTY as EMPTY_SNAPSHOT }
