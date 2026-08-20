import { useEffect, useState, type ReactNode } from 'react'
import { getStorage } from '../platform'
import type { DailyReadingStats, OverallReadingStats } from '../platform/types'
import { localDateKey } from './tracking'
import {
  checkinState,
  EXCEEDED_GOAL_MULTIPLE,
  isCurrentMonth,
  monthCheckinSummary,
  shiftMonth,
  type CheckinState,
} from './checkins'
import {
  IconBook,
  IconCalendar,
  IconChevronLeft,
  IconChevronRight,
  IconClock,
  IconFlame,
  IconInfo,
  IconLibrary,
  IconStats,
} from '../ui/icons'
import { useModalDialog } from '../ui/useModalDialog'
import { useLanguage, useT } from '../i18n/useT'
import type { Language, MessageKey, Translate } from '../i18n/types'

interface StatsModalProps {
  dailyGoalMinutes: number
  onClose: () => void
}

export function StatsModal({ dailyGoalMinutes, onClose }: StatsModalProps) {
  const [stats, setStats] = useState<OverallReadingStats | null>(null)
  const [loading, setLoading] = useState(true)
  const [tab, setTab] = useState<'overview' | 'checkin'>('overview')
  const dialogRef = useModalDialog<HTMLDivElement>(onClose)
  const t = useT()
  const { language } = useLanguage()

  useEffect(() => {
    let cancelled = false
    void (async () => {
      try {
        const storage = await getStorage()
        const data = await storage.getReadingStats()
        if (!cancelled) {
          setStats(data)
          setLoading(false)
        }
      } catch {
        if (!cancelled) setLoading(false)
      }
    })()

    return () => {
      cancelled = true
    }
  }, [])

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      {/* Backdrop */}
      <div
        className="fixed inset-0 bg-black/35 backdrop-blur-sm vr-animate-fade"
        onClick={onClose}
        aria-hidden="true"
      />

      {/* Modal Card */}
      <div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby="reading-stats-title"
        tabIndex={-1}
        className="relative z-10 flex max-h-[90vh] w-full max-w-2xl flex-col rounded-3xl border border-black/[0.08] bg-white/94 p-6 shadow-[0_30px_70px_rgba(0,0,0,0.22),0_2px_8px_rgba(0,0,0,0.06)] backdrop-blur-3xl dark:border-white/[0.08] dark:bg-[#1C1C1E]/94 dark:text-neutral-100 vr-animate-pop"
      >
        <div className="flex items-center justify-between pb-4 border-b border-black/[0.06] dark:border-white/[0.06]">
          <div className="flex items-center gap-3">
            <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-blue-500/10 text-blue-600 dark:bg-blue-400/15 dark:text-blue-400">
              <IconStats />
            </div>
            <h2 id="reading-stats-title" className="text-base font-semibold tracking-tight">
              {t('stats.title')}
            </h2>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="flex h-8 w-8 items-center justify-center rounded-full text-neutral-400 transition hover:bg-black/5 hover:text-neutral-700 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue-500 dark:hover:bg-white/10 dark:hover:text-neutral-200"
            aria-label={t('stats.close')}
          >
            ✕
          </button>
        </div>

        <div className="mt-4 flex w-fit rounded-xl bg-black/[0.04] p-1 dark:bg-white/[0.06]">
          {[
            { id: 'overview' as const, label: t('stats.tab.overview'), icon: <IconStats /> },
            { id: 'checkin' as const, label: t('stats.tab.checkin'), icon: <IconCalendar /> },
          ].map((item) => (
            <button
              key={item.id}
              type="button"
              onClick={() => setTab(item.id)}
              className={`flex items-center gap-1.5 rounded-lg px-3.5 py-1.5 text-[11px] font-medium transition focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue-500 ${
                tab === item.id
                  ? 'bg-white text-neutral-900 shadow-[0_1px_4px_rgba(0,0,0,0.08)] dark:bg-[#303033] dark:text-white'
                  : 'text-neutral-500 hover:text-neutral-900 dark:text-neutral-400 dark:hover:text-white'
              }`}
              aria-pressed={tab === item.id}
            >
              <span className="opacity-70">{item.icon}</span>
              {item.label}
            </button>
          ))}
        </div>

        <div className="flex-1 overflow-y-auto overscroll-contain py-5 space-y-6">
          {loading ? (
            <div className="py-16 text-center text-xs text-neutral-400">{t('stats.loading')}</div>
          ) : !stats ? (
            <div className="py-16 text-center text-xs text-neutral-400">{t('stats.empty')}</div>
          ) : tab === 'overview' ? (
            <>
              {/* 4 Top Metric Cards */}
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                <MetricCard
                  label={t('stats.totalDuration')}
                  value={
                    stats.totalDurationMinutes >= 60
                      ? `${(stats.totalDurationMinutes / 60).toFixed(1)}`
                      : `${stats.totalDurationMinutes}`
                  }
                  unit={t(stats.totalDurationMinutes >= 60 ? 'stats.hours' : 'stats.minutes')}
                  icon={<IconClock />}
                />
                <ReadingVolumeCard
                  latinWords={stats.totalLatinWordsRead}
                  cjkCharacters={stats.totalCjkCharactersRead}
                  t={t}
                  language={language}
                />
                <MetricCard
                  label={t('stats.streak')}
                  value={`${stats.currentStreakDays}`}
                  unit={t('stats.days')}
                  icon={<IconFlame />}
                />
                <MetricCard
                  label={t('stats.booksTouched')}
                  value={`${stats.totalBooksRead}`}
                  unit={t('stats.books')}
                  icon={<IconLibrary />}
                />
              </div>

              {/* Heatmap Activity Grid */}
              <div className="rounded-2xl border border-black/[0.06] bg-black/[0.02] p-5 dark:border-white/[0.06] dark:bg-white/[0.03]">
                <div className="flex items-center justify-between mb-4">
                  <h3 className="text-xs font-semibold tracking-wide text-neutral-700 dark:text-neutral-300">
                    {t('stats.heatmap')}
                  </h3>
                  <div className="flex items-center gap-1.5 text-[10px] text-neutral-400">
                    <span>{t('stats.heatmapLess')}</span>
                    <span
                      className="h-2.5 w-2.5 rounded-xs bg-neutral-200/80 dark:bg-neutral-800"
                      title={t('stats.heatmap.none')}
                    />
                    {[...HEATMAP_LEVELS].reverse().map((level) => (
                      <span
                        key={level.min}
                        className={`h-2.5 w-2.5 rounded-xs ${level.swatch}`}
                        title={t(level.labelKey)}
                      />
                    ))}
                    <span>{t('stats.heatmapMore')}</span>
                  </div>
                </div>

                <HeatmapGrid dailyStats={stats.dailyStats} t={t} />
              </div>

              {/* Anti-idle note */}
              <div className="rounded-2xl border border-black/[0.06] bg-black/[0.02] p-4 text-xs text-neutral-600 dark:border-white/[0.06] dark:bg-white/[0.03] dark:text-neutral-300">
                <div className="flex items-start gap-3">
                  <span className="text-blue-500 mt-0.5"><IconInfo /></span>
                  <p className="leading-relaxed text-[11px] opacity-90">
                    <strong className="text-neutral-900 dark:text-white">
                      {t('stats.antiIdleTitle')}
                    </strong>{' '}
                    {t('stats.antiIdleBody')}
                  </p>
                </div>
              </div>
            </>
          ) : (
            <CheckinPage
              dailyStats={stats.dailyStats}
              currentStreakDays={stats.currentStreakDays}
              dailyGoalMinutes={dailyGoalMinutes}
            />
          )}
        </div>
      </div>
    </div>
  )
}

