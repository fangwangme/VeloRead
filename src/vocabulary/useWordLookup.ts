import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { getDict } from '../platform'
import { newId } from '../platform/ids'
import type {
  DictDownloadProgress,
  DictStatus,
  VocabularyStatus,
  VocabularyWord,
} from '../platform/types'
import type {
  DefinitionState,
  DictionaryDownloadState,
} from '../reader/annotations/HighlightPopover'
import { createLookupIntent } from './intent'
import { isSingleWord, lookupCandidates, normaliseWord, resolveStem } from './lemma'

/**
 * The tag every vocabulary row is filed under.
 *
 * A constant, not the book's metadata: the dictionary is English-only and
 * Chinese lookup is explicitly out of scope, so a Chinese book would otherwise
 * quietly create a second, empty language namespace.
 */
const LANG = 'en'

export interface WordSelection {
  /** The selected text, exactly as it reads on the page. */
  text: string
  /** The sentence it sits in, for the vocabulary row. */
  sentence: string
  /** JSON Locator of the position, or null when it cannot be anchored. */
  locator: string | null
}

export interface WordLookup {
  /**
   * What to show in the popover's definition area, or null when the selection
   * is not a single word — null means "do not render the area at all".
   */
  definition: DefinitionState | null
  /** Whether this word is already in the vocabulary list, and how. */
  vocabulary: VocabularyStatus | 'none'
  /** A selection opened the popover. */
  begin: (selection: WordSelection) => void
  /** The popover closed. */
  end: () => void
  /** The reader did something further with the word — evidence of intent. */
  act: () => void
  /** Cycle the word's place in the vocabulary list. */
  setStatus: (next: VocabularyStatus | 'none') => void
  /** Download the desktop dictionary and retry the current word. */
  downloadDictionary: () => void
}

/**
 * Looking a selected word up, and deciding whether that was a lookup worth
 * keeping.
 *
 * A hook rather than more state inside `Reader.tsx`, which is already 2000
 * lines: the whole of this feature's reader-side behaviour is here, and what
 * the reader has to know is one object.
 *
 * The vocabulary list is read once and then kept in step locally. It is a few
 * hundred rows at most, and re-reading it on every selection would put a
 * database round trip in front of a popover that is supposed to feel instant.
 */
