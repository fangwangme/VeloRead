import {
  isCjkGrapheme,
  isStrongPunctuation,
  punctuationPauseMs,
  type TextTokenKind,
} from './tokenizer'

export type PacerUnitKind = 'latin' | 'cjk'

export interface WordItem {
  text: string
  rect: {
    left: number
    top: number
    width: number
    height: number
    bottom: number
    right: number
  }
  kind: TextTokenKind
  wordBoundaryAfter?: boolean
  range?: Range
}

export interface ReadingUnitCounts {
  latinWords: number
  cjkCharacters: number
}

interface ChunkRect {
  left: number
  top: number
  width: number
  height: number
}

export interface PacerChunk {
  id: number
  text: string
  /**
   * Reading units in this chunk, counted per script.
   *
   * Two counters rather than one count plus a kind: a whole-line cursor lands on
   * mixed Chinese/English lines routinely, and those two halves have to be timed
   * by their own rates.
   */
  units: ReadingUnitCounts
  rect: ChunkRect
  rects: ChunkRect[]
  /**
   * The whole line this chunk sits on, within its own column.
   *
   * Carried on every chunk because the `chunk-in-line` cursor draws it, and the
   * chunker is the one place that already knows where the lines are.
   */
  lineRect: ChunkRect
  dwellMs: number
  animMs: number
  range?: Range
}

export interface ChunkerOptions {
  latinWpm: number
  cjkCpm: number
  latinChunkSize?: number // default 3 words
  cjkChunkSize?: number // default 4 grapheme characters
  /**
   * Distance between the left edges of two adjacent columns, in book-page
   * coordinates. Paginated epub.js is a CSS multi-column layout, so the Nth line
   * of the left column and the Nth line of the right one share a `top`: without
   * this, one chunk can span both and the highlight stretches across the page.
   *
   * Omitted (scrolled flow, or the metrics could not be read) means fall back to
   * comparing `top` alone. Losing column awareness must never mean losing chunks.
   */
  columnPitch?: number | null
  /**
   * Whole-line cursor: one line is one chunk. Line and column awareness still
   * apply; only the within-line splitting is switched off.
   */
  wholeLine?: boolean
}

/** Kept as a compatibility name for existing callers and tests. */
export const isCjkChar = isCjkGrapheme

export function countReadingUnits(words: WordItem[]): ReadingUnitCounts {
  let latinWords = 0
  let cjkCharacters = 0
  for (const word of words) {
    if (word.kind === 'latin') latinWords += 1
    if (word.kind === 'cjk') cjkCharacters += 1
  }
  return { latinWords, cjkCharacters }
}

/**
 * Characters of body text in a measured page, punctuation included.
 *
 * Separate from `countReadingUnits` because that shape is what the statistics
 * persist; this is the bridge the time estimate needs between one page and
 * epub.js's character-based location index.
 */
export function countCharacters(words: WordItem[]): number {
  let characters = 0
  for (const word of words) characters += word.text.length
  return characters
}

export function dominantPacerUnit(
  words: WordItem[],
  fallback: PacerUnitKind = 'latin',
): PacerUnitKind {
  const counts = countReadingUnits(words)
  if (counts.latinWords === counts.cjkCharacters) return fallback
  return counts.cjkCharacters > counts.latinWords ? 'cjk' : 'latin'
}

/**
 * Which column of the page a measured word sits in.
 *
 * The midpoint rather than the left edge, so a word that starts a hair before a
 * column boundary is still attributed to the column it is actually printed in.
 * Without a pitch every word is in column 0, which is exactly the old behaviour.
 */
export function columnIndexOf(rect: { left: number; width: number }, columnPitch?: number | null): number {
  if (!columnPitch || !Number.isFinite(columnPitch) || columnPitch <= 0) return 0
  return Math.floor((rect.left + rect.width / 2) / columnPitch)
}

/**
 * Split measured tokens into the lines they are printed on.
 *
 * A line is "same `top`, same column". Comparing `top` alone is what let a chunk
 * run from the end of a left-column line into the start of the right-column line
 * beside it, because in a two-column spread those two lines have the same `top`.
 */
export function splitWordsIntoLines(
  words: WordItem[],
  columnPitch?: number | null,
): WordItem[][] {
  const lines: WordItem[][] = []
  let current: WordItem[] = []
  let anchorTop: number | null = null
  let anchorColumn = 0

  for (const item of words) {
    const column = columnIndexOf(item.rect, columnPitch)
    const sameLine =
      anchorTop === null ||
      (column === anchorColumn &&
        Math.abs(item.rect.top - anchorTop) <= Math.max(8, item.rect.height * 0.5))

    if (!sameLine) {
      lines.push(current)
      current = []
      anchorTop = null
    }

    if (current.length === 0) {
      anchorTop = item.rect.top
      anchorColumn = column
    }
    current.push(item)
  }

  if (current.length > 0) lines.push(current)
  return lines
}

/**
 * Group measured tokens into line-aware fixation chunks without changing the
 * book DOM. Latin and CJK reading units share geometry/state machinery but are
 * timed by their own rate, so a mixed chunk is timed by both.
 */
