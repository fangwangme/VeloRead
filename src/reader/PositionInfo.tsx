import { useT } from '../i18n/useT'

interface PositionInfoProps {
  chapterTitle?: string | null
  pagesLeftInChapter?: number | null
  percentage: number | null
}

export function PositionInfo({ chapterTitle, pagesLeftInChapter, percentage }: PositionInfoProps) {
  const t = useT()
  const parts: string[] = []

  if (chapterTitle && chapterTitle.trim()) {
    parts.push(chapterTitle.trim())
  }

  if (pagesLeftInChapter !== null && pagesLeftInChapter !== undefined && pagesLeftInChapter >= 0) {
    parts.push(t.plural('position.pagesLeft', pagesLeftInChapter))
  }

  if (percentage !== null) {
    parts.push(t('position.wholeBook', { percent: Math.round(percentage * 100) }))
  }

  if (parts.length === 0) {
    return (
      <span className="text-[11px] font-normal text-neutral-400">{t('position.locating')}</span>
    )
  }

  return (
    <div className="flex items-center gap-2 text-[11px] font-medium opacity-70 tracking-wide">
      {parts.map((part, index) => (
        <span key={index} className="flex items-center gap-2">
          {index > 0 && <span className="opacity-30">·</span>}
          <span>{part}</span>
        </span>
      ))}
    </div>
  )
}
