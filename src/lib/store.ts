import { create } from 'zustand'
import { persist } from 'zustand/middleware'

// Apple Books style themes for Reader
export type ReaderTheme = 'original' | 'quiet' | 'paper' | 'bold' | 'calm' | 'focus'
export type AppTheme = 'light' | 'dark' | 'system'
export type FontFamily = 'sans' | 'serif' | 'mono'
export type FlowMode = 'paginated' | 'scrolled'

interface SettingsState {
  appTheme: AppTheme
  readerTheme: ReaderTheme
  fontSize: number
  fontFamily: FontFamily
  lineHeight: number
  wordSpacing: number
  hyphens: boolean
  flowMode: FlowMode
  spreadMode: 'none' | 'auto'
  vocabEnabled: boolean

  // Pacer
  wpm: number
  isPacerPlaying: boolean
  pacerWordIndex: number
  pacerStartIndex: number
  pacerChunkSize: number
  pacerActionKey: number

  // Page Info (Not persisted)
  pageInfo: {
    current: number
    total: number
    chapterLeft: number
  } | null

  // Per-book persistence
  bookSettings: Record<string, any>

  // Actions
  setAppTheme: (theme: AppTheme) => void
  setReaderTheme: (theme: ReaderTheme) => void
  setFontSize: (size: number) => void
  setFontFamily: (font: FontFamily) => void
  setLineHeight: (height: number) => void
  setWordSpacing: (spacing: number) => void
  setHyphens: (enabled: boolean) => void
  setFlowMode: (mode: FlowMode) => void
  setSpreadMode: (mode: 'none' | 'auto') => void
  setVocabEnabled: (enabled: boolean) => void
  setWpm: (wpm: number) => void
  setIsPacerPlaying: (isPlaying: boolean) => void
  setPacerWordIndex: (index: number) => void
  setPacerStartIndex: (index: number) => void
  setPacerChunkSize: (size: number) => void
  setPacerActionKey: (key: number) => void
  setPageInfo: (info: { current: number, total: number, chapterLeft: number } | null) => void
  updateBookSettings: (bookKey: string, settings: any) => void
}

export const useSettingsStore = create<SettingsState>()(
  persist(
    (set) => ({
      appTheme: 'system',
      readerTheme: 'paper',
      fontSize: 100,
      fontFamily: 'serif',
      lineHeight: 1.6,
      wordSpacing: 0,
      hyphens: true,
      flowMode: 'paginated',
      spreadMode: 'none',
      vocabEnabled: true,
      wpm: 250,
      isPacerPlaying: false,
      pacerWordIndex: 0,
      pacerStartIndex: 0,
      pacerChunkSize: 3,
      pacerActionKey: 0,
      pageInfo: null,
      bookSettings: {},

      setAppTheme: (appTheme) => set({ appTheme }),
      setReaderTheme: (readerTheme) => set({ readerTheme }),
      setFontSize: (fontSize) => set({ fontSize }),
      setFontFamily: (fontFamily) => set({ fontFamily }),
      setLineHeight: (lineHeight) => set({ lineHeight }),
      setWordSpacing: (wordSpacing) => set({ wordSpacing }),
      setHyphens: (hyphens) => set({ hyphens }),
      setFlowMode: (flowMode) => set({ flowMode }),
      setSpreadMode: (spreadMode) => set({ spreadMode }),
      setVocabEnabled: (vocabEnabled) => set({ vocabEnabled }),
      setWpm: (wpm) => set({ wpm }),
      setIsPacerPlaying: (isPlaying) => set({ isPacerPlaying: isPlaying, pacerActionKey: Date.now() }),
      setPacerWordIndex: (index) => set({ pacerWordIndex: index }),
      setPacerStartIndex: (pacerStartIndex) => set({ pacerStartIndex }),
      setPacerChunkSize: (pacerChunkSize) => set({ pacerChunkSize }),
      setPacerActionKey: (pacerActionKey) => set({ pacerActionKey }),
      setPageInfo: (pageInfo) => set({ pageInfo }),
      updateBookSettings: (bookKey, settings) => set((state) => ({
        bookSettings: {
          ...state.bookSettings,
          [bookKey]: {
            ...state.bookSettings[bookKey],
            ...settings
          }
        }
      })),
    }),
    {
      name: 'veloread-settings',
      partialize: (state) => {
        const { pageInfo, ...rest } = state
        return rest
      },
    }
  )
)
