import { useEffect, useState } from 'react'
import { getStorage } from '../platform'
import type { BookRecord } from '../platform/types'

/**
 * Cover art for a shelf tile, loaded lazily from storage and served as an
 * object URL so the bytes never round-trip through a base64 data URL.
 */
export function BookCover({ book }: { book: BookRecord }) {
  const url = useCoverUrl(book)

  return (
    <div className="relative h-full w-full overflow-hidden rounded-lg bg-neutral-100 dark:bg-neutral-800">
      {url ? (
        <img src={url} alt="" width="304" height="456" className="h-full w-full object-cover" />
      ) : (
        <div className="flex h-full w-full flex-col justify-end p-3.5 bg-gradient-to-br from-neutral-100 to-neutral-200 dark:from-neutral-800 dark:to-neutral-900">
          <span className="line-clamp-4 text-xs font-semibold leading-snug text-neutral-800 dark:text-neutral-100 font-serif">
            {book.title}
          </span>
          {book.author && (
            <span className="line-clamp-1 mt-1 text-[10px] text-neutral-500 dark:text-neutral-400">
              {book.author}
            </span>
          )}
        </div>
      )}

      {/* Apple Books Hardcover Spine Crease & Sheen Simulation */}
      <div className="pointer-events-none absolute inset-y-0 left-0 w-2.5 bg-gradient-to-r from-black/20 via-white/10 to-transparent" />
      <div className="pointer-events-none absolute inset-0 ring-1 ring-inset ring-black/5 dark:ring-white/10 rounded-lg" />
    </div>
  )
}

function useCoverUrl(book: BookRecord): string | null {
  const [url, setUrl] = useState<string | null>(null)
  const { id, coverMime } = book

  useEffect(() => {
    if (!coverMime) return
    let objectUrl: string | null = null
    let cancelled = false

    void (async () => {
      try {
        const bytes = await (await getStorage()).readCover(id)
        if (cancelled || !bytes) return
        objectUrl = URL.createObjectURL(new Blob([bytes as BlobPart], { type: coverMime }))
        setUrl(objectUrl)
      } catch {
        // A missing cover is not worth surfacing; the text fallback covers it.
      }
    })()

    return () => {
      cancelled = true
      if (objectUrl) URL.revokeObjectURL(objectUrl)
    }
  }, [id, coverMime])

  return url
}
