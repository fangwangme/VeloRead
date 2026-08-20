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
 * Collection order, shared so both storage targets agree.
 *
 * Plain code-point order rather than `localeCompare`: SQLite's `ORDER BY name`
 * is code-point ordering and teaching it pinyin collation is not worth a
 * shelf list, but the two targets returning different orders for the same data
 * is a real inconsistency. `id` breaks ties so the order is total.
 */
export function compareCollections(
  a: { name: string; id: string },
  b: { name: string; id: string },
): number {
  if (a.name !== b.name) return a.name < b.name ? -1 : 1
  if (a.id === b.id) return 0
  return a.id < b.id ? -1 : 1
}
