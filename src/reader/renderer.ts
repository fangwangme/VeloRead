import ePub from 'epubjs'
import type { Book, Contents, Rendition } from 'epubjs'
import type { ResolvedStyle } from './styles/types'
import { toCssRules } from './styles/toCssRules'
import type { HighlightColor, TocItem } from '../platform/types'
import { highlightPalette } from './annotations/colors'
import type { WordItem } from './pacer/chunker'
import { tokenizeText } from './pacer/tokenizer'
import { columnPitchFromLayout } from './pacer/geometry'
import { createSwipeTracker, isHorizontalWheel } from './swipe'
import { sentenceAt } from './sentence'

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
  /**
   * Characters of body text between here and the end of the book, or null
   * before the location index exists. epub.js indexes the spine in fixed-size
   * chunks, so this is the only whole-book measure available without
   * paginating everything up front — coarse, but real.
   */
  charactersLeftInBook: number | null
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
  /**
   * The sentence the selection sits in, for the vocabulary list. Empty when the
   * paragraph cannot be read — a word without its sentence is still worth
   * recording, so this never blocks a lookup.
   */
  sentence: string
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
  /**
   * A sideways swipe on a trackpad or Magic Mouse asked for a page turn. The
   * gating (a panel is open, the Pacer is running) belongs to the caller, which
   * already owns exactly that decision for the arrow keys.
   */
  onHorizontalSwipe?: (direction: 'prev' | 'next') => void
  onSelection?: (selection: SelectionInfo) => void
  onHighlightClick?: (annotationId: string) => void
  flow?: 'paginated' | 'scrolled-doc'
  spreadMode?: 'auto' | 'single' | 'double'
  /**
   * Container width at which `auto` may split into two columns.
   *
   * Not a constant: two columns are only an improvement while each one still
   * holds a readable measure. Below that they are the same text in shorter
   * lines, which is worse, so the threshold has to come from the measure the
   * typography is actually set to.
   */
  minSpreadWidth?: number
  style?: ResolvedStyle
}

/** Elements that hold a paragraph of prose rather than a run of inline text. */
const BLOCK_TAGS = new Set([
  'P', 'DIV', 'LI', 'BLOCKQUOTE', 'TD', 'TH', 'DD', 'DT', 'FIGCAPTION', 'SECTION',
  'ARTICLE', 'H1', 'H2', 'H3', 'H4', 'H5', 'H6', 'BODY',
])

function closestBlock(node: Node): Element | null {
  let current: Node | null = node.nodeType === Node.ELEMENT_NODE ? node : node.parentNode
  while (current && current.nodeType === Node.ELEMENT_NODE) {
    if (BLOCK_TAGS.has((current as Element).tagName)) return current as Element
    current = current.parentNode
  }
  return null
}

