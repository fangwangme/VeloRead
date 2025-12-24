import { Library, BookOpen, Sun, Moon, Monitor } from 'lucide-react'
import { cn } from '../lib/utils'
import { useSettingsStore } from '../lib/store'

interface LayoutProps {
  children: React.ReactNode
  activeTab?: 'library' | 'vocabulary' | 'reader'
}

export function Layout({ children, activeTab = 'library' }: LayoutProps) {
  const { appTheme, setAppTheme } = useSettingsStore()
  
  return (
    <div className="flex min-h-screen bg-background text-foreground transition-colors duration-300">
      {/* Sidebar - Apple Inspired Minimalism */}
      <aside className={cn(
        "w-64 border-r border-border bg-card p-6 flex-col gap-10 transition-all duration-300",
        activeTab === 'reader' ? "hidden" : "hidden md:flex"
      )}>
        <div className="flex items-center gap-3 py-2">
          <BookOpen className="w-8 h-8 text-primary shadow-sm" />
          <h1 className="text-2xl font-bold font-serif tracking-tight text-foreground select-none">VeloRead</h1>
        </div>
        
        <nav className="flex flex-col gap-1 flex-1">
          <button 
            className={cn(
              "flex items-center gap-3 px-4 py-2.5 rounded-lg text-sm font-semibold transition-all group relative overflow-hidden",
              activeTab === 'library' 
                ? "text-primary bg-primary/5" 
                : "text-muted-foreground hover:text-foreground hover:bg-secondary/50"
            )}
          >
            {activeTab === 'library' && (
                <div className="absolute left-0 top-1/2 -translate-y-1/2 w-1 h-5 bg-primary rounded-r-full" />
            )}
            <Library className={cn(
                "w-4 h-4 transition-colors",
                activeTab === 'library' ? "text-primary" : "text-muted-foreground group-hover:text-foreground"
            )} />
            Library
          </button>
        </nav>

        <div className="pt-8 border-t border-border">
           <div className="flex flex-col gap-4">
              <span className="text-[10px] font-bold text-muted-foreground uppercase tracking-widest opacity-50 px-1">Appearance</span>
              <div className="flex p-1 bg-secondary/50 rounded-xl gap-1">
                 {(['light', 'dark', 'system'] as const).map((t) => (
                    <button
                        key={t}
                        onClick={() => setAppTheme(t)}
                        className={cn(
                            "flex-1 flex flex-col items-center gap-2 py-2.5 rounded-lg transition-all",
                            appTheme === t 
                                ? "bg-background text-primary shadow-sm" 
                                : "text-muted-foreground hover:text-foreground"
                        )}
                        title={t.charAt(0).toUpperCase() + t.slice(1)}
                    >
                        {t === 'light' && <Sun className="w-3.5 h-3.5" />}
                        {t === 'dark' && <Moon className="w-3.5 h-3.5" />}
                        {t === 'system' && <Monitor className="w-3.5 h-3.5" />}
                        <span className="text-[10px] font-bold uppercase tracking-tight">{t}</span>
                    </button>
                 ))}
              </div>
           </div>
        </div>
      </aside>

      {/* Main Content */}
      <main className="flex-1 flex flex-col">
        {/* Page Content */}
        <div className="flex-1 p-6 overflow-y-auto">
            {children}
        </div>
      </main>
    </div>
  )
}
