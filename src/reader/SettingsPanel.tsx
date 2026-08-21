import type { StyleId, StyleOverride } from './styles/types'
import { PRESETS } from './styles/presets'
import {
  IconColumnsAuto,
  IconColumnSingle,
  IconColumnsDouble,
} from '../ui/icons'
import { useT } from '../i18n/useT'
import type { MessageKey } from '../i18n/types'

interface SettingsPanelProps {
  currentStyleId: StyleId
  overrides: StyleOverride
  flow: 'paginated' | 'scrolled-doc'
  isDark: boolean
  /**
   * The values actually in effect after the preset and the overrides are
   * resolved. The controls are relative steps, so without these the panel can
   * only report "+1", which says nothing about what the page will look like.
   */
  resolved: { fontSizePx: number; lineHeight: number; measureCh: number }
  onStyleSelect: (id: StyleId) => void
  onOverridesChange: (overrides: StyleOverride) => void
  onFlowChange: (flow: 'paginated' | 'scrolled-doc') => void
  onClose: () => void
}

const FONT_OPTIONS: { labelKey: MessageKey; value: string }[] = [
  { labelKey: 'fonts.original', value: 'original' },
  {
    labelKey: 'fonts.newYork',
    value:
      '-apple-system-ui-serif, "New York", "Iowan Old Style", "Charter", "Georgia", serif',
  },
  {
    labelKey: 'fonts.palatino',
    value:
      '"Palatino", "Palatino Linotype", "Iowan Old Style", -apple-system-ui-serif, serif',
  },
  {
    labelKey: 'fonts.charter',
    value: '"Charter", "Bitstream Charter", -apple-system-ui-serif, serif',
  },
  {
    labelKey: 'fonts.sfPro',
    value: '-apple-system, "SF Pro Text", "SF Pro", "Helvetica Neue", sans-serif',
  },
  {
    labelKey: 'fonts.songti',
    value: '-apple-system-ui-serif, "Songti SC", "STSong", "Noto Serif CJK SC", serif',
  },
]