export interface ReaderHandle {
  next(): Promise<void>
  prev(): Promise<void>
  display(target?: string): Promise<void>
  resize(width: number, height: number): void
  applyStyle(style: ResolvedStyle): void
  setFlow(flow: 'paginated' | 'scrolled-doc'): Promise<void>
  setSpread(mode: 'auto' | 'single' | 'double', minSpreadWidth?: number): Promise<void>
  getToc(): Promise<TocItem[]>
  getVisibleWords(): WordItem[]
  getViewportWords(): WordItem[]
  /**
   * Distance between two adjacent columns of the paginated page, or null in
   * scrolled flow and whenever the layout cannot be read. The Pacer needs it to
   * tell "end of the left column" from "start of the right one" — those two
   * lines share a `top`.
   */
  getColumnPitch(): number | null
  /**
   * A CFI for one position in the book, collapsed to the start of `range`.
   *
   * Collapsed on purpose: a point CFI is what `ReadingProgress.cfi` has always
   * held, so `display()` and the location index keep behaving exactly as before
   * while the position gains word-level precision.
   */
  cfiFromRange(range: Range): string | null
  /** The live range a stored CFI points at, if its page is currently rendered. */
  rangeFromCfi(cfi: string): Range | null
  /**
   * Feed the parent document's wheel events in. `wheel` does not cross the
   * iframe boundary, so the book page registers its own listener inside; both
   * share one gesture accumulator, or half a flick each turns two pages.
   */
  handleWheel(event: WheelEvent): void
  getIframeElement(): HTMLIFrameElement | null
  getScrollElement(): HTMLElement | null
  getCurrentLocation(): ReaderLocation | null
  /**
   * Paint a stored highlight onto the page. Re-adding the same id repaints it.
   * `emphasis` paints it stronger, to answer "which one did I just jump to".
   */
  addHighlight(
    annotationId: string,
    cfiRange: string,
    color: HighlightColor,
    emphasis?: boolean,
  ): void
  removeHighlight(cfiRange: string): void
  /** Where a stored highlight sits right now, in container coordinates. */
  rectForCfiRange(cfiRange: string): SelectionInfo['rect'] | null
  /**
   * The sentence a stored range sits in, read off the live page.
   *
   * Reopening a highlight has to get the sentence from the book, not from the
   * highlight: a one-word highlight's own text *is* the word, and recording
   * that as its own context would be worthless.
   */
  sentenceForCfiRange(cfiRange: string): string
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

/** Fallback threshold when the caller has not measured its typography yet. */
const DEFAULT_MIN_SPREAD_WIDTH = 1500

/** How long a page turn may take to report its new location before we give up. */
const RELOCATION_TIMEOUT_MS = 800

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
  let currentMinSpreadWidth = options.minSpreadWidth ?? DEFAULT_MIN_SPREAD_WIDTH

  const initialSpread = currentSpreadMode === 'single' ? 'none' : currentSpreadMode === 'double' ? 'always' : 'auto'

