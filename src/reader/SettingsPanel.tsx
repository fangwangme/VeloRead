import type { StyleId, StyleOverride } from './styles/types'
import { PRESETS } from './styles/presets'

interface SettingsPanelProps {
  currentStyleId: StyleId
  overrides: StyleOverride
  flow: 'paginated' | 'scrolled-doc'
  autoNightMode: boolean
  onStyleSelect: (id: StyleId) => void
  onOverridesChange: (overrides: StyleOverride) => void
  onFlowChange: (flow: 'paginated' | 'scrolled-doc') => void
  onAutoNightModeChange: (enabled: boolean) => void
  onClose: () => void
}

const FONT_OPTIONS = [
  { label: '跟随书籍原字体', value: 'original' },
  { label: 'Georgia (衬线)', value: "'Georgia', 'Iowan Old Style', 'Charter', serif" },
  { label: 'Palatino (典雅)', value: "'Palatino', 'Palatino Linotype', 'Iowan Old Style', 'Georgia', serif" },
  { label: 'Charter (报刊)', value: "'Charter', 'Bitstream Charter', 'Georgia', serif" },
  { label: '系统无衬线 (现代)', value: "-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif" },
  { label: '中文宋体 (标准)', value: "'Georgia', 'Songti SC', 'STSong', 'Noto Serif CJK SC', serif" },
]

