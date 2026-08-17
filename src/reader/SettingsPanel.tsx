import type { StyleId, StyleOverride } from './styles/types'
import { PRESETS } from './styles/presets'
import {
  IconColumnsAuto,
  IconColumnSingle,
  IconColumnsDouble,
  IconMonitor,
  IconMoon,
  IconSun,
} from '../ui/icons'

interface SettingsPanelProps {
  currentStyleId: StyleId
  overrides: StyleOverride
  flow: 'paginated' | 'scrolled-doc'
  themeMode: 'auto' | 'light' | 'dark'
  isDark: boolean
  onStyleSelect: (id: StyleId) => void
  onOverridesChange: (overrides: StyleOverride) => void
  onFlowChange: (flow: 'paginated' | 'scrolled-doc') => void
  onThemeModeChange: (mode: 'auto' | 'light' | 'dark') => void
  onClose: () => void
}

const FONT_OPTIONS = [
  { label: '书籍原字体 (Original)', value: 'original' },
  {
    label: 'New York (苹果经典衬线)',
    value:
      '-apple-system-ui-serif, "New York", "Iowan Old Style", "Charter", "Georgia", serif',
  },
  {
    label: 'Palatino (典雅精读)',
    value:
      '"Palatino", "Palatino Linotype", "Iowan Old Style", -apple-system-ui-serif, serif',
  },
  { label: 'Charter (报刊体)', value: '"Charter", "Bitstream Charter", -apple-system-ui-serif, serif' },
  { label: 'SF Pro (现代无衬线)', value: '-apple-system, "SF Pro Text", "SF Pro", "Helvetica Neue", sans-serif' },
  { label: '中文宋体 (标准阅读)', value: '-apple-system-ui-serif, "Songti SC", "STSong", "Noto Serif CJK SC", serif' },
]

