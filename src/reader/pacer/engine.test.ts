import { afterEach, describe, expect, it, vi } from 'vitest'
import type { PacerChunk } from './chunker'
import { PacerEngine } from './engine'
import { chunkIndexContainingRange, nearestChunkIndex } from './usePacer'

function chunk(id: number, left = id * 100): PacerChunk {
  return {
    id,
    text: `chunk-${id}`,
    units: { latinWords: 1, cjkCharacters: 0 },
    rect: { left, top: 10, width: 80, height: 20 },
    lineBoxes: [{ left, top: 10, width: 80, height: 20 }],
    lineRect: { left, top: 10, width: 80, height: 20 },
    dwellMs: 100,
    animMs: 50,
  }
}

afterEach(() => {
  vi.useRealTimers()
})

describe('PacerEngine', () => {
  it('pauses at the end of the book instead of restarting the final page', async () => {
    vi.useFakeTimers()
    const onPageTurnNeeded = vi.fn().mockResolvedValue(false)
    const engine = new PacerEngine({ onPageTurnNeeded })
    engine.setChunks([chunk(0)])
    engine.play()

    await vi.advanceTimersByTimeAsync(100)

    expect(onPageTurnNeeded).toHaveBeenCalledTimes(1)
    expect(onPageTurnNeeded).toHaveBeenCalledWith(true)
    expect(engine.getState()).toBe('paused')
    expect(engine.getCurrentIndex()).toBe(0)
  })

  it('does not report a fully consumed page after seeking to the final chunk', async () => {
    vi.useFakeTimers()
    const onPageTurnNeeded = vi.fn().mockResolvedValue(false)
    const engine = new PacerEngine({ onPageTurnNeeded })
    engine.setChunks([chunk(0), chunk(1), chunk(2)])
    engine.seek(2)
    engine.play()

    await vi.advanceTimersByTimeAsync(100)

    expect(onPageTurnNeeded).toHaveBeenCalledWith(false)
  })

  it('can conservatively invalidate consumption without pausing playback', async () => {
    vi.useFakeTimers()
    const onPageTurnNeeded = vi.fn().mockResolvedValue(false)
    const engine = new PacerEngine({ onPageTurnNeeded })
    engine.setChunks([chunk(0)])
    engine.play()
    engine.invalidatePageConsumption()

    expect(engine.getState()).toBe('playing')
    await vi.advanceTimersByTimeAsync(100)

    expect(onPageTurnNeeded).toHaveBeenCalledWith(false)
  })

  it('invalidates page consumption when the last chunk is skipped manually', async () => {
    vi.useFakeTimers()
    const onPageTurnNeeded = vi.fn().mockResolvedValue(false)
    const engine = new PacerEngine({ onPageTurnNeeded })
    engine.setChunks([chunk(0), chunk(1)])
    engine.play()
    engine.nextChunk()
    engine.nextChunk()

    await vi.runAllTimersAsync()

    expect(onPageTurnNeeded).toHaveBeenCalledWith(false)
  })

  it('keeps playing when retimed chunk geometry is updated', () => {
    vi.useFakeTimers()
    const engine = new PacerEngine()
    engine.setChunks([chunk(0), chunk(1)])
    engine.play()

    const retimed = [chunk(0), chunk(1), chunk(2)].map((item) => ({ ...item, dwellMs: 140 }))
    engine.setChunks(retimed, true)

    expect(engine.getState()).toBe('playing')
    expect(engine.getCurrentChunk()?.dwellMs).toBe(140)
    expect(engine.getCurrentIndex()).toBe(0)
  })

  it('maps a clicked word rectangle to the corresponding chunk', () => {
    expect(
      nearestChunkIndex(
        [chunk(0, 0), chunk(1, 100), chunk(2, 200)],
        { left: 135, top: 12, width: 20, height: 18 },
      ),
    ).toBe(1)
  })

  it('keeps the engine paused when a click seeks the cursor to another chunk', () => {
    const onStateChange = vi.fn()
    const engine = new PacerEngine({ onStateChange })
    engine.setChunks([chunk(0), chunk(1), chunk(2)])

    // A click while idle repositions the cursor. It must never start playback:
    // starting is an explicit user action (play button or Space).
    engine.seek(2)

    expect(engine.getCurrentIndex()).toBe(2)
    expect(engine.getState()).toBe('idle')
    expect(onStateChange).not.toHaveBeenCalledWith('playing')

    engine.pause()
    engine.seek(1)
    expect(engine.getCurrentIndex()).toBe(1)
    expect(engine.getState()).toBe('paused')
  })

  it('keeps running from the new position when a click seeks while playing', async () => {
    vi.useFakeTimers()
    const engine = new PacerEngine({})
    engine.setChunks([chunk(0), chunk(1), chunk(2), chunk(3)])
    engine.play()
    expect(engine.getState()).toBe('playing')

    engine.seek(2)
    expect(engine.getState()).toBe('playing')
    expect(engine.getCurrentIndex()).toBe(2)

    await vi.advanceTimersByTimeAsync(100)
    expect(engine.getCurrentIndex()).toBe(3)
    expect(engine.getState()).toBe('playing')
  })

  it('maps a rebuilt chunk group by DOM text position instead of numeric index', () => {
    const node = document.createTextNode('one two three four five six')
    document.body.append(node)
    const range = (start: number, end: number) => {
      const value = document.createRange()
      value.setStart(node, start)
      value.setEnd(node, end)
      return value
    }
    const rebuilt = [
      { ...chunk(0), range: range(0, 13) },
      { ...chunk(1), range: range(14, 27) },
    ]

    expect(chunkIndexContainingRange(rebuilt, range(8, 13))).toBe(0)
    expect(chunkIndexContainingRange(rebuilt, range(19, 23))).toBe(1)
  })
})