const CHECKIN_STYLES: Record<
  CheckinState,
  { cell: string; swatch: string; labelKey: MessageKey }
> = {
  exceeded: {
    cell: 'border-blue-600/70 bg-gradient-to-br from-blue-600 to-indigo-600 text-white shadow-[0_4px_12px_rgba(37,99,235,0.28)] dark:from-blue-500 dark:to-indigo-500',
    swatch: 'bg-gradient-to-br from-blue-600 to-indigo-600 dark:from-blue-500 dark:to-indigo-500',
    labelKey: 'stats.checkin.exceeded',
  },
  complete: {
    cell: 'border-blue-500/60 bg-blue-600 text-white shadow-[0_3px_9px_rgba(37,99,235,0.2)] dark:bg-blue-500',
    swatch: 'bg-blue-600 dark:bg-blue-500',
    labelKey: 'stats.checkin.complete',
  },
  partial: {
    cell: 'border-amber-400/55 bg-amber-50 text-amber-800 dark:border-amber-500/35 dark:bg-amber-400/10 dark:text-amber-300',
    swatch: 'bg-amber-100 border border-amber-300 dark:bg-amber-400/10 dark:border-amber-500/40',
    labelKey: 'stats.checkin.partial',
  },
  empty: {
    cell: 'border-black/[0.07] bg-white/70 text-neutral-500 dark:border-white/[0.07] dark:bg-white/[0.025] dark:text-neutral-400',
    swatch: 'bg-white border border-black/10 dark:bg-white/[0.03] dark:border-white/10',
    labelKey: 'stats.checkin.empty',
  },
  future: {
    cell: 'border-dashed border-black/[0.06] bg-transparent text-neutral-300 dark:border-white/[0.06] dark:text-neutral-700',
    swatch: 'border border-dashed border-black/15 dark:border-white/15',
    labelKey: 'stats.checkin.future',
  },
}

