import { create } from 'zustand'
import { persist } from 'zustand/middleware'

interface VocabularyState {
  knownWords: Set<string>
  learningWords: Record<string, string> // word -> definition (simplified)
  
  // Actions
  markAsKnown: (word: string) => void
  markAsLearning: (word: string, definition?: string) => void
  isKnown: (word: string) => boolean
  isLearning: (word: string) => boolean
}

// Custom storage wrapper to handle Set serialization
const storage = {
  getItem: (name: string) => {
    const str = localStorage.getItem(name)
    if (!str) return null
    const existing = JSON.parse(str)
    return {
      ...existing,
      state: {
        ...existing.state,
        knownWords: new Set(existing.state.knownWords),
      },
    }
  },
  setItem: (name: string, value: any) => {
    const str = JSON.stringify({
      ...value,
      state: {
        ...value.state,
        knownWords: Array.from(value.state.knownWords),
      },
    })
    localStorage.setItem(name, str)
  },
  removeItem: (name: string) => localStorage.removeItem(name),
}

export const useVocabularyStore = create<VocabularyState>()(
  persist(
    (set, get) => ({
      knownWords: new Set(['the', 'and', 'to', 'of', 'a', 'in', 'is', 'that', 'for', 'it', 'as', 'was', 'with', 'on']), // Start with basic stop words
      learningWords: {},

      markAsKnown: (word) => set((state) => {
        const lower = word.toLowerCase()
        const newSet = new Set(state.knownWords)
        newSet.add(lower)
        // Remove from learning if exists
        const newLearning = { ...state.learningWords }
        delete newLearning[lower]
        return { knownWords: newSet, learningWords: newLearning }
      }),

      markAsLearning: (word, definition = '') => set((state) => {
        const lower = word.toLowerCase()
        return {
            learningWords: { ...state.learningWords, [lower]: definition }
        }
      }),

      isKnown: (word) => get().knownWords.has(word.toLowerCase()),
      isLearning: (word) => word.toLowerCase() in get().learningWords,
    }),
    {
      name: 'veloread-vocab',
      storage,
    }
  )
)
