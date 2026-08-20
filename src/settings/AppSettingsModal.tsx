import { useState, type ReactNode } from 'react'
import type { AppSettings } from '../platform/types'
import {
  IconClock,
  IconMonitor,
  IconMoon,
  IconSettings,
  IconSun,
} from '../ui/icons'

interface AppSettingsModalProps {
  settings: AppSettings
  onChange: (changes: Partial<AppSettings>) => Promise<void>
  onClose: () => void
}

const GOAL_OPTIONS = [10, 15, 20, 30, 45, 60]

export function AppSettingsModal({ settings, onChange, onClose }: AppSettingsModalProps) {
  const [error, setError] = useState<string | null>(null)
  const themeMode = settings.themeMode ?? 'auto'
  const dailyGoal = settings.dailyReadingGoalMinutes ?? 15

  const save = async (changes: Partial<AppSettings>) => {
    setError(null)
    try {
      await onChange(changes)
    } catch {
      setError('设置未能保存，请重试。')
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div
        className="fixed inset-0 bg-black/35 backdrop-blur-sm animate-in fade-in"
        onClick={onClose}
        aria-hidden="true"
      />

      <section
        className="relative z-10 w-full max-w-xl overflow-hidden rounded-3xl border border-black/[0.08] bg-[#FBFBFA]/96 shadow-[0_30px_70px_rgba(0,0,0,0.22)] backdrop-blur-3xl dark:border-white/[0.08] dark:bg-[#1C1C1E]/96 dark:text-neutral-100 animate-in fade-in zoom-in-95 duration-200"
        aria-label="应用设置"
      >
        <header className="flex items-center justify-between border-b border-black/[0.06] px-6 py-5 dark:border-white/[0.06]">
          <div className="flex items-center gap-3">
            <span className="flex size-9 items-center justify-center rounded-xl bg-blue-500/10 text-blue-600 dark:bg-blue-400/15 dark:text-blue-400">
              <IconSettings />
            </span>
            <div>
              <h2 className="text-base font-semibold tracking-tight">应用设置</h2>
              <p className="mt-0.5 text-xs text-neutral-500 dark:text-neutral-400">
                控制整个 VeloRead；书内排版请使用阅读器的 Aa。
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="flex size-8 items-center justify-center rounded-full text-neutral-400 transition hover:bg-black/5 hover:text-neutral-700 dark:hover:bg-white/10 dark:hover:text-neutral-200"
            aria-label="关闭应用设置"
          >
            ✕
          </button>
        </header>

        <div className="space-y-5 p-6">
          <SettingSection
            icon={<IconMonitor />}
            title="外观"
            description="应用工具栏、书库和数据页面的显示方式"
          >
            <div className="mt-4 grid grid-cols-3 gap-2 rounded-2xl bg-black/[0.035] p-1.5 dark:bg-white/[0.055]">
              {[
                { id: 'auto' as const, label: '跟随系统', icon: <IconMonitor /> },
                { id: 'light' as const, label: '浅色', icon: <IconSun /> },
                { id: 'dark' as const, label: '深色', icon: <IconMoon /> },
              ].map((option) => (
                <button
                  key={option.id}
                  type="button"
                  onClick={() => void save({ themeMode: option.id })}
                  className={`flex items-center justify-center gap-1.5 rounded-xl py-2 text-[11px] font-medium transition focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue-500 ${
                    themeMode === option.id
                      ? 'bg-white text-neutral-900 shadow-[0_1px_4px_rgba(0,0,0,0.1)] dark:bg-[#303033] dark:text-white'
                      : 'text-neutral-500 hover:text-neutral-900 dark:text-neutral-400 dark:hover:text-white'
                  }`}
                  aria-pressed={themeMode === option.id}
                >
                  <span className="opacity-75">{option.icon}</span>
                  {option.label}
                </button>
              ))}
            </div>
          </SettingSection>

          <SettingSection
            icon={<IconClock />}
            title="每日阅读目标"
            description="达到目标分钟数后，当天会自动记为完成打卡"
          >
            <div className="mt-4 grid grid-cols-6 gap-1.5">
              {GOAL_OPTIONS.map((minutes) => (
                <button
                  key={minutes}
                  type="button"
                  onClick={() => void save({ dailyReadingGoalMinutes: minutes })}
                  className={`rounded-xl border py-2 text-[11px] font-mono font-semibold transition focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue-500 ${
                    dailyGoal === minutes
                      ? 'border-blue-500/70 bg-blue-500/10 text-blue-600 dark:text-blue-400'
                      : 'border-black/[0.06] bg-white/60 text-neutral-600 hover:border-black/15 dark:border-white/[0.07] dark:bg-white/[0.03] dark:text-neutral-300 dark:hover:border-white/15'
                  }`}
                  aria-pressed={dailyGoal === minutes}
                >
                  {minutes} 分
                </button>
              ))}
            </div>
          </SettingSection>

          {error && (
            <p className="rounded-xl border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-700 dark:border-red-900/60 dark:bg-red-950/40 dark:text-red-300">
              {error}
            </p>
          )}
        </div>
      </section>
    </div>
  )
}

function SettingSection({
  icon,
  title,
  description,
  children,
}: {
  icon: ReactNode
  title: string
  description: string
  children: ReactNode
}) {
  return (
    <section className="rounded-2xl border border-black/[0.06] bg-white/55 p-4 dark:border-white/[0.07] dark:bg-white/[0.025]">
      <div className="flex items-start gap-3">
        <span className="mt-0.5 flex size-8 shrink-0 items-center justify-center rounded-xl bg-neutral-900/[0.055] text-neutral-600 dark:bg-white/[0.07] dark:text-neutral-300">
          {icon}
        </span>
        <div>
          <h3 className="text-xs font-semibold text-neutral-800 dark:text-neutral-200">{title}</h3>
          <p className="mt-0.5 text-[11px] leading-relaxed text-neutral-500 dark:text-neutral-400">
            {description}
          </p>
        </div>
      </div>
      {children}
    </section>
  )
}