function CheckinPage({
  dailyStats,
  currentStreakDays,
  dailyGoalMinutes,
}: {
  dailyStats: Record<string, DailyReadingStats>
  currentStreakDays: number
  dailyGoalMinutes: number
}) {
  const t = useT()
  const { locale } = useLanguage()
  const today = new Date()
  const safeDailyGoalMinutes = Math.max(1, dailyGoalMinutes)
  const [month, setMonth] = useState(() => new Date(today.getFullYear(), today.getMonth(), 1))
  const viewingCurrentMonth = isCurrentMonth(month, today)

  const summary = monthCheckinSummary(dailyStats, safeDailyGoalMinutes, month, today)
  const year = month.getFullYear()
  const monthIndex = month.getMonth()
  const firstDay = new Date(year, monthIndex, 1).getDay()
  const daysInMonth = new Date(year, monthIndex + 1, 0).getDate()

  // Progress can pass 100%: the bar fills to the goal and a second segment shows
  // the overshoot, so a 2x day reads differently from a bare pass.
  const goalProgress = Math.min(100, Math.round((summary.todayMinutes / safeDailyGoalMinutes) * 100))
  const overshootMinutes = Math.max(0, summary.todayMinutes - safeDailyGoalMinutes)
  const overshootProgress = Math.min(
    100,
    Math.round((overshootMinutes / safeDailyGoalMinutes) * 100),
  )
  const todayState = checkinState(today, summary.todayMinutes, safeDailyGoalMinutes, today)

  const cells: (Date | null)[] = Array.from({ length: firstDay }, () => null)
  for (let day = 1; day <= daysInMonth; day++) cells.push(new Date(year, monthIndex, day))

  const todayMessage =
    todayState === 'exceeded'
      ? t('stats.todayExceeded', {
          n: summary.todayMinutes,
          times: Math.floor(summary.todayMinutes / safeDailyGoalMinutes),
        })
      : todayState === 'complete'
        ? t('stats.todayComplete')
        : t('stats.todayRemaining', {
            n: Math.max(0, safeDailyGoalMinutes - summary.todayMinutes),
          })

  return (
    <div className="space-y-5">
      <section className="relative overflow-hidden rounded-2xl border border-blue-500/15 bg-blue-500/[0.055] p-5 dark:border-blue-400/15 dark:bg-blue-400/[0.07]">
        <div className="flex items-end justify-between gap-5">
          <div>
            <p className="text-[10px] font-semibold uppercase tracking-[0.16em] text-blue-600/70 dark:text-blue-300/70">
              {t('stats.today')}
            </p>
            <div className="mt-2 flex items-baseline gap-1.5">
              <span className="font-serif text-4xl font-semibold tracking-tight text-neutral-900 dark:text-white">
                {summary.todayMinutes}
              </span>
              <span className="text-xs font-medium text-neutral-500 dark:text-neutral-400">
                {t('stats.todayOf', { n: safeDailyGoalMinutes })}
              </span>
            </div>
            <p className="mt-2 text-[11px] text-neutral-500 dark:text-neutral-400">{todayMessage}</p>
          </div>
          <div className="shrink-0 text-right">
            <p className="font-mono text-2xl font-bold text-blue-600 dark:text-blue-400">
              {Math.round((summary.todayMinutes / safeDailyGoalMinutes) * 100)}%
            </p>
            <p className="mt-1 text-[10px] text-neutral-400">
              {t('stats.streakDays', { n: currentStreakDays })}
            </p>
          </div>
        </div>
        <div className="mt-4 flex h-1.5 gap-0.5 overflow-hidden rounded-full bg-blue-500/10 dark:bg-blue-300/10">
          <div
            className="h-full rounded-full bg-blue-600 transition-[width] duration-300 motion-reduce:transition-none dark:bg-blue-400"
            style={{ width: `${goalProgress}%` }}
          />
          {overshootProgress > 0 && (
            <div
              className="h-full rounded-full bg-indigo-500/70 transition-[width] duration-300 motion-reduce:transition-none dark:bg-indigo-400/70"
              style={{ width: `${overshootProgress}%` }}
              title={t('stats.overshootHint', { n: overshootMinutes })}
            />
          )}
        </div>
      </section>

      <section className="rounded-2xl border border-black/[0.06] bg-black/[0.015] p-5 dark:border-white/[0.07] dark:bg-white/[0.025]">
        <div className="mb-4 flex items-end justify-between gap-4">
          <div className="flex items-center gap-1">
            <button
              type="button"
              onClick={() => setMonth((current) => shiftMonth(current, -1))}
              className="flex size-7 items-center justify-center rounded-lg text-neutral-400 transition hover:bg-black/5 hover:text-neutral-700 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue-500 dark:hover:bg-white/10 dark:hover:text-neutral-200"
              aria-label={t('stats.prevMonth')}
            >
              <IconChevronLeft />
            </button>
            <div className="min-w-28 text-center">
              <h3 className="text-sm font-semibold tracking-tight text-neutral-800 dark:text-neutral-200">
                {new Intl.DateTimeFormat(locale, { year: 'numeric', month: 'long' }).format(
                  new Date(year, monthIndex, 1),
                )}
              </h3>
            </div>
            <button
              type="button"
              onClick={() => setMonth((current) => shiftMonth(current, 1))}
              disabled={viewingCurrentMonth}
              className="flex size-7 items-center justify-center rounded-lg text-neutral-400 transition hover:bg-black/5 hover:text-neutral-700 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue-500 disabled:pointer-events-none disabled:opacity-30 dark:hover:bg-white/10 dark:hover:text-neutral-200"
              aria-label={t('stats.nextMonth')}
            >
              <IconChevronRight />
            </button>
          </div>
          <div className="text-right text-[11px] leading-relaxed text-neutral-500 dark:text-neutral-400">
            <p>
              {t('stats.monthCompleted', {
                completed: summary.completedDays,
                elapsed: summary.elapsedDays,
              })}
              {summary.exceededDays > 0 && t('stats.monthExceeded', { n: summary.exceededDays })}
            </p>
            <p className="mt-0.5 text-neutral-400">
              {t('stats.monthActive', {
                n: summary.activeDays,
                duration: formatMinutes(summary.totalMinutes, t),
              })}
            </p>
          </div>
        </div>

        <div className="grid grid-cols-7 gap-2">
          {WEEKDAY_KEYS.map((key) => (
            <div key={key} className="pb-1 text-center text-[9px] font-medium text-neutral-400">
              {t(key)}
            </div>
          ))}
          {cells.map((date, index) => {
            if (!date) return <div key={`blank-${index}`} aria-hidden="true" />
            const key = localDateKey(date)
            const minutes = dailyStats[key]?.durationMinutes ?? 0
            const state = checkinState(date, minutes, safeDailyGoalMinutes, today)
            const isToday = key === localDateKey(today)
            return (
              <div
                key={key}
                title={t('stats.checkinCell', {
                  date: key,
                  minutes,
                  state: t(CHECKIN_STYLES[state].labelKey),
                })}
                className={`relative min-h-14 rounded-[7px_12px_7px_7px] border px-2 py-1.5 transition ${CHECKIN_STYLES[state].cell} ${
                  isToday ? 'ring-2 ring-blue-500/25 ring-offset-2 ring-offset-white dark:ring-offset-[#1C1C1E]' : ''
                }`}
              >
                <span className="text-[10px] font-semibold">{date.getDate()}</span>
                {state !== 'future' && (
                  <span className="mt-2 block font-mono text-[9px] opacity-75">
                  {t('stats.cellMinutes', { n: minutes })}
                </span>
                )}
                {(state === 'complete' || state === 'exceeded') && (
                  <>
                    <span
                      className="absolute right-1.5 top-1 text-[9px] font-bold"
                      aria-label={t(CHECKIN_STYLES[state].labelKey)}
                    >
                      {state === 'exceeded' ? '★' : '✓'}
                    </span>
                    <span className="absolute right-0 top-0 size-2.5 rounded-tr-[6px] bg-white/30 [clip-path:polygon(0_0,100%_0,100%_100%)]" aria-hidden="true" />
                  </>
                )}
              </div>
            )
          })}
        </div>

        <div className="mt-4 flex flex-wrap items-center gap-x-4 gap-y-2 text-[10px] text-neutral-400">
          {(['exceeded', 'complete', 'partial', 'empty'] as const).map((state) => (
            <Legend
              key={state}
              swatch={CHECKIN_STYLES[state].swatch}
              label={t(CHECKIN_STYLES[state].labelKey)}
            />
          ))}
          <span className="ml-auto">
            {t('stats.checkinRule', {
              goal: safeDailyGoalMinutes,
              exceeded: safeDailyGoalMinutes * EXCEEDED_GOAL_MULTIPLE,
            })}
          </span>
        </div>
      </section>
    </div>
  )
}

