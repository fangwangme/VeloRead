import type { ReadingUnitCounts } from './pacer/chunker'
import type { LearnedReadingRate } from '../stats/readingRate'

/**
 * "How long until I finish this chapter / this book."
 *
 * There is no word count to look up: an EPUB carries no such number, and
 * counting one would mean paginating the whole spine before the first page
 * appears. So the page in front of you is the ruler. We know how long it takes
 * to read — its words, at your measured rate — and epub.js's location index
 * tells us how much text is left. Both answers are that one page, scaled.
 */

export interface RemainingEstimate {
  /** Minutes to the end of the current chapter, or null when not measurable. */
  chapterMinutes: number | null
  /** Minutes to the end of the book, or null when not measurable. */
  bookMinutes: number | null
}

export interface EstimateInput {
  /** Units on the page currently displayed. */
  pageUnits: ReadingUnitCounts
  /** Characters of body text on that page — the bridge from page to book. */
  pageCharacters: number
  /** Pages left in this chapter, from epub.js's `displayed` counter. */
  pagesLeftInChapter: number | null
  /** Characters left in the book, from epub.js's location index. */
  charactersLeftInBook: number | null
  rate: LearnedReadingRate
}

/** Below this the page is a cover, a plate, or simply not measured yet. */
const MIN_UNITS_PER_PAGE = 20

export function estimateTimeLeft({
  pageUnits,
  pageCharacters,
  pagesLeftInChapter,
  charactersLeftInBook,
  rate,
}: EstimateInput): RemainingEstimate {
  const unitsPerPage = pageUnits.latinWords + pageUnits.cjkCharacters
  if (unitsPerPage < MIN_UNITS_PER_PAGE || pageCharacters <= 0) {
    return { chapterMinutes: null, bookMinutes: null }
  }

  // Each script is paced at its own rate, then added: a mixed page costs what
  // its English costs plus what its Chinese costs.
  const minutesPerPage =
    pageUnits.latinWords / Math.max(1, rate.latinWpm) +
    pageUnits.cjkCharacters / Math.max(1, rate.cjkCpm)

  const chapterMinutes =
    pagesLeftInChapter === null || pagesLeftInChapter < 0
      ? null
      : atLeastAMinute(pagesLeftInChapter * minutesPerPage)

  let bookMinutes: number | null = null
  if (charactersLeftInBook !== null && charactersLeftInBook >= 0) {
    // How many more pages like this one are left, by character count.
    const pagesLeftInBook = charactersLeftInBook / pageCharacters
    bookMinutes = atLeastAMinute(pagesLeftInBook * minutesPerPage)
    // The location index is coarse — one location spans about a thousand
    // characters — so near a chapter's end it can round to less text than the
    // chapter itself has left. Showing a book shorter than its current chapter
    // reads as broken, whatever the arithmetic says.
    if (chapterMinutes !== null) bookMinutes = Math.max(bookMinutes, chapterMinutes)
  }

  return { chapterMinutes, bookMinutes }
}

function atLeastAMinute(minutes: number): number {
  return Math.max(1, Math.round(minutes))
}
