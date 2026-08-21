import { describe, expect, it } from 'vitest'
import { learnReadingRate } from './readingRate'

const FALLBACK = { latinWpm: 250, cjkCpm: 300 }

describe('learnReadingRate', () => {
  it('falls back until there is enough history', () => {
    expect(learnReadingRate(null, FALLBACK)).toEqual({ ...FALLBACK, learned: false })
    expect(
      learnReadingRate(
        { totalDurationMinutes: 4, totalLatinWordsRead: 9_000, totalCjkCharactersRead: 0 },
        FALLBACK,
      ),
    ).toEqual({ ...FALLBACK, learned: false })
  })

  it('reports the sustained rate once the history is long enough', () => {
    const rate = learnReadingRate(
      { totalDurationMinutes: 100, totalLatinWordsRead: 21_000, totalCjkCharactersRead: 0 },
      FALLBACK,
    )
    expect(rate).toEqual({ latinWpm: 210, cjkCpm: 300, learned: true })
  })

  it('judges each script on its own history', () => {
    // Plenty of English, a single Chinese page: the CJK rate stays the default
    // rather than being derived from almost nothing.
    const rate = learnReadingRate(
      { totalDurationMinutes: 200, totalLatinWordsRead: 44_000, totalCjkCharactersRead: 300 },
      FALLBACK,
    )
    expect(rate.latinWpm).toBe(220)
    expect(rate.cjkCpm).toBe(300)
    expect(rate.learned).toBe(true)
  })

  it('rejects rates no human produces', () => {
    // Long-idle sessions and mis-credited pages both show up as absurd rates.
    const tooFast = learnReadingRate(
      { totalDurationMinutes: 10, totalLatinWordsRead: 500_000, totalCjkCharactersRead: 0 },
      FALLBACK,
    )
    expect(tooFast.latinWpm).toBe(250)
    expect(tooFast.learned).toBe(false)
  })
})