function formatMinutes(minutes: number, t: Translate): string {
  if (minutes < 60) return t('stats.durationMinutes', { n: minutes })
  const hours = Math.floor(minutes / 60)
  const rest = minutes % 60
  return rest === 0
    ? t('stats.durationHours', { n: hours })
    : t('stats.durationHoursMinutes', { hours, minutes: rest })
}

const WEEKDAY_KEYS = [
  'stats.weekday.sun',
  'stats.weekday.mon',
  'stats.weekday.tue',
  'stats.weekday.wed',
  'stats.weekday.thu',
  'stats.weekday.fri',
  'stats.weekday.sat',
] as const

function Legend({ swatch, label }: { swatch: string; label: string }) {
  return (
    <span className="flex items-center gap-1.5">
      <span className={`size-2.5 rounded-[3px] ${swatch}`} />
      {label}
    </span>
  )
}

function MetricCard({
  label,
  value,
  unit,
  icon,
}: {
  label: string
  value: string
  unit: string
  icon: ReactNode
}) {
  return (
    <div className="flex flex-col justify-between rounded-2xl border border-black/[0.06] bg-black/[0.02] p-4 dark:border-white/[0.06] dark:bg-white/[0.03] transition hover:bg-black/[0.03] dark:hover:bg-white/[0.05]">
      <div className="flex items-center justify-between text-neutral-400 text-xs mb-2">
        <span className="font-medium text-[11px]">{label}</span>
        <span className="opacity-70">{icon}</span>
      </div>
      <div className="flex items-baseline gap-1">
        <span className="text-2xl font-bold font-mono tracking-tight text-neutral-900 dark:text-white">
          {value}
        </span>
        <span className="text-xs text-neutral-500 font-medium">{unit}</span>
      </div>
    </div>
  )
}

