/**
 * Ids for rows the frontend creates.
 *
 * `crypto.randomUUID` is only defined in a secure context, and a book id ends
 * up in a filename on the Tauri side, so a failure here would break importing
 * entirely — reaching the dev server over a LAN address is enough to lose it.
 * `getRandomValues` has no such restriction; both shapes satisfy the
 * `[A-Za-z0-9-]` check that Rust applies before touching the filesystem.
 */
export function newId(): string {
  if (typeof crypto.randomUUID === 'function') return crypto.randomUUID()
  const bytes = crypto.getRandomValues(new Uint8Array(16))
  return Array.from(bytes, (byte) => byte.toString(16).padStart(2, '0')).join('')
}
