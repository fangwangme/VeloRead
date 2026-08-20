import { describe, expect, it } from 'vitest'
import { ReadingSessionBuffer, type ReadingBufferSnapshot } from './sessionBuffer'

function deferredWriter() {
  const persisted: ReadingBufferSnapshot[] = []
  const resolvers: (() => void)[] = []
  const write = (snapshot: ReadingBufferSnapshot) =>
    new Promise<void>((resolve) => {
      resolvers.push(() => {
        persisted.push(snapshot)
        resolve()
      })
    })
  const tick = () => new Promise<void>((resolve) => setTimeout(resolve, 0))
  // Each chain link registers its write only after the previous one settles, so
  // draining has to keep waiting a macrotask for the next writer to show up.
  const settleAll = async () => {
    for (let guard = 0; guard < 50; guard++) {
      if (resolvers.length === 0) {
        await tick()
        if (resolvers.length === 0) return
      }
      resolvers.shift()?.()
      await tick()
    }
    throw new Error('writer queue did not drain')
  }
  const total = () =>
    persisted.reduce(
      (sum, item) => ({
        durationSeconds: sum.durationSeconds + item.durationSeconds,
        latinWords: sum.latinWords + item.latinWords,
        cjkCharacters: sum.cjkCharacters + item.cjkCharacters,
      }),
      { durationSeconds: 0, latinWords: 0, cjkCharacters: 0 },
    )
  return { write, persisted, settleAll, total }
}

describe('ReadingSessionBuffer', () => {
  it('persists exactly what was accumulated', async () => {
    const writer = deferredWriter()
    const buffer = new ReadingSessionBuffer(writer.write)
    buffer.addSeconds(12)
    buffer.addReadingUnits(300, 40)

    const done = buffer.flush()
    await writer.settleAll()
    await done

    expect(writer.total()).toEqual({ durationSeconds: 12, latinWords: 300, cjkCharacters: 40 })
    expect(buffer.pending()).toEqual({ durationSeconds: 0, latinWords: 0, cjkCharacters: 0 })
  })

  it('never persists the same snapshot twice when flushes queue up', async () => {
    // Regression: two flushes queued behind one in-flight write used to read the
    // same buffer snapshot, because the decrement only happened after the write
    // resolved. That double-counted every queued second and word. Panel toggles
    // plus the 15s timer make this collision reachable in normal use.
    const writer = deferredWriter()
    const buffer = new ReadingSessionBuffer(writer.write)

    buffer.addSeconds(10)
    buffer.addReadingUnits(100, 0)
    const first = buffer.flush()

    buffer.addSeconds(5)
    buffer.addReadingUnits(50, 0)
    const second = buffer.flush()
    const third = buffer.flush()

    await writer.settleAll()
    await Promise.all([first, second, third])

    expect(writer.total()).toEqual({ durationSeconds: 15, latinWords: 150, cjkCharacters: 0 })
    expect(buffer.pending()).toEqual({ durationSeconds: 0, latinWords: 0, cjkCharacters: 0 })
  })

  it('keeps increments that arrive while a write is in flight', async () => {
    const writer = deferredWriter()
    const buffer = new ReadingSessionBuffer(writer.write)
    buffer.addSeconds(10)
    const done = buffer.flush()
    // Let the chain link read its snapshot and hand it to the writer, so the
    // seconds below really do land mid-write rather than before it started.
    await new Promise<void>((resolve) => setTimeout(resolve, 0))

    buffer.addSeconds(4)
    await writer.settleAll()
    await done

    expect(writer.total().durationSeconds).toBe(10)
    expect(buffer.pending().durationSeconds).toBe(4)
  })

  it('retains the buffer when a write fails and retries it on the next flush', async () => {
    let attempts = 0
    const persisted: ReadingBufferSnapshot[] = []
    const buffer = new ReadingSessionBuffer(async (snapshot) => {
      attempts += 1
      if (attempts === 1) throw new Error('storage offline')
      persisted.push(snapshot)
    })

    buffer.addSeconds(7)
    buffer.addReadingUnits(20, 5)
    await expect(buffer.flush()).rejects.toThrow('storage offline')
    expect(buffer.pending()).toEqual({ durationSeconds: 7, latinWords: 20, cjkCharacters: 5 })

    buffer.addSeconds(3)
    await buffer.flush()

    expect(persisted).toEqual([{ durationSeconds: 10, latinWords: 20, cjkCharacters: 5 }])
    expect(buffer.pending()).toEqual({ durationSeconds: 0, latinWords: 0, cjkCharacters: 0 })
  })

  it('does not write when there is nothing buffered', async () => {
    let calls = 0
    const buffer = new ReadingSessionBuffer(async () => {
      calls += 1
    })
    await buffer.flush()
    await buffer.flush()
    expect(calls).toBe(0)
  })
})
