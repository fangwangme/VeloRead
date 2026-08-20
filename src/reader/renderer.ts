import ePub from 'epubjs'
import type { Book, Contents, Rendition } from 'epubjs'
import type { ResolvedStyle } from './styles/types'
import { toCssRules } from './styles/toCssRules'
import type { HighlightColor, TocItem } from '../platform/types'
import { highlightPalette } from './annotations/colors'
import type { WordItem } from './pacer/chunker'
import { tokenizeText } from './pacer/tokenizer'

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

/** One match from an in-book search. */
export interface SearchHit {
  cfi: string
  excerpt: string
  sectionIndex: number
  chapterTitle: string | null
}

export interface SearchOptions {
  /** Reports spine progress so a long search can show where it is. */
  onProgress?: (searchedSections: number, totalSections: number) => void
  signal?: AbortSignal
  /** Stop early once this many hits are collected. */
  limit?: number
}

/** A live text selection, already translated into parent-container coordinates. */
export interface SelectionInfo {
  cfiRange: string
  text: string
  rect: { left: number; top: number; width: number; height: number }
}

export interface ReaderOptions {
  onLocation?: (location: ReaderLocation) => void
  onKeyDown?: (event: KeyboardEvent) => void
  onClickText?: (target: {
    text: string
    range?: Range
    /**
     * Set when the click landed on blank space inside the page rather than on a
     * word — epub.js's own column gutters, the area below the last line. Which
     * half of the visible page it fell in, so the caller can turn the page.
     */
    blankSide?: 'prev' | 'next' | null
  }) => void
  onLinkClick?: () => void
  onSelection?: (selection: SelectionInfo) => void
  onHighlightClick?: (annotationId: string) => void
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
  /** Paint a stored highlight onto the page. Re-adding the same id repaints it. */
  addHighlight(annotationId: string, cfiRange: string, color: HighlightColor): void
  removeHighlight(cfiRange: string): void
  /** Where a stored highlight sits right now, in container coordinates. */
  rectForCfiRange(cfiRange: string): SelectionInfo['rect'] | null
  /** True while text inside the book is selected, so a margin tap can defer. */
  hasTextSelection(): boolean
  clearSelection(): void
  /**
   * Full-text search across the whole book.
   *
   * epub.js has no index, so this loads each spine section on demand, searches
   * it, and unloads it again. That keeps memory flat on large books at the cost
   * of a visible pass — hence the progress callback and the abort signal.
   */
  searchBook(query: string, options?: SearchOptions): Promise<SearchHit[]>
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
  const onLinkClick = options.onLinkClick
  const onSelection = options.onSelection
  const onHighlightClick = options.onHighlightClick

  /** Translate an iframe-relative rect into the parent container's box. */
  function toContainerRect(rect: DOMRect): SelectionInfo['rect'] | null {
    const iframe = getIframe()
    if (!iframe) return null
    const iframeRect = iframe.getBoundingClientRect()
    const containerRect = container.getBoundingClientRect()
    return {
      left: Math.round(iframeRect.left - containerRect.left + rect.left),
      top: Math.round(iframeRect.top - containerRect.top + rect.top),
      width: Math.round(rect.width),
      height: Math.round(rect.height),
    }
  }

  if (onSelection) {
    rendition.on('selected', (cfiRange: string, contents: Contents) => {
      let text = ''
      let rect: SelectionInfo['rect'] | null = null
      try {
        const range = contents.range(cfiRange)
        text = range?.toString().trim() ?? ''
        const bounds = range?.getBoundingClientRect()
        if (bounds) rect = toContainerRect(bounds)
      } catch {
        // A malformed CFI must not break selecting text.
      }
      if (!text || !rect) return
      onSelection({ cfiRange, text, rect })
    })
  }

  if (onHighlightClick) {
    rendition.on('markClicked', (_cfiRange: string, data?: { id?: string }) => {
      if (data?.id) onHighlightClick(data.id)
    })
  }

