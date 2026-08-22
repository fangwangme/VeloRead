import { describe, expect, it } from 'vitest'
import { isSingleWord, lookupCandidates, normaliseWord, resolveStem } from './lemma'

/**
 * Stands in for the real dictionary. Only the words a test actually needs are
 * in it, which is enough: `resolveStem` asks nothing else of it.
 */
const DICTIONARY = [
  'run',
  'running',
  'walk',
  'move',
  'use',
  'us',
  'stop',
  'hope',
  'city',
  'knife',
  'happy',
  'man',
  'be',
  'go',
  'study',
  'carry',
  'anopheles',
]

const stem = (word: string) =>
  resolveStem(
    word,
    lookupCandidates(word).filter((form) => DICTIONARY.includes(form)),
  )

describe('normaliseWord', () => {
  it('strips the punctuation a selection drags along', () => {
    expect(normaliseWord('  Running,  ')).toBe('running')
    expect(normaliseWord('“word”')).toBe('word')
    expect(normaliseWord('(run)')).toBe('run')
    expect(normaliseWord('don’t')).toBe("don't")
  })

  it('leaves an internal apostrophe alone', () => {
    expect(normaliseWord("Ada's")).toBe("ada's")
  })
})

describe('isSingleWord', () => {
  it('is what decides whether there is anything to define', () => {
    expect(isSingleWord('running')).toBe(true)
    expect(isSingleWord('He kept running.')).toBe(false)
    expect(isSingleWord('  ')).toBe(false)
    expect(isSingleWord('42')).toBe(false)
    // A hyphenated word is still one word; the dictionary may or may not have it.
    expect(isSingleWord('well-known')).toBe(true)
  })
})

describe('lookupCandidates', () => {
  it('asks about the word as selected before any reduction', () => {
    expect(lookupCandidates('Running')[0]).toBe('running')
    expect(lookupCandidates('runs')[0]).toBe('runs')
  })

  it('offers the reductions a suffix could have come from', () => {
    expect(lookupCandidates('running')).toContain('run')
    expect(lookupCandidates('cities')).toContain('city')
    expect(lookupCandidates('knives')).toContain('knife')
    expect(lookupCandidates('studied')).toContain('study')
    expect(lookupCandidates('happiest')).toContain('happy')
    expect(lookupCandidates('happily')).toContain('happy')
  })

  it('has nothing to ask about an empty selection', () => {
    expect(lookupCandidates('   ')).toEqual([])
  })
})

describe('resolveStem', () => {
  /** The acceptance case from docs/specs/vocabulary.md §9. */
  it('files running, ran and runs under run', () => {
    expect(stem('running')).toBe('run')
    expect(stem('ran')).toBe('run')
    expect(stem('runs')).toBe('run')
  })

  it('does not file a word under itself just because it has its own entry', () => {
    // `running` is a headword — the reader reads that entry — but the row it
    // belongs to is still `run`, or the list would hold `run` twice.
    expect(DICTIONARY).toContain('running')
    expect(stem('running')).toBe('run')
  })

  it('undoes the spelling changes that go with a suffix', () => {
    expect(stem('stopped')).toBe('stop')
    expect(stem('stopping')).toBe('stop')
    expect(stem('moving')).toBe('move')
    expect(stem('hoped')).toBe('hope')
    expect(stem('used')).toBe('use')
    expect(stem('walking')).toBe('walk')
    expect(stem('walked')).toBe('walk')
  })

  it('handles the plurals and comparatives rules reach', () => {
    expect(stem('cities')).toBe('city')
    expect(stem('knives')).toBe('knife')
    expect(stem('studies')).toBe('study')
    expect(stem('carried')).toBe('carry')
    expect(stem('happiest')).toBe('happy')
    expect(stem('happily')).toBe('happy')
  })

  it('handles the irregulars no rule can reach', () => {
    expect(stem('men')).toBe('man')
    expect(stem('were')).toBe('be')
    expect(stem('went')).toBe('go')
  })

  it('falls back to the first reduction when there is no dictionary', () => {
    // The browser build has none. It still has to file words somewhere, and
    // getting the common shapes right is what keeps that list usable.
    expect(resolveStem('runs')).toBe('run')
    expect(resolveStem('ran')).toBe('run')
    expect(resolveStem('running')).toBe('run')
    expect(resolveStem('cities')).toBe('city')
    expect(resolveStem('stopped')).toBe('stop')
  })

  it('leaves a word whose reductions the dictionary has never heard of', () => {
    expect(stem('obviation')).toBe('obviation')
    // `anophele` is a form the rules invent; only the dictionary can say that
    // `anopheles` is already the headword.
    expect(lookupCandidates('anopheles')).toContain('anophele')
    expect(stem('anopheles')).toBe('anopheles')
    // Without a dictionary that is exactly what the browser build cannot know.
    expect(resolveStem('anopheles')).toBe('anophele')
  })
})
