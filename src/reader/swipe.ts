/**
 * Turning pages by swiping sideways on a Magic Mouse or trackpad.
 *
 * The hard part is not the direction, it is that one flick of two fingers is not
 * one event. macOS sends a burst of `wheel` events whose `deltaX` decays with the
 * inertia of the gesture — dozens to hundreds of them, easily several hundred
 * pixels in total. Turning a page per event, or per fixed number of pixels, would
 * fan through five pages on one flick.
 *
 * So: accumulate, fire once at a threshold, then lock until the burst has gone
 * quiet. The lock is released by time-since-last-event rather than by a timer,
 * because the tail of a flick is exactly what must not be allowed to start the
 * next page turn.
 *
 * Kept free of the DOM so the thresholds can be exercised as plain numbers, and
 * so the book iframe and the parent document can share one instance — each
 * listener seeing only half of a gesture is another way to turn two pages.
 */

/** Pixels of horizontal travel that count as a deliberate page turn. */
export const SWIPE_THRESHOLD_PX = 90

/** Quiet time that ends a gesture. Below ~200ms the inertia tail re-triggers. */
export const SWIPE_RELEASE_MS = 260

/** `deltaMode: 1` counts lines. A text line is the sensible unit to assume. */
const LINE_TO_PX = 16

/** `deltaMode: 2` counts pages, which for a horizontal wheel means a screenful. */
const PAGE_TO_PX = 400

export type SwipeDirection = 'prev' | 'next'

/** The parts of a `WheelEvent` this module reads. */
export interface WheelSample {
  deltaX: number
  deltaY: number
  deltaMode?: number
}

/**
 * Is this a sideways gesture at all?
 *
 * Ties go to vertical: a mostly-vertical scroll with a little sideways drift is
 * someone scrolling, and in scrolled flow that has to keep working.
 */
export function isHorizontalWheel(sample: WheelSample): boolean {
  return Math.abs(sample.deltaX) > Math.abs(sample.deltaY)
}

/** Horizontal travel in CSS pixels, whatever unit the event reported. */
export function wheelDeltaXPx(sample: WheelSample): number {
  switch (sample.deltaMode) {
    case 1:
      return sample.deltaX * LINE_TO_PX
    case 2:
      return sample.deltaX * PAGE_TO_PX
    default:
      return sample.deltaX
  }
}

export interface SwipeTracker {
  /**
   * Feed one wheel event. `now` is a timestamp from a single clock — events from
   * inside the book iframe carry their own time origin, so the caller passes the
   * parent's clock rather than `event.timeStamp`.
   *
   * Returns the page turn this event completed, or null.
   */
  feed(sample: WheelSample, now: number): SwipeDirection | null
  /** Forget the current gesture, e.g. after the page changed some other way. */
  reset(): void
}

export function createSwipeTracker(
  options: { thresholdPx?: number; releaseMs?: number } = {},
): SwipeTracker {
  const thresholdPx = options.thresholdPx ?? SWIPE_THRESHOLD_PX
  const releaseMs = options.releaseMs ?? SWIPE_RELEASE_MS

  let travelled = 0
  let spent = false
  let lastEventAt: number | null = null

  return {
    feed(sample, now) {
      if (!isHorizontalWheel(sample)) return null

      if (lastEventAt !== null && now - lastEventAt > releaseMs) {
        travelled = 0
        spent = false
      }
      lastEventAt = now

      // Still inside the gesture that already turned a page: swallow the tail.
      if (spent) return null

      travelled += wheelDeltaXPx(sample)
      if (Math.abs(travelled) < thresholdPx) return null

      // macOS natural scrolling: pushing the content left reveals what comes
      // after it, which in a book is the next page.
      const direction: SwipeDirection = travelled > 0 ? 'next' : 'prev'
      travelled = 0
      spent = true
      return direction
    },
    reset() {
      travelled = 0
      spent = false
      lastEventAt = null
    },
  }
}
