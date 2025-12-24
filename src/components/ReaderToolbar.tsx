import { X, Play, Pause, RotateCcw } from 'lucide-react'
import { ReaderSettings } from './ReaderSettings'
import { useSettingsStore } from '../lib/store'
import { useShallow } from 'zustand/react/shallow'
import { cn } from '../lib/utils'

interface ReaderToolbarProps {
  onClose: () => void
}

export function ReaderToolbar({ onClose }: ReaderToolbarProps) {
  const { isPacerPlaying, setIsPacerPlaying, setPacerWordIndex, setPacerActionKey, pageInfo, wpm } = useSettingsStore(
    useShallow(s => ({
      isPacerPlaying: s.isPacerPlaying,
      setIsPacerPlaying: s.setIsPacerPlaying,
      setPacerWordIndex: s.setPacerWordIndex,
      setPacerActionKey: s.setPacerActionKey,
      pageInfo: s.pageInfo,
      wpm: s.wpm
    }))
  )

  return (
    <div className="flex items-center gap-3">
      {/* Page Info - Always visible */}
      {pageInfo && (
        <div className="flex items-center gap-3 mr-4 text-[11px] font-bold text-foreground/30 tracking-wide">
          <span>{pageInfo.current} / {pageInfo.total}</span>
          <span>{pageInfo.chapterLeft} {pageInfo.chapterLeft === 1 ? 'PAGE' : 'PAGES'} LEFT</span>
        </div>
      )}

      {/* Pacer Controls - Always visible, Clean Design */}
      <div className="flex items-center gap-1.5 bg-secondary/50 rounded-xl p-1 pl-3">
          <span className={cn(
              "text-[11px] font-bold tracking-wide tabular-nums transition-colors mr-1.5",
              isPacerPlaying ? "text-primary" : "text-foreground/40"
          )}>
              {wpm} WPM
          </span>
          
          <button
            onClick={() => {
                setPacerWordIndex(0)
                setPacerActionKey(Date.now())
            }}
            className="p-2 rounded-lg text-foreground/40 hover:text-foreground hover:bg-background transition-all"
            title="Reset to page start"
          >
            <RotateCcw className="w-3.5 h-3.5" />
          </button>

          <button
            onClick={() => setIsPacerPlaying(!isPacerPlaying)}
            className={cn(
                "p-2 rounded-lg transition-all",
                isPacerPlaying 
                    ? "text-primary-foreground bg-primary shadow-sm" 
                    : "text-foreground/60 bg-background hover:bg-secondary"
            )}
            aria-label={isPacerPlaying ? "Pause pacer" : "Start pacer"}
          >
            {isPacerPlaying ? <Pause className="w-4 h-4" /> : <Play className="w-4 h-4 ml-0.5" />}
          </button>
      </div>

      {/* Settings Panel Trigger */}
      <ReaderSettings />
      
      {/* Unified Close/Back Button */}
      <button
        onClick={onClose}
        className="p-2 rounded-xl text-foreground/40 hover:text-destructive hover:bg-destructive/10 transition-all"
        aria-label="Exit to library"
      >
        <X className="w-5 h-5" />
      </button>
    </div>
  )
}
