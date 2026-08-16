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
  isCjk?: boolean
  range?: Range
}

export interface PacerChunk {
  id: number
  text: string
  wordCount: number
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
  wpm: number
  chunkSize?: number // default 3 for English
  cjkChunkSize?: number // default 8 for CJK
}

const CJK_REGEX = /[\u4e00-\u9fa5\u3040-\u30ff\u3400-\u4dbf\uf900-\ufaff]/

export function isCjkChar(char: string): boolean {
  return CJK_REGEX.test(char)
}

/**
 * Pure function: Groups a list of word/character items into fixation chunks.
 *
 * Rules:
 * - English: chunkSize words per group (default 3, range 1-5).
 * - CJK: cjkChunkSize characters per group (default 8).
 * - Line-aware: chunks NEVER cross lines. If next word starts on a new line, current chunk ends immediately.
 * - Non-empty bounding box calculation.
 * - Dwell time calculation: (wordCount / wpm) * 60,000 ms, min 100ms.
 * - Animation duration: min(dwell * 0.5, 180ms).
 */
export function groupWordsIntoChunks(words: WordItem[], options: ChunkerOptions): PacerChunk[] {
  if (words.length === 0) return []

  const { wpm, chunkSize = 3, cjkChunkSize = 8 } = options
  const safeWpm = Math.max(50, Math.min(1500, wpm))

  const chunks: PacerChunk[] = []
  let currentGroup: WordItem[] = []
  let currentLineTop: number | null = null

  function flushGroup() {
    if (currentGroup.length === 0) return

    const first = currentGroup[0]
    const isCjk = Boolean(first.isCjk)

    let left = Infinity
    let top = Infinity
    let right = -Infinity
    let bottom = -Infinity

    const rects = currentGroup.map((w) => {
      left = Math.min(left, w.rect.left)
      top = Math.min(top, w.rect.top)
      right = Math.max(right, w.rect.right)
      bottom = Math.max(bottom, w.rect.bottom)
      return {
        left: w.rect.left,
        top: w.rect.top,
        width: w.rect.width,
        height: w.rect.height,
      }
    })

    const text = isCjk
      ? currentGroup.map((w) => w.text).join('')
      : currentGroup.map((w) => w.text).join(' ')

    const count = currentGroup.length
    // For CJK count is character count; for Latin count is word count.
    const effectiveUnits = isCjk ? Math.max(1, count / 2.5) : count
    const rawDwell = (effectiveUnits / safeWpm) * 60000
    const dwellMs = Math.max(100, Math.round(rawDwell))
    const animMs = Math.min(Math.round(dwellMs * 0.5), 180)

    chunks.push({
      id: chunks.length,
      text,
      wordCount: count,
      rect: {
        left,
        top,
        width: Math.max(0, right - left),
        height: Math.max(0, bottom - top),
      },
      rects,
      dwellMs,
      animMs,
      range: first.range,
    })

    currentGroup = []
    currentLineTop = null
  }

  for (let i = 0; i < words.length; i++) {
    const item = words[i]
    const itemIsCjk = Boolean(item.isCjk)
    const limit = itemIsCjk ? cjkChunkSize : chunkSize

    // Check if line changed (difference in top > 0.5 * height)
    const isNewLine =
      currentLineTop !== null &&
      Math.abs(item.rect.top - currentLineTop) > Math.max(8, item.rect.height * 0.5)

    // Check if mixing CJK and Western in same group
    const isTypeMismatch =
      currentGroup.length > 0 && Boolean(currentGroup[0].isCjk) !== itemIsCjk

    if (isNewLine || isTypeMismatch || currentGroup.length >= limit) {
      flushGroup()
    }

    if (currentGroup.length === 0) {
      currentLineTop = item.rect.top
    }
    currentGroup.push(item)
  }

  flushGroup()
  return chunks
}
