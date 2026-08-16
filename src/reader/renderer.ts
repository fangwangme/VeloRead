import ePub from 'epubjs'
import type { Book, Contents, Rendition } from 'epubjs'
import type { ResolvedStyle } from './styles/types'
import { toCssRules } from './styles/toCssRules'
import type { TocItem } from '../platform/types'
import { isCjkChar, type WordItem } from './pacer/chunker'

export interface ReaderLocation {
  /** CFI of the first visible position on the current page. */
  cfi: string
  href?: string
  chapterTitle?: string | null
  pagesLeftInChapter?: number | null
  /**
   * 0–1, or null while epub.js is still generating locations in the
   * background. Null means "not known yet", never "at the beginning".
   */
  percentage: number | null
  atStart: boolean
  atEnd: boolean
}

export interface ReaderOptions {
  onLocation?: (location: ReaderLocation) => void
  onKeyDown?: (event: KeyboardEvent) => void
  onClickText?: (target: { text: string; range?: Range }) => void
  flow?: 'paginated' | 'scrolled-doc'
  spreadMode?: 'auto' | 'single' | 'double'
  style?: ResolvedStyle
}

export interface ReaderHandle {
  next(): Promise<void>
  prev(): Promise<void>
  display(target?: string): Promise<void>
  resize(width: number, height: number): void
  applyStyle(style: ResolvedStyle): void
  setFlow(flow: 'paginated' | 'scrolled-doc'): Promise<void>
  setSpread(mode: 'auto' | 'single' | 'double'): Promise<void>
  getToc(): Promise<TocItem[]>
  getVisibleWords(): WordItem[]
  getIframeElement(): HTMLIFrameElement | null
  destroy(): void
}

interface RawNavItem {
  id?: string
  label?: string
  title?: string
  href?: string
  subitems?: RawNavItem[]
}

/**
 * The single place that talks to epub.js.
 *
 * epub.js has known CFI and pagination rough edges; keeping every call behind
 * this module is what makes swapping the rendering layer a contained decision
 * later on.
 */
