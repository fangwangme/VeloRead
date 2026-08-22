import { act, useEffect } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { DictPort, VocabularyLookupInput, VocabularyWord } from '../platform/types'
import { LOOKUP_INTENT_DWELL_MS } from './intent'
import { useWordLookup, type WordLookup } from './useWordLookup'

/** Every lookup written during a test, in order. */
const recorded: VocabularyLookupInput[] = []
const deleted: string[] = []
const statuses: [string, string][] = []

const dict: DictPort = {
  init: async () => ({ ready: true, entries: 2 }),
  status: async () => ({ ready: true, entries: 2 }),
  // A two-word dictionary is enough: `running` has its own entry and `run` is
  // the reduction, which is the case the stem rule turns on.
  lookup: async (candidates: string[]) => {
    const known = candidates.filter((word) => ['running', 'run'].includes(word))
    return {
      known,
      entry: known[0] ? { word: known[0], definition: 'To move swiftly.' } : null,
    }
  },
  listVocabulary: async () => [],
  recordLookup: async (input: VocabularyLookupInput): Promise<VocabularyWord> => {
    recorded.push(input)
    return {
      id: input.wordId,
      word: input.word,
      stem: input.stem,
      lang: input.lang,
      status: 'learning',
      createdAt: input.createdAt,
    }
  },
  setWordStatus: async (id, status) => {
    statuses.push([id, status])
  },
  deleteWord: async (id) => {
    deleted.push(id)
  },
}

vi.mock('../platform', () => ({ getDict: () => Promise.resolve(dict) }))

let root: Root | null = null
let host: HTMLDivElement | null = null
let hook: WordLookup

function Probe() {
  const value = useWordLookup('book-a')
  // Published from an effect rather than during render: assigning to an outer
  // variable while rendering is a side effect, and `act()` flushes effects, so
  // this is always the latest value by the time a test reads it.
  useEffect(() => {
    hook = value
  })
  return null
}

/** Lets the mocked port's promises settle. */
async function settle() {
  await act(async () => {
    await Promise.resolve()
    await Promise.resolve()
    await Promise.resolve()
  })
}

const selection = {
  text: 'running',
  sentence: 'He kept running.',
  locator: '{"format":"epub","cfi":"epubcfi(/6/2!/4/2)"}',
}

beforeEach(async () => {
  recorded.length = 0
  deleted.length = 0
  statuses.length = 0
  vi.useFakeTimers()
  host = document.createElement('div')
  document.body.append(host)
  const container = host
  act(() => {
    root = createRoot(container)
    root.render(<Probe />)
  })
  await settle()
})

afterEach(() => {
  act(() => root?.unmount())
  root = null
  host?.remove()
  host = null
  vi.useRealTimers()
})

describe('useWordLookup', () => {
  it('shows the entry for the word as selected, and files it under the stem', async () => {
    act(() => hook.begin(selection))
    await settle()

    // `running` has its own entry: that is what the reader should read.
    expect(hook.definition).toEqual({
      status: 'found',
      word: 'running',
      definition: 'To move swiftly.',
    })

    act(() => vi.advanceTimersByTime(LOOKUP_INTENT_DWELL_MS))
    await settle()

    // But the row it belongs to is `run`.
    expect(recorded).toHaveLength(1)
    expect(recorded[0].stem).toBe('run')
    expect(recorded[0].word).toBe('running')
    expect(recorded[0].sentence).toBe('He kept running.')
    expect(recorded[0].bookId).toBe('book-a')
  })

  it('does not render a definition area for a sentence, and records nothing', async () => {
    act(() => hook.begin({ ...selection, text: 'He kept running until it was dark.' }))
    await settle()

    expect(hook.definition).toBeNull()

    act(() => vi.advanceTimersByTime(10_000))
    await settle()
    expect(recorded).toEqual([])
  })

  it('records nothing when the popover is dismissed before the threshold', async () => {
    act(() => hook.begin(selection))
    await settle()
    act(() => vi.advanceTimersByTime(200))
    act(() => hook.end())
    act(() => vi.advanceTimersByTime(10_000))
    await settle()

    // A double-click that put the caret somewhere is not a lookup.
    expect(recorded).toEqual([])
  })

  it('records at once when the reader acts on the word', async () => {
    act(() => hook.begin(selection))
    await settle()
    act(() => hook.act())
    await settle()

    expect(recorded).toHaveLength(1)
  })

  /** The bug this memoisation exists for: two doors into one write. */
  it('does not write a second sentence when a dwell is followed by saving', async () => {
    act(() => hook.begin(selection))
    await settle()

    act(() => vi.advanceTimersByTime(LOOKUP_INTENT_DWELL_MS))
    await settle()
    expect(recorded).toHaveLength(1)

    act(() => hook.setStatus('known'))
    await settle()

    // One lookup of one word in one place is one sentence, however many ways
    // the reader confirmed they meant it.
    expect(recorded).toHaveLength(1)
    expect(statuses).toEqual([[recorded[0].wordId, 'known']])
  })

  it('saves a word that was never dwelt on, then marks it known', async () => {
    act(() => hook.begin(selection))
    await settle()
    act(() => hook.setStatus('learning'))
    await settle()

    expect(recorded).toHaveLength(1)
    expect(hook.vocabulary).toBe('learning')
  })

  it('puts a word back after it was removed from the same popover', async () => {
    act(() => hook.begin(selection))
    await settle()
    act(() => hook.setStatus('learning'))
    await settle()

    act(() => hook.setStatus('none'))
    await settle()
    expect(deleted).toHaveLength(1)
    expect(hook.vocabulary).toBe('none')

    // Re-armed: pressing save again writes the row again rather than reporting
    // one that is no longer there.
    act(() => hook.setStatus('learning'))
    await settle()
    expect(recorded).toHaveLength(2)
    expect(hook.vocabulary).toBe('learning')
  })

  it('starts a fresh write for the next word', async () => {
    act(() => hook.begin(selection))
    await settle()
    act(() => hook.act())
    await settle()

    act(() => hook.end())
    act(() => hook.begin({ ...selection, text: 'runs', sentence: 'She runs.' }))
    await settle()
    act(() => hook.act())
    await settle()

    expect(recorded).toHaveLength(2)
    expect(recorded[1].word).toBe('runs')
    // Both forms land on the same row, which is the point of the stem.
    expect(recorded.map((entry) => entry.stem)).toEqual(['run', 'run'])
  })
})