export function useWordLookup(bookId: string): WordLookup {
  const [definition, setDefinition] = useState<DefinitionState | null>(null)
  const [vocabulary, setVocabulary] = useState<VocabularyStatus | 'none'>('none')

  /** stem → the row it is filed under. */
  const savedRef = useRef(new Map<string, VocabularyWord>())
  /**
   * The selection the popover is showing.
   *
   * `stem` is the rules-only guess, good enough to render with; `settled` is
   * the promise of the stem once the dictionary has had its say. Anything that
   * *writes* must await `settled`, because the two can differ — `anopheles`
   * reduces to `anophele` by rule and is its own headword in fact — and a row
   * filed under a guess is a row under the wrong word.
   */
  const pendingRef = useRef<
    (WordSelection & { stem: string; settled: Promise<string> }) | null
  >(null)
  /** Guards against a slow lookup landing after the reader moved on. */
  const tokenRef = useRef(0)
  const downloadRef = useRef<Promise<void> | null>(null)
  const downloadStateRef = useRef<DictionaryDownloadState | null>(null)

  useEffect(() => {
    let cancelled = false
    void (async () => {
      try {
        const entries = await (await getDict()).listVocabulary()
        if (cancelled) return
        savedRef.current = new Map(entries.map((entry) => [entry.word.stem, entry.word]))
      } catch {
        // No vocabulary list is not a reason to stop showing definitions.
      }
    })()
    return () => {
      cancelled = true
    }
  }, [])

  const remember = useCallback((word: VocabularyWord) => {
    savedRef.current.set(word.stem, word)
    // The write and the dictionary answer land in either order. Each one
    // re-reads what the other left behind, so both orderings converge.
    setVocabulary((current) => (pendingRef.current?.stem === word.stem ? word.status : current))
  }, [])

  /**
   * The write for the current opening, started at most once.
   *
   * Memoised rather than merely gated by the dwell timer, because there are two
   * doors into it: the timer, and saving the word explicitly. Dwelling over a
   * definition and *then* pressing save is one lookup of one word in one place
   * — without this it would be two identical sentences under it.
   */
  const recordedRef = useRef<Promise<VocabularyWord | null> | null>(null)

  const record = useCallback((): Promise<VocabularyWord | null> => {
    if (recordedRef.current) return recordedRef.current

    const pending = pendingRef.current
    if (!pending) return Promise.resolve(null)

    const write = (async () => {
      try {
        // Waits for the dictionary. Acting on a word the instant the popover
        // appears must not file it under the rules-only guess.
        const stem = await pending.settled
        const word = await (await getDict()).recordLookup({
          wordId: newId(),
          lookupId: newId(),
          word: normaliseWord(pending.text),
          stem,
          lang: LANG,
          bookId,
          locator: pending.locator,
          sentence: pending.sentence,
          createdAt: new Date().toISOString(),
        })
        remember(word)
        return word
      } catch {
        // Non-fatal: the definition was still read, which is what mattered.
        return null
      }
    })()
    recordedRef.current = write
    return write
  }, [bookId, remember])

  // Built once and never rebuilt: what happens when the evidence lands is
  // decided at `open()`, in an event handler, not here during render.
  const intent = useMemo(() => createLookupIntent(), [])

  // A reader who closes the book mid-popover still meant it if they had dwelt.
  useEffect(() => () => intent.close(), [intent])

  const begin = useCallback(
    (selection: WordSelection) => {
      const token = ++tokenRef.current

      if (!isSingleWord(selection.text)) {
        // A sentence has no dictionary entry: the definition area is not
        // rendered, and nothing is recorded.
        pendingRef.current = null
        recordedRef.current = null
        intent.close()
        setDefinition(null)
        setVocabulary('none')
        return
      }

      const candidates = lookupCandidates(selection.text)
      const word = candidates[0]
      recordedRef.current = null

      const answer = (async () => {
        const dict = await getDict()
        const [found, status] = await Promise.all([dict.lookup(candidates), dict.status()])
        return { found, status }
      })()

      // The rules-only guess renders immediately; `settled` is what anything
      // that writes must wait for. Falling back to the guess keeps a word
      // recordable when the dictionary is missing or broken.
      const guess = resolveStem(selection.text)
      const settled = answer
        .then(({ found }) => resolveStem(selection.text, found.known))
        .catch(() => guess)

      pendingRef.current = { ...selection, stem: guess, settled }
      setDefinition({ status: 'loading' })
      setVocabulary(savedRef.current.get(guess)?.status ?? 'none')
      intent.open(() => void record())

      void (async () => {
        try {
          const { found, status } = await answer
          if (token !== tokenRef.current) return

          const stem = await settled
          pendingRef.current = { ...selection, stem, settled }
          setVocabulary(savedRef.current.get(stem)?.status ?? 'none')
          const offeredDownload =
            !found.entry && !status.ready
              ? downloadState(status, downloadStateRef.current)
              : null
          if (offeredDownload) downloadStateRef.current = offeredDownload
          setDefinition(
            found.entry
              ? { status: 'found', word: found.entry.word, definition: found.entry.definition }
              : status.ready
                ? { status: 'missing', word }
                : { status: 'unavailable', download: offeredDownload },
          )
        } catch {
          if (token !== tokenRef.current) return
          setDefinition({ status: 'unavailable', download: null })
        }
      })()
    },
    [intent, record],
  )

  const end = useCallback(() => {
    tokenRef.current += 1
    intent.close()
    pendingRef.current = null
    recordedRef.current = null
    setDefinition(null)
    setVocabulary('none')
  }, [intent])

  const act = useCallback(() => intent.act(), [intent])

  const setStatus = useCallback(
    (next: VocabularyStatus | 'none') => {
      const pending = pendingRef.current
      if (!pending) return

      if (next === 'none') {
        setVocabulary('none')
        // Nothing left to record — and the write is re-armed, so pressing save
        // again on the same popover puts the word back rather than reporting a
        // row that is no longer there.
        intent.close()
        const written = recordedRef.current
        recordedRef.current = null
        void (async () => {
          // The row to delete is whichever one exists: one this popover just
          // wrote, or one an earlier session did, found under the settled stem.
          const stem = await pending.settled
          const existing = (await written) ?? savedRef.current.get(stem)
          if (pendingRef.current?.stem === stem) setVocabulary('none')
          if (!existing) return
          savedRef.current.delete(existing.stem)
          try {
            await (await getDict()).deleteWord(existing.id)
          } catch {
            // Non-fatal; the row reappears on the next read.
          }
        })()
        return
      }

      setVocabulary(next)
      void (async () => {
        // Saving is the strongest evidence of intent there is, so the row goes
        // in now rather than waiting out the dwell — and through the same
        // memoised write, so dwelling first does not make this a second row.
        const stem = await pending.settled
        const word = (await record()) ?? savedRef.current.get(stem)
        if (!word) return
        savedRef.current.set(word.stem, { ...word, status: next })
        // Reinstated after the write: a row is created `learning`, and letting
        // that land last would silently undo the reader pressing "known".
        if (pendingRef.current?.stem === word.stem) setVocabulary(next)
        try {
          await (await getDict()).setWordStatus(word.id, next)
        } catch {
          // Non-fatal.
        }
      })()
    },
    [intent, record],
  )

  const downloadDictionary = useCallback(() => {
    if (downloadRef.current) return

    const current = downloadStateRef.current
    if (!current) return
    const sizeBytes =
      current.status === 'downloading' ? current.totalBytes : current.sizeBytes

    const publish = (next: DictionaryDownloadState) => {
      downloadStateRef.current = next
      setDefinition((state) =>
        state?.status === 'unavailable' ? { status: 'unavailable', download: next } : state,
      )
    }
    const progress = ({ downloadedBytes, totalBytes }: DictDownloadProgress) => {
      publish({ status: 'downloading', downloadedBytes, totalBytes })
    }

    const install = (async () => {
      try {
        publish({ status: 'downloading', downloadedBytes: 0, totalBytes: sizeBytes })
        const dict = await getDict()
        const status = await dict.download(progress)
        if (!status.ready) throw new Error('The downloaded dictionary did not become ready')
        downloadStateRef.current = null

        // The selection may have changed during the download. Retry whichever
        // word is still open, and never resurrect a popover the reader closed.
        const pending = pendingRef.current
        if (pending) {
          begin({ text: pending.text, sentence: pending.sentence, locator: pending.locator })
        }
      } catch (cause) {
        publish({
          status: 'failed',
          sizeBytes,
          message: cause instanceof Error ? cause.message : String(cause),
        })
      } finally {
        downloadRef.current = null
      }
    })()
    downloadRef.current = install
  }, [begin])

  return { definition, vocabulary, begin, end, act, setStatus, downloadDictionary }
}

function downloadState(
  status: DictStatus,
  current: DictionaryDownloadState | null,
): DictionaryDownloadState | null {
  if (!status.download) return null
  if (current) return current
  return { status: 'available', sizeBytes: status.download.sizeBytes }
}
