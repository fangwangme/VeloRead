import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createLookupIntent, LOOKUP_INTENT_DWELL_MS } from './intent'

describe('createLookupIntent', () => {
  beforeEach(() => vi.useFakeTimers())
  afterEach(() => vi.useRealTimers())

  it('records nothing when the popover is dismissed straight away', () => {
    const onQualify = vi.fn()
    const intent = createLookupIntent()

    intent.open(onQualify)
    vi.advanceTimersByTime(200)
    intent.close()
    vi.advanceTimersByTime(10_000)

    // A double-click that put the caret somewhere, not a lookup.
    expect(onQualify).not.toHaveBeenCalled()
  })

  it('records once the definition has been on screen past the threshold', () => {
    const onQualify = vi.fn()
    const intent = createLookupIntent()

    intent.open(onQualify)
    vi.advanceTimersByTime(LOOKUP_INTENT_DWELL_MS - 1)
    expect(onQualify).not.toHaveBeenCalled()

    vi.advanceTimersByTime(1)
    expect(onQualify).toHaveBeenCalledTimes(1)
  })

  it('records immediately when the reader does something with the word', () => {
    const onQualify = vi.fn()
    const intent = createLookupIntent()

    intent.open(onQualify)
    vi.advanceTimersByTime(50)
    intent.act()

    // Highlighting, saving or searching is evidence on its own — no waiting.
    expect(onQualify).toHaveBeenCalledTimes(1)
  })

  it('records at most once per opening', () => {
    const onQualify = vi.fn()
    const intent = createLookupIntent()

    intent.open(onQualify)
    intent.act()
    intent.act()
    vi.advanceTimersByTime(10_000)

    expect(onQualify).toHaveBeenCalledTimes(1)
  })

  it('starts over for the next word', () => {
    const onQualify = vi.fn()
    const intent = createLookupIntent()

    intent.open(onQualify)
    intent.act()
    intent.close()

    intent.open(onQualify)
    vi.advanceTimersByTime(LOOKUP_INTENT_DWELL_MS)

    expect(onQualify).toHaveBeenCalledTimes(2)
  })

  it('ignores an action after the popover has closed', () => {
    const onQualify = vi.fn()
    const intent = createLookupIntent()

    intent.open(onQualify)
    intent.close()
    intent.act()

    expect(onQualify).not.toHaveBeenCalled()
  })

  it('takes the threshold from the caller, so the rule is one number', () => {
    const onQualify = vi.fn()
    const intent = createLookupIntent(50)

    intent.open(onQualify)
    vi.advanceTimersByTime(50)

    expect(onQualify).toHaveBeenCalledTimes(1)
  })
})
