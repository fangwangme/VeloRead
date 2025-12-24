import { useState } from 'react'
import { createPortal } from 'react-dom'
import { Settings } from 'lucide-react'
import { useSettingsStore, type FontFamily } from '../lib/store'
import { cn } from '../lib/utils'

export function ReaderSettings() {
  const [isOpen, setIsOpen] = useState(false)
  const { 
    fontSize, fontFamily, lineHeight, wordSpacing, hyphens, wpm, vocabEnabled, spreadMode, pacerChunkSize,
    setFontSize, setFontFamily, setLineHeight, setWordSpacing, setHyphens, setWpm, setVocabEnabled, setSpreadMode, setPacerChunkSize 
  } = useSettingsStore()


  const fonts: { id: FontFamily; label: string; style: string }[] = [
    { id: 'serif', label: 'Serif', style: 'font-serif' },
    { id: 'sans', label: 'Sans', style: 'font-sans' },
    { id: 'mono', label: 'Mono', style: 'font-mono' },
  ]

  return (
    <>
      {/* Trigger Button */}
      <button
        onClick={() => setIsOpen(true)}
        className="p-2 rounded-xl hover:bg-secondary/80 transition-colors"
        aria-label="Settings"
      >
        <Settings className="w-5 h-5 text-foreground/60" />
      </button>

      {/* Settings Panel Overlay - Portaled to body to escape stacking context */}
      {isOpen && createPortal(
        <div className="fixed inset-0 z-[9999] flex items-start justify-end p-4">
          {/* Backdrop */}
          <div 
            className="absolute inset-0 bg-black/10 backdrop-blur-[2px]"
            onClick={() => setIsOpen(false)}
          />
          
          {/* Panel */}
          <div className="relative w-full max-w-[280px] bg-background/95 backdrop-blur-xl rounded-[20px] shadow-[0_20px_50px_rgba(0,0,0,0.3)] border border-white/10 overflow-hidden animate-in fade-in zoom-in-95 duration-200">
            {/* Header */}
            <div className="flex items-center justify-between px-6 py-4 border-b border-border/50">
              <span className="font-semibold text-[17px]">Reading Settings</span>
              <button 
                onClick={() => setIsOpen(false)}
                className="p-1 px-3 py-1 rounded-full bg-secondary hover:bg-secondary/80 text-xs font-semibold transition-colors"
              >
                Done
              </button>
            </div>

            <div className="p-4 space-y-4 max-h-[70vh] overflow-y-auto">
              {/* Font Size Selector Block */}
              <div className="bg-secondary/40 rounded-[24px] border border-border/40 overflow-hidden">
                <div className="flex items-center justify-between p-2">
                  <button
                    onClick={() => setFontSize(Math.max(50, fontSize - 10))}
                    className="w-12 h-12 flex items-center justify-center rounded-2xl hover:bg-background/80 transition-all text-sm font-medium"
                  >
                    <span style={{ fontSize: '12px' }}>A</span>
                  </button>
                  <div className="text-[14px] font-bold tabular-nums opacity-60">
                    {fontSize}%
                  </div>
                  <button
                    onClick={() => setFontSize(Math.min(200, fontSize + 10))}
                    className="w-12 h-12 flex items-center justify-center rounded-2xl hover:bg-background/80 transition-all text-sm font-medium"
                  >
                    <span style={{ fontSize: '18px' }}>A</span>
                  </button>
                </div>
              </div>

              {/* Font Family Selector - Pill style */}
              <div className="space-y-3">
                <div className="flex gap-1 p-1 bg-secondary/50 rounded-xl border border-border/50">
                  {fonts.map(f => (
                    <button
                      key={f.id}
                      onClick={() => setFontFamily(f.id)}
                      className={cn(
                        "flex-1 py-2 rounded-lg text-[13px] font-semibold transition-all",
                        f.style,
                        fontFamily === f.id
                          ? "bg-background shadow-md text-foreground scale-[1.02]"
                          : "text-muted-foreground hover:text-foreground hover:bg-background/40"
                      )}
                    >
                      {f.label}
                    </button>
                  ))}
                </div>
              </div>

              {/* Pacing Speed (WPM) - Top level */}
              <div className="bg-primary/5 p-4 rounded-[24px] space-y-4 border border-primary/20">
                <div className="space-y-2">
                  <div className="flex items-center justify-between text-[10px] font-bold tracking-widest text-primary uppercase px-1">
                    <span>Focus Range</span>
                    <span className="tabular-nums bg-primary/10 px-2 py-0.5 rounded-full">{pacerChunkSize} {pacerChunkSize === 1 ? 'WORD' : 'WORDS'}</span>
                  </div>
                  <div className="flex gap-1 p-1 bg-background/50 rounded-xl border border-primary/10">
                    {[1, 3, 5].map(size => (
                      <button
                        key={size}
                        onClick={() => setPacerChunkSize(size)}
                        className={cn(
                          "flex-1 py-1.5 rounded-lg text-[11px] font-bold transition-all",
                          pacerChunkSize === size
                            ? "bg-primary text-primary-foreground shadow-sm"
                            : "text-primary/60 hover:text-primary hover:bg-primary/5"
                        )}
                      >
                        {size}
                      </button>
                    ))}
                  </div>
                </div>

                <div className="space-y-2">
                  <div className="flex items-center justify-between text-[10px] font-bold tracking-widest text-primary uppercase px-1">
                    <span>Pacing Speed</span>
                    <span className="tabular-nums bg-primary/10 px-2 py-0.5 rounded-full">{wpm} WPM</span>
                  </div>
                  <input
                    type="range"
                    min="100"
                    max="800"
                    step="10"
                    value={wpm}
                    onChange={(e) => setWpm(Number(e.target.value))}
                    className="w-full h-1 bg-primary/20 rounded-full appearance-none cursor-pointer accent-primary"
                  />
                </div>
              </div>

              {/* Custom Settings - Collapsible */}
              <details className="group">
                <summary className="flex items-center justify-between p-3 bg-secondary/30 rounded-2xl border border-border/30 cursor-pointer list-none">
                  <span className="text-[13px] font-semibold">Custom</span>
                  <span className="text-[10px] text-muted-foreground group-open:hidden">Layout, Spacing</span>
                  <span className="text-[10px] text-muted-foreground hidden group-open:inline">▲</span>
                </summary>
                <div className="mt-2 p-4 bg-secondary/20 rounded-2xl border border-border/20 space-y-4">
                  {/* Page Layout */}
                  <div className="space-y-2">
                    <span className="text-[10px] font-bold tracking-widest text-muted-foreground uppercase">Page Layout</span>
                    <div className="flex gap-1 p-1 bg-background/50 rounded-lg border border-border/30">
                      <button
                        onClick={() => setSpreadMode('none')}
                        className={cn(
                          "flex-1 py-1.5 rounded-md text-[11px] font-semibold transition-all",
                          spreadMode === 'none'
                            ? "bg-primary text-primary-foreground"
                            : "text-muted-foreground hover:text-foreground"
                        )}
                      >
                        Single
                      </button>
                      <button
                        onClick={() => setSpreadMode('auto')}
                        className={cn(
                          "flex-1 py-1.5 rounded-md text-[11px] font-semibold transition-all",
                          spreadMode === 'auto'
                            ? "bg-primary text-primary-foreground"
                            : "text-muted-foreground hover:text-foreground"
                        )}
                      >
                        Dual
                      </button>
                    </div>
                  </div>
                  
                  {/* Line Height */}
                  <div className="space-y-2">
                    <div className="flex items-center justify-between text-[10px] font-bold tracking-widest text-muted-foreground uppercase">
                      <span>Line Spacing</span>
                      <span className="tabular-nums bg-background/50 px-2 py-0.5 rounded-full">{lineHeight.toFixed(1)}</span>
                    </div>
                    <input
                      type="range"
                      min="1.0"
                      max="2.5"
                      step="0.1"
                      value={lineHeight}
                      onChange={(e) => setLineHeight(Number(e.target.value))}
                      className="w-full h-1 bg-border/50 rounded-full appearance-none cursor-pointer accent-primary"
                    />
                  </div>
                  
                  {/* Word Spacing */}
                  <div className="space-y-2">
                    <div className="flex items-center justify-between text-[10px] font-bold tracking-widest text-muted-foreground uppercase">
                      <span>Word Spacing</span>
                      <span className="tabular-nums bg-background/50 px-2 py-0.5 rounded-full">{wordSpacing}px</span>
                    </div>
                    <input
                      type="range"
                      min="-2"
                      max="10"
                      step="1"
                      value={wordSpacing}
                      onChange={(e) => setWordSpacing(Number(e.target.value))}
                      className="w-full h-1 bg-border/50 rounded-full appearance-none cursor-pointer accent-primary"
                    />
                  </div>
                  
                  {/* Hyphenation Toggle */}
                  <div className="flex items-center justify-between">
                    <span className="text-[10px] font-bold tracking-widest text-muted-foreground uppercase">Hyphenation</span>
                    <button
                      onClick={() => setHyphens(!hyphens)}
                      className={cn(
                        "relative w-9 h-5 rounded-full transition-colors",
                        hyphens ? "bg-primary" : "bg-border"
                      )}
                    >
                      <div className={cn(
                        "absolute top-0.5 w-4 h-4 bg-white rounded-full shadow-sm transition-transform",
                        hyphens ? "translate-x-[18px]" : "translate-x-0.5"
                      )} />
                    </button>
                  </div>
                </div>
              </details>

              {/* Vocabulary Toggle */}
              <div className="flex items-center justify-between p-4 bg-secondary/30 rounded-2xl border border-border/30">
                <div className="flex flex-col gap-0.5">
                  <span className="text-[13px] font-semibold">Vocabulary Helper</span>
                  <span className="text-[10px] text-muted-foreground">Annotate advanced words</span>
                </div>
                <button
                  onClick={() => setVocabEnabled(!vocabEnabled)}
                  className={cn(
                    "relative w-11 h-6 rounded-full transition-colors",
                    vocabEnabled ? "bg-primary" : "bg-border"
                  )}
                >
                  <div className={cn(
                    "absolute top-0.5 w-5 h-5 bg-white rounded-full shadow-sm transition-transform",
                    vocabEnabled ? "translate-x-[22px]" : "translate-x-0.5"
                  )} />
                </button>
              </div>

            </div>
          </div>
        </div>,
        document.body
      )}
    </>
  )
}
