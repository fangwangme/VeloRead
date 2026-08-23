/**
 * Finding the sentence a selected word sits in.
 *
 * A Kindle records the sentence beside every word you look up, and that is the
 * half of the vocabulary list that is actually worth keeping: a bare word is a
 * flashcard, a word in the sentence you met it in is a memory. See
 * docs/specs/vocabulary.md §4.
 *
 * Split out from the renderer because it is string work, not DOM work: the
 * renderer's job is to hand over the paragraph and where in it the selection
 * started, and this decides where the sentence begins and ends.
 */

/**
 * Terminators that end a sentence, and the closers allowed to follow one.
 *
 * A Latin full stop only counts with whitespace (or the end of the text) after
 * it, which is what keeps `3.5` and `veloread.app` in one piece. CJK
 * terminators need no such guard — nothing follows 。 but the next sentence,
 * and requiring a space would mean never splitting Chinese at all.
 */
const BOUNDARY = /[.!?]["'”’»）)\]]*(?=\s|$)|[。！？…]["'”’»）)\]]*/gu

/**
 * Abbreviations whose full stop does not end a sentence.
 *
 * A short list on purpose. Getting `Mr. Darcy` wrong splits one sentence into
 * two, which costs a little context; trying to be complete here would cost more
 * in false negatives than it saves.
 */
const ABBREVIATIONS = [
  'mr', 'mrs', 'ms', 'dr', 'prof', 'st', 'jr', 'sr', 'vs', 'etc', 'e.g', 'i.e',
  'fig', 'no', 'vol', 'ch', 'pp', 'ed', 'al', 'inc', 'ltd', 'co',
]

/** How much text to keep when nothing looks like a sentence boundary. */
const MAX_SENTENCE_LENGTH = 400

function endsWithAbbreviation(text: string, end: number): boolean {
  const before = text.slice(Math.max(0, end - 12), end).toLowerCase()
  const word = /([\p{L}.]+)\.$/u.exec(before)?.[1]
  return word !== undefined && ABBREVIATIONS.includes(word.replace(/\.$/, ''))
}

/**
 * The sentence around `offset` in `text`, with its whitespace folded.
 *
 * `offset` is a character index into `text` — where the selection started. The
 * result is clamped to `MAX_SENTENCE_LENGTH` around it, so a paragraph with no
 * punctuation at all (a heading, a line of verse, an unlucky OCR) yields a
 * usable fragment rather than the whole page.
 */
export function sentenceAt(text: string, offset: number): string {
  const source = text ?? ''
  if (source.trim().length === 0) return ''
  // Clamped inside the text, not to its length: an offset is where a word
  // begins, so it always has at least one character after it. Landing exactly
  // on the end would put the word after the final boundary, in no sentence.
  const at = Math.max(0, Math.min(offset, source.length - 1))

  let start = 0
  let end = source.length
  BOUNDARY.lastIndex = 0
  for (let match = BOUNDARY.exec(source); match !== null; match = BOUNDARY.exec(source)) {
    const boundary = match.index + match[0].length
    if (endsWithAbbreviation(source, match.index + 1)) continue
    // A boundary at or before the word starts the sentence; the first one after
    // it ends the sentence.
    if (boundary <= at) {
      start = boundary
    } else {
      end = boundary
      break
    }
  }

  if (end - start > MAX_SENTENCE_LENGTH) {
    // No usable punctuation nearby: keep a window around the word instead.
    const half = Math.floor(MAX_SENTENCE_LENGTH / 2)
    start = Math.max(start, at - half)
    end = Math.min(end, at + half)
  }

  return source.slice(start, end).replace(/\s+/gu, ' ').trim()
}
