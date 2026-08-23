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
const mutationEvents: string[] = []

/** Held open by a test that needs to act while the lookup is still in flight. */
let releaseLookup: (() => void) | null = null
let dictionaryReady = true
let downloads = 0
let holdDownload = false
let releaseDownload: (() => void) | null = null
let holdDelete = false
let releaseDelete: (() => void) | null = null

const dictionaryStatus = () =>
  dictionaryReady
    ? { ready: true, entries: 3, download: null }
    : {
        ready: false,
        entries: 0,
        download: { version: 'dictionary-v1', sizeBytes: 27_324_416 },
      }

const dict: DictPort = {
  init: async () => dictionaryStatus(),
  status: async () => dictionaryStatus(),
  download: async (onProgress) => {
    downloads += 1
    onProgress({ downloadedBytes: 13_662_208, totalBytes: 27_324_416 })
    if (holdDownload) {
      await new Promise<void>((resolve) => {
        releaseDownload = resolve
      })
    }
    onProgress({ downloadedBytes: 27_324_416, totalBytes: 27_324_416 })
    dictionaryReady = true
    return dictionaryStatus()
  },
  // Three words is enough for every case the stem rule turns on: `running` has
  // its own entry *and* reduces to `run`, and `anopheles` is its own headword
  // whose rule-guessed reduction `anophele` is not a word at all.
  lookup: async (candidates: string[]) => {
    if (releaseLookup) {
      await new Promise<void>((resolve) => {
        releaseLookup = resolve
      })
    }
    if (!dictionaryReady) return { known: [], entry: null }
    const known = candidates.filter((word) => ['running', 'run', 'anopheles'].includes(word))
    return {
      known,
      entry: known[0] ? { word: known[0], definition: 'To move swiftly.' } : null,
    }
  },
  listVocabulary: async () => [],
  recordLookup: async (input: VocabularyLookupInput): Promise<VocabularyWord> => {
    mutationEvents.push(`record:${input.word}`)
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
    mutationEvents.push(`delete:start:${id}`)
    if (holdDelete) {
      await new Promise<void>((resolve) => {
        releaseDelete = resolve
      })
    }
    deleted.push(id)
    mutationEvents.push(`delete:done:${id}`)
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
  releaseLookup = null
  dictionaryReady = true
  downloads = 0
  holdDownload = false
  releaseDownload = null
  holdDelete = false
  releaseDelete = null
  recorded.length = 0
  deleted.length = 0
  statuses.length = 0
  mutationEvents.length = 0
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

  it('downloads a missing desktop dictionary and retries the word still open', async () => {
    dictionaryReady = false

    act(() => hook.begin(selection))
    await settle()
    expect(hook.definition).toEqual({
      status: 'unavailable',
      download: { status: 'available', sizeBytes: 27_324_416 },
    })

    act(() => hook.downloadDictionary())
    await settle()
    await settle()

    expect(downloads).toBe(1)
    expect(hook.definition).toEqual({
      status: 'found',
      word: 'running',
      definition: 'To move swiftly.',
    })
  })

  it('keeps download progress visible when another word is selected mid-install', async () => {
    dictionaryReady = false
    holdDownload = true
    act(() => hook.begin(selection))
    await settle()

    act(() => hook.downloadDictionary())
    await settle()
    expect(hook.definition).toEqual({
      status: 'unavailable',
      download: {
        status: 'downloading',
        downloadedBytes: 13_662_208,
        totalBytes: 27_324_416,
      },
    })

    act(() => hook.begin({ ...selection, text: 'runs', sentence: 'She runs.' }))
    await settle()
    expect(hook.definition).toMatchObject({
      status: 'unavailable',
      download: { status: 'downloading' },
    })

    act(() => releaseDownload?.())
    await settle()
    await settle()
    expect(hook.definition).toMatchObject({ status: 'found', word: 'run' })
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

  it('does not record when an existing highlight is merely reopened', async () => {
    act(() => hook.begin(selection, { recordOnDwell: false }))
    await settle()
    act(() => vi.advanceTimersByTime(LOOKUP_INTENT_DWELL_MS * 2))
    act(() => hook.act())
    await settle()

    expect(recorded).toEqual([])
    expect(hook.definition).toMatchObject({ status: 'found', word: 'running' })
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

  it('serialises a slow delete before immediately adding the word back', async () => {
    act(() => hook.begin(selection))
    await settle()
    act(() => hook.setStatus('learning'))
    await settle()

    holdDelete = true
    act(() => hook.setStatus('none'))
    await settle()
    expect(mutationEvents.some((event) => event.startsWith('delete:start:'))).toBe(true)

    act(() => hook.setStatus('learning'))
    await settle()
    expect(recorded).toHaveLength(1)

    act(() => releaseDelete?.())
    await settle()
    await settle()

    expect(recorded).toHaveLength(2)
    expect(hook.vocabulary).toBe('learning')
    expect(mutationEvents.findIndex((event) => event.startsWith('delete:done:'))).toBeLessThan(
      mutationEvents.lastIndexOf('record:running'),
    )
  })

  /**
   * The rules alone reduce `anopheles` to `anophele`; only the dictionary knows
   * it is already the headword. Acting on the word before that answer arrives
   * must not file it under the guess — on a first run the dictionary import can
   * hold that answer for seconds.
   */
  it('files a word under the dictionary stem even when acted on mid-lookup', async () => {
    releaseLookup = () => {}
    act(() => hook.begin({ ...selection, text: 'anopheles', sentence: 'A genus of mosquitoes.' }))
    await settle()

    // The lookup has not answered yet.
    expect(hook.definition).toEqual({ status: 'loading' })
    act(() => hook.act())
    await settle()
    expect(recorded).toEqual([])

    // Now let the dictionary answer.
    act(() => releaseLookup?.())
    await settle()

    expect(recorded).toHaveLength(1)
    expect(recorded[0].stem).toBe('anopheles')
    expect(recorded[0].stem).not.toBe('anophele')
    // And the popover shows the word as saved, not as unsaved under a stem
    // nobody filed it under.
    expect(hook.vocabulary).toBe('learning')
  })

  it('saves under the dictionary stem when saved mid-lookup', async () => {
    releaseLookup = () => {}
    act(() => hook.begin({ ...selection, text: 'anopheles', sentence: 'A genus of mosquitoes.' }))
    await settle()

    act(() => hook.setStatus('known'))
    await settle()
    act(() => releaseLookup?.())
    await settle()

    expect(recorded).toHaveLength(1)
    expect(recorded[0].stem).toBe('anopheles')
    expect(statuses).toEqual([[recorded[0].wordId, 'known']])
    expect(hook.vocabulary).toBe('known')
  })

  it('keeps vocabulary status as none when removed mid-write', async () => {
    act(() => hook.begin(selection))
    await settle()

    // Intent dwell begins recording
    act(() => hook.act())
    // User immediately removes the word before write finishes settling
    act(() => hook.setStatus('none'))
    await settle()

    expect(hook.vocabulary).toBe('none')
    expect(deleted).toHaveLength(1)
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
