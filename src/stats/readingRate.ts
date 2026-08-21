import type { OverallReadingStats } from '../platform/types'

/**
 * How fast you actually read, learned from recorded sessions.
 *
 * Not the Pacer's speed: that is the speed you asked to be pushed at. This is
 * the speed the statistics say you sustained, across every book, and it is what
 * a "time left" estimate has to be built on — an estimate derived from the
 * setting would just restate the setting.
 */
export interface LearnedReadingRate {
  /** Latin words per minute. */
  latinWpm: number
  /** CJK graphemes per minute. */
  cjkCpm: number
  /**
   * False while there is too little history to say anything, in which case the
   * rates above are the caller's fallback, unchanged. An estimate presented as
   * measured when it is really the default setting is worse than no estimate.
   */
  learned: boolean
}

/**
 * Minimum history before a rate is trusted. A single short session is mostly
 * page-turn latency and settling-in, and extrapolating a whole book from it
 * produces numbers that swing wildly between sessions.
 */
export const MIN_MINUTES_FOR_RATE = 10
export const MIN_LATIN_WORDS_FOR_RATE = 1_000
export const MIN_CJK_CHARACTERS_FOR_RATE = 1_500

/** Rates outside this band are a measurement artefact, not a reader. */
const MIN_PLAUSIBLE_RATE = 40
const MAX_PLAUSIBLE_RATE = 2_000

export function learnReadingRate(
  stats: Pick<
    OverallReadingStats,
    'totalDurationMinutes' | 'totalLatinWordsRead' | 'totalCjkCharactersRead'
  > | null,
  fallback: { latinWpm: number; cjkCpm: number },
): LearnedReadingRate {
  const minutes = stats?.totalDurationMinutes ?? 0
  if (!stats || minutes < MIN_MINUTES_FOR_RATE) {
    return { ...fallback, learned: false }
  }

  // Each script is judged on its own history: someone with a hundred hours of
  // English and one Chinese chapter should keep the learned English rate and
  // the default CJK one.
  const latin = usable(stats.totalLatinWordsRead, minutes, MIN_LATIN_WORDS_FOR_RATE)
  const cjk = usable(stats.totalCjkCharactersRead, minutes, MIN_CJK_CHARACTERS_FOR_RATE)

  return {
    latinWpm: latin ?? fallback.latinWpm,
    cjkCpm: cjk ?? fallback.cjkCpm,
    learned: latin !== null || cjk !== null,
  }
}

function usable(units: number, minutes: number, minimumUnits: number): number | null {
  if (units < minimumUnits) return null
  const rate = units / minutes
  if (rate < MIN_PLAUSIBLE_RATE || rate > MAX_PLAUSIBLE_RATE) return null
  return Math.round(rate)
}
