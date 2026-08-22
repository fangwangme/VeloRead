import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { getDict } from '../platform'
import { newId } from '../platform/ids'
import type { VocabularyStatus, VocabularyWord } from '../platform/types'
import type { DefinitionState } from '../reader/annotations/HighlightPopover'
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
  /** The selection the popover is currently showing, with its resolved stem. */
  const pendingRef = useRef<(WordSelection & { stem: string }) | null>(null)
  /** Guards against a slow lookup landing after the reader moved on. */
  const tokenRef = useRef(0)

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
    if (pendingRef.current?.stem === word.stem) setVocabulary(word.status)
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
        const word = await (await getDict()).recordLookup({
          wordId: newId(),
          lookupId: newId(),
          word: normaliseWord(pending.text),
          stem: pending.stem,
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
      // Provisional until the dictionary answers, so the word is filed
      // correctly even if the popover is dismissed before the lookup lands.
      pendingRef.current = { ...selection, stem: resolveStem(selection.text) }
      setDefinition({ status: 'loading' })
      setVocabulary(savedRef.current.get(pendingRef.current.stem)?.status ?? 'none')
      intent.open(() => void record())

      void (async () => {
        try {
          const dict = await getDict()
          const [found, status] = await Promise.all([dict.lookup(candidates), dict.status()])
          if (token !== tokenRef.current) return

          const stem = resolveStem(selection.text, found.known)
          pendingRef.current = { ...selection, stem }
          setVocabulary(savedRef.current.get(stem)?.status ?? 'none')
          setDefinition(
            found.entry
              ? { status: 'found', word: found.entry.word, definition: found.entry.definition }
              : status.ready
                ? { status: 'missing', word }
                : { status: 'unavailable' },
          )
        } catch {
          if (token !== tokenRef.current) return
          setDefinition({ status: 'unavailable' })
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
      const existing = savedRef.current.get(pending.stem)

      if (next === 'none') {
        if (!existing) return
        savedRef.current.delete(pending.stem)
        setVocabulary('none')
        // Nothing left to record — and the write is re-armed, so pressing save
        // again on the same popover puts the word back rather than reporting a
        // row that is no longer there.
        intent.close()
        recordedRef.current = null
        void (async () => {
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
        const word = (await record()) ?? savedRef.current.get(pending.stem)
        if (!word) return
        savedRef.current.set(pending.stem, { ...word, status: next })
        try {
          await (await getDict()).setWordStatus(word.id, next)
        } catch {
          // Non-fatal.
        }
      })()
    },
    [intent, record],
  )

  return { definition, vocabulary, begin, end, act, setStatus }
}