export function SettingsPanel({
  currentStyleId,
  overrides,
  flow,
  themeMode,
  isDark,
  onStyleSelect,
  onOverridesChange,
  onFlowChange,
  onThemeModeChange,
  onClose,
}: SettingsPanelProps) {
  const currentFont = overrides.fontStack ?? 'original'
  const fontSizeStep = overrides.fontSizeStep ?? 0
  const lineHeightStep = overrides.lineHeightStep ?? 0
  const marginStep = overrides.marginStep ?? 0
  const bold = Boolean(overrides.bold)
  const justify = overrides.justify ?? (PRESETS[currentStyleId]?.body.align === 'justify')
  const currentSpread = overrides.spreadMode ?? 'auto'

  return (
    <div
      className="absolute right-6 top-16 z-50 w-88 rounded-3xl border border-black/[0.08] bg-white/95 p-5 shadow-[0_25px_60px_rgba(0,0,0,0.18),0_2px_8px_rgba(0,0,0,0.06)] backdrop-blur-2xl dark:border-white/[0.08] dark:bg-[#1C1C1E]/95 dark:text-neutral-100 animate-in fade-in zoom-in-95 duration-150"
    >
      {/* Header */}
      <div className="flex items-center justify-between pb-3.5 border-b border-black/[0.06] dark:border-white/[0.06]">
        <h3 className="text-[11px] font-semibold tracking-wider text-neutral-500 dark:text-neutral-400 uppercase">
          排版与主题设置
        </h3>
        <button
          type="button"
          onClick={onClose}
          className="flex h-6 w-6 items-center justify-center rounded-full text-neutral-400 hover:bg-black/5 hover:text-neutral-700 dark:hover:bg-white/10 dark:hover:text-neutral-200 transition"
          aria-label="关闭"
        >
          ✕
        </button>
      </div>

      <div className="mt-4 space-y-4 text-xs">
        {/* 3-way Appearance Mode Toggle: Auto / Light / Dark */}
        <div>
          <label className="mb-1.5 block text-[10px] font-semibold uppercase tracking-wider text-neutral-400 dark:text-neutral-500">
            外观模式
          </label>
          <div className="flex rounded-xl bg-black/[0.04] p-1 dark:bg-white/[0.06]">
            {[
              { id: 'auto' as const, label: '跟随系统', icon: <IconMonitor /> },
              { id: 'light' as const, label: '浅色', icon: <IconSun /> },
              { id: 'dark' as const, label: '深色', icon: <IconMoon /> },
            ].map((item) => (
              <button
                key={item.id}
                type="button"
                onClick={() => onThemeModeChange(item.id)}
                className={`flex-1 flex items-center justify-center gap-1.5 rounded-lg py-1.5 text-center transition text-[11px] font-medium ${
                  themeMode === item.id
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

        {/* Columns / Spread Layout Toggle: Auto / Single / Double */}
        <div>
          <label className="mb-1.5 block text-[10px] font-semibold uppercase tracking-wider text-neutral-400 dark:text-neutral-500">
            页面分栏
          </label>
          <div className="flex rounded-xl bg-black/[0.04] p-1 dark:bg-white/[0.06]">
            {[
              { id: 'auto' as const, label: '自适应', icon: <IconColumnsAuto /> },
              { id: 'single' as const, label: '单栏', icon: <IconColumnSingle /> },
              { id: 'double' as const, label: '双栏', icon: <IconColumnsDouble /> },
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
          <label className="mb-2 block text-[10px] font-semibold uppercase tracking-wider text-neutral-400 dark:text-neutral-500">
            排版风格
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
                  <span className="text-xs tracking-tight">{preset.name}</span>
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
          <label className="mb-1.5 block text-[10px] font-semibold uppercase tracking-wider text-neutral-400 dark:text-neutral-500">
            字体族
          </label>
          <div className="relative">
            <select
              value={currentFont}
              onChange={(e) => onOverridesChange({ ...overrides, fontStack: e.target.value })}
              className="w-full appearance-none rounded-xl border border-black/[0.08] bg-black/[0.03] px-3.5 py-2 text-xs text-neutral-800 transition focus:border-blue-500 focus:outline-none dark:border-white/[0.08] dark:bg-white/[0.04] dark:text-neutral-200 cursor-pointer pr-8"
            >
              {FONT_OPTIONS.map((opt) => (
                <option key={opt.value} value={opt.value}>
                  {opt.label}
                </option>
              ))}
            </select>
            <span className="pointer-events-none absolute right-3 top-2.5 text-[9px] text-neutral-400">
              ▼
            </span>
          </div>
        </div>

        {/* Font Size Steps: A- / A+ */}
        <div>
          <div className="mb-1.5 flex justify-between text-[10px] font-semibold uppercase tracking-wider text-neutral-400 dark:text-neutral-500">
            <span>字号大小</span>
            <span className="text-neutral-700 dark:text-neutral-300 font-mono lowercase font-normal">
              {fontSizeStep > 0 ? `+${fontSizeStep}` : fontSizeStep === 0 ? '标准' : fontSizeStep}
            </span>
          </div>
          <div className="flex items-center rounded-xl bg-black/[0.04] p-1 dark:bg-white/[0.06]">
            <button
              type="button"
              disabled={fontSizeStep <= -3}
              onClick={() => onOverridesChange({ ...overrides, fontSizeStep: Math.max(-3, fontSizeStep - 1) })}
              className="flex-1 rounded-lg py-1.5 text-xs font-semibold text-neutral-700 dark:text-neutral-300 transition hover:bg-white dark:hover:bg-[#2C2C2E] disabled:opacity-30 active:scale-95"
            >
              A -
            </button>
            <div className="h-4 w-px bg-black/[0.08] dark:bg-white/[0.08]" />
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
            <label className="mb-1.5 block text-[10px] font-semibold uppercase tracking-wider text-neutral-400 dark:text-neutral-500">
              行距
            </label>
            <div className="flex rounded-xl bg-black/[0.04] p-1 dark:bg-white/[0.06]">
              {[
                { label: '紧凑', step: -1 },
                { label: '适中', step: 0 },
                { label: '宽松', step: 1 },
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
            <label className="mb-1.5 block text-[10px] font-semibold uppercase tracking-wider text-neutral-400 dark:text-neutral-500">
              页边距
            </label>
            <div className="flex rounded-xl bg-black/[0.04] p-1 dark:bg-white/[0.06]">
              {[
                { label: '宽版', step: -1 },
                { label: '标准', step: 0 },
                { label: '紧凑', step: 1 },
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
        <div className="space-y-2.5 pt-3 border-t border-black/[0.06] dark:border-white/[0.06]">
          <label className="flex items-center justify-between cursor-pointer py-0.5 group">
            <span className="text-neutral-700 dark:text-neutral-300 text-xs font-medium group-hover:text-neutral-900 dark:group-hover:text-white transition">
              两端对齐排版
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
              字重加粗 (提高对比度)
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
              连续垂直滚动模式
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
