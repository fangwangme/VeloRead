import { useEffect, useState, type ReactNode } from 'react'
import { getStorage } from '../platform'
import type { OverallReadingStats } from '../platform/types'
import {
  IconBook,
  IconClock,
  IconFlame,
  IconInfo,
  IconLibrary,
  IconStats,
} from '../ui/icons'

interface StatsModalProps {
  onClose: () => void
}

export function StatsModal({ onClose }: StatsModalProps) {
  const [stats, setStats] = useState<OverallReadingStats | null>(null)
  const [loading, setLoading] = useState(true)

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
        className="fixed inset-0 bg-black/40 backdrop-blur-sm transition-opacity duration-200"
        onClick={onClose}
        aria-hidden="true"
      />

      {/* Modal Card */}
      <div className="relative z-10 flex max-h-[90vh] w-full max-w-2xl flex-col rounded-3xl border border-black/10 bg-white/95 p-6 shadow-2xl backdrop-blur-2xl dark:border-white/10 dark:bg-neutral-900/95 dark:text-neutral-100 animate-in fade-in zoom-in-95 duration-200">
        <div className="flex items-center justify-between pb-4 border-b border-black/5 dark:border-white/5">
          <div className="flex items-center gap-3">
            <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-black/[0.04] dark:bg-white/[0.06] text-neutral-700 dark:text-neutral-200">
              <IconStats />
            </div>
            <div>
              <h2 className="text-base font-bold tracking-tight">阅读数据与统计</h2>
              <p className="text-xs text-neutral-500 dark:text-neutral-400">
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

        <div className="flex-1 overflow-y-auto py-5 space-y-6">
          {loading ? (
            <div className="py-16 text-center text-xs text-neutral-400">正在汇总阅读记录…</div>
          ) : !stats ? (
            <div className="py-16 text-center text-xs text-neutral-400">暂无阅读数据</div>
          ) : (
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
              <div className="rounded-2xl border border-black/5 bg-black/[0.02] p-5 dark:border-white/5 dark:bg-white/[0.03]">
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
              <div className="rounded-xl border border-neutral-200/80 bg-neutral-50 p-3.5 text-xs text-neutral-600 dark:border-neutral-800 dark:bg-neutral-800/40 dark:text-neutral-300">
                <div className="flex items-start gap-2.5">
                  <span className="text-neutral-500 mt-0.5"><IconInfo /></span>
                  <p className="leading-relaxed text-[11px] opacity-90">
                    <strong>智能防挂机机制：</strong>
                    为保证统计客观真实，单页停留超过 5 分钟无操作将自动暂停计时；页面切至后台或窗口失焦时立即暂停，翻页或互动后自动续接。
                  </p>
                </div>
              </div>
            </>
          )}
        </div>
      </div>
    </div>
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
    <div className="flex flex-col justify-between rounded-2xl border border-black/5 bg-black/[0.02] p-4 dark:border-white/5 dark:bg-white/[0.03]">
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
    const dateStr = d.toISOString().slice(0, 10)
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
