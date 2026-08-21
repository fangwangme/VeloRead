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

export interface PacerChunk {
  id: number
  text: string
  /** Number of words or grapheme characters that drive this chunk's dwell. */
  wordCount: number
  unitKind: PacerUnitKind
  rect: {
    left: number
    top: number
    width: number
    height: number
  }
  rects: {
    left: number
    top: number
    width: number
    height: number
  }[]
  dwellMs: number
  animMs: number
  range?: Range
}

export interface ChunkerOptions {
  latinWpm: number
  cjkCpm: number
  latinChunkSize?: number // default 3 words
  cjkChunkSize?: number // default 4 grapheme characters
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
 * Group measured tokens into line-aware fixation chunks without changing the
 * book DOM. Latin and CJK chunks share geometry/state machinery but use their
 * own rate and chunk-size profile.
 */
export function groupWordsIntoChunks(words: WordItem[], options: ChunkerOptions): PacerChunk[] {
  if (words.length === 0) return []

  const {
    latinWpm,
    cjkCpm,
    latinChunkSize = 3,
    cjkChunkSize = 4,
  } = options
  const safeLatinWpm = clampRate(latinWpm)
  const safeCjkCpm = clampRate(cjkCpm)

  const chunks: PacerChunk[] = []
  let currentGroup: WordItem[] = []
  let currentKind: PacerUnitKind | null = null
  let currentLineTop: number | null = null
  let currentUnitCount = 0
  let canBreakAfter = false
  let breakBeforeNextUnit = false
  let pendingPunctuation: WordItem[] = []

  function flushGroup() {
    if (currentGroup.length === 0 || !currentKind || currentUnitCount === 0) {
      currentGroup = []
      currentKind = null
      currentLineTop = null
      currentUnitCount = 0
      canBreakAfter = false
      breakBeforeNextUnit = false
      return
    }

    let left = Infinity
    let top = Infinity
    let right = -Infinity
    let bottom = -Infinity

    const rects = currentGroup.map((word) => {
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

    const rate = currentKind === 'cjk' ? safeCjkCpm : safeLatinWpm
    const pause = currentGroup.reduce(
      (total, word) => total + (word.kind === 'punctuation' ? punctuationPauseMs(word.text) : 0),
      0,
    )
    const rawDwell = (currentUnitCount / rate) * 60_000 + pause
    const dwellMs = Math.max(100, Math.round(rawDwell))
    const animMs = Math.min(Math.round(dwellMs * 0.5), 180)

    chunks.push({
      id: chunks.length,
      text: joinChunkText(currentGroup),
      wordCount: currentUnitCount,
      unitKind: currentKind,
      rect: {
        left,
        top,
        width: Math.max(0, right - left),
        height: Math.max(0, bottom - top),
      },
      rects,
      dwellMs,
      animMs,
      range: spanLexicalRanges(currentGroup),
    })

    currentGroup = []
    currentKind = null
    currentLineTop = null
    currentUnitCount = 0
    canBreakAfter = false
    breakBeforeNextUnit = false
  }

  for (const item of words) {
    const groupAnchor = currentGroup[0] ?? pendingPunctuation[0]
    const anchorTop = currentLineTop ?? groupAnchor?.rect.top ?? null
    const isNewLine =
      anchorTop !== null &&
      Math.abs(item.rect.top - anchorTop) > Math.max(8, item.rect.height * 0.5)

    if (isNewLine) {
      flushGroup()
      pendingPunctuation = []
    }

    if (item.kind === 'punctuation') {
      if (currentGroup.length === 0) {
        pendingPunctuation.push(item)
      } else {
        currentGroup.push(item)
        if (isStrongPunctuation(item.text)) breakBeforeNextUnit = true
      }
      continue
    }

    const itemKind: PacerUnitKind = item.kind
    const limit = itemKind === 'cjk' ? cjkChunkSize : latinChunkSize
    const hardLimit = itemKind === 'cjk' ? limit + 2 : limit

    if (breakBeforeNextUnit) flushGroup()
    if (currentKind && currentKind !== itemKind) flushGroup()
    if (currentUnitCount >= limit && (canBreakAfter || currentUnitCount >= hardLimit)) flushGroup()

    if (currentGroup.length === 0) {
      currentGroup.push(...pendingPunctuation)
      pendingPunctuation = []
      currentKind = itemKind
      currentLineTop = item.rect.top
    }

    currentGroup.push(item)
    currentUnitCount += 1
    canBreakAfter = item.wordBoundaryAfter ?? true
  }

  flushGroup()
  return chunks
}

function clampRate(rate: number): number {
  return Math.max(50, Math.min(1500, rate))
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
