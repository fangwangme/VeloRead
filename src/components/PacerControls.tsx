import { Play, Pause } from 'lucide-react'
import { useSettingsStore } from '../lib/store'
import { cn } from '../lib/utils'

export function PacerControls() {
  const { wpm, isPacerPlaying, setWpm, setIsPacerPlaying } = useSettingsStore()

  return (
    <div className="flex items-center gap-4 bg-background/90 backdrop-blur border border-border px-4 py-2 rounded-full shadow-lg">
      <button
        onClick={() => setIsPacerPlaying(!isPacerPlaying)}
        className={cn(
          "w-10 h-10 rounded-full flex items-center justify-center transition-colors",
          isPacerPlaying ? "bg-primary text-primary-foreground" : "bg-secondary text-foreground hover:bg-secondary/80"
        )}
      >
        {isPacerPlaying ? <Pause className="w-5 h-5 fill-current" /> : <Play className="w-5 h-5 ml-1 fill-current" />}
      </button>

      <div className="flex flex-col gap-1 min-w-[120px]">
        <div className="flex justify-between text-xs font-medium text-muted-foreground">
          <span>Speed</span>
          <span>{wpm} WPM</span>
        </div>
        <input
          type="range"
          min="100"
          max="1000"
          step="10"
          value={wpm}
          onChange={(e) => setWpm(Number(e.target.value))}
          className="h-2 w-full cursor-pointer accent-primary bg-secondary rounded-full appearance-none"
        />
      </div>
    </div>
  )
}
