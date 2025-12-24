// Dictionary service - lazy loads the dictionary JSON
let dictionary: Record<string, string> | null = null
let loadPromise: Promise<void> | null = null

async function loadDictionary(): Promise<void> {
  if (dictionary) return
  if (loadPromise) return loadPromise
  
  loadPromise = (async () => {
    try {
      const response = await fetch('/dictionary.json')
      if (response.ok) {
        dictionary = await response.json()
      } else {
        console.warn('Failed to load dictionary')
        dictionary = {}
      }
    } catch (e) {
      console.warn('Dictionary load error:', e)
      dictionary = {}
    }
  })()
  
  return loadPromise
}

// Pre-load dictionary on module import
loadDictionary()

export function lookupWord(word: string): string | null {
  if (!dictionary) return null
  
  const lower = word.toLowerCase()
  const definition = dictionary[lower]
  
  if (!definition) return null
  
  // Truncate long definitions for display
  if (definition.length > 100) {
    return definition.slice(0, 100) + '...'
  }
  return definition
}

export function isDictionaryLoaded(): boolean {
  return dictionary !== null
}

export { loadDictionary }
