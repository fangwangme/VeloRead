import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { SelectionCaptureQueue, SelectionPoller } from './selectionCapture'

describe('SelectionCaptureQueue', () => {
  beforeEach(() => vi.useFakeTimers())
  afterEach(() => vi.useRealTimers())

  it('waits for a WebKit selection to settle instead of reading in dblclick synchronously', () => {
    const read = vi.fn(() => true)
    const exhausted = vi.fn()
    const queue = new SelectionCaptureQueue(read, exhausted, [20])

    queue.begin()
    queue.queue('word')

    expect(read).not.toHaveBeenCalled()
    vi.advanceTimersByTime(20)
    expect(read).toHaveBeenCalledOnce()
    expect(read).toHaveBeenCalledWith('word')
    expect(exhausted).not.toHaveBeenCalled()
  })

  it('lets the second click replace the first click capture', () => {
    const read = vi.fn(() => true)
    const queue = new SelectionCaptureQueue(read, vi.fn(), [20])

    queue.begin()
    queue.queue('first click')
    queue.begin()
    queue.queue('double click')
    vi.runAllTimers()

    expect(read).toHaveBeenCalledTimes(1)
    expect(read).toHaveBeenCalledWith('double click')
  })

  it('retries a temporarily collapsed selection and emits once when it stabilises', () => {
    const read = vi.fn().mockReturnValueOnce(false).mockReturnValueOnce(false).mockReturnValue(true)
    const exhausted = vi.fn()
    const queue = new SelectionCaptureQueue(read, exhausted, [10, 20, 30])

    queue.begin()
    queue.queue('word')
    vi.runAllTimers()

    expect(read).toHaveBeenCalledTimes(3)
    expect(exhausted).not.toHaveBeenCalled()
  })

  it('falls back only after all bounded attempts fail', () => {
    const exhausted = vi.fn()
    const queue = new SelectionCaptureQueue(() => false, exhausted, [10, 20])

    queue.begin()
    queue.queue('passage')
    vi.runAllTimers()

    expect(exhausted).toHaveBeenCalledOnce()
    expect(exhausted).toHaveBeenCalledWith('passage')
  })

  it('cancels a queued fallback when epub.js already resolved the selection', () => {
    const read = vi.fn(() => true)
    const exhausted = vi.fn()
    const queue = new SelectionCaptureQueue(read, exhausted, [20])

    queue.begin()
    queue.queue('word')
    queue.resolved()
    vi.runAllTimers()

    expect(read).not.toHaveBeenCalled()
    expect(exhausted).not.toHaveBeenCalled()
  })
})

describe('SelectionPoller', () => {
  beforeEach(() => vi.useFakeTimers())
  afterEach(() => vi.useRealTimers())

  it('finds a native WebKit selection even when no DOM selection event fires', () => {
    const read = vi.fn(() => true)
    const onEmpty = vi.fn()
    const poller = new SelectionPoller(() => ['iframe'], read, onEmpty, 100)

    poller.start()
    vi.advanceTimersByTime(100)

    expect(read).toHaveBeenCalledWith('iframe')
    expect(onEmpty).not.toHaveBeenCalled()
    poller.stop()
  })

  it('checks every rendered EPUB view and stops at the first live selection', () => {
    const read = vi.fn((source: string) => source === 'selected iframe')
    const poller = new SelectionPoller(
      () => ['collapsed iframe', 'selected iframe', 'later iframe'],
      read,
      vi.fn(),
      100,
    )

    poller.start()
    vi.advanceTimersByTime(100)

    expect(read.mock.calls.map(([source]) => source)).toEqual([
      'collapsed iframe',
      'selected iframe',
    ])
    poller.stop()
  })

  it('reports a cleared selection and stops observing after teardown', () => {
    const read = vi.fn(() => false)
    const onEmpty = vi.fn()
    const poller = new SelectionPoller(() => ['iframe'], read, onEmpty, 100)

    poller.start()
    vi.advanceTimersByTime(100)
    expect(onEmpty).toHaveBeenCalledOnce()

    poller.stop()
    vi.advanceTimersByTime(500)
    expect(read).toHaveBeenCalledOnce()
  })
})
