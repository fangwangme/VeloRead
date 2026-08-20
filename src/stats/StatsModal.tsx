import { useEffect, useState, type ReactNode } from 'react'
import { getStorage } from '../platform'
import type { OverallReadingStats } from '../platform/types'
import { localDateKey } from './tracking'
import { checkinState, monthCheckinSummary } from './checkins'
import {
  IconBook,
  IconCalendar,
  IconClock,
  IconFlame,
  IconInfo,
  IconLibrary,
  IconStats,
} from '../ui/icons'

interface StatsModalProps {
  dailyGoalMinutes: number
  onClose: () => void
}

export function StatsModal({ dailyGoalMinutes, onClose }: StatsModalProps) {
  const [stats, setStats] = useState<OverallReadingStats | null>(null)
  const [loading, setLoading] = useState(true)
  const [tab, setTab] = useState<'overview' | 'checkin'>('overview')

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
        className="fixed inset-0 bg-black/35 backdrop-blur-sm transition-opacity duration-300 animate-in fade-in"
        onClick={onClose}
        aria-hidden="true"
      />

      {/* Modal Card */}
      <div className="relative z-10 flex max-h-[90vh] w-full max-w-2xl flex-col rounded-3xl border border-black/[0.08] bg-white/94 p-6 shadow-[0_30px_70px_rgba(0,0,0,0.22),0_2px_8px_rgba(0,0,0,0.06)] backdrop-blur-3xl dark:border-white/[0.08] dark:bg-[#1C1C1E]/94 dark:text-neutral-100 animate-in fade-in zoom-in-95 duration-200">
        <div className="flex items-center justify-between pb-4 border-b border-black/[0.06] dark:border-white/[0.06]">
          <div className="flex items-center gap-3">
            <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-blue-500/10 text-blue-600 dark:bg-blue-400/15 dark:text-blue-400">
              <IconStats />
            </div>
            <div>
              <h2 className="text-base font-semibold tracking-tight">阅读数据与统计</h2>
              <p className="text-xs text-neutral-500 dark:text-neutral-400 mt-0.5">
                记录专注阅读，见证心智成长
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="flex h-8 w-8 items-center justify-center rounded-full text-neutral-400 hover:bg-black/5 hover:text-neutral-700 dark:hover:bg-white/10 dark:hover:text-neutral-200 transition"
            aria-label="关闭统计"
          >
            ✕
          </button>
        </div>

        <div className="mt-4 flex w-fit rounded-xl bg-black/[0.04] p-1 dark:bg-white/[0.06]">
          {[
            { id: 'overview' as const, label: '数据总览', icon: <IconStats /> },
            { id: 'checkin' as const, label: '阅读打卡', icon: <IconCalendar /> },
          ].map((item) => (
            <button
              key={item.id}
              type="button"
              onClick={() => setTab(item.id)}
              className={`flex items-center gap-1.5 rounded-lg px-3.5 py-1.5 text-[11px] font-medium transition ${
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

        <div className="flex-1 overflow-y-auto py-5 space-y-6">
          {loading ? (
            <div className="py-16 text-center text-xs text-neutral-400">正在汇总阅读记录…</div>
          ) : !stats ? (
            <div className="py-16 text-center text-xs text-neutral-400">暂无阅读数据</div>
          ) : tab === 'overview' ? (
            <>
              {/* 4 Top Metric Cards */}
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                <MetricCard
                  label="累计阅读时长"
                  value={
                    stats.totalDurationMinutes >= 60
                      ? `${(stats.totalDurationMinutes / 60).toFixed(1)}`
                      : `${stats.totalDurationMinutes}`
                  }
                  unit={stats.totalDurationMinutes >= 60 ? '小时' : '分钟'}
                  icon={<IconClock />}
                />
                <MetricCard
                  label="累计阅读字数"
                  value={
                    stats.totalWordsRead >= 10000
                      ? `${(stats.totalWordsRead / 10000).toFixed(1)}`
                      : `${stats.totalWordsRead}`
                  }
                  unit={stats.totalWordsRead >= 10000 ? '万字' : '字/词'}
                  icon={<IconBook />}
                />
                <MetricCard
                  label="连续阅读"
                  value={`${stats.currentStreakDays}`}
                  unit="天"
                  icon={<IconFlame />}
                />
                <MetricCard
                  label="涉猎图书"
                  value={`${stats.totalBooksRead}`}
                  unit="本"
                  icon={<IconLibrary />}
                />
              </div>

              {/* Heatmap Activity Grid */}
              <div className="rounded-2xl border border-black/[0.06] bg-black/[0.02] p-5 dark:border-white/[0.06] dark:bg-white/[0.03]">
                <div className="flex items-center justify-between mb-4">
                  <h3 className="text-xs font-semibold tracking-wide text-neutral-700 dark:text-neutral-300">
                    近半年阅读热力图 (Activity Heatmap)
                  </h3>
                  <div className="flex items-center gap-1.5 text-[10px] text-neutral-400">
                    <span>少</span>
                    <span className="h-2.5 w-2.5 rounded-xs bg-neutral-200 dark:bg-neutral-800" />
                    <span className="h-2.5 w-2.5 rounded-xs bg-emerald-200 dark:bg-emerald-900/60" />
                    <span className="h-2.5 w-2.5 rounded-xs bg-emerald-400 dark:bg-emerald-700" />
                    <span className="h-2.5 w-2.5 rounded-xs bg-emerald-600 dark:bg-emerald-500" />
                    <span>多</span>
                  </div>
                </div>

                <HeatmapGrid dailyStats={stats.dailyStats} />
              </div>

              {/* Anti-idle note */}
              <div className="rounded-2xl border border-black/[0.06] bg-black/[0.02] p-4 text-xs text-neutral-600 dark:border-white/[0.06] dark:bg-white/[0.03] dark:text-neutral-300">
                <div className="flex items-start gap-3">
                  <span className="text-blue-500 mt-0.5"><IconInfo /></span>
                  <p className="leading-relaxed text-[11px] opacity-90">
                    <strong className="text-neutral-900 dark:text-white">智能防挂机机制：</strong>
                    为保证统计客观真实，单页累计 5 分钟后将暂停计时；页面切至后台或窗口失焦时也会立即暂停，翻到新页后自动续接。
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

function CheckinPage({
  dailyStats,
  currentStreakDays,
  dailyGoalMinutes,
}: {
  dailyStats: Record<string, { durationMinutes: number; wordsRead: number }>
  currentStreakDays: number
  dailyGoalMinutes: number
}) {
  const today = new Date()
  const safeDailyGoalMinutes = Math.max(1, dailyGoalMinutes)
  const year = today.getFullYear()
  const month = today.getMonth()
  const firstDay = new Date(year, month, 1).getDay()
  const daysInMonth = new Date(year, month + 1, 0).getDate()
  const summary = monthCheckinSummary(dailyStats, safeDailyGoalMinutes, today)
  const progress = Math.min(100, Math.round((summary.todayMinutes / safeDailyGoalMinutes) * 100))
  const cells: (Date | null)[] = Array.from({ length: firstDay }, () => null)
  for (let day = 1; day <= daysInMonth; day++) cells.push(new Date(year, month, day))

  return (
    <div className="space-y-5">
      <section className="relative overflow-hidden rounded-2xl border border-blue-500/15 bg-blue-500/[0.055] p-5 dark:border-blue-400/15 dark:bg-blue-400/[0.07]">
        <div className="flex items-end justify-between gap-5">
          <div>
            <p className="text-[10px] font-semibold uppercase tracking-[0.16em] text-blue-600/70 dark:text-blue-300/70">
              今日阅读
            </p>
            <div className="mt-2 flex items-baseline gap-1.5">
              <span className="font-serif text-4xl font-semibold tracking-tight text-neutral-900 dark:text-white">
                {summary.todayMinutes}
              </span>
              <span className="text-xs font-medium text-neutral-500 dark:text-neutral-400">
                / {safeDailyGoalMinutes} 分钟
              </span>
            </div>
            <p className="mt-2 text-[11px] text-neutral-500 dark:text-neutral-400">
              {progress >= 100 ? '今日目标已完成，打卡已自动点亮。' : `再读 ${Math.max(0, safeDailyGoalMinutes - summary.todayMinutes)} 分钟即可完成打卡。`}
            </p>
          </div>
          <div className="shrink-0 text-right">
            <p className="font-mono text-2xl font-bold text-blue-600 dark:text-blue-400">{progress}%</p>
            <p className="mt-1 text-[10px] text-neutral-400">连续 {currentStreakDays} 天</p>
          </div>
        </div>
        <div className="mt-4 h-1.5 overflow-hidden rounded-full bg-blue-500/10 dark:bg-blue-300/10">
          <div
            className="h-full rounded-full bg-blue-600 transition-[width] duration-300 dark:bg-blue-400"
            style={{ width: `${progress}%` }}
          />
        </div>
      </section>

      <section className="rounded-2xl border border-black/[0.06] bg-black/[0.015] p-5 dark:border-white/[0.07] dark:bg-white/[0.025]">
        <div className="mb-4 flex items-end justify-between">
          <div>
            <h3 className="text-sm font-semibold tracking-tight text-neutral-800 dark:text-neutral-200">
              {year} 年 {month + 1} 月
            </h3>
            <p className="mt-1 text-[10px] text-neutral-400">达标日会在书页右上角留下完成印记</p>
          </div>
          <p className="text-[11px] text-neutral-500 dark:text-neutral-400">
            <span className="font-mono font-bold text-neutral-900 dark:text-white">{summary.completedDays}</span>
            {' '}天达标 · {summary.activeDays} 天有阅读
          </p>
        </div>

        <div className="grid grid-cols-7 gap-2">
          {['日', '一', '二', '三', '四', '五', '六'].map((day) => (
            <div key={day} className="pb-1 text-center text-[9px] font-medium text-neutral-400">
              {day}
            </div>
          ))}
          {cells.map((date, index) => {
            if (!date) return <div key={`blank-${index}`} aria-hidden="true" />
            const key = localDateKey(date)
            const minutes = dailyStats[key]?.durationMinutes ?? 0
            const state = checkinState(date, minutes, safeDailyGoalMinutes, today)
            const isToday = key === localDateKey(today)
            const stateClass = {
              complete: 'border-blue-500/60 bg-blue-600 text-white shadow-[0_3px_9px_rgba(37,99,235,0.2)] dark:bg-blue-500',
              partial: 'border-amber-400/55 bg-amber-50 text-amber-800 dark:border-amber-500/35 dark:bg-amber-400/10 dark:text-amber-300',
              empty: 'border-black/[0.07] bg-white/70 text-neutral-500 dark:border-white/[0.07] dark:bg-white/[0.025] dark:text-neutral-400',
              future: 'border-black/[0.035] bg-transparent text-neutral-300 dark:border-white/[0.035] dark:text-neutral-700',
            }[state]
            return (
              <div
                key={key}
                title={`${key}: ${minutes} 分钟`}
                className={`relative min-h-14 rounded-[7px_12px_7px_7px] border px-2 py-1.5 transition ${stateClass} ${
                  isToday ? 'ring-2 ring-blue-500/25 ring-offset-2 ring-offset-white dark:ring-offset-[#1C1C1E]' : ''
                }`}
              >
                <span className="text-[10px] font-semibold">{date.getDate()}</span>
                {state !== 'future' && (
                  <span className="mt-2 block text-[9px] font-mono opacity-75">{minutes}m</span>
                )}
                {state === 'complete' && (
                  <>
                    <span className="absolute right-1.5 top-1 text-[9px] font-bold" aria-label="已达标">✓</span>
                    <span className="absolute right-0 top-0 size-2.5 rounded-tr-[6px] bg-white/30 [clip-path:polygon(0_0,100%_0,100%_100%)]" aria-hidden="true" />
                  </>
                )}
              </div>
            )
          })}
        </div>

        <div className="mt-4 flex flex-wrap items-center gap-x-4 gap-y-2 text-[10px] text-neutral-400">
          <Legend swatch="bg-blue-600 dark:bg-blue-500" label="已达标" />
          <Legend swatch="bg-amber-100 border border-amber-300 dark:bg-amber-400/10 dark:border-amber-500/40" label="阅读中" />
          <Legend swatch="bg-white border border-black/10 dark:bg-white/[0.03] dark:border-white/10" label="未阅读" />
          <span className="ml-auto">达到 {safeDailyGoalMinutes} 分钟自动打卡</span>
        </div>
      </section>
    </div>
  )
}

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

function HeatmapGrid({
  dailyStats,
}: {
  dailyStats: Record<string, { durationMinutes: number; wordsRead: number }>
}) {
  // Generate past 24 weeks (168 days)
  const WEEKS = 24
  const days: { dateStr: string; dayOfWeek: number; minutes: number; words: number }[] = []
  const today = new Date()

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
      words: record?.wordsRead ?? 0,
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
          <span className="h-3 leading-3">日</span>
          <span className="h-3 leading-3">一</span>
          <span className="h-3 leading-3">二</span>
          <span className="h-3 leading-3">三</span>
          <span className="h-3 leading-3">四</span>
          <span className="h-3 leading-3">五</span>
          <span className="h-3 leading-3">六</span>
        </div>

        {/* Heatmap column bars */}
        {columns.map((col, cIdx) => (
          <div key={cIdx} className="flex flex-col gap-1.5">
            {col.map((day) => {
              let bg = 'bg-neutral-200/80 dark:bg-neutral-800'
              if (day.minutes > 0 && day.minutes <= 15) {
                bg = 'bg-emerald-300 dark:bg-emerald-900'
              } else if (day.minutes > 15 && day.minutes <= 30) {
                bg = 'bg-emerald-400 dark:bg-emerald-700'
              } else if (day.minutes > 30 && day.minutes <= 60) {
                bg = 'bg-emerald-500 dark:bg-emerald-600'
              } else if (day.minutes > 60) {
                bg = 'bg-emerald-600 dark:bg-emerald-400'
              }

              return (
                <div
                  key={day.dateStr}
                  title={`${day.dateStr}: ${day.minutes} 分钟 · ${day.words} 字`}
                  className={`h-3 w-3 rounded-xs transition-colors hover:ring-2 hover:ring-blue-500 cursor-pointer ${bg}`}
                />
              )
            })}
          </div>
        ))}
      </div>
    </div>
  )
}