  rendition.hooks.content.register((contents: Contents) => {
    const doc = contents.document
    if (onKeyDown) {
      doc.addEventListener('keydown', onKeyDown as EventListener)
    }
    if (onClickText) {
      doc.addEventListener('click', (event: MouseEvent) => {
        const target = event.target as Element | null
        // epub.js owns hyperlink navigation. Treating the same click as a
        // Pacer seek would leave the engine bound to the departing document.
        if (target?.closest?.('a[href]')) {
          onLinkClick?.()
          return
        }
        const selection = doc.getSelection()
        // Preserve ordinary text selection for the future annotation feature.
        if (selection && !selection.isCollapsed) return
        const range = wordRangeAtPoint(doc, event.clientX, event.clientY)
        // `caretRangeFromPoint` snaps to the nearest text position however far
        // away it is, so a click in the page margin still resolves to a word.
        // Only the geometry can tell a real word hit from a snapped one.
        const onWord = range ? pointHitsRange(range, event.clientX, event.clientY) : false
        onClickText({
          text: onWord ? (range as Range).toString() : '',
          range: onWord ? (range as Range) : undefined,
          blankSide: onWord ? null : blankSideOfPage(event.clientX),
        })
      })
    }
  })

  /**
   * Which half of the visible page a click inside the book fell in.
   *
   * Paginated epub.js makes the iframe as wide as the whole section and slides
   * it behind a clipping container, so `event.clientX` is a section coordinate,
   * not a screen one. Adding the iframe's own offset — which carries that slide
   * — turns it back into a screen position that can be compared with the
   * container. Scrolled flow has no page to turn, so it opts out.
   */
  function blankSideOfPage(clientX: number): 'prev' | 'next' | null {
    if (currentFlow === 'scrolled-doc') return null
    const iframe = getIframe()
    if (!iframe) return null
    const containerRect = container.getBoundingClientRect()
    if (containerRect.width === 0) return null
    const screenX = iframe.getBoundingClientRect().left + clientX
    return screenX < containerRect.left + containerRect.width / 2 ? 'prev' : 'next'
  }

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