export async function createReader(
  container: HTMLElement,
  data: Uint8Array,
  startCfi: string | null,
  options: ReaderOptions = {},
): Promise<ReaderHandle> {
  const book: Book = ePub(detach(data))
  let currentFlow = options.flow ?? 'paginated'
  let currentSpreadMode = options.spreadMode ?? 'auto'

  const initialSpread = currentSpreadMode === 'single' ? 'none' : currentSpreadMode === 'double' ? 'always' : 'auto'

  const rendition: Rendition = book.renderTo(container, {
    width: '100%',
    height: '100%',
    flow: currentFlow,
    spread: initialSpread,
    minSpreadWidth: 860,
    allowScriptedContent: false,
  })

  let currentStyle: ResolvedStyle | null = options.style ?? null

  function registerAndApplyStyle(style: ResolvedStyle) {
    currentStyle = style
    const rules = toCssRules(style)
    // epub.js themes.select() is mutually exclusive; merge style into single theme
    rendition.themes.register('vr-theme', rules)
    rendition.themes.select('vr-theme')
  }

  if (currentStyle) {
    registerAndApplyStyle(currentStyle)
  }

  const onKeyDown = options.onKeyDown
  const onClickText = options.onClickText

  rendition.hooks.content.register((contents: Contents) => {
    const doc = contents.document
    if (onKeyDown) {
      doc.addEventListener('keydown', onKeyDown as EventListener)
    }
    if (onClickText) {
      doc.addEventListener('click', (event: MouseEvent) => {
        const selection = doc.getSelection()
        const text = selection?.toString() || (event.target as HTMLElement)?.innerText || ''
        onClickText({ text })
      })
    }
  })

  let locationsReady = false
  let tocItems: TocItem[] = []

  // Load TOC
  book.loaded.navigation
    .then((nav) => {
      tocItems = mapToc(nav.toc)
    })
    .catch(() => {
      // TOC failure is non-fatal
    })

  function findChapterTitle(href?: string): string | null {
    if (!href || tocItems.length === 0) return null
    const cleanHref = href.split('#')[0]

    function search(items: TocItem[]): string | null {
      for (const item of items) {
        if (item.href.includes(cleanHref) || cleanHref.includes(item.href.split('#')[0])) {
          return item.label.trim()
        }
        if (item.subitems && item.subitems.length > 0) {
          const found = search(item.subitems)
          if (found) return found
        }
      }
      return null
    }

    return search(tocItems)
  }

  function makeLocationPayload(location: RelocatedEvent): ReaderLocation {
    const cfi = location.start.cfi
    const href = location.start.href
    const displayed = location.start.displayed
    let pagesLeftInChapter: number | null = null
    if (displayed && displayed.total > 0 && displayed.page > 0) {
      pagesLeftInChapter = Math.max(0, displayed.total - displayed.page)
    }

    return {
      cfi,
      href,
      chapterTitle: findChapterTitle(href),
      pagesLeftInChapter,
      percentage: locationsReady ? percentageOf(book, cfi) : null,
      atStart: Boolean(location.atStart),
      atEnd: Boolean(location.atEnd),
    }
  }

  rendition.on('relocated', (location: RelocatedEvent) => {
    options.onLocation?.(makeLocationPayload(location))
  })

  // Display initial position
  await rendition.display(startCfi ?? undefined)

  let destroyed = false
  void book.locations
    .generate(1000)
    .then(() => {
      if (destroyed) return
      locationsReady = true
      const current = rendition.location as unknown as RelocatedEvent | undefined
      if (current?.start?.cfi) {
        options.onLocation?.(makeLocationPayload(current))
      }
    })
    .catch(() => {
      // Percentage stays null if locations fail
    })

  function getIframe(): HTMLIFrameElement | null {
    return container.querySelector('iframe')
  }

  function getVisibleWords(): WordItem[] {
    const iframe = getIframe()
    if (!iframe || !iframe.contentDocument || !iframe.contentWindow) return []

    const doc = iframe.contentDocument
    const body = doc.body
    if (!body) return []

    const viewWidth = iframe.clientWidth
    const viewHeight = iframe.clientHeight

    const words: WordItem[] = []
    const blacklist = new Set(['SCRIPT', 'STYLE', 'NOSCRIPT', 'SVG', 'CANVAS', 'OBJECT'])

    const walker = doc.createTreeWalker(body, NodeFilter.SHOW_TEXT, {
      acceptNode(node) {
        const parent = node.parentElement
        if (!parent || blacklist.has(parent.tagName)) {
          return NodeFilter.FILTER_REJECT
        }
        if (!node.textContent || node.textContent.trim().length === 0) {
          return NodeFilter.FILTER_SKIP
        }
        return NodeFilter.FILTER_ACCEPT
      },
    })

    let textNode: Text | null = walker.nextNode() as Text | null
    while (textNode) {
      const text = textNode.textContent ?? ''
      let index = 0

      while (index < text.length) {
        // Skip whitespace
        while (index < text.length && /\s/.test(text[index])) {
          index++
        }
        if (index >= text.length) break

        const start = index
        const char = text[index]
        const isCjk = isCjkChar(char)

        let end = start + 1
        if (!isCjk) {
          // English / Latin word: gather letters until whitespace or CJK
          while (end < text.length && !/\s/.test(text[end]) && !isCjkChar(text[end])) {
            end++
          }
        }
        index = end

        const token = text.slice(start, end).trim()
        if (token.length === 0) continue

        try {
          const range = doc.createRange()
          range.setStart(textNode, start)
          range.setEnd(textNode, end)

          const rects = range.getClientRects()
          if (rects.length > 0) {
            const r = rects[0]
            // Visible on the current page / viewport check
            if (
              r.width > 0 &&
              r.height > 0 &&
              r.right >= -2 &&
              r.left <= viewWidth + 2 &&
              r.bottom >= -2 &&
              r.top <= viewHeight + 2
            ) {
              words.push({
                text: token,
                rect: {
                  left: r.left,
                  top: r.top,
                  width: r.width,
                  height: r.height,
                  bottom: r.bottom,
                  right: r.right,
                },
                isCjk,
                range,
              })
            }
          }
        } catch {
          // Range creation errors should not break reading
        }
      }

      textNode = walker.nextNode() as Text | null
    }

    return words
  }

  return {
    next: () => rendition.next(),
    prev: () => rendition.prev(),
    display: async (target?: string) => {
      await rendition.display(target)
    },
    resize: (width, height) => {
      rendition.resize(width, height)
    },
    applyStyle: (style: ResolvedStyle) => {
      registerAndApplyStyle(style)
    },
    setFlow: async (flow: 'paginated' | 'scrolled-doc') => {
      if (flow === currentFlow) return
      currentFlow = flow
      const currentLoc = rendition.location?.start?.cfi
      rendition.flow(flow)
      if (currentStyle) {
        registerAndApplyStyle(currentStyle)
      }
      await rendition.display(currentLoc ?? undefined)
    },
    setSpread: async (mode: 'auto' | 'single' | 'double') => {
      if (mode === currentSpreadMode) return
      currentSpreadMode = mode
      const currentLoc = rendition.location?.start?.cfi
      const spreadValue = mode === 'single' ? 'none' : mode === 'double' ? 'always' : 'auto'
      rendition.spread(spreadValue, 860)
      if (currentStyle) {
        registerAndApplyStyle(currentStyle)
      }
      await rendition.display(currentLoc ?? undefined)
    },
    getToc: async () => {
      if (tocItems.length > 0) return tocItems
      const nav = await book.loaded.navigation
      tocItems = mapToc(nav.toc)
      return tocItems
    },
    getVisibleWords,
    getIframeElement: getIframe,
    destroy() {
      destroyed = true
      rendition.destroy()
      book.destroy()
    },
  }
}

function mapToc(items: unknown[]): TocItem[] {
  if (!Array.isArray(items)) return []
  return (items as RawNavItem[]).map((item, index) => ({
    id: item.id || `toc-${index}`,
    label: item.label || item.title || '',
    href: item.href || '',
    subitems: item.subitems ? mapToc(item.subitems) : undefined,
  }))
}

function percentageOf(book: Book, cfi: string): number | null {
  if (book.locations.length() === 0) return null
  const value = book.locations.percentageFromCfi(cfi)
  return Number.isFinite(value) ? value : null
}

function detach(bytes: Uint8Array): ArrayBuffer {
  return bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer
}

interface RelocatedEvent {
  start: {
    cfi: string
    href?: string
    displayed?: {
      page: number
      total: number
    }
  }
  atStart?: boolean
  atEnd?: boolean
}