function ReadingVolumeCard({
  latinWords,
  cjkCharacters,
  t,
  language,
}: {
  latinWords: number
  cjkCharacters: number
  t: Translate
  language: Language
}) {
  return (
    <div className="flex flex-col justify-between rounded-2xl border border-black/[0.06] bg-black/[0.02] p-4 transition hover:bg-black/[0.03] dark:border-white/[0.06] dark:bg-white/[0.03] dark:hover:bg-white/[0.05]">
      <div className="mb-2 flex items-center justify-between text-xs text-neutral-400">
        <span className="text-[11px] font-medium">{t('stats.volume')}</span>
        <span className="opacity-70"><IconBook /></span>
      </div>
      <div className="space-y-0.5 font-mono text-[11px] font-semibold text-neutral-800 dark:text-neutral-200">
        <p>
          {formatReadingCount(latinWords, t, language)}{' '}
          <span className="font-sans font-medium text-neutral-400">{t('stats.latinWords')}</span>
        </p>
        <p>
          {formatReadingCount(cjkCharacters, t, language)}{' '}
          <span className="font-sans font-medium text-neutral-400">{t('stats.cjkCharacters')}</span>
        </p>
      </div>
    </div>
  )
}

/**
 * Chinese groups large numbers by 万 (10,000), English by millions, so the
 * divisor belongs to the language rather than to the message.
 */
