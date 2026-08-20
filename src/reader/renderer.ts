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
  tocId?: string | null
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
  getViewportWords(): WordItem[]
  getIframeElement(): HTMLIFrameElement | null
  getScrollElement(): HTMLElement | null
  getCurrentLocation(): ReaderLocation | null
  advancePacerPage(): Promise<boolean>
  ensurePacerRectVisible(rect: Pick<WordItem['rect'], 'top' | 'height'>): void
  fontsReady(): Promise<void>
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
        // Preserve ordinary text selection for the future annotation feature.
        if (selection && !selection.isCollapsed) return
        const range = wordRangeAtPoint(doc, event.clientX, event.clientY)
        const text = range?.toString() || (event.target as HTMLElement)?.innerText || ''
        onClickText({ text, range: range ?? undefined })
      })
    }
  })

  let locationsReady = false
  let tocItems: TocItem[] = []
  let lastLocation: ReaderLocation | null = null

  // Load TOC
  book.loaded.navigation
    .then((nav) => {
      tocItems = mapToc(nav.toc)
    })
    .catch(() => {
      // TOC failure is non-fatal
    })

  function findCurrentTocItem(href?: string): TocItem | null {
    if (!href || tocItems.length === 0) return null
    const currentDocument = normalizeDocumentHref(href)
    const candidates = flattenToc(tocItems).filter(
      (item) => normalizeDocumentHref(item.href) === currentDocument,
    )
    if (candidates.length === 0) return null

    const exact = candidates.find((item) => normalizeHref(item.href) === normalizeHref(href))
    if (exact && href.includes('#')) return exact

    const iframe = getIframe()
    const doc = iframe?.contentDocument
    if (!iframe || !doc) return candidates[0]

    const iframeRect = iframe.getBoundingClientRect()
    const containerRect = container.getBoundingClientRect()
    const threshold = currentFlow === 'scrolled-doc'
      ? containerRect.top + containerRect.height * 0.3
      : iframeRect.left + iframe.clientWidth * 0.3

    let active = candidates[0]
    for (const item of candidates) {
      const fragment = fragmentOf(item.href)
      if (!fragment) continue
      const element = doc.getElementById(fragment)
      if (!element) continue
      const rect = element.getBoundingClientRect()
      const position = currentFlow === 'scrolled-doc' ? iframeRect.top + rect.top : iframeRect.left + rect.left
      if (position <= threshold) active = item
    }
    return active
  }

  function makeLocationPayload(location: RelocatedEvent): ReaderLocation {
    const cfi = location.start.cfi
    const href = location.start.href
    const displayed = location.start.displayed
    let pagesLeftInChapter: number | null = null
    if (displayed && displayed.total > 0 && displayed.page > 0) {
      pagesLeftInChapter = Math.max(0, displayed.total - displayed.page)
    }

    const currentTocItem = findCurrentTocItem(href)
    return {
      cfi,
      href,
      chapterTitle: currentTocItem?.label.trim() || null,
      tocId: currentTocItem?.id ?? null,
      pagesLeftInChapter,
      percentage: locationsReady ? percentageOf(book, cfi) : null,
      atStart: Boolean(location.atStart),
      atEnd: Boolean(location.atEnd),
    }
  }

  rendition.on('relocated', (location: RelocatedEvent) => {
    lastLocation = makeLocationPayload(location)
    options.onLocation?.(lastLocation)
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
        lastLocation = makeLocationPayload(current)
        options.onLocation?.(lastLocation)
      }
    })
    .catch(() => {
      // Percentage stays null if locations fail
    })

  function getIframe(): HTMLIFrameElement | null {
    return container.querySelector('iframe')
  }

  function getScrollElement(): HTMLElement | null {
    return container.querySelector<HTMLElement>('.epub-container')
  }

  function collectWords(includeWholeScrolledSection: boolean): WordItem[] {
    const iframe = getIframe()
    if (!iframe || !iframe.contentDocument || !iframe.contentWindow) return []

    const doc = iframe.contentDocument
    const body = doc.body
    if (!body) return []

    const iframeRect = iframe.getBoundingClientRect()
    const containerRect = container.getBoundingClientRect()

    const words: WordItem[] = []
    const blacklist = new Set(['SCRIPT', 'STYLE', 'NOSCRIPT', 'SVG', 'CANVAS', 'OBJECT'])

    const walker = doc.createTreeWalker(body, NodeFilter.SHOW_TEXT, {
      acceptNode(node) {
        const parent = node.parentElement
        if (
          !parent ||
          blacklist.has(parent.tagName) ||
          parent.closest('script, style, noscript, svg, canvas, object, figcaption, .caption')
        ) {
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
            const screenLeft = iframeRect.left + r.left
            const screenTop = iframeRect.top + r.top
            const intersectsPage =
              screenLeft + r.width >= containerRect.left - 2 &&
              screenLeft <= containerRect.right + 2 &&
              screenTop + r.height >= containerRect.top - 2 &&
              screenTop <= containerRect.bottom + 2
            // In scrolling mode the Pacer owns a whole spine section and scrolls
            // the parent viewport as chunks advance. Paginated mode only owns
            // the currently visible page/spread.
            if (
              r.width > 0 &&
              r.height > 0 &&
              (includeWholeScrolledSection && currentFlow === 'scrolled-doc' || intersectsPage)
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

  function getVisibleWords(): WordItem[] {
    return collectWords(true)
  }

  function getViewportWords(): WordItem[] {
    return collectWords(false)
  }

  function ensurePacerRectVisible(rect: Pick<WordItem['rect'], 'top' | 'height'>) {
    if (currentFlow !== 'scrolled-doc') return
    const iframe = getIframe()
    const scroller = getScrollElement()
    if (!iframe || !scroller) return

    const iframeRect = iframe.getBoundingClientRect()
    const viewportRect = container.getBoundingClientRect()
    const screenTop = iframeRect.top + rect.top
    const screenBottom = screenTop + rect.height
    const lowerThreshold = viewportRect.top + viewportRect.height * 0.78
    const upperThreshold = viewportRect.top + viewportRect.height * 0.12

    if (screenBottom > lowerThreshold || screenTop < upperThreshold) {
      const targetTop = viewportRect.top + viewportRect.height * 0.32
      const nextTop = Math.max(0, scroller.scrollTop + screenTop - targetTop)
      scroller.scrollTo({ top: nextTop, behavior: 'smooth' })
    }
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
    getViewportWords,
    getIframeElement: getIframe,
    getScrollElement,
    getCurrentLocation: () => lastLocation,
    advancePacerPage: async () => {
      if (lastLocation?.atEnd) return false
      const before = lastLocation?.cfi ?? null
      await rendition.next()
      return Boolean(lastLocation?.cfi && lastLocation.cfi !== before)
    },
    ensurePacerRectVisible,
    fontsReady: async () => {
      const fonts = getIframe()?.contentDocument?.fonts
      if (fonts) await fonts.ready
    },
    destroy() {
      destroyed = true
      rendition.destroy()
      book.destroy()
    },
  }
}

function mapToc(items: unknown[], parentId = 'toc'): TocItem[] {
  if (!Array.isArray(items)) return []
  return (items as RawNavItem[]).map((item, index) => {
    const fallbackId = `${parentId}-${index}`
    return {
      id: item.id || fallbackId,
      label: item.label || item.title || '',
      href: item.href || '',
      subitems: item.subitems ? mapToc(item.subitems, fallbackId) : undefined,
    }
  })
}

function flattenToc(items: TocItem[]): TocItem[] {
  return items.flatMap((item) => [item, ...flattenToc(item.subitems ?? [])])
}

function normalizeHref(href: string): string {
  try {
    return decodeURI(href).replace(/^\.\//, '')
  } catch {
    return href.replace(/^\.\//, '')
  }
}

function normalizeDocumentHref(href: string): string {
  return normalizeHref(href).split('#')[0]
}

function fragmentOf(href: string): string | null {
  const fragment = href.split('#')[1]
  if (!fragment) return null
  try {
    return decodeURIComponent(fragment)
  } catch {
    return fragment
  }
}

function wordRangeAtPoint(doc: Document, x: number, y: number): Range | null {
  const caretDocument = doc as Document & {
    caretRangeFromPoint?: (clientX: number, clientY: number) => Range | null
    caretPositionFromPoint?: (
      clientX: number,
      clientY: number,
    ) => { offsetNode: Node; offset: number } | null
  }

  let caret = caretDocument.caretRangeFromPoint?.(x, y) ?? null
  if (!caret) {
    const position = caretDocument.caretPositionFromPoint?.(x, y)
    if (position) {
      caret = doc.createRange()
      caret.setStart(position.offsetNode, position.offset)
      caret.collapse(true)
    }
  }
  if (!caret || caret.startContainer.nodeType !== Node.TEXT_NODE) return null

  const node = caret.startContainer as Text
  const text = node.textContent ?? ''
  if (text.length === 0) return null
  let offset = Math.min(caret.startOffset, text.length - 1)
  while (offset > 0 && /\s/.test(text[offset])) offset--

  let start = offset
  let end = offset + 1
  if (!isCjkChar(text[offset])) {
    while (start > 0 && !/\s/.test(text[start - 1]) && !isCjkChar(text[start - 1])) start--
    while (end < text.length && !/\s/.test(text[end]) && !isCjkChar(text[end])) end++
  }

  const word = doc.createRange()
  word.setStart(node, start)
  word.setEnd(node, end)
  return word
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
