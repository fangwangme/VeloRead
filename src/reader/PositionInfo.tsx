import { useT } from '../i18n/useT'

interface PositionInfoProps {
  chapterTitle?: string | null
  pagesLeftInChapter?: number | null
  percentage: number | null
  /** Minutes to the end of the chapter, or null when not measurable. */
  chapterMinutesLeft?: number | null
  /** Minutes to the end of the book, or null when not measurable. */
  bookMinutesLeft?: number | null
  /**
   * Whether the estimate rests on recorded reading or on the Pacer setting.
   * Worth saying: one is a measurement, the other is an assumption.
   */
  rateIsLearned?: boolean
}

export function PositionInfo({
  chapterTitle,
  pagesLeftInChapter,
  percentage,
  chapterMinutesLeft = null,
  bookMinutesLeft = null,
  rateIsLearned = false,
}: PositionInfoProps) {
  const t = useT()
  const parts: string[] = []

  if (chapterTitle && chapterTitle.trim()) {
    parts.push(chapterTitle.trim())
  }

  if (pagesLeftInChapter !== null && pagesLeftInChapter !== undefined && pagesLeftInChapter >= 0) {
    parts.push(
      chapterMinutesLeft === null
        ? t.plural('position.pagesLeft', pagesLeftInChapter)
        : t('position.chapterTimeLeft', { duration: formatDuration(chapterMinutesLeft, t) }),
    )
  }

  if (percentage !== null) {
    parts.push(t('position.wholeBook', { percent: Math.round(percentage * 100) }))
  }

  if (bookMinutesLeft !== null) {
    parts.push(t('position.bookTimeLeft', { duration: formatDuration(bookMinutesLeft, t) }))
  }

  if (parts.length === 0) {
    return (
      <span className="text-[11px] font-normal text-neutral-500 dark:text-neutral-400">
        {t('position.locating')}
      </span>
    )
  }

  return (
    <div
      className="flex items-center gap-2 text-[11px] font-medium tracking-wide opacity-70"
      title={t(rateIsLearned ? 'position.rateLearned' : 'position.rateAssumed')}
    >
      {parts.map((part, index) => (
        <span key={index} className="flex items-center gap-2">
          {index > 0 && <span className="opacity-30">·</span>}
          <span>{part}</span>
        </span>
      ))}
    </div>
  )
}

/** `95` → `1 小时 35 分`, `40` → `40 分钟`. */
function formatDuration(minutes: number, t: ReturnType<typeof useT>): string {
  if (minutes < 60) return t('position.minutes', { n: minutes })
  const hours = Math.floor(minutes / 60)
  const rest = minutes % 60
  return rest === 0
    ? t('position.hours', { n: hours })
    : t('position.hoursMinutes', { hours, minutes: rest })
}