function formatReadingCount(value: number, t: Translate, language: Language): string {
  const largeDivisor = language === 'zh' ? 10_000 : 1_000_000
  if (value >= largeDivisor) {
    return t('stats.countLarge', { n: (value / largeDivisor).toFixed(1) })
  }
  if (value >= 1_000) return t('stats.countMedium', { n: (value / 1_000).toFixed(1) })
  return String(value)
}

/** Descending, so the first match wins. The legend renders from this same list
 *  — the two used to disagree on both the number of steps and the shades. */
const HEATMAP_LEVELS: { min: number; swatch: string; labelKey: MessageKey }[] = [
  { min: 60, swatch: 'bg-emerald-600 dark:bg-emerald-400', labelKey: 'stats.heatmap.over60' },
  { min: 30, swatch: 'bg-emerald-500 dark:bg-emerald-600', labelKey: 'stats.heatmap.30to60' },
  { min: 15, swatch: 'bg-emerald-400 dark:bg-emerald-700', labelKey: 'stats.heatmap.15to30' },
  { min: 0, swatch: 'bg-emerald-300 dark:bg-emerald-900', labelKey: 'stats.heatmap.under15' },
]

function HeatmapGrid({
  dailyStats,
  t,
}: {
  dailyStats: Record<string, DailyReadingStats>
  t: Translate
}) {
  // Generate past 24 weeks (168 days), Sunday-aligned columns ending this week.
  const WEEKS = 24
  const days: {
    dateStr: string
    dayOfWeek: number
    minutes: number
    latinWords: number
    cjkCharacters: number
    isFuture: boolean
  }[] = []
  const today = new Date()
  const todayKey = localDateKey(today)

  // Calculate start date (Sunday 24 weeks ago)
  const totalDays = WEEKS * 7
  const startDate = new Date(today)
  startDate.setDate(today.getDate() - totalDays + (7 - today.getDay()))

  for (let i = 0; i < totalDays; i++) {
    const d = new Date(startDate)
    d.setDate(startDate.getDate() + i)
    const dateStr = localDateKey(d)
    const record = dailyStats[dateStr]
    days.push({
      dateStr,
      dayOfWeek: d.getDay(),
      minutes: record?.durationMinutes ?? 0,
      latinWords: record?.latinWordsRead ?? 0,
      cjkCharacters: record?.cjkCharactersRead ?? 0,
      // The Sunday-aligned window always runs to this Saturday, so up to six
      // cells sit past today. Rendering them like unread days reads as a gap.
      isFuture: dateStr > todayKey,
    })
  }

  // Group into columns of 7 days
  const columns: (typeof days)[] = []
  for (let i = 0; i < days.length; i += 7) {
    columns.push(days.slice(i, i + 7))
  }

  return (
    <div className="overflow-x-auto pb-1">
      <div className="flex gap-1.5 min-w-[500px]">
        {/* Day of week labels */}
        <div className="flex flex-col gap-1.5 text-[9px] text-neutral-400 font-mono pr-1 pt-0.5">
          {WEEKDAY_KEYS.map((key) => (
            <span key={key} className="h-3 leading-3">
              {t(key)}
            </span>
          ))}
        </div>

        {/* Heatmap column bars */}
        {columns.map((col, cIdx) => (
          <div key={cIdx} className="flex flex-col gap-1.5">
            {col.map((day) => {
              if (day.isFuture) {
                return (
                  <div
                    key={day.dateStr}
                    aria-hidden="true"
                    className="h-3 w-3 rounded-xs border border-dashed border-black/[0.07] dark:border-white/[0.07]"
                  />
                )
              }

              const bg = HEATMAP_LEVELS.find((level) => day.minutes > level.min)?.swatch
                ?? 'bg-neutral-200/80 dark:bg-neutral-800'

              return (
                <div
                  key={day.dateStr}
                  title={t('stats.heatmapCell', {
                    date: day.dateStr,
                    minutes: day.minutes,
                    words: day.latinWords,
                    characters: day.cjkCharacters,
                  })}
                  className={`h-3 w-3 rounded-xs transition-colors hover:ring-2 hover:ring-blue-500 ${bg}`}
                />
              )
            })}
          </div>
        ))}
      </div>
    </div>
  )
}