export function groupWordsIntoChunks(words: WordItem[], options: ChunkerOptions): PacerChunk[] {
  if (words.length === 0) return []

  const {
    latinWpm,
    cjkCpm,
    latinChunkSize = 3,
    cjkChunkSize = 4,
    columnPitch,
    wholeLine = false,
  } = options
  const safeLatinWpm = clampRate(latinWpm)
  const safeCjkCpm = clampRate(cjkCpm)

  const chunks: PacerChunk[] = []

  for (const line of splitWordsIntoLines(words, columnPitch)) {
    const lineRect = unionRect(line)
    const groups = wholeLine
      ? [line]
      : splitLineIntoGroups(line, { latinChunkSize, cjkChunkSize })

    for (const group of groups) {
      const chunk = makeChunk(group, {
        id: chunks.length,
        lineRect,
        latinWpm: safeLatinWpm,
        cjkCpm: safeCjkCpm,
      })
      if (chunk) chunks.push(chunk)
    }
  }

  return chunks
}

/**
 * Cut one line into fixation-sized groups.
 *
 * Three reasons to break: the chunk is full, a strong punctuation mark ended a
 * sentence, or the script changed — a chunk-sized cursor reads better one script
 * at a time. Punctuation is carried with the words around it and never counts.
 */
function splitLineIntoGroups(
  line: WordItem[],
  limits: { latinChunkSize: number; cjkChunkSize: number },
): WordItem[][] {
  const groups: WordItem[][] = []
  let group: WordItem[] = []
  let kind: PacerUnitKind | null = null
  let counted = 0
  let canBreakAfter = false
  let breakBeforeNextUnit = false
  let pendingPunctuation: WordItem[] = []

  const flush = () => {
    if (group.length > 0 && counted > 0) groups.push(group)
    group = []
    kind = null
    counted = 0
    canBreakAfter = false
    breakBeforeNextUnit = false
  }

  for (const item of line) {
    if (item.kind === 'punctuation') {
      if (group.length === 0) {
        pendingPunctuation.push(item)
      } else {
        group.push(item)
        if (isStrongPunctuation(item.text)) breakBeforeNextUnit = true
      }
      continue
    }

    const itemKind: PacerUnitKind = item.kind
    const limit = itemKind === 'cjk' ? limits.cjkChunkSize : limits.latinChunkSize
    // CJK may overrun the target slightly rather than split a segmented word.
    const hardLimit = itemKind === 'cjk' ? limit + 2 : limit

    if (breakBeforeNextUnit) flush()
    if (kind && kind !== itemKind) flush()
    if (counted >= limit && (canBreakAfter || counted >= hardLimit)) flush()

    if (group.length === 0) {
      group.push(...pendingPunctuation)
      pendingPunctuation = []
      kind = itemKind
    }

    group.push(item)
    counted += 1
    canBreakAfter = item.wordBoundaryAfter ?? true
  }

  flush()
  return groups
}

/**
 * Turn one group of measured tokens into a chunk, or null when it holds nothing
 * that counts as reading (punctuation alone).
 */
function makeChunk(
  group: WordItem[],
  context: { id: number; lineRect: ChunkRect; latinWpm: number; cjkCpm: number },
): PacerChunk | null {
  const units = countReadingUnits(group)
  if (group.length === 0 || units.latinWords + units.cjkCharacters === 0) return null

  let left = Infinity
  let top = Infinity
  let right = -Infinity
  let bottom = -Infinity

  const rects = group.map((word) => {
    left = Math.min(left, word.rect.left)
    top = Math.min(top, word.rect.top)
    right = Math.max(right, word.rect.right)
    bottom = Math.max(bottom, word.rect.bottom)
    return {
      left: word.rect.left,
      top: word.rect.top,
      width: word.rect.width,
      height: word.rect.height,
    }
  })

  const pause = group.reduce(
    (total, word) => total + (word.kind === 'punctuation' ? punctuationPauseMs(word.text) : 0),
    0,
  )
  const rawDwell =
    (units.latinWords / context.latinWpm) * 60_000 +
    (units.cjkCharacters / context.cjkCpm) * 60_000 +
    pause
  const dwellMs = Math.max(100, Math.round(rawDwell))

  return {
    id: context.id,
    text: joinChunkText(group),
    units,
    rect: {
      left,
      top,
      width: Math.max(0, right - left),
      height: Math.max(0, bottom - top),
    },
    rects,
    lineRect: context.lineRect,
    dwellMs,
    // The animation must never outlast the dwell it is moving within.
    animMs: Math.min(Math.round(dwellMs * 0.5), 180),
    range: spanLexicalRanges(group),
  }
}

function clampRate(rate: number): number {
  return Math.max(50, Math.min(1500, rate))
}

function unionRect(words: WordItem[]): ChunkRect {
  let left = Infinity
  let top = Infinity
  let right = -Infinity
  let bottom = -Infinity
  for (const word of words) {
    left = Math.min(left, word.rect.left)
    top = Math.min(top, word.rect.top)
    right = Math.max(right, word.rect.right)
    bottom = Math.max(bottom, word.rect.bottom)
  }
  if (!Number.isFinite(left)) return { left: 0, top: 0, width: 0, height: 0 }
  return { left, top, width: Math.max(0, right - left), height: Math.max(0, bottom - top) }
}

function joinChunkText(words: WordItem[]): string {
  let text = ''
  let previous: WordItem | undefined
  for (const word of words) {
    const needsSpace = previous?.kind === 'latin' && word.kind === 'latin'
    text += `${needsSpace ? ' ' : ''}${word.text}`
    previous = word
  }
  return text
}

function spanLexicalRanges(words: WordItem[]): Range | undefined {
  const ranges = words
    .filter((word) => word.kind !== 'punctuation' && word.range)
    .map((word) => word.range as Range)
  if (ranges.length === 0) return undefined

  try {
    const span = ranges[0].cloneRange()
    const last = ranges[ranges.length - 1]
    span.setEnd(last.endContainer, last.endOffset)
    return span
  } catch {
    return ranges[0]
  }
}