export function SettingsPanel({
  currentStyleId,
  overrides,
  flow,
  autoNightMode,
  onStyleSelect,
  onOverridesChange,
  onFlowChange,
  onAutoNightModeChange,
  onClose,
}: SettingsPanelProps) {
  const currentFont = overrides.fontStack ?? 'original'
  const fontSizeStep = overrides.fontSizeStep ?? 0
  const lineHeightStep = overrides.lineHeightStep ?? 0
  const marginStep = overrides.marginStep ?? 0
  const bold = Boolean(overrides.bold)
  const justify = overrides.justify ?? (PRESETS[currentStyleId].body.align === 'justify')

  return (
    <div className="absolute right-6 top-16 z-50 w-80 rounded-2xl border border-neutral-200 bg-white/95 p-5 shadow-2xl backdrop-blur-md dark:border-neutral-800 dark:bg-neutral-900/95 dark:text-neutral-100">
      <div className="flex items-center justify-between pb-3 border-b border-neutral-100 dark:border-neutral-800">
        <h3 className="text-sm font-semibold tracking-wide">排版与显示</h3>
        <button
          type="button"
          onClick={onClose}
          className="rounded-full p-1 text-neutral-400 hover:bg-neutral-100 hover:text-neutral-600 dark:hover:bg-neutral-800 dark:hover:text-neutral-200"
          aria-label="关闭"
        >
          ✕
        </button>
      </div>

      <div className="mt-4 space-y-5 text-xs">
        {/* 6 Preset styles */}
        <div>
          <label className="mb-2 block font-medium text-neutral-500 dark:text-neutral-400">风格主题</label>
          <div className="grid grid-cols-3 gap-2">
            {(Object.keys(PRESETS) as StyleId[]).map((id) => {
              const preset = PRESETS[id]
              const isSelected = currentStyleId === id
              return (
                <button
                  key={id}
                  type="button"
                  onClick={() => onStyleSelect(id)}
                  style={{
                    backgroundColor: preset.palette.background,
                    color: preset.palette.text,
                    borderColor: isSelected ? preset.palette.accent : preset.palette.rule,
                  }}
                  className={`flex flex-col items-center justify-center rounded-lg border-2 p-2.5 transition ${
                    isSelected ? 'ring-2 ring-blue-500/40 shadow-sm' : 'hover:opacity-90'
                  }`}
                >
                  <span className="text-xs font-semibold">{preset.name}</span>
                  <span className="mt-0.5 text-[10px] opacity-75">Aa</span>
                </button>
              )
            })}
          </div>
        </div>

        {/* Font Family */}
        <div>
          <label className="mb-1.5 block font-medium text-neutral-500 dark:text-neutral-400">字体</label>
          <select
            value={currentFont}
            onChange={(e) => onOverridesChange({ ...overrides, fontStack: e.target.value })}
            className="w-full rounded-lg border border-neutral-300 bg-neutral-50 px-3 py-2 text-xs text-neutral-800 transition focus:border-blue-500 focus:outline-none dark:border-neutral-700 dark:bg-neutral-800 dark:text-neutral-200"
          >
            {FONT_OPTIONS.map((opt) => (
              <option key={opt.value} value={opt.value}>
                {opt.label}
              </option>
            ))}
          </select>
        </div>

        {/* Font Size Steps: A- / A+ */}
        <div>
          <div className="mb-1.5 flex justify-between font-medium text-neutral-500 dark:text-neutral-400">
            <span>字号</span>
            <span className="text-neutral-700 dark:text-neutral-300">
              {fontSizeStep > 0 ? `+${fontSizeStep}` : fontSizeStep}
            </span>
          </div>
          <div className="flex items-center gap-2">
            <button
              type="button"
              disabled={fontSizeStep <= -3}
              onClick={() => onOverridesChange({ ...overrides, fontSizeStep: Math.max(-3, fontSizeStep - 1) })}
              className="flex-1 rounded-lg border border-neutral-300 py-1.5 font-medium transition hover:bg-neutral-100 disabled:opacity-40 dark:border-neutral-700 dark:hover:bg-neutral-800"
            >
              A-
            </button>
            <button
              type="button"
              disabled={fontSizeStep >= 5}
              onClick={() => onOverridesChange({ ...overrides, fontSizeStep: Math.min(5, fontSizeStep + 1) })}
              className="flex-1 rounded-lg border border-neutral-300 py-1.5 font-medium transition hover:bg-neutral-100 disabled:opacity-40 dark:border-neutral-700 dark:hover:bg-neutral-800"
            >
              A+
            </button>
          </div>
        </div>

        {/* Line Height & Margin Steps */}
        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="mb-1.5 block font-medium text-neutral-500 dark:text-neutral-400">行距</label>
            <div className="flex rounded-lg border border-neutral-300 dark:border-neutral-700 overflow-hidden">
              {[
                { label: '紧', step: -1 },
                { label: '中', step: 0 },
                { label: '松', step: 1 },
              ].map((item) => (
                <button
                  key={item.step}
                  type="button"
                  onClick={() => onOverridesChange({ ...overrides, lineHeightStep: item.step })}
                  className={`flex-1 py-1.5 text-center transition ${
                    lineHeightStep === item.step
                      ? 'bg-neutral-900 text-white dark:bg-neutral-100 dark:text-neutral-900 font-medium'
                      : 'hover:bg-neutral-100 dark:hover:bg-neutral-800'
                  }`}
                >
                  {item.label}
                </button>
              ))}
            </div>
          </div>

          <div>
            <label className="mb-1.5 block font-medium text-neutral-500 dark:text-neutral-400">版心 / 页边距</label>
            <div className="flex rounded-lg border border-neutral-300 dark:border-neutral-700 overflow-hidden">
              {[
                { label: '宽', step: -1 },
                { label: '中', step: 0 },
                { label: '窄', step: 1 },
              ].map((item) => (
                <button
                  key={item.step}
                  type="button"
                  onClick={() => onOverridesChange({ ...overrides, marginStep: item.step })}
                  className={`flex-1 py-1.5 text-center transition ${
                    marginStep === item.step
                      ? 'bg-neutral-900 text-white dark:bg-neutral-100 dark:text-neutral-900 font-medium'
                      : 'hover:bg-neutral-100 dark:hover:bg-neutral-800'
                  }`}
                >
                  {item.label}
                </button>
              ))}
            </div>
          </div>
        </div>

        {/* Toggles */}
        <div className="space-y-2.5 pt-2 border-t border-neutral-100 dark:border-neutral-800">
          <label className="flex items-center justify-between cursor-pointer">
            <span>两端对齐</span>
            <input
              type="checkbox"
              checked={justify}
              onChange={(e) => onOverridesChange({ ...overrides, justify: e.target.checked })}
              className="h-4 w-4 rounded accent-blue-600"
            />
          </label>

          <label className="flex items-center justify-between cursor-pointer">
            <span>粗体文本</span>
            <input
              type="checkbox"
              checked={bold}
              onChange={(e) => onOverridesChange({ ...overrides, bold: e.target.checked })}
              className="h-4 w-4 rounded accent-blue-600"
            />
          </label>

          <label className="flex items-center justify-between cursor-pointer">
            <span>自动夜间主题 (跟随系统)</span>
            <input
              type="checkbox"
              checked={autoNightMode}
              onChange={(e) => onAutoNightModeChange(e.target.checked)}
              className="h-4 w-4 rounded accent-blue-600"
            />
          </label>

          <label className="flex items-center justify-between cursor-pointer">
            <span>连续垂直滚动模式</span>
            <input
              type="checkbox"
              checked={flow === 'scrolled-doc'}
              onChange={(e) => onFlowChange(e.target.checked ? 'scrolled-doc' : 'paginated')}
              className="h-4 w-4 rounded accent-blue-600"
            />
          </label>
        </div>
      </div>
    </div>
  )
}
