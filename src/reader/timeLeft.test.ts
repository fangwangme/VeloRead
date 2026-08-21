import { describe, expect, it } from 'vitest'
import { estimateTimeLeft } from './timeLeft'

const RATE = { latinWpm: 200, cjkCpm: 300, learned: true }
// A page of 200 English words is exactly one minute at 200 wpm.
const PAGE = { pageUnits: { latinWords: 200, cjkCharacters: 0 }, pageCharacters: 1_000 }

describe('estimateTimeLeft', () => {
  it('scales the current page by the pages left in the chapter', () => {
    const { chapterMinutes } = estimateTimeLeft({
      ...PAGE,
      pagesLeftInChapter: 10,
      charactersLeftInBook: null,
      rate: RATE,
    })
    expect(chapterMinutes).toBe(10)
  })

  it('scales the current page by the characters left in the book', () => {
    const { bookMinutes } = estimateTimeLeft({
      ...PAGE,
      pagesLeftInChapter: 0,
      charactersLeftInBook: 60_000, // 60 pages' worth at 1000 chars a page
      rate: RATE,
    })
    expect(bookMinutes).toBe(60)
  })

  it('prices each script at its own rate on a mixed page', () => {
    // 100 English words at 200 wpm is half a minute; 300 CJK characters at
    // 300 cpm is one minute. One page therefore costs 1.5 minutes.
    const { chapterMinutes } = estimateTimeLeft({
      pageUnits: { latinWords: 100, cjkCharacters: 300 },
      pageCharacters: 1_000,
      pagesLeftInChapter: 4,
      charactersLeftInBook: null,
      rate: RATE,
    })
    expect(chapterMinutes).toBe(6)
  })

  it('never says the book is shorter than the chapter left in it', () => {
    const { chapterMinutes, bookMinutes } = estimateTimeLeft({
      ...PAGE,
      pagesLeftInChapter: 20,
      charactersLeftInBook: 1_000, // the coarse index rounded down to one page
      rate: RATE,
    })
    expect(chapterMinutes).toBe(20)
    expect(bookMinutes).toBe(20)
  })

  it('withholds an estimate on a page it cannot measure', () => {
    expect(
      estimateTimeLeft({
        pageUnits: { latinWords: 3, cjkCharacters: 0 },
        pageCharacters: 20,
        pagesLeftInChapter: 10,
        charactersLeftInBook: 50_000,
        rate: RATE,
      }),
    ).toEqual({ chapterMinutes: null, bookMinutes: null })
  })

  it('rounds up rather than promising zero minutes', () => {
    const { chapterMinutes } = estimateTimeLeft({
      ...PAGE,
      pagesLeftInChapter: 0,
      charactersLeftInBook: null,
      rate: RATE,
    })
    expect(chapterMinutes).toBe(1)
  })
})
