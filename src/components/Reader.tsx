import { useEffect, useRef, useState } from 'react'
import ePub, { Book as EPubBook, Rendition } from 'epubjs'
import { db } from '../lib/db'
import { useSettingsStore } from '../lib/store'
import { useShallow } from 'zustand/react/shallow'
import { useVocabularyStore } from '../lib/vocabularyStore' // Import directly
import { processTextNode } from '../lib/vocabulary' // Import directly
import { usePacer } from '../lib/hooks/usePacer'
import { Loader2 } from 'lucide-react'

interface ReaderProps {
  bookId: string
  onRelocated?: (location: any) => void
  onClose?: () => void
}

export function Reader({ bookId, onRelocated, onClose }: ReaderProps) {
  const viewerRef = useRef<HTMLDivElement>(null)
  const renditionRef = useRef<Rendition | null>(null)
  const bookRef = useRef<EPubBook | null>(null)
  
  const [isReady, setIsReady] = useState(false)
  const [error, setError] = useState<string | null>(null)
  
  const { 
    fontSize, fontFamily, lineHeight, wordSpacing, hyphens, flowMode, spreadMode,
    setFontSize, setFontFamily, setLineHeight, setWordSpacing, setHyphens, setSpreadMode, updateBookSettings,
    setIsPacerPlaying, appTheme
  } = useSettingsStore(
    useShallow(s => ({
      fontSize: s.fontSize,
      fontFamily: s.fontFamily,
      lineHeight: s.lineHeight,
      wordSpacing: s.wordSpacing,
      hyphens: s.hyphens,
      flowMode: s.flowMode,
      spreadMode: s.spreadMode,
      setFontSize: s.setFontSize,
      setFontFamily: s.setFontFamily,
      setLineHeight: s.setLineHeight,
      setWordSpacing: s.setWordSpacing,
      setHyphens: s.setHyphens,
      setSpreadMode: s.setSpreadMode,
      updateBookSettings: s.updateBookSettings,
      setIsPacerPlaying: s.setIsPacerPlaying,
      appTheme: s.appTheme
    }))
  )

  // Derive effective theme from system or preference
  const isDarkMode = appTheme === 'dark' || (appTheme === 'system' && typeof window !== 'undefined' && window.matchMedia('(prefers-color-scheme: dark)').matches);
  const themeBg = isDarkMode ? '#1c1c1e' : '#ffffff';

  const DEFAULT_SETTINGS = {
    fontSize: 100,
    fontFamily: 'serif' as const,
    lineHeight: 1.6,
    wordSpacing: 0,
    hyphens: true,
    spreadMode: 'none' as const
  }

  // Initialize Book and Rendition
  useEffect(() => {
    let mounted = true
    
    const loadBook = async () => {
      try {
        const bookData = await db.books.get(bookId)
        if (!bookData || !bookData.data) {
          throw new Error('Book not found')
        }

        if (!mounted) return

        // Always reset pacer state on book load
        setIsPacerPlaying(false)

        const book = ePub(bookData.data)
        const metadata = await book.loaded.metadata
        const bookKey = `${metadata.title}-${metadata.creator}`
        
        // Restore book-specific settings or apply defaults
        const savedSettings = useSettingsStore.getState().bookSettings[bookKey]
        const settingsToApply = savedSettings || DEFAULT_SETTINGS
        

        setFontSize(settingsToApply.fontSize)
        setFontFamily(settingsToApply.fontFamily)
        setLineHeight(settingsToApply.lineHeight)
        setWordSpacing(settingsToApply.wordSpacing ?? 0)
        setHyphens(settingsToApply.hyphens ?? true)
        setSpreadMode(settingsToApply.spreadMode)

        bookRef.current = book
        if (!viewerRef.current) return

        const currentFlowMode = useSettingsStore.getState().flowMode
        const currentSpreadMode = useSettingsStore.getState().spreadMode
        
        const rendition = book.renderTo(viewerRef.current, {
          width: '100%',
          height: '100%',
          flow: currentFlowMode,
          spread: currentSpreadMode, 
          allowScriptedContent: true
        })
        renditionRef.current = rendition

        // Register Light and Dark themes only - follows global app theme
        const currentAppTheme = useSettingsStore.getState().appTheme;
        const systemDark = typeof window !== 'undefined' && window.matchMedia('(prefers-color-scheme: dark)').matches;
        const isCurrentlyDark = currentAppTheme === 'dark' || (currentAppTheme === 'system' && systemDark);

        rendition.themes.register('light', {
          body: { color: '#121214', background: '#ffffff', lineHeight: '1.6' },
          'a': { 'color': '#007aff !important', 'text-decoration': 'none !important', 'border-bottom': '1px solid rgba(0, 122, 255, 0.4) !important' },
          '::selection': { background: 'rgba(168, 130, 95, 0.3)' }
        })
        rendition.themes.register('dark', {
          body: { color: '#f5f5f5', background: '#1c1c1e', lineHeight: '1.6' },
          'a': { 'color': '#64b5f6 !important', 'text-decoration': 'none !important', 'border-bottom': '1px solid rgba(100, 181, 246, 0.4) !important' },
          '::selection': { background: 'rgba(255, 214, 10, 0.3)' }
        })

        rendition.themes.register('layout', {
          'body': {
            'column-count': spreadMode === 'none' ? '1 !important' : 'auto',
            'column-width': spreadMode === 'none' ? 'auto !important' : 'auto',
            'width': '100% !important'
          }
        })
        rendition.themes.select('layout')
        rendition.themes.select(isCurrentlyDark ? 'dark' : 'light')
        
        // Display
        const startLocation = bookData.progress || undefined
        await rendition.display(startLocation)
        rendition.spread(spreadMode) // Dynamic spread mode
        
        // Fix: Force multiple resize attempts to ensure content renders (epubjs rendering bug workaround)
        const forceResize = () => {
            if (viewerRef.current && renditionRef.current) {
                const width = viewerRef.current.offsetWidth
                const height = viewerRef.current.offsetHeight
                if (width > 0 && height > 0) {
                    renditionRef.current.resize(width, height)
                }
            }
        }
        
        // Multiple attempts at different intervals
        setTimeout(forceResize, 50)
        setTimeout(forceResize, 150)
        setTimeout(forceResize, 300)
        
        // Also resize when content is first rendered
        rendition.on('started', forceResize)

        // Load locations - ASYNC and non-blocking
        if (bookData.locations) {
            book.locations.load(bookData.locations)
        } else {
            // Generate in background
            book.locations.generate(1000).then(() => {
                const serializedLocs = book.locations.save()
                db.books.get(bookId).then(currentBook => {
                   if (currentBook) {
                       currentBook.locations = serializedLocs
                       db.books.add(currentBook)
                   }
                })
            })
        }
        
        // Listeners for persistence and page info
        rendition.on('relocated', (location: any) => {
            if (onRelocated) onRelocated(location)
            db.books.updateProgress(bookId, location.start.cfi)

            // Update page info
            const displayed = location.start.displayed
            if (displayed) {
                // Heuristic for pages left in chapter
                // We'll show an estimate based on total pages and spine items
                const chapterCount = (book.spine as any).items?.length || 1
                
                useSettingsStore.getState().setPageInfo({
                    current: displayed.page,
                    total: displayed.total,
                    chapterLeft: Math.max(1, Math.round((displayed.total - displayed.page) / chapterCount)) 
                })
            }
        })

        // Vocabulary Hook
        rendition.hooks.content.register((contents: any) => {
            const doc = contents.document
            
            // Force language for hyphenation support
            if (!doc.documentElement.getAttribute('lang')) {
                doc.documentElement.setAttribute('lang', 'en')
            }

            // Apply base styles to ensure fixed word spacing
            doc.body.style.textAlign = 'left'
            doc.body.style.setProperty('text-align', 'left', 'important')
            
            // Recursive scan
            const buildVocab = (node: Node) => {
                if (node.nodeType === 3) { // Text node
                    // Avoid re-processing
                    if (node.parentElement?.tagName === 'RUBY' || 
                        node.parentElement?.tagName === 'RT' ||
                        node.parentElement?.classList.contains('vocab-processed')) {
                        return
                    }
                    
                    const fragment = processTextNode(node)
                    if (fragment) {
                        node.parentNode?.replaceChild(fragment, node)
                    }
                } else {
                    node.childNodes.forEach(buildVocab)
                }
            }

            // Styles
            contents.addStylesheetRules({
                'ruby.vocab-word': {
                    'text-decoration': 'none',
                    'border-bottom': '1px dotted rgba(100, 100, 100, 0.5)',
                    'cursor': 'help',
                    'position': 'relative'
                },
                'rt': {
                    'display': 'none',
                    'font-size': '0.5em',
                    'line-height': '1',
                    'background': '#333',
                    'color': '#fff',
                    'padding': '2px 4px',
                    'border-radius': '2px',
                    'position': 'absolute',
                    'bottom': '100%',
                    'left': '50%',
                    'transform': 'translateX(-50%)',
                    'white-space': 'nowrap',
                    'pointer-events': 'none',
                    'font-family': 'sans-serif'
                },
                'ruby.vocab-word:hover rt': {
                    'display': 'block'
                }
            })

            // Run in background using requestIdleCallback for performance
            const processNodes = (nodes: Node[], deadline: IdleDeadline) => {
                while (nodes.length > 0 && deadline.timeRemaining() > 0) {
                    const node = nodes.shift()!
                    if (node.nodeType === 3) { // Text node
                        if (node.parentElement?.tagName === 'RUBY' || 
                            node.parentElement?.tagName === 'RT' ||
                            node.parentElement?.classList.contains('vocab-processed')) {
                            continue
                        }
                        try {
                            const fragment = processTextNode(node)
                            if (fragment) {
                                node.parentNode?.replaceChild(fragment, node)
                            }
                        } catch(e) { /* ignore */ }
                    } else {
                        nodes.push(...Array.from(node.childNodes))
                    }
                }
                if (nodes.length > 0) {
                    requestIdleCallback((d) => processNodes(nodes, d))
                }
            }

            // Start background processing only if vocabulary is enabled
            const isVocabEnabled = useSettingsStore.getState().vocabEnabled
            if (isVocabEnabled) {
                try {
                    const allNodes: Node[] = Array.from(doc.body.childNodes)
                    if ('requestIdleCallback' in window) {
                        requestIdleCallback((d) => processNodes(allNodes, d))
                    }
                } catch(e) { console.warn('Vocab error', e)}
            }

            // Click Handler
            doc.body.addEventListener('click', (e: MouseEvent) => {
                const target = e.target as HTMLElement
                // Handle "Mark as Known"
                if (target.closest('ruby.vocab-word')) {
                     const ruby = target.closest('ruby')
                     const word = ruby?.dataset.word
                     if (word && ruby) {
                         useVocabularyStore.getState().markAsKnown(word)
                         // Optimistic UI update: revert to text
                         const text = document.createTextNode(word)
                         ruby.parentNode?.replaceChild(text, ruby)
                     }
                     e.preventDefault()
                     e.stopPropagation()
                }
            })
        })

        setIsReady(true)

      } catch (err) {
        console.error(err)
        setError('Failed to load book')
      }
    }

    loadBook()

    return () => {
      mounted = false
      if (bookRef.current) {
        bookRef.current.destroy()
      }
    }
  }, [bookId, flowMode])

  // Apply Settings Effect
  useEffect(() => {
    const rendition = renditionRef.current
    if (!rendition) return

    rendition.themes.select(isDarkMode ? 'dark' : 'light')
    rendition.themes.fontSize(`${fontSize}%`)
    rendition.themes.font(
        fontFamily === 'serif' ? 'New York, Georgia, serif' : 
        fontFamily === 'mono' ? 'monospace' : 
        '-apple-system, system-ui, sans-serif'
    )
    
    // Register custom typography theme
    const hyphensValue = hyphens ? 'auto' : 'none'
    rendition.themes.register('custom', {
      'body': {
        'line-height': `${lineHeight} !important`,
        'word-spacing': `${wordSpacing}px !important`,
        'letter-spacing': `${wordSpacing * 0.5}px !important`,
        'text-align': 'left !important',
        'hyphens': `${hyphensValue} !important`,
        '-webkit-hyphens': `${hyphensValue} !important`,
        'column-count': spreadMode === 'none' ? '1 !important' : 'auto',
        'column-width': spreadMode === 'none' ? 'auto !important' : 'auto',
        'width': '100% !important'
      },
      'p': {
        'text-align': 'left !important',
        'hyphens': `${hyphensValue} !important`,
        '-webkit-hyphens': `${hyphensValue} !important`
      }
    })

    rendition.themes.select('custom')
    rendition.themes.select(isDarkMode ? 'dark' : 'light')
    
    // Auto-save current settings to this book
    const saveToBook = async () => {
        if (bookRef.current) {
            const metadata = await bookRef.current.loaded.metadata
            const bookKey = `${metadata.title}-${metadata.creator}`
            updateBookSettings(bookKey, {
                fontSize, fontFamily, lineHeight, wordSpacing, hyphens, spreadMode
            })
        }
    }
    saveToBook()

  }, [isDarkMode, fontSize, fontFamily, lineHeight, wordSpacing, hyphens, spreadMode, isReady])

  // Window Resize Handler - Keep rendition size in sync with container
  useEffect(() => {
    const handleResize = () => {
      const rendition = renditionRef.current
      if (viewerRef.current && rendition && (rendition as any).manager) {
        const width = viewerRef.current.offsetWidth
        const height = viewerRef.current.offsetHeight
        if (width > 0 && height > 0) {
          rendition.resize(width, height)
        }
      }
    }

    // Debounced resize handler
    let resizeTimeout: ReturnType<typeof setTimeout>
    const debouncedResize = () => {
      clearTimeout(resizeTimeout)
      resizeTimeout = setTimeout(handleResize, 150)
    }

    window.addEventListener('resize', debouncedResize)
    
    // Also use ResizeObserver for container size changes
    const resizeObserver = new ResizeObserver(debouncedResize)
    if (viewerRef.current) {
      resizeObserver.observe(viewerRef.current)
    }

    return () => {
      window.removeEventListener('resize', debouncedResize)
      clearTimeout(resizeTimeout)
      resizeObserver.disconnect()
    }
  }, [isReady])
  
  // Keyboard Navigation & Event Forwarding
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
        // Target checks
        const target = e.target as HTMLElement
        if (['INPUT', 'TEXTAREA', 'SELECT'].includes(target.nodeName) || target.isContentEditable) return

        if (e.key === 'Escape') {
            onClose?.()
            return
        }

        // Spacebar toggles Pacer - support both key and code
        if (e.key === ' ' || e.code === 'Space') {
            e.preventDefault()
            e.stopPropagation()
            const currentState = useSettingsStore.getState().isPacerPlaying
            useSettingsStore.getState().setIsPacerPlaying(!currentState)
            return
        }

        if (!renditionRef.current) return
        if (e.key === 'ArrowRight') renditionRef.current.next()
        if (e.key === 'ArrowLeft') renditionRef.current.prev()
    }
    
    // Attach to parent window
    window.addEventListener('keydown', handleKeyDown, true)

    // Attach to iframe whenever a section is rendered
    const rendition = renditionRef.current
    const attachToIframe = (_section: any, view: any) => {
        const frame = view.iframe
        if (frame && frame.contentWindow) {
            // Remove existing to avoid duplicates if any
            frame.contentWindow.removeEventListener('keydown', handleKeyDown, true)
            frame.contentWindow.addEventListener('keydown', handleKeyDown, true)
        }
    }

    if (rendition) {
        rendition.on('rendered', attachToIframe)
        // If already rendered, try to attach now
        const views = (rendition as any).manager?.views
        if (views) {
            views.forEach((view: any) => attachToIframe(null, view))
        }
    }

    return () => {
        window.removeEventListener('keydown', handleKeyDown, true)
        if (rendition) {
            rendition.off('rendered', attachToIframe)
        }
    }
  }, [isReady, renditionRef.current, onClose]) // Depend on renditionRef.current to catch updates

  // Pacer Logic
  usePacer(renditionRef.current, isReady)
  
  // NOTE: Keyboard Nav is handled above. 
  // Error state handled above.

  if (error) {
    return <div className="flex items-center justify-center h-full text-destructive">{error}</div>
  }


  return (
    <div className="relative w-full h-full flex flex-col items-center transition-colors duration-500 overflow-hidden" style={{ backgroundColor: themeBg }}>
       {!isReady && (
         <div className="absolute inset-0 flex items-center justify-center z-50 transition-opacity duration-300" style={{ backgroundColor: themeBg }}>
           <Loader2 className="w-8 h-8 animate-spin text-primary/60" />
         </div>
       )}
       <div 
         ref={viewerRef} 
         className="w-full h-full"
       />
    </div>
  )
}
