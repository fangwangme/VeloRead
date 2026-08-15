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
