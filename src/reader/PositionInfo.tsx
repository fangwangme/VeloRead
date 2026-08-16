interface PositionInfoProps {
  chapterTitle?: string | null
  pagesLeftInChapter?: number | null
  percentage: number | null
}

export function PositionInfo({ chapterTitle, pagesLeftInChapter, percentage }: PositionInfoProps) {
  const parts: string[] = []

  if (chapterTitle && chapterTitle.trim()) {
    parts.push(chapterTitle.trim())
  }

  if (pagesLeftInChapter !== null && pagesLeftInChapter !== undefined && pagesLeftInChapter >= 0) {
    parts.push(`本章还剩 ${pagesLeftInChapter} 页`)
  }

  if (percentage !== null) {
    parts.push(`全书 ${Math.round(percentage * 100)}%`)
  }

  if (parts.length === 0) {
    return <span className="text-xs text-neutral-400">正在定位...</span>
  }

  return (
    <div className="flex items-center gap-2 text-xs text-neutral-500 dark:text-neutral-400">
      {parts.map((part, index) => (
        <span key={index} className="flex items-center gap-2">
          {index > 0 && <span className="opacity-40">·</span>}
          <span>{part}</span>
        </span>
      ))}
    </div>
  )
}
