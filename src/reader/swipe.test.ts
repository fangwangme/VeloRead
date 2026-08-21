import { describe, expect, it } from 'vitest'
import {
  createSwipeTracker,
  isHorizontalWheel,
  wheelDeltaXPx,
  SWIPE_RELEASE_MS,
  SWIPE_THRESHOLD_PX,
} from './swipe'

/** One flick: a strong push followed by a long, decaying inertia tail. */
function flick(deltaX: number, samples = 12): number[] {
  const deltas: number[] = []
  let value = deltaX
  for (let index = 0; index < samples; index++) {
    deltas.push(value)
    value = value * 0.75
  }
  return deltas
}

describe('swipe tracker', () => {
  it('turns exactly one page per flick, however long the inertia runs', () => {
    const tracker = createSwipeTracker()
    const turns: string[] = []

    let now = 0
    for (const deltaX of flick(40, 40)) {
      const direction = tracker.feed({ deltaX, deltaY: 0 }, now)
      if (direction) turns.push(direction)
      now += 8
    }

    expect(turns).toEqual(['next'])
  })

  it('turns again once the burst has gone quiet', () => {
    const tracker = createSwipeTracker()
    const turns: string[] = []

    let now = 0
    for (const deltaX of flick(40)) {
      const direction = tracker.feed({ deltaX, deltaY: 0 }, now)
      if (direction) turns.push(direction)
      now += 8
    }

    now += SWIPE_RELEASE_MS + 1
    for (const deltaX of flick(-40)) {
      const direction = tracker.feed({ deltaX, deltaY: 0 }, now)
      if (direction) turns.push(direction)
      now += 8
    }

    expect(turns).toEqual(['next', 'prev'])
  })

  it('reads a negative deltaX as the previous page', () => {
    const tracker = createSwipeTracker()
    expect(tracker.feed({ deltaX: -SWIPE_THRESHOLD_PX, deltaY: 0 }, 0)).toBe('prev')
  })

  it('ignores vertical scrolling, including a drifting one', () => {
    const tracker = createSwipeTracker()
    let now = 0
    for (let index = 0; index < 20; index++) {
      expect(tracker.feed({ deltaX: 12, deltaY: 40 }, now)).toBeNull()
      now += 8
    }
    // The drift must not have accumulated either: one deliberate swipe after it
    // still has to travel the whole threshold.
    expect(tracker.feed({ deltaX: SWIPE_THRESHOLD_PX - 1, deltaY: 0 }, now)).toBeNull()
  })

  it('does not fire below the threshold', () => {
    const tracker = createSwipeTracker()
    expect(tracker.feed({ deltaX: SWIPE_THRESHOLD_PX - 1, deltaY: 0 }, 0)).toBeNull()
  })

  it('converts line and page deltas rather than adding them as pixels', () => {
    expect(wheelDeltaXPx({ deltaX: 3, deltaY: 0, deltaMode: 0 })).toBe(3)
    expect(wheelDeltaXPx({ deltaX: 3, deltaY: 0, deltaMode: 1 })).toBe(48)
    expect(wheelDeltaXPx({ deltaX: 1, deltaY: 0, deltaMode: 2 })).toBe(400)

    // A one-line-per-event mouse wheel would never reach the threshold if its
    // deltas were counted as pixels.
    const tracker = createSwipeTracker()
    const turns = [1, 1, 1, 1, 1, 1].map((deltaX, index) =>
      tracker.feed({ deltaX, deltaY: 0, deltaMode: 1 }, index * 8),
    )
    expect(turns.filter(Boolean)).toEqual(['next'])
  })

  it('calls a tie vertical', () => {
    expect(isHorizontalWheel({ deltaX: 10, deltaY: 10 })).toBe(false)
    expect(isHorizontalWheel({ deltaX: 11, deltaY: 10 })).toBe(true)
  })

  it('forgets a gesture when reset', () => {
    const tracker = createSwipeTracker()
    tracker.feed({ deltaX: SWIPE_THRESHOLD_PX - 1, deltaY: 0 }, 0)
    tracker.reset()
    expect(tracker.feed({ deltaX: 2, deltaY: 0 }, 8)).toBeNull()
  })
})
