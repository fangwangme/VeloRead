import { useEffect, useState } from 'react'
import { getStorage } from '../platform'
import type { BookRecord } from '../platform/types'

/**
 * Cover art for a shelf tile, loaded lazily from storage and served as an
 * object URL so the bytes never round-trip through a base64 data URL.
 */
export function BookCover({ book }: { book: BookRecord }) {
  const url = useCoverUrl(book)

  if (!url) {
    return (
      <div className="flex h-full w-full flex-col justify-end gap-1 bg-neutral-200 p-3 dark:bg-neutral-800">
        <span className="line-clamp-4 text-sm font-medium text-neutral-700 dark:text-neutral-200">
          {book.title}
        </span>
        {book.author && (
          <span className="line-clamp-1 text-xs text-neutral-500">{book.author}</span>
        )}
      </div>
    )
  }

  return <img src={url} alt="" className="h-full w-full object-cover" />
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