export function SettingsPanel({
  currentStyleId,
  overrides,
  flow,
  isDark,
  resolved,
  onStyleSelect,
  onOverridesChange,
  onFlowChange,
  onClose,
}: SettingsPanelProps) {
  const t = useT()
  const currentFont = overrides.fontStack ?? 'original'
  const fontSizeStep = overrides.fontSizeStep ?? 0
  const lineHeightStep = overrides.lineHeightStep ?? 0
  const marginStep = overrides.marginStep ?? 0
  const bold = Boolean(overrides.bold)
  const justify = overrides.justify ?? (PRESETS[currentStyleId]?.body.align === 'justify')
  const currentSpread = overrides.spreadMode ?? 'auto'

  return (
    <div
      className="absolute right-6 top-16 z-50 w-88 rounded-3xl border border-black/[0.12] bg-white/95 p-5 shadow-[0_25px_60px_rgba(0,0,0,0.18),0_2px_8px_rgba(0,0,0,0.06)] backdrop-blur-2xl dark:border-white/[0.08] dark:bg-[#1C1C1E]/95 dark:text-neutral-100 vr-animate-pop"
    >
      {/* Header */}
      <div className="flex items-center justify-between pb-3.5 border-b border-black/[0.10] dark:border-white/[0.06]">
        <h3 className="text-[11px] font-semibold tracking-wider text-neutral-500 dark:text-neutral-400 uppercase">
          {t('typography.title')}
        </h3>
        <button
          type="button"
          onClick={onClose}
          className="flex h-6 w-6 items-center justify-center rounded-full text-neutral-500 dark:text-neutral-400 hover:bg-black/5 hover:text-neutral-700 dark:hover:bg-white/10 dark:hover:text-neutral-200 transition"
          aria-label={t('common.close')}
        >
          ✕
        </button>
      </div>

      <div className="mt-4 space-y-4 text-xs">
        {/* Columns / Spread Layout Toggle: Auto / Single / Double */}
        <div>
          <label className="mb-1.5 block text-[10px] font-semibold uppercase tracking-wider text-neutral-500 dark:text-neutral-400">
            {t('typography.spread')}
          </label>
          <div className="flex rounded-xl bg-black/[0.06] p-1 dark:bg-white/[0.06]">
            {[
              { id: 'auto' as const, label: t('typography.spread.auto'), icon: <IconColumnsAuto /> },
              { id: 'single' as const, label: t('typography.spread.single'), icon: <IconColumnSingle /> },
              { id: 'double' as const, label: t('typography.spread.double'), icon: <IconColumnsDouble /> },
            ].map((item) => (
              <button
                key={item.id}
                type="button"
                onClick={() => onOverridesChange({ ...overrides, spreadMode: item.id })}
                className={`flex-1 flex items-center justify-center gap-1.5 rounded-lg py-1.5 text-center transition text-[11px] font-medium ${
                  currentSpread === item.id
                    ? 'bg-white text-neutral-900 shadow-[0_1px_3px_rgba(0,0,0,0.1)] dark:bg-[#2C2C2E] dark:text-white font-semibold'
                    : 'text-neutral-500 hover:text-neutral-900 dark:text-neutral-400 dark:hover:text-white'
                }`}
              >
                <span className="opacity-75">{item.icon}</span>
                <span>{item.label}</span>
              </button>
            ))}
          </div>
        </div>

        {/* 6 Preset theme swatches with theme-aware preview palette */}
        <div>
          <label className="mb-2 block text-[10px] font-semibold uppercase tracking-wider text-neutral-500 dark:text-neutral-400">
            {t('typography.style')}
          </label>
          <div className="grid grid-cols-3 gap-2">
            {(Object.keys(PRESETS) as StyleId[]).map((id) => {
              const preset = PRESETS[id]
              const isSelected = currentStyleId === id
              const palette = isDark ? preset.darkPalette : preset.lightPalette
              return (
                <button
                  key={id}
                  type="button"
                  onClick={() => onStyleSelect(id)}
                  style={{
                    backgroundColor: palette.background,
                    color: palette.text,
                    borderColor: isSelected ? palette.accent : palette.rule,
                  }}
                  className={`relative flex flex-col items-center justify-center rounded-2xl border p-2.5 transition transform active:scale-95 ${
                    isSelected
                      ? 'ring-2 ring-blue-500/60 shadow-xs font-semibold'
                      : 'opacity-85 hover:opacity-100 hover:shadow-2xs'
                  }`}
                >
                  <span className="text-xs tracking-tight">{t(preset.nameKey)}</span>
                  <span className="mt-0.5 text-[10px] opacity-60 font-serif">Aa</span>
                  {isSelected && (
                    <span
                      className="absolute top-1.5 right-1.5 h-1.5 w-1.5 rounded-full"
                      style={{ backgroundColor: palette.accent }}
                    />
                  )}
                </button>
              )
            })}
          </div>
        </div>

        {/* Font Family selector */}
        <div>
          <label className="mb-1.5 block text-[10px] font-semibold uppercase tracking-wider text-neutral-500 dark:text-neutral-400">
            {t('typography.fontFamily')}
          </label>
          <div className="relative">
            <select
              value={currentFont}
              onChange={(e) => onOverridesChange({ ...overrides, fontStack: e.target.value })}
              className="w-full cursor-pointer appearance-none rounded-xl border border-black/[0.12] bg-black/[0.05] px-3.5 py-2 pr-8 text-xs text-neutral-800 transition focus-visible:border-blue-500 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue-500 dark:border-white/[0.08] dark:bg-white/[0.04] dark:text-neutral-200"
            >
              {FONT_OPTIONS.map((opt) => (
                <option key={opt.value} value={opt.value}>
                  {t(opt.labelKey)}
                </option>
              ))}
            </select>
            <span className="pointer-events-none absolute right-3 top-2.5 text-[9px] text-neutral-500 dark:text-neutral-400">
              ▼
            </span>
          </div>
        </div>

        {/* Font Size Steps: A- / A+ */}
        <div>
          <div className="mb-1.5 flex justify-between text-[10px] font-semibold uppercase tracking-wider text-neutral-500 dark:text-neutral-400">
            <span>{t('typography.fontSize')}</span>
            <span className="flex items-baseline gap-1.5 font-normal">
              <span className="font-mono text-xs font-semibold normal-case text-neutral-800 dark:text-neutral-200">
                {resolved.fontSizePx}px
              </span>
              <span className="font-mono text-[10px] normal-case text-neutral-500 dark:text-neutral-400">
                {fontSizeStep > 0
                  ? `+${fontSizeStep}`
                  : fontSizeStep === 0
                    ? t('typography.fontSizeStandard')
                    : fontSizeStep}
              </span>
            </span>
          </div>
          <div className="flex items-center rounded-xl bg-black/[0.06] p-1 dark:bg-white/[0.06]">
            <button
              type="button"
              disabled={fontSizeStep <= -3}
              onClick={() => onOverridesChange({ ...overrides, fontSizeStep: Math.max(-3, fontSizeStep - 1) })}
              className="flex-1 rounded-lg py-1.5 text-xs font-semibold text-neutral-700 dark:text-neutral-300 transition hover:bg-white dark:hover:bg-[#2C2C2E] disabled:opacity-30 active:scale-95"
            >
              A -
            </button>
            <div className="h-4 w-px bg-black/[0.10] dark:bg-white/[0.08]" />
            <button
              type="button"
              disabled={fontSizeStep >= 5}
              onClick={() => onOverridesChange({ ...overrides, fontSizeStep: Math.min(5, fontSizeStep + 1) })}
              className="flex-1 rounded-lg py-1.5 text-sm font-semibold text-neutral-700 dark:text-neutral-300 transition hover:bg-white dark:hover:bg-[#2C2C2E] disabled:opacity-30 active:scale-95"
            >
              A +
            </button>
          </div>
        </div>

        {/* Line Height & Margin Segmented Controls */}
        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="mb-1.5 flex items-baseline justify-between text-[10px] font-semibold uppercase tracking-wider text-neutral-500 dark:text-neutral-400">
              <span>{t('typography.lineHeight')}</span>
              <span className="font-mono text-neutral-600 normal-case dark:text-neutral-300">
                {resolved.lineHeight.toFixed(2)}
              </span>
            </label>
            <div className="flex rounded-xl bg-black/[0.06] p-1 dark:bg-white/[0.06]">
              {[
                { label: t('typography.lineHeight.tight'), step: -1 },
                { label: t('typography.lineHeight.normal'), step: 0 },
                { label: t('typography.lineHeight.loose'), step: 1 },
              ].map((item) => (
                <button
                  key={item.step}
                  type="button"
                  onClick={() => onOverridesChange({ ...overrides, lineHeightStep: item.step })}
                  className={`flex-1 rounded-lg py-1 text-center transition text-[11px] font-medium ${
                    lineHeightStep === item.step
                      ? 'bg-white text-neutral-900 shadow-[0_1px_3px_rgba(0,0,0,0.08)] dark:bg-[#2C2C2E] dark:text-white font-semibold'
                      : 'text-neutral-500 hover:text-neutral-900 dark:text-neutral-400 dark:hover:text-white'
                  }`}
                >
                  {item.label}
                </button>
              ))}
            </div>
          </div>

          <div>
            <label className="mb-1.5 flex items-baseline justify-between text-[10px] font-semibold uppercase tracking-wider text-neutral-500 dark:text-neutral-400">
              <span>{t('typography.margin')}</span>
              <span className="font-mono text-neutral-600 normal-case dark:text-neutral-300">
                {t('typography.measure', { n: resolved.measureCh })}
              </span>
            </label>
            <div className="flex rounded-xl bg-black/[0.06] p-1 dark:bg-white/[0.06]">
              {[
                { label: t('typography.margin.wide'), step: -1 },
                { label: t('typography.margin.normal'), step: 0 },
                { label: t('typography.margin.narrow'), step: 1 },
              ].map((item) => (
                <button
                  key={item.step}
                  type="button"
                  onClick={() => onOverridesChange({ ...overrides, marginStep: item.step })}
                  className={`flex-1 rounded-lg py-1 text-center transition text-[11px] font-medium ${
                    marginStep === item.step
                      ? 'bg-white text-neutral-900 shadow-[0_1px_3px_rgba(0,0,0,0.08)] dark:bg-[#2C2C2E] dark:text-white font-semibold'
                      : 'text-neutral-500 hover:text-neutral-900 dark:text-neutral-400 dark:hover:text-white'
                  }`}
                >
                  {item.label}
                </button>
              ))}
            </div>
          </div>
        </div>

        {/* Toggles */}
        <div className="space-y-2.5 pt-3 border-t border-black/[0.10] dark:border-white/[0.06]">
          <label className="flex items-center justify-between cursor-pointer py-0.5 group">
            <span className="text-neutral-700 dark:text-neutral-300 text-xs font-medium group-hover:text-neutral-900 dark:group-hover:text-white transition">
              {t('typography.justify')}
            </span>
            <input
              type="checkbox"
              checked={justify}
              onChange={(e) => onOverridesChange({ ...overrides, justify: e.target.checked })}
              className="h-4 w-4 rounded-md accent-blue-600 cursor-pointer"
            />
          </label>

          <label className="flex items-center justify-between cursor-pointer py-0.5 group">
            <span className="text-neutral-700 dark:text-neutral-300 text-xs font-medium group-hover:text-neutral-900 dark:group-hover:text-white transition">
              {t('typography.bold')}
            </span>
            <input
              type="checkbox"
              checked={bold}
              onChange={(e) => onOverridesChange({ ...overrides, bold: e.target.checked })}
              className="h-4 w-4 rounded-md accent-blue-600 cursor-pointer"
            />
          </label>

          <label className="flex items-center justify-between cursor-pointer py-0.5 group">
            <span className="text-neutral-700 dark:text-neutral-300 text-xs font-medium group-hover:text-neutral-900 dark:group-hover:text-white transition">
              {t('typography.scrolled')}
            </span>
            <input
              type="checkbox"
              checked={flow === 'scrolled-doc'}
              onChange={(e) => onFlowChange(e.target.checked ? 'scrolled-doc' : 'paginated')}
              className="h-4 w-4 rounded-md accent-blue-600 cursor-pointer"
            />
          </label>
        </div>
      </div>
    </div>
  )
}
