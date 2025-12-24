import { useVocabularyStore } from './vocabularyStore'
import { lookupWord, isDictionaryLoaded } from './dictionary'

// Common words that should NOT be annotated (top 3000 English words would be ideal)
// This is a simplified list - in production, use a proper frequency list
const COMMON_WORDS = new Set([
  'the', 'be', 'to', 'of', 'and', 'a', 'in', 'that', 'have', 'i',
  'it', 'for', 'not', 'on', 'with', 'he', 'as', 'you', 'do', 'at',
  'this', 'but', 'his', 'by', 'from', 'they', 'we', 'say', 'her', 'she',
  'or', 'an', 'will', 'my', 'one', 'all', 'would', 'there', 'their', 'what',
  'so', 'up', 'out', 'if', 'about', 'who', 'get', 'which', 'go', 'me',
  'when', 'make', 'can', 'like', 'time', 'no', 'just', 'him', 'know', 'take',
  'people', 'into', 'year', 'your', 'good', 'some', 'could', 'them', 'see', 'other',
  'than', 'then', 'now', 'look', 'only', 'come', 'its', 'over', 'think', 'also',
  'back', 'after', 'use', 'two', 'how', 'our', 'work', 'first', 'well', 'way',
  'even', 'new', 'want', 'because', 'any', 'these', 'give', 'day', 'most', 'us',
  'is', 'are', 'was', 'were', 'been', 'being', 'has', 'had', 'having', 'does',
  'did', 'doing', 'said', 'says', 'saying', 'made', 'making', 'went', 'going', 'gone',
  'got', 'getting', 'came', 'coming', 'took', 'taking', 'taken', 'saw', 'seeing', 'seen',
  'life', 'life:', 'life.', 'life,', 'wife', 'wife.', 'wife,', 'man', 'men', 'woman', 'women',
  'child', 'children', 'world', 'world.', 'school', 'still', 'last', 'may', 'mean', 'keep',
  'student', 'group', 'country', 'problem', 'hand', 'part', 'place', 'case', 'week', 'company',
  'system', 'program', 'question', 'work', 'number', 'night', 'mr', 'mrs', 'home', 'water',
  'room', 'mother', 'area', 'money', 'story', 'point', 'government', 'face', 'head', 'hand',
  'eye', 'body', 'back', 'heart', 'life', 'love', 'loves', 'friend', 'friends'
])

// Check if a word is "advanced" (not in common words list)
function isAdvancedWord(word: string): boolean {
  const lower = word.toLowerCase()
  // Skip very short words
  if (lower.length < 4) return false
  // Skip common words
  if (COMMON_WORDS.has(lower)) return false
  return true
}

// Get word details for annotation
export function getWordDetails(word: string): string | null {
  const store = useVocabularyStore.getState()
  const lower = word.toLowerCase()
  
  // If user already knows it, don't annotate
  if (store.isKnown(lower)) return null
  
  // If user is actively learning it, show definition
  if (store.isLearning(lower)) {
    const userDef = store.learningWords[lower]
    if (userDef) return userDef
    // Try dictionary lookup
    return lookupWord(lower)
  }
  
  // Only annotate "advanced" words
  if (!isAdvancedWord(word)) return null
  
  // Look up in dictionary
  if (!isDictionaryLoaded()) return null
  
  return lookupWord(lower)
}

export function processTextNode(node: Node): DocumentFragment | null {
  const text = node.textContent
  if (!text || !text.trim()) return null
  
  // Split by word boundaries
  const words = text.split(/([a-zA-Z]+)/)
  
  let hasAnnotation = false
  const fragment = document.createDocumentFragment()
  
  words.forEach(part => {
    if (/^[a-zA-Z]+$/.test(part)) {
      const def = getWordDetails(part)
      if (def) {
        hasAnnotation = true
        // Create annotated element
        const ruby = document.createElement('ruby')
        ruby.className = 'vocab-word group relative inline-block cursor-help border-b border-dotted border-primary/50'
        ruby.innerText = part
        
        const rt = document.createElement('rt')
        rt.className = 'block absolute bottom-full left-1/2 -translate-x-1/2 mb-1 px-2 py-1 text-[10px] leading-tight text-white bg-black/80 rounded opacity-0 group-hover:opacity-100 transition-opacity whitespace-nowrap pointer-events-none z-10 w-max max-w-[200px]'
        rt.innerText = def
        
        ruby.appendChild(rt)
        ruby.dataset.word = part
        ruby.dataset.def = def
        
        fragment.appendChild(ruby)
      } else {
        fragment.appendChild(document.createTextNode(part))
      }
    } else {
      fragment.appendChild(document.createTextNode(part))
    }
  })
  
  return hasAnnotation ? fragment : null
}