  function tocLabelForHref(href?: string): string | null {
    if (!href) return null
    const target = normalizeDocumentHref(href)
    const match = flattenToc(tocItems).find(
      (item) => normalizeDocumentHref(item.href) === target,
    )
    return match?.label.trim() || null
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

    // In scrolled flow the Pacer owns the whole spine section, so every token is
    // wanted and there is nothing to cull.
    const cullToViewport = !(includeWholeScrolledSection && currentFlow === 'scrolled-doc')
    // One reusable range for the per-node test: measuring a whole text node once
    // decides whether any of its tokens can be on this page. Without it every
    // token in the section cost a `createRange()` plus a forced layout, so a
    // long single-file chapter meant tens of thousands of layouts per page turn.
    const probe = doc.createRange()

    let textNode: Text | null = walker.nextNode() as Text | null
    while (textNode) {
      const text = textNode.textContent ?? ''

      if (cullToViewport) {
        probe.selectNodeContents(textNode)
        const nodeRect = probe.getBoundingClientRect()
        // The union of the node's line boxes, so this only ever over-selects: a
        // node it rejects had no fragment anywhere near the page.
        const nodeVisible =
          (nodeRect.width > 0 || nodeRect.height > 0) &&
          iframeRect.left + nodeRect.right >= containerRect.left - 2 &&
          iframeRect.left + nodeRect.left <= containerRect.right + 2 &&
          iframeRect.top + nodeRect.bottom >= containerRect.top - 2 &&
          iframeRect.top + nodeRect.top <= containerRect.bottom + 2
        if (!nodeVisible) {
          textNode = walker.nextNode() as Text | null
          continue
        }
      }

      for (const token of tokenizeText(text)) {
        const { start, end } = token

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
                text: token.text,
                rect: {
                  left: r.left,
                  top: r.top,
                  width: r.width,
                  height: r.height,
                  bottom: r.bottom,
                  right: r.right,
                },
                kind: token.kind,
                wordBoundaryAfter: token.wordBoundaryAfter,
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
    addHighlight: (annotationId, cfiRange, color) => {
      const palette = highlightPalette(color)
      // Removing first makes this idempotent, so a recolor is just a re-add and
      // a repaint after page turns cannot stack duplicate marks.
      try {
        rendition.annotations.remove(cfiRange, 'highlight')
      } catch {
        // Nothing painted there yet.
      }
      try {
        rendition.annotations.highlight(
          cfiRange,
          { id: annotationId },
          undefined,
          'vr-highlight',
          {
            fill: palette.fill,
            'fill-opacity': palette.fillOpacity,
            'mix-blend-mode': 'multiply',
          },
        )
      } catch {
        // A highlight whose CFI no longer resolves is skipped rather than
        // breaking the page; the row itself stays listed and readable.
      }
    },
    removeHighlight: (cfiRange) => {
      try {
        rendition.annotations.remove(cfiRange, 'highlight')
      } catch {
        // Already gone.
      }
    },
    rectForCfiRange: (cfiRange) => {
      try {
        const range = rendition.getRange(cfiRange)
        const bounds = range?.getBoundingClientRect()
        if (!bounds || (bounds.width === 0 && bounds.height === 0)) return null
        return toContainerRect(bounds)
      } catch {
        return null
      }
    },
    hasTextSelection: () => {
      const selection = getIframe()?.contentWindow?.getSelection()
      return Boolean(selection && !selection.isCollapsed && selection.toString().trim().length > 0)
    },
    clearSelection: () => {
      getIframe()?.contentWindow?.getSelection()?.removeAllRanges()
    },
    searchBook: async (query, searchOptions = {}) => {
      const trimmed = query.trim()
      if (trimmed.length === 0) return []

      const { onProgress, signal, limit = 300 } = searchOptions
      const sections: SpineSection[] = []
      book.spine.each((section: SpineSection) => {
        sections.push(section)
      })

      const hits: SearchHit[] = []
      const seen = new Set<string>()

      for (let index = 0; index < sections.length; index++) {
        if (signal?.aborted || hits.length >= limit) break
        const section = sections[index]
        // A section the renderer is currently showing is already loaded, and
        // `Section.unload()` clears `document`/`contents`/`output` on the very
        // object the live view holds. Leave those exactly as they were found.
        const wasAlreadyLoaded = Boolean(section.document)
        try {
          await section.load(book.load.bind(book))
          // `search` stitches sequential text nodes, so a phrase split across
          // <em> or a line break still matches; `find` is the IE-era fallback.
          const found =
            typeof section.search === 'function' ? section.search(trimmed) : section.find(trimmed)
          const chapterTitle = tocLabelForHref(section.href)
          for (const match of found ?? []) {
            if (!match?.cfi || seen.has(match.cfi)) continue
            seen.add(match.cfi)
            hits.push({
              cfi: match.cfi,
              excerpt: match.excerpt?.replace(/\s+/gu, ' ').trim() ?? '',
              sectionIndex: index,
              chapterTitle,
            })
            if (hits.length >= limit) break
          }
        } catch {
          // A section that will not load is skipped; the rest still searches.
        } finally {
          if (!wasAlreadyLoaded) {
            try {
              section.unload()
            } catch {
              // Already unloaded.
            }
          }
        }

        onProgress?.(index + 1, sections.length)
        // Yield between sections so typing and cancelling stay responsive.
        await new Promise((resolve) => setTimeout(resolve, 0))
      }

      return hits
    },
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
  while (offset > 0 && /\s/u.test(text[offset])) offset--
  const tokens = tokenizeText(text)
  const token = tokens.find((candidate) => candidate.start <= offset && offset < candidate.end)
  if (!token) return null

  const word = doc.createRange()
  word.setStart(node, token.start)
  word.setEnd(node, token.end)
  return word
}

/**
 * Did the click actually land on this word, or did the caret snap to it from
 * somewhere blank?
 *
 * Horizontal slack is small — the page margins are what we are trying to
 * detect. Vertical slack is a whole line box, so the leading between two lines
 * of the same paragraph still counts as landing on the text.
 */
function pointHitsRange(range: Range, x: number, y: number): boolean {
  const rect = range.getClientRects()[0] ?? range.getBoundingClientRect()
  if (!rect || (rect.width === 0 && rect.height === 0)) return false
  const slackX = 4
  const slackY = rect.height
  return (
    x >= rect.left - slackX &&
    x <= rect.right + slackX &&
    y >= rect.top - slackY &&
    y <= rect.bottom + slackY
  )
}

function percentageOf(book: Book, cfi: string): number | null {
  if (book.locations.length() === 0) return null
  const value = book.locations.percentageFromCfi(cfi)
  return Number.isFinite(value) ? value : null
}

function detach(bytes: Uint8Array): ArrayBuffer {
  return bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer
}

/**
 * The epub.js typings declare `Section.find` as returning elements, and omit
 * `search` entirely; both actually answer with `{cfi, excerpt}`.
 */
interface SpineSection {
  href?: string
  /** Set while the section is loaded; the live view relies on it staying set. */
  document?: Document
  load(request: unknown): Promise<Document>
  unload(): void
  find(query: string): { cfi: string; excerpt: string }[]
  search?: (query: string, maxSeqEle?: number) => { cfi: string; excerpt: string }[]
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
