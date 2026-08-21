import { useState, type ReactNode } from 'react'
import type { AppSettings } from '../platform/types'
import {
  AUTO_HIGHLIGHT_COLOR,
  MAX_HIGHLIGHT_OPACITY,
  MIN_HIGHLIGHT_OPACITY,
  PACER_HIGHLIGHT_SWATCHES,
  readHighlightStyle,
  resolveOverlayStyle,
  type PacerHighlightShape,
  type PacerHighlightStyle,
} from '../reader/pacer/overlayStyle'
import {
  IconClock,
  IconGlobe,
  IconKeyboard,
  IconHighlight,
  IconMonitor,
  IconMoon,
  IconPlay,
  IconSettings,
  IconSun,
} from '../ui/icons'
import { useModalDialog } from '../ui/useModalDialog'
import { useT } from '../i18n/useT'
import type { MessageKey, Translate } from '../i18n/types'
import { LANGUAGE_OPTIONS } from '../i18n/resolveLanguage'

interface AppSettingsModalProps {
  settings: AppSettings
  onChange: (changes: Partial<AppSettings>) => Promise<void>
  onClose: () => void
}

const GOAL_OPTIONS = [10, 15, 20, 30, 45, 60]
/** Ten hours. Past this it is a typo, not a daily reading goal. */
/** Stands in for the reading style's accent while previewing. */
const PREVIEW_ACCENT = '#D97706'

/** Reader keys. The left column is literal, so it needs no translation. */
const SHORTCUT_KEYS: [string, MessageKey][] = [
  ['Space', 'shortcut.space'],
  ['← →', 'shortcut.arrows'],
  ['T', 'shortcut.toc'],
  ['A', 'shortcut.typography'],
  ['/ · F', 'shortcut.search'],
  ['Esc', 'shortcut.escape'],
]

/** Pointer gestures, whose trigger has to be described in words. */
const SHORTCUT_GESTURES: [MessageKey, MessageKey][] = [
  ['gesture.clickText', 'shortcut.clickText'],
  ['gesture.clickBlank', 'shortcut.clickBlank'],
  ['gesture.select', 'shortcut.select'],
]

const GOAL_MIN = 1
const GOAL_MAX = 600

