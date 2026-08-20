export type TextTokenKind = 'latin' | 'cjk' | 'punctuation'

export interface TextTokenSpan {
  text: string
  start: number
  end: number
  kind: TextTokenKind
  /** True when this token ends a linguistic word returned by Intl.Segmenter. */
  wordBoundaryAfter: boolean
}

const CJK_SCRIPT = /(?:\p{Script=Han}|\p{Script=Hiragana}|\p{Script=Katakana}|\p{Script=Hangul})/u
// Japanese prolonged sound marks are Script=Common, but are lexical reading
// units in both full-width and half-width Katakana words.
const JAPANESE_PROLONGED_SOUND_MARK = /[ーｰ]/u
const PUNCTUATION_OR_SYMBOL = /[\p{Punctuation}\p{Symbol}]/u

const wordSegmenter = new Intl.Segmenter(undefined, { granularity: 'word' })
const graphemeSegmenter = new Intl.Segmenter(undefined, { granularity: 'grapheme' })

export function isCjkGrapheme(grapheme: string): boolean {
  return CJK_SCRIPT.test(grapheme) || JAPANESE_PROLONGED_SOUND_MARK.test(grapheme)
}

export function isPunctuationOrSymbol(grapheme: string): boolean {
  return PUNCTUATION_OR_SYMBOL.test(grapheme)
}

/**
 * Split one DOM text node into Unicode-safe pacing tokens.
 *
 * Latin text keeps Intl.Segmenter's word units. CJK word segments are expanded
 * into grapheme characters for CPM timing, while retaining their final word
 * boundary so the chunker can avoid splitting a word when practical.
 */
export function tokenizeText(text: string): TextTokenSpan[] {
  const tokens: TextTokenSpan[] = []

  for (const word of wordSegmenter.segment(text)) {
    const segment = word.segment
    if (!segment || /^\s+$/u.test(segment)) continue

    const start = word.index
    const graphemes = [...graphemeSegmenter.segment(segment)]
    const containsCjk = graphemes.some((item) => isCjkGrapheme(item.segment))

    if (word.isWordLike && !containsCjk) {
      tokens.push({
        text: segment,
        start,
        end: start + segment.length,
        kind: 'latin',
        wordBoundaryAfter: true,
      })
      continue
    }

    for (let index = 0; index < graphemes.length; index++) {
      const grapheme = graphemes[index]
      const graphemeStart = start + grapheme.index
      const value = grapheme.segment
      const kind: TextTokenKind = isCjkGrapheme(value)
        ? 'cjk'
        : isPunctuationOrSymbol(value) || !word.isWordLike
          ? 'punctuation'
          : 'latin'

      tokens.push({
        text: value,
        start: graphemeStart,
        end: graphemeStart + value.length,
        kind,
        wordBoundaryAfter: index === graphemes.length - 1,
      })
    }
  }

  return tokens
}

export function isStrongPunctuation(value: string): boolean {
  return /[.!?。！？…]/u.test(value)
}

export function punctuationPauseMs(value: string): number {
  if (isStrongPunctuation(value)) return 120
  return /[,;:，；：、]/u.test(value) ? 60 : 0
}