  const rendition: Rendition = book.renderTo(container, {
    width: '100%',
    height: '100%',
    flow: currentFlow,
    spread: initialSpread,
    minSpreadWidth: currentMinSpreadWidth,
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

  /**
   * The sentence a selection sits in, read out of its own paragraph.
   *
   * The block element is the unit: a sentence never spans two paragraphs, and
   * taking the whole document's text would make finding the offset a walk over
   * the entire chapter.
   */
  function sentenceAroundRange(range: Range): string {
    const block = closestBlock(range.startContainer)
    if (!block) return ''
    const upToWord = range.startContainer.ownerDocument!.createRange()
    upToWord.setStart(block, 0)
    upToWord.setEnd(range.startContainer, range.startOffset)
    return sentenceAt(block.textContent ?? '', upToWord.toString().length)
  }

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

  /**
   * A selection epub.js has told us about but that is not finished yet.
   *
   * epub.js reports a selection 250 ms after it last changed, which during a
   * drag means *mid-drag*: pause for a quarter second while sweeping across a
   * sentence and the popover appears over the words still being selected, then
   * jumps as the selection grows. Dragging is one gesture and it ends on mouse
   * up; until then there is no selection to act on.
   */
  let selectionInProgress = false
  let pendingSelection: { cfiRange: string; contents: Contents } | null = null
  let flushTimer: ReturnType<typeof setTimeout> | null = null

  function emitSelection(cfiRange: string, contents: Contents) {
    if (!onSelection) return
    pendingSelection = null
    if (flushTimer !== null) {
      clearTimeout(flushTimer)
      flushTimer = null
    }
    let text = ''
    let rect: SelectionInfo['rect'] | null = null
    let sentence = ''
    try {
      const range = contents.range(cfiRange)
      text = range?.toString().trim() ?? ''
      const bounds = range?.getBoundingClientRect()
      if (bounds) rect = toContainerRect(bounds)
      if (range) sentence = sentenceAroundRange(range)
    } catch {
      // A malformed CFI must not break selecting text.
    }
    if (!text || !rect) return
    onSelection({ cfiRange, text, rect, sentence })
  }

  /** The drag is over: show whatever was held back, if anything still stands. */
  function endSelectionGesture() {
    selectionInProgress = false
    if (!pendingSelection) return
    if (flushTimer !== null) clearTimeout(flushTimer)
    // A short beat, in case epub.js is about to report the final selection
    // itself — that path emits directly and cancels this one.
    flushTimer = setTimeout(() => {
      flushTimer = null
      const held = pendingSelection
      if (held) emitSelection(held.cfiRange, held.contents)
    }, 60)
  }

  // A sweep that runs off the edge of the page is released over the app, not
  // over the book, so the book document never sees the mouse come up.
  const onWindowMouseUp = () => {
    if (selectionInProgress) endSelectionGesture()
  }
  if (onSelection) document.addEventListener('mouseup', onWindowMouseUp)

  if (onSelection) {
    rendition.on('selected', (cfiRange: string, contents: Contents) => {
      // Still dragging: remember it, but do not put a panel over the text the
      // reader is in the middle of sweeping across.
      if (selectionInProgress) {
        pendingSelection = { cfiRange, contents }
        return
      }
      emitSelection(cfiRange, contents)
    })
  }

  if (onHighlightClick) {
    rendition.on('markClicked', (_cfiRange: string, data?: { id?: string }) => {
      if (data?.id) onHighlightClick(data.id)
    })
  }

  rendition.hooks.content.register((contents: Contents) => {
    const doc = contents.document
    if (doc.defaultView) neutraliseOffscreenText(doc, doc.defaultView)
    if (onSelection) {
      doc.addEventListener('mousedown', () => {
        selectionInProgress = true
        // Whatever was held back belonged to the selection being replaced.
        pendingSelection = null
      })
      doc.addEventListener('mouseup', endSelectionGesture)
    }
    if (onKeyDown) {
      doc.addEventListener('keydown', onKeyDown as EventListener)
    }
    if (options.onHorizontalSwipe) {
      // Not passive: a horizontal wheel over the page has to be swallowed, or
      // WKWebView reads it as the "go back" swipe.
      doc.addEventListener('wheel', handleWheel as EventListener, { passive: false })
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

  /**
   * One accumulator for both listeners, and one clock for both documents: the
   * book iframe has its own time origin, so `event.timeStamp` from inside it
   * cannot be compared with one from the parent.
   */
  const swipe = createSwipeTracker()

  function handleWheel(event: WheelEvent) {
    // Scrolled flow has no page to turn, the same trade-off `blankSideOfPage`
    // already makes; the wheel there belongs to the scroller.
    if (currentFlow === 'scrolled-doc') return
    if (!isHorizontalWheel(event)) return
    event.preventDefault()
    const direction = swipe.feed(event, performance.now())
    if (direction) options.onHorizontalSwipe?.(direction)
  }

  /**
   * How far apart the columns of the current page are.
   *
   * epub.js paginates by setting `column-width` and `column-gap` on the book's
   * body (see `epubjs/lib/contents.js`), so the layout has to be read back from
   * the page rather than recomputed here. CSS decides the real column count from
   * the space available, which is not always the count epub.js asked for — a
   * single-column page still carries a `column-width` as wide as the whole body.
   */
  function getColumnPitch(): number | null {
    if (currentFlow === 'scrolled-doc') return null
    const doc = getIframe()?.contentDocument
    const body = doc?.body
    const view = doc?.defaultView
    if (!body || !view) return null

    try {
      const style = view.getComputedStyle(body)
      // Vertical writing modes paginate along the other axis; a horizontal pitch
      // would be worse than none.
      if (!style.writingMode.startsWith('horizontal')) return null

      // `clientWidth` less its padding rather than the computed `width`: epub.js
      // sets `box-sizing: border-box` on the body, so the computed width is the
      // border box and the columns are laid out inside the content box.
      const paddingLeft = Number.parseFloat(style.paddingLeft) || 0
      const paddingRight = Number.parseFloat(style.paddingRight) || 0
      return columnPitchFromLayout({
        available: body.clientWidth - paddingLeft - paddingRight,
        columnWidth: Number.parseFloat(style.columnWidth),
        columnGap: Number.parseFloat(style.columnGap),
      })
    } catch {
      // A page that will not report its layout falls back to no column awareness.
      return null
    }
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
      charactersLeftInBook: locationsReady ? charactersLeftFrom(book, cfi) : null,
      atStart: Boolean(location.atStart),
      atEnd: Boolean(location.atEnd),
    }
  }

  /**
   * Callers waiting for the *next* `relocated` event.
   *
   * `rendition.next()` resolves as soon as epub.js's `reportLocation()` has
   * scheduled its `requestAnimationFrame` — the enqueued function returns
   * before the frame runs, so the queue does not wait for it. Sampling the
   * location right after awaiting `next()` therefore still reads the page we
   * just left. Blink happens to win that race often enough to hide it; WebKit
   * does not, which is why the Pacer stopped after every page turn in the
   * packaged app but not in the browser.
   */
  let relocationWaiters: (() => void)[] = []

  function whenRelocated(timeoutMs: number): Promise<void> {
    return new Promise((resolve) => {
      let settled = false
      const finish = () => {
        if (settled) return
        settled = true
        clearTimeout(timer)
        const index = relocationWaiters.indexOf(finish)
        if (index !== -1) relocationWaiters.splice(index, 1)
        resolve()
      }
      // A `next()` that turns out to be a no-op never relocates; the Pacer must
      // not hang waiting for an event that is not coming.
      const timer = setTimeout(finish, timeoutMs)
      relocationWaiters.push(finish)
    })
  }

  rendition.on('relocated', (location: RelocatedEvent) => {
    lastLocation = makeLocationPayload(location)
    options.onLocation?.(lastLocation)
    const waiters = relocationWaiters
    relocationWaiters = []
    for (const resolve of waiters) resolve()
  })

  // Display initial position
  await rendition.display(startCfi ?? undefined)

  let destroyed = false
  void book.locations
    .generate(LOCATION_CHARS)
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

  /**
   * Words on the page, measured.
   *
   * Two passes exist because the fast one is built on
   * `Range.getBoundingClientRect()` over a whole text node, and engines do not
   * always agree about that rect inside a CSS multi-column layout. If the cull
   * yields nothing, measuring every token is slower but is the behaviour that
   * predates the optimisation — and it means an engine disagreement costs
   * frames rather than leaving the Pacer with nothing to pace.
   */
  function collectWords(includeWholeScrolledSection: boolean): WordItem[] {
    const culled = measureWords(includeWholeScrolledSection, true)
    if (culled.length > 0) return culled
    return measureWords(includeWholeScrolledSection, false)
  }

  function measureWords(
    includeWholeScrolledSection: boolean,
    cull: boolean,
  ): WordItem[] {
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
    const cullToViewport =
      cull && !(includeWholeScrolledSection && currentFlow === 'scrolled-doc')
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
              // Justified English is hyphenated, so a word the renderer broke
              // across a line comes back as two boxes. Both are the word.
              const fragments =
                rects.length > 1
                  ? Array.from(rects, (piece) => ({
                      left: piece.left,
                      top: piece.top,
                      width: piece.width,
                      height: piece.height,
                      bottom: piece.bottom,
                      right: piece.right,
                    })).filter((piece) => piece.width > 0 && piece.height > 0)
                  : undefined

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
                ...(fragments && fragments.length > 1 ? { fragments } : {}),
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
    setSpread: async (mode: 'auto' | 'single' | 'double', minSpreadWidth?: number) => {
      const nextMin = minSpreadWidth ?? currentMinSpreadWidth
      if (mode === currentSpreadMode && nextMin === currentMinSpreadWidth) return
      currentSpreadMode = mode
      currentMinSpreadWidth = nextMin
      const currentLoc = rendition.location?.start?.cfi
      const spreadValue = mode === 'single' ? 'none' : mode === 'double' ? 'always' : 'auto'
      rendition.spread(spreadValue, currentMinSpreadWidth)
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
    getColumnPitch,
    cfiFromRange: (range: Range) => {
      try {
        const doc = range.startContainer.ownerDocument
        const contents = rendition.getContents() as unknown as Contents[]
        const list = Array.isArray(contents) ? contents : [contents]
        const owner = list.find((candidate) => candidate?.document === doc)
        if (!owner) return null
        const point = range.cloneRange()
        point.collapse(true)
        return owner.cfiFromRange(point)
      } catch {
        // A range whose document has gone has no position worth recording.
        return null
      }
    },
    rangeFromCfi: (cfi: string) => {
      try {
        return rendition.getRange(cfi) ?? null
      } catch {
        return null
      }
    },
    handleWheel,
    getIframeElement: getIframe,
    getScrollElement,
    getCurrentLocation: () => lastLocation,
    addHighlight: (annotationId, cfiRange, color, emphasis = false) => {
      const palette = highlightPalette(color)
      const fillOpacity = emphasis
        ? String(Math.min(0.85, Number(palette.fillOpacity) * 2.4))
        : palette.fillOpacity
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
            'fill-opacity': fillOpacity,
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
    sentenceForCfiRange: (cfiRange) => {
      try {
        const range = rendition.getRange(cfiRange)
        return range ? sentenceAroundRange(range) : ''
      } catch {
        return ''
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
      // Subscribe before turning: the event can land while `next()` is still
      // settling, and missing it would look exactly like a failed page turn.
      const relocated = whenRelocated(RELOCATION_TIMEOUT_MS)
      await rendition.next()
      await relocated
      return Boolean(lastLocation?.cfi && lastLocation.cfi !== before)
    },
    ensurePacerRectVisible,
    fontsReady: async () => {
      const fonts = getIframe()?.contentDocument?.fonts
      if (fonts) await fonts.ready
    },
    destroy() {
      destroyed = true
      document.removeEventListener('mouseup', onWindowMouseUp)
      if (flushTimer !== null) clearTimeout(flushTimer)
      rendition.destroy()
      book.destroy()
    },
  }
}

/**
 * How far off-screen a box has to sit before it is the hiding trick below
 * rather than a legitimate layout.
 */
const OFFSCREEN_THRESHOLD_PX = -2000

/**
 * Re-express "hidden off-screen" text so it does not blow up pagination.
 *
 * Books hide text from sighted readers while keeping it for screen readers with
 * the old recipe `position: absolute; left: -999em` — Standard Ebooks uses it on
 * every title page, imprint and colophon, where the words are already in the
 * artwork. It is correct HTML.
 *
 * epub.js measures a section's width from `range.getBoundingClientRect().width`
 * over the whole body, and that box spans from the hidden element to the last
 * glyph: −999em at a 34px heading is −33966px, so a title page measured 34740px
 * wide and paginated into forty-one columns, forty of them empty. That is the
 * "dozens of blank pages" — not the book, and not the parse.
 *
 * The fix keeps the element exactly as visible as it was, and in the
 * accessibility tree, by swapping the offset for the modern clip recipe: a 1px
 * box at the origin. Only elements actually parked off-screen are touched.
 */
function neutraliseOffscreenText(doc: Document, view: Window) {
  // One measurement first: a section without the trick pays nothing.
  const probe = doc.createRange()
  probe.selectNodeContents(doc.body)
  if (probe.getBoundingClientRect().left > OFFSCREEN_THRESHOLD_PX) return

  for (const element of doc.body.querySelectorAll<HTMLElement>('*')) {
    const style = view.getComputedStyle(element)
    if (style.position !== 'absolute' && style.position !== 'fixed') continue
    const left = Number.parseFloat(style.left)
    const top = Number.parseFloat(style.top)
    const parked =
      (Number.isFinite(left) && left < OFFSCREEN_THRESHOLD_PX) ||
      (Number.isFinite(top) && top < OFFSCREEN_THRESHOLD_PX)
    if (!parked) continue

    for (const [property, value] of [
      ['left', '0'],
      ['top', '0'],
      ['width', '1px'],
      ['height', '1px'],
      ['overflow', 'hidden'],
      ['clip-path', 'inset(50%)'],
      ['white-space', 'nowrap'],
    ] as const) {
      element.style.setProperty(property, value, 'important')
    }
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

/** Must match the argument given to `book.locations.generate()` below. */
const LOCATION_CHARS = 1000

function charactersLeftFrom(book: Book, cfi: string): number | null {
  const locations = book.locations as unknown as {
    total?: number
    locationFromCfi?: (cfi: string) => number
  }
  const total = locations.total
  const current = locations.locationFromCfi?.(cfi)
  if (typeof total !== 'number' || typeof current !== 'number' || current < 0) return null
  return Math.max(0, total - current) * LOCATION_CHARS
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
