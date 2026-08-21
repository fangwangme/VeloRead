import type { TocItem } from '../platform/types'

export function resolveActiveTocId(
  items: TocItem[],
  currentTocId: string | null,
  currentHref: string | null,
): string | null {
  const flat = flattenToc(items)
  if (currentTocId && flat.some((item) => item.id === currentTocId)) return currentTocId
  if (!currentHref) return null

  const normalizedCurrent = normalizeHref(currentHref)
  const exact = flat.find((item) => normalizeHref(item.href) === normalizedCurrent)
  if (exact) return exact.id

  const currentDocument = normalizedCurrent.split('#')[0]
  return flat.find((item) => normalizeHref(item.href).split('#')[0] === currentDocument)?.id ?? null
}

function flattenToc(items: TocItem[]): TocItem[] {
  return items.flatMap((item) => [item, ...flattenToc(item.subitems ?? [])])
}

function normalizeHref(href: string): string {
  try {
    return decodeURI(href).replace(/^\.\//, '')
  } catch {
    return href.replace(/^\.\//, '')
  }
}