export function AppSettingsModal({ settings, onChange, onClose }: AppSettingsModalProps) {
  const [error, setError] = useState<MessageKey | null>(null)
  const t = useT()
  const dialogRef = useModalDialog<HTMLElement>(onClose)
  const themeMode = settings.themeMode ?? 'auto'
  const languagePreference = settings.language ?? 'auto'
  const dailyGoal = settings.dailyReadingGoalMinutes ?? 15
  const pacerWpm = settings.pacerWpm ?? 250
  const pacerCpm = settings.pacerCpm ?? 300
  const pacerChunkSize = settings.pacerChunkSize ?? 3
  const pacerCjkCharCount = settings.pacerCjkCharCount ?? 4
  const highlight = readHighlightStyle(settings)
  const clickToPosition = settings.clickToPositionPacer ?? true
  // The preview should look like the page it describes, so it follows the
  // appearance the app is actually showing rather than the OS.
  const previewDark =
    themeMode === 'dark' ||
    (themeMode === 'auto' &&
      typeof window !== 'undefined' &&
      Boolean(window.matchMedia?.('(prefers-color-scheme: dark)')?.matches))

  const save = async (changes: Partial<AppSettings>) => {
    setError(null)
    try {
      await onChange(changes)
    } catch {
      setError('settings.saveFailed')
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div
        className="fixed inset-0 bg-black/35 backdrop-blur-sm vr-animate-fade"
        onClick={onClose}
        aria-hidden="true"
      />

      <section
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby="app-settings-title"
        tabIndex={-1}
        className="relative z-10 flex max-h-[90vh] w-full max-w-xl flex-col overflow-hidden rounded-3xl border border-black/[0.12] bg-[#FBFBFA]/96 shadow-[0_30px_70px_rgba(0,0,0,0.22)] backdrop-blur-3xl dark:border-white/[0.08] dark:bg-[#1C1C1E]/96 dark:text-neutral-100 vr-animate-pop"
      >
        <header className="flex items-center justify-between border-b border-black/[0.10] px-6 py-5 dark:border-white/[0.06]">
          <div className="flex items-center gap-3">
            <span className="flex size-9 items-center justify-center rounded-xl bg-blue-500/10 text-blue-600 dark:bg-blue-400/15 dark:text-blue-400">
              <IconSettings />
            </span>
            <div>
              <h2 id="app-settings-title" className="text-base font-semibold tracking-tight">
                {t('settings.title')}
              </h2>
              <p className="mt-0.5 text-xs text-neutral-500 dark:text-neutral-400">
                {t('settings.subtitle')}
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="flex size-8 items-center justify-center rounded-full text-neutral-500 dark:text-neutral-400 transition hover:bg-black/5 hover:text-neutral-700 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue-500 dark:hover:bg-white/10 dark:hover:text-neutral-200"
            aria-label={t('settings.close')}
          >
            ✕
          </button>
        </header>

        <div className="space-y-5 overflow-y-auto overscroll-contain p-6">
          <SettingSection
            icon={<IconMonitor />}
            title={t('settings.appearance')}
            description={t('settings.appearanceHint')}
          >
            <div className="mt-4 grid grid-cols-3 gap-2 rounded-2xl bg-black/[0.055] p-1.5 dark:bg-white/[0.055]">
              {[
                { id: 'auto' as const, label: t('settings.theme.auto'), icon: <IconMonitor /> },
                { id: 'light' as const, label: t('settings.theme.light'), icon: <IconSun /> },
                { id: 'dark' as const, label: t('settings.theme.dark'), icon: <IconMoon /> },
              ].map((option) => (
                <button
                  key={option.id}
                  type="button"
                  onClick={() => void save({ themeMode: option.id })}
                  className={`flex items-center justify-center gap-1.5 rounded-xl py-2 text-[11px] font-medium transition focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue-500 ${
                    themeMode === option.id
                      ? 'bg-blue-500/12 text-blue-700 ring-1 ring-inset ring-blue-500/35 dark:bg-[#303033] dark:text-white dark:ring-0'
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
            icon={<IconGlobe />}
            title={t('settings.language')}
            description={t('settings.languageHint')}
          >
            <div className="mt-4 grid grid-cols-3 gap-2 rounded-2xl bg-black/[0.055] p-1.5 dark:bg-white/[0.055]">
              {LANGUAGE_OPTIONS.map((option) => (
                <button
                  key={option}
                  type="button"
                  onClick={() => void save({ language: option })}
                  className={`rounded-xl py-2 text-[11px] font-medium transition focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue-500 ${
                    languagePreference === option
                      ? 'bg-blue-500/12 text-blue-700 ring-1 ring-inset ring-blue-500/35 dark:bg-[#303033] dark:text-white dark:ring-0'
                      : 'text-neutral-500 hover:text-neutral-900 dark:text-neutral-400 dark:hover:text-white'
                  }`}
                  aria-pressed={languagePreference === option}
                >
                  {t(`settings.language.${option}`)}
                </button>
              ))}
            </div>
          </SettingSection>

          <SettingSection
            icon={<IconPlay />}
            title={t('settings.pacerDefaults')}
            description={t('settings.pacerDefaultsHint')}
          >
            <div className="mt-4 grid gap-3 sm:grid-cols-2">
              <PacerProfileEditor
                key={`latin-${pacerWpm}`}
                title={t('settings.pacerLatin')}
                caption={t('settings.pacerLatinCaption')}
                speed={pacerWpm}
                unit={t('pacer.unitLatin')}
                chunkSize={pacerChunkSize}
                chunkUnit="latin"
                t={t}
                chunkOptions={[1, 2, 3, 4, 5]}
                onSpeedCommit={(value) => void save({ pacerWpm: value })}
                onChunkChange={(value) => {
                  const nextWpm = value === 1 && pacerWpm > 600 ? 600 : pacerWpm
                  void save({ pacerChunkSize: value, pacerWpm: nextWpm })
                }}
              />
              <PacerProfileEditor
                key={`cjk-${pacerCpm}`}
                title={t('settings.pacerCjk')}
                caption={t('settings.pacerCjkCaption')}
                speed={pacerCpm}
                unit={t('pacer.unitCjkShort')}
                chunkSize={pacerCjkCharCount}
                chunkUnit="cjk"
                t={t}
                chunkOptions={[2, 4, 6, 8, 10]}
                onSpeedCommit={(value) => void save({ pacerCpm: value })}
                onChunkChange={(value) => void save({ pacerCjkCharCount: value })}
              />
            </div>
            <div className="mt-3 flex items-center justify-between gap-4 border-t border-black/[0.08] pt-3 text-[10px] text-neutral-500 dark:text-neutral-400 dark:border-white/[0.06]">
              <span>{t('settings.pacerRecommended')}</span>
              <button
                type="button"
                onClick={() => void save({
                  pacerWpm: 250,
                  pacerCpm: 300,
                  pacerChunkSize: 3,
                  pacerCjkCharCount: 4,
                })}
                className="shrink-0 rounded-lg px-2 py-1 font-medium text-blue-600 transition hover:bg-blue-500/10 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue-500 dark:text-blue-400"
              >
                {t('settings.pacerRestore')}
              </button>
            </div>
          </SettingSection>

          <SettingSection
            icon={<IconHighlight />}
            title={t('settings.highlight')}
            description={t('settings.highlightHint')}
          >
            <HighlightStyleEditor
              style={highlight}
              isDark={previewDark}
              onChange={(changes) => void save(changes)}
              t={t}
            />
          </SettingSection>

          <SettingSection
            icon={<IconKeyboard />}
            title={t('settings.controls')}
            description={t('settings.controlsHint')}
          >
            <label className="mt-4 flex cursor-pointer items-start justify-between gap-4 rounded-2xl border border-black/[0.06] bg-black/[0.02] p-3 dark:border-white/[0.07] dark:bg-white/[0.025]">
              <span>
                <span className="block text-[11px] font-medium text-neutral-800 dark:text-neutral-200">
                  {t('settings.clickToPosition')}
                </span>
                <span className="mt-0.5 block text-[10px] leading-relaxed text-neutral-500 dark:text-neutral-400">
                  {t('settings.clickToPositionHint')}
                </span>
              </span>
              <input
                type="checkbox"
                checked={clickToPosition}
                onChange={(event) => void save({ clickToPositionPacer: event.target.checked })}
                className="mt-0.5 size-4 shrink-0 cursor-pointer rounded-md accent-blue-600"
              />
            </label>

            {/* Everything the reader responds to that nothing on screen
                announces. Kept here rather than as a hint that appears once and
                is gone: the question "what can this thing do" comes back. */}
            <dl className="mt-3 space-y-1.5 rounded-2xl border border-black/[0.06] bg-black/[0.02] p-3 dark:border-white/[0.07] dark:bg-white/[0.025]">
              {SHORTCUT_KEYS.map(([keys, description]) => (
                <ShortcutRow key={keys} trigger={keys} mono description={t(description)} />
              ))}
              <div className="!mt-2.5 border-t border-black/[0.06] pt-2.5 dark:border-white/[0.07]" />
              {SHORTCUT_GESTURES.map(([trigger, description]) => (
                <ShortcutRow key={trigger} trigger={t(trigger)} description={t(description)} />
              ))}
            </dl>
          </SettingSection>

          <SettingSection
            icon={<IconClock />}
            title={t('settings.goal')}
            description={t('settings.goalHint')}
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
                      : 'border-black/[0.10] bg-white/60 text-neutral-600 hover:border-black/15 dark:border-white/[0.07] dark:bg-white/[0.03] dark:text-neutral-300 dark:hover:border-white/15'
                  }`}
                  aria-pressed={dailyGoal === minutes}
                >
                  {t('settings.goalPreset', { n: minutes })}
                </button>
              ))}
            </div>

            <DailyGoalInput
              key={dailyGoal}
              value={dailyGoal}
              isPreset={GOAL_OPTIONS.includes(dailyGoal)}
              onCommit={(minutes) => void save({ dailyReadingGoalMinutes: minutes })}
              t={t}
            />
          </SettingSection>

          {error && (
            <p aria-live="polite" className="rounded-xl border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-700 dark:border-red-900/60 dark:bg-red-950/40 dark:text-red-300">
              {t(error)}
            </p>
          )}
        </div>
      </section>
    </div>
  )
}

/**
 * Free-form goal, alongside the presets rather than replacing them: the presets
 * stay the one-tap path, and this covers the person who wants 25 or 90.
 * Remounted by key when the value changes elsewhere, matching how the pacer
 * editors below keep their draft in sync.
 */
function DailyGoalInput({
  value,
  isPreset,
  onCommit,
  t,
}: {
  value: number
  isPreset: boolean
  onCommit: (minutes: number) => void
  t: Translate
}) {
  const [draft, setDraft] = useState(String(value))

  const commit = () => {
    const parsed = Number(draft)
    const next = Number.isFinite(parsed)
      ? Math.max(GOAL_MIN, Math.min(GOAL_MAX, Math.round(parsed)))
      : value
    setDraft(String(next))
    if (next !== value) onCommit(next)
  }

  return (
    <div className="mt-2.5 flex items-center justify-between gap-3 border-t border-black/[0.08] pt-2.5 dark:border-white/[0.06]">
      <span className="text-[10px] text-neutral-500 dark:text-neutral-400">
        {t('settings.goalCustomHint', { min: GOAL_MIN, max: GOAL_MAX })}
      </span>
      <label
        className={`flex items-center gap-1 rounded-lg border px-2 py-1 transition focus-within:border-blue-500 focus-within:ring-2 focus-within:ring-blue-500/20 ${
          isPreset
            ? 'border-black/[0.11] bg-white/70 dark:border-white/[0.08] dark:bg-black/15'
            : 'border-blue-500/70 bg-blue-500/10'
        }`}
      >
        <span className="sr-only">{t('settings.goalCustomLabel')}</span>
        <input
          type="number"
          min={GOAL_MIN}
          max={GOAL_MAX}
          step={5}
          name="daily-reading-goal"
          autoComplete="off"
          inputMode="numeric"
          value={draft}
          onChange={(event) => setDraft(event.target.value)}
          onBlur={commit}
          onKeyDown={(event) => {
            if (event.key === 'Enter') event.currentTarget.blur()
          }}
          className={`w-12 bg-transparent text-right font-mono text-[11px] font-bold outline-none ${
            isPreset ? '' : 'text-blue-600 dark:text-blue-400'
          }`}
        />
        <span className="text-[9px] font-medium text-neutral-500 dark:text-neutral-400">{t('settings.minutes')}</span>
      </label>
    </div>
  )
}

function PacerProfileEditor({
  title,
  caption,
  speed,
  unit,
  chunkSize,
  chunkUnit,
  chunkOptions,
  onSpeedCommit,
  onChunkChange,
  t,
}: {
  title: string
  caption: string
  speed: number
  unit: string
  chunkSize: number
  /** Which profile this editor drives, not a display string. */
  chunkUnit: 'latin' | 'cjk'
  chunkOptions: number[]
  onSpeedCommit: (value: number) => void
  onChunkChange: (value: number) => void
  t: Translate
}) {
  const [draft, setDraft] = useState(String(speed))
  const maxSpeed = chunkUnit === 'latin' && chunkSize === 1 ? 600 : 1000

  const commit = () => {
    const parsed = Number(draft)
    const next = Number.isFinite(parsed)
      ? Math.max(100, Math.min(maxSpeed, Math.round(parsed / 10) * 10))
      : speed
    setDraft(String(next))
    if (next !== speed) onSpeedCommit(next)
  }

  return (
    <div className="rounded-2xl border border-black/[0.10] bg-black/[0.03] p-3.5 dark:border-white/[0.07] dark:bg-white/[0.025]">
      <div className="flex items-start justify-between gap-2">
        <div>
          <h4 className="text-[11px] font-semibold text-neutral-800 dark:text-neutral-200">{title}</h4>
          <p className="mt-0.5 text-[9px] text-neutral-500 dark:text-neutral-400">{caption}</p>
        </div>
        <label className="flex items-center gap-1 rounded-lg border border-black/[0.11] bg-white/70 px-2 py-1 focus-within:border-blue-500 focus-within:ring-2 focus-within:ring-blue-500/20 dark:border-white/[0.08] dark:bg-black/15">
          <span className="sr-only">{t('settings.pacerSpeedLabel', { profile: title })}</span>
          <input
            type="number"
            min={100}
            max={maxSpeed}
            step={10}
            name={`${chunkUnit}-pacer-speed`}
            autoComplete="off"
            inputMode="numeric"
            value={draft}
            onChange={(event) => setDraft(event.target.value)}
            onBlur={commit}
            onKeyDown={(event) => {
              if (event.key === 'Enter') event.currentTarget.blur()
            }}
            className="w-12 bg-transparent text-right font-mono text-[11px] font-bold outline-none"
          />
          <span className="text-[8px] font-medium text-neutral-500 dark:text-neutral-400">{unit}</span>
        </label>
      </div>
      <div className="mt-3 flex items-center justify-between gap-2">
        <span className="text-[9px] font-medium text-neutral-500 dark:text-neutral-400">{t('settings.pacerChunk')}</span>
        <div className="flex rounded-lg bg-black/[0.06] p-0.5 dark:bg-white/[0.06]">
          {chunkOptions.map((option) => (
            <button
              key={option}
              type="button"
              onClick={() => onChunkChange(option)}
              className={`rounded-md px-1.5 py-1 text-[9px] font-medium transition focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-blue-500 ${
                chunkSize === option
                  ? 'bg-blue-500/12 text-blue-700 ring-1 ring-inset ring-blue-500/35 dark:bg-[#303033] dark:text-white dark:ring-0'
                  : 'text-neutral-500 hover:text-neutral-900 dark:text-neutral-400 dark:hover:text-white'
              }`}
              aria-pressed={chunkSize === option}
            >
              {t(chunkUnit === 'latin' ? 'pacer.chunkUnitLatin' : 'pacer.chunkUnitCjk', {
                n: option,
              })}
            </button>
          ))}
        </div>
      </div>
    </div>
  )
}

/**
 * The highlight is the one piece of chrome that sits on top of the words for
 * minutes at a time, so it gets a live sample rather than three abstract
 * controls: what "22%" means depends entirely on the colour next to it.
 */
function HighlightStyleEditor({
  style,
  isDark,
  onChange,
  t,
}: {
  style: PacerHighlightStyle
  isDark: boolean
  onChange: (changes: Partial<AppSettings>) => void
  t: Translate
}) {
  const resolved = resolveOverlayStyle(style, PREVIEW_ACCENT, isDark)
  const customHex = style.color === AUTO_HIGHLIGHT_COLOR ? PREVIEW_ACCENT : style.color
  const isCustom =
    style.color !== AUTO_HIGHLIGHT_COLOR &&
    !PACER_HIGHLIGHT_SWATCHES.some((swatch) => swatch.hex === style.color)

  const shapes: { id: PacerHighlightShape; label: string }[] = [
    { id: 'block', label: t('settings.highlight.shapeBlock') },
    { id: 'block-underline', label: t('settings.highlight.shapeBlockUnderline') },
    { id: 'underline', label: t('settings.highlight.shapeUnderline') },
  ]

  return (
    <div className="mt-4 space-y-3.5">
      <div className="flex items-center justify-between gap-3">
        <span className="text-[10px] font-semibold uppercase tracking-wider text-neutral-500 dark:text-neutral-400">
          {t('settings.highlight.color')}
        </span>
        <div className="flex items-center gap-1.5">
          {PACER_HIGHLIGHT_SWATCHES.map((swatch) => {
            const selected = style.color === (swatch.hex ?? AUTO_HIGHLIGHT_COLOR)
            const auto = swatch.hex === null
            return (
              <button
                key={swatch.id}
                type="button"
                onClick={() => onChange({ pacerHighlightColor: swatch.hex ?? AUTO_HIGHLIGHT_COLOR })}
                aria-pressed={selected}
                aria-label={
                  auto
                    ? t('settings.highlight.autoLabel')
                    : t('settings.highlight.swatchLabel', { hex: swatch.hex ?? '' })
                }
                title={auto ? t('settings.highlight.auto') : swatch.hex ?? ''}
                style={auto ? undefined : { backgroundColor: swatch.hex ?? undefined }}
                className={`size-5 rounded-full border transition focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue-500 ${
                  auto
                    ? 'border-dashed border-black/30 bg-gradient-to-br from-amber-400 via-sky-400 to-violet-500 dark:border-white/30'
                    : 'border-black/10 dark:border-white/15'
                } ${selected ? 'ring-2 ring-blue-500 ring-offset-2 ring-offset-white dark:ring-offset-[#1C1C1E]' : 'hover:scale-110'}`}
              />
            )
          })}
          <label
            title={t('settings.highlight.custom')}
            className={`flex size-5 cursor-pointer items-center justify-center overflow-hidden rounded-full border border-black/10 dark:border-white/15 ${
              isCustom ? 'ring-2 ring-blue-500 ring-offset-2 ring-offset-white dark:ring-offset-[#1C1C1E]' : ''
            }`}
            style={{ backgroundColor: customHex }}
          >
            <span className="sr-only">{t('settings.highlight.customLabel')}</span>
            <input
              type="color"
              value={customHex}
              onChange={(event) => onChange({ pacerHighlightColor: event.target.value })}
              className="size-8 cursor-pointer opacity-0"
            />
          </label>
        </div>
      </div>

      <div className="flex items-center justify-between gap-3">
        <span className="shrink-0 text-[10px] font-semibold uppercase tracking-wider text-neutral-500 dark:text-neutral-400">
          {t('settings.highlight.opacity')}
        </span>
        <div className="flex flex-1 items-center gap-2.5">
          <input
            type="range"
            min={MIN_HIGHLIGHT_OPACITY * 100}
            max={MAX_HIGHLIGHT_OPACITY * 100}
            step={1}
            value={Math.round(style.opacity * 100)}
            disabled={style.shape === 'underline'}
            onChange={(event) =>
              onChange({ pacerHighlightOpacity: Number(event.target.value) / 100 })
            }
            aria-label={t('settings.highlight.opacityLabel')}
            className="h-1.5 flex-1 cursor-pointer rounded-lg bg-black/10 accent-blue-600 disabled:opacity-40 dark:bg-white/10"
          />
          <span className="w-8 text-right font-mono text-[10px] text-neutral-500 dark:text-neutral-400">
            {Math.round(style.opacity * 100)}%
          </span>
        </div>
      </div>

      <div className="flex items-center justify-between gap-3">
        <span className="text-[10px] font-semibold uppercase tracking-wider text-neutral-500 dark:text-neutral-400">
          {t('settings.highlight.shape')}
        </span>
        <div className="flex rounded-xl bg-black/[0.06] p-1 dark:bg-white/[0.06]">
          {shapes.map((shape) => (
            <button
              key={shape.id}
              type="button"
              onClick={() => onChange({ pacerHighlightShape: shape.id })}
              aria-pressed={style.shape === shape.id}
              className={`rounded-lg px-2.5 py-1 text-[10px] font-medium transition focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-blue-500 ${
                style.shape === shape.id
                  ? 'bg-blue-500/12 text-blue-700 ring-1 ring-inset ring-blue-500/35 dark:bg-[#303033] dark:text-white dark:ring-0'
                  : 'text-neutral-500 hover:text-neutral-900 dark:text-neutral-400 dark:hover:text-white'
              }`}
            >
              {shape.label}
            </button>
          ))}
        </div>
      </div>

      <div
        className="rounded-2xl border border-black/[0.10] px-4 py-3.5 dark:border-white/[0.07]"
        style={{ backgroundColor: isDark ? '#16161A' : '#FBF8F1' }}
      >
        <p
          className="font-serif text-[13px] leading-loose"
          style={{ color: isDark ? '#D8D4CC' : '#2B2622' }}
        >
          <span>{t('settings.highlight.previewBefore')}</span>
          <span
            className="rounded-xs px-0.5"
            style={{
              backgroundColor: resolved.backgroundColor,
              borderBottom: resolved.underlineColor
                ? `2.5px solid ${resolved.underlineColor}`
                : undefined,
              mixBlendMode: resolved.mixBlendMode,
            }}
          >
            {t('settings.highlight.previewHighlighted')}
          </span>
          <span>{t('settings.highlight.previewAfter')}</span>
        </p>
      </div>
    </div>
  )
}

function ShortcutRow({
  trigger,
  description,
  mono = false,
}: {
  trigger: string
  description: string
  mono?: boolean
}) {
  return (
    <div className="flex items-baseline justify-between gap-4">
      <dt
        className={`shrink-0 text-[10px] text-neutral-500 dark:text-neutral-400 ${
          mono ? 'font-mono' : ''
        }`}
      >
        {trigger}
      </dt>
      <dd className="text-right text-[10px] leading-relaxed text-neutral-600 dark:text-neutral-300">
        {description}
      </dd>
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
    <section className="rounded-2xl border border-black/[0.10] bg-white/55 p-4 dark:border-white/[0.07] dark:bg-white/[0.025]">
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
