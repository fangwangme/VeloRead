import { afterEach, describe, expect, it, vi } from 'vitest'
import type { PacerChunk } from './chunker'
import { PacerEngine } from './engine'
import { nearestChunkIndex } from './usePacer'

function chunk(id: number, left = id * 100): PacerChunk {
  return {
    id,
    text: `chunk-${id}`,
    wordCount: 1,
    rect: { left, top: 10, width: 80, height: 20 },
    rects: [{ left, top: 10, width: 80, height: 20 }],
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
    expect(engine.getState()).toBe('paused')
    expect(engine.getCurrentIndex()).toBe(0)
  })

  it('keeps playing when speed and chunk geometry are updated', () => {
    vi.useFakeTimers()
    const engine = new PacerEngine()
    engine.setChunks([chunk(0), chunk(1)])
    engine.play()

    engine.setWpm(420)
    engine.setChunks([chunk(0), chunk(1), chunk(2)], true)

    expect(engine.getState()).toBe('playing')
    expect(engine.getWpm()).toBe(420)
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
})
