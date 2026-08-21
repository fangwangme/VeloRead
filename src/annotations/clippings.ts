import { EpubCFI } from 'epubjs'
import type { Annotation, BookRecord } from '../platform/types'
import { compareCodePoints } from '../platform/sort'

/**
 * Export highlights in the shape of Kindle's `My Clippings.txt`.
 *
 * Aligning with that format is the point of the feature, not a nod to it: it is
 * what the reading-notes tools out there already parse, and it is the format the
 * user's own Kindle history is already in. See docs/specs/annotations.md.
 *
 * One record is five lines, separated by `==========`:
 *
 *   <title> (<author>)
 *   - Your Highlight | location <n> | Added on <weekday>, <date> <time>
 *   <blank>
 *   <text>
 *   ==========
 */

const SEPARATOR = '=========='

/**
 * Kindle writes the metadata line in the firmware's language. We always write
 * English: nearly every parser in the wild was written against the English
 * form, and an export nobody can parse defeats the purpose.
 */
const EXPORT_LOCALE = 'en-GB'

export interface ClippingsBook {
  book: BookRecord
  annotations: Annotation[]
}

/** Reading order, rather than the order the highlights happened to be made in. */
export function sortByPosition(annotations: Annotation[]): Annotation[] {
  const cfi = new EpubCFI()
  return [...annotations].sort((a, b) => {
    try {
      const byPosition = cfi.compare(a.cfiRange, b.cfiRange)
      if (byPosition !== 0) return byPosition
    } catch {
      // An imported row may carry no usable CFI. Fall through to time, which is
      // the only other order it has.
    }
    return a.createdAt.localeCompare(b.createdAt)
  })
}

/** Shelf-independent, so the same library always exports the same document. */
export function sortBooks(entries: ClippingsBook[]): ClippingsBook[] {
  return [...entries].sort((a, b) => {
    const byTitle = compareCodePoints(a.book.title, b.book.title)
    if (byTitle !== 0) return byTitle
    return compareCodePoints(a.book.id, b.book.id)
  })
}

/**
 * `Saturday, 26 March 2016 14:59:39`, in the reader's own timezone — the point
 * of the timestamp is when *you* highlighted it.
 */
export function formatTimestamp(iso: string): string {
  const date = new Date(iso)
  if (Number.isNaN(date.getTime())) return iso
  const parts = new Intl.DateTimeFormat(EXPORT_LOCALE, {
    weekday: 'long',
    day: 'numeric',
    month: 'long',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false,
  }).formatToParts(date)
  const get = (type: Intl.DateTimeFormatPartTypes) =>
    parts.find((part) => part.type === type)?.value ?? ''
  return [
    `${get('weekday')},`,
    get('day'),
    get('month'),
    get('year'),
    `${get('hour')}:${get('minute')}:${get('second')}`,
  ].join(' ')
}

function header(book: BookRecord): string {
  return book.author ? `${book.title} (${book.author})` : book.title
}

/**
 * A record's metadata line.
 *
 * `location` is a **1-based ordinal in reading order**, not a Kindle location:
 * an EPUB has no such coordinate, and inventing a number that looks like
 * Kindle's would be worse than an honest counter. `page` is omitted rather than
 * faked — a page number here depends on the window size and the type scale, so
 * there is no value that would still mean anything tomorrow. Real Kindle files
 * omit `page` as well, so parsers already cope with its absence.
 */
function metadata(kind: 'Highlight' | 'Note', ordinal: number, createdAt: string): string {
  return `- Your ${kind} | location ${ordinal} | Added on ${formatTimestamp(createdAt)}`
}

function record(
  book: BookRecord,
  kind: 'Highlight' | 'Note',
  ordinal: number,
  at: string,
  body: string,
): string {
  return [header(book), metadata(kind, ordinal, at), '', body, SEPARATOR, ''].join('\n')
}

/**
 * One book's highlights as clippings text.
 *
 * A highlight carrying a note becomes two records — Highlight then Note — which
 * is how Kindle stores the same thing, and why the note lives on the highlight
 * row here rather than behind a `kind` column.
 */
export function formatBookClippings({ book, annotations }: ClippingsBook): string {
  return sortByPosition(annotations)
    .flatMap((annotation, index) => {
      const ordinal = index + 1
      const out = [record(book, 'Highlight', ordinal, annotation.createdAt, annotation.text)]
      const note = annotation.note.trim()
      if (note) out.push(record(book, 'Note', ordinal, annotation.updatedAt, note))
      return out
    })
    .join('')
}

/** Every book in one document, each book's highlights kept together. */
export function formatAllClippings(entries: ClippingsBook[]): string {
  return sortBooks(entries.filter((entry) => entry.annotations.length > 0))
    .map(formatBookClippings)
    .join('')
}

/**
 * A filename that survives a filesystem: no separators, no leading dot, not
 * unboundedly long, and never empty.
 */
export function clippingsFileName(title: string): string {
  const cleaned = title
    .replace(/[/\\:*?"<>|]/gu, ' ')
    .replace(/\s+/gu, ' ')
    .trim()
    .replace(/^\.+/u, '')
    .slice(0, 80)
    .trim()
  return `${cleaned || 'Untitled'}.txt`
}
