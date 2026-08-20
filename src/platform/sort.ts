import type { BookRecord } from './types'

/**
 * Shelf order: most recently read first, never-read books after them, and
 * ties broken by import time. The Tauri implementation encodes the same order
 * in SQL; this is the JS twin used by the web implementation and by tests.
 */
export function compareBooks(a: BookRecord, b: BookRecord): number {
  const byRead = (b.lastReadAt ?? '').localeCompare(a.lastReadAt ?? '')
  if (byRead !== 0) return byRead
  return b.addedAt.localeCompare(a.addedAt)
}

/**
 * Compare two strings by Unicode code point, which is the order SQLite's
 * default BINARY collation produces on UTF-8 text.
 *
 * Not `<` on the strings themselves: that compares UTF-16 code units, so an
 * astral character (a book emoji, U+1F4D8) sorts *before* a high BMP one
 * (U+FF21) even though its code point is far larger. Iterating the string
 * yields whole code points, which restores the UTF-8 ordering.
 */
export function compareCodePoints(a: string, b: string): number {
  if (a === b) return 0
  const left = Array.from(a)
  const right = Array.from(b)
  const shared = Math.min(left.length, right.length)
  for (let index = 0; index < shared; index++) {
    const leftPoint = left[index].codePointAt(0) ?? 0
    const rightPoint = right[index].codePointAt(0) ?? 0
    if (leftPoint !== rightPoint) return leftPoint < rightPoint ? -1 : 1
  }
  return left.length - right.length
}

/**
 * Collection order, shared so both storage targets agree.
 *
 * Code-point order rather than `localeCompare`: SQLite's `ORDER BY name` is
 * code-point ordering and teaching it pinyin collation is not worth a shelf
 * list, but the two targets returning different orders for the same data is a
 * real inconsistency. `id` breaks ties so the order is total.
 */
export function compareCollections(
  a: { name: string; id: string },
  b: { name: string; id: string },
): number {
  const byName = compareCodePoints(a.name, b.name)
  if (byName !== 0) return byName
  return compareCodePoints(a.id, b.id)
}
