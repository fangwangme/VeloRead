import { useEffect, useState } from 'react'
import { db, type Book } from '../lib/db'
import { Reader } from '../components/Reader'
import { ReaderToolbar } from '../components/ReaderToolbar'
import { useSettingsStore } from '../lib/store'

interface ReaderPageProps {
  bookId: string
  onBack: () => void
}

export function ReaderPage({ bookId, onBack }: ReaderPageProps) {
  const [book, setBook] = useState<Book | null>(null)

  const { appTheme } = useSettingsStore()

  useEffect(() => {
    db.books.get(bookId).then(setBook)
  }, [bookId])

  // Use exact same logic as Reader.tsx for color consistency
  const isDarkMode = appTheme === 'dark' || (appTheme === 'system' && typeof window !== 'undefined' && window.matchMedia('(prefers-color-scheme: dark)').matches);
  const themeBg = isDarkMode ? '#1c1c1e' : '#ffffff';

  return (
    <div className="flex flex-col h-[100dvh] fixed inset-0 z-50 overflow-hidden font-sans transition-colors duration-500 group/reader" style={{ backgroundColor: themeBg }}>
        {/* Fixed Header - Always visible, takes up space */}
        <div className="flex-shrink-0 flex items-center justify-between py-3 px-6 backdrop-blur-sm border-b border-border/20" style={{ backgroundColor: themeBg }}>
            {/* Left: Title */}
            <div className="flex items-center gap-3 overflow-hidden max-w-[40%]">
                <span className="text-[13px] font-bold text-foreground/60 truncate">
                    {book?.title || 'Reading'}
                </span>
            </div>

            {/* Right: Controls */}
            <ReaderToolbar onClose={onBack} />
        </div>

        {/* Reader Content - Below header, no overlap */}
        <div className="flex-1 relative overflow-hidden" id="viewer-container">
            <Reader bookId={bookId} onClose={onBack} />
        </div>
    </div>
  )
}
