import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { Annotation } from '../../platform/types'
import { formatDefinition } from '../../vocabulary/formatDefinition'
import { HighlightPopover, type DefinitionState, type HighlightDraft } from './HighlightPopover'

/**
 * Rendered with `react-dom/client` rather than a testing library: the whole
 * question here is what the DOM looks like, and one `createRoot` answers it
 * without adding a dependency.
 */
let root: Root | null = null
let host: HTMLDivElement | null = null

function render(props: Partial<Parameters<typeof HighlightPopover>[0]> = {}) {
  const draft: HighlightDraft = props.draft ?? {
    annotation: null,
    cfiRange: 'epubcfi(/6/2!/4/2,/1:0,/1:7)',
    text: 'running',
    rect: { left: 200, top: 300, width: 60, height: 18 },
  }

  host = document.createElement('div')
  document.body.append(host)
  const container = host
  act(() => {
    root = createRoot(container)
    root.render(
      <HighlightPopover
        // Keyed by the passage, as `Reader.tsx` does.
        key={draft.cfiRange}
        draft={draft}
        bounds={{ width: 900, height: 700 }}
        definition={{ status: 'found', word: 'running', definition: 'Act of running.' }}
        vocabulary="none"
        onApply={() => {}}
        onDelete={() => {}}
        onClose={() => {}}
        onVocabularyChange={() => {}}
        onSearch={() => {}}
        onCopy={async () => true}
        onDownloadDictionary={() => {}}
        {...props}
      />,
    )
  })
  return container
}

/** The action row, in the order it is painted. */
function actions(container: HTMLElement): string[] {
  const row = container.querySelector('[data-testid="popover-actions"]')!
  return [...row.querySelectorAll('button')].map((button) => button.dataset.action!)
}

function action(container: HTMLElement, name: string): HTMLButtonElement {
  return container.querySelector<HTMLButtonElement>(`button[data-action="${name}"]`)!
}

/**
 * Type into a controlled field.
 *
 * Through the prototype's setter, not `element.value =`: React tracks the last
 * value it wrote, and a direct assignment updates the DOM while leaving that
 * tracker untouched — so the change event is discarded as a no-op and the DOM
 * silently reverts on the next render.
 */
function type(element: HTMLTextAreaElement, value: string) {
  const setter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')!.set!
  setter.call(element, value)
  element.dispatchEvent(new Event('input', { bubbles: true }))
}

afterEach(() => {
  act(() => root?.unmount())
  root = null
  host?.remove()
  host = null
  vi.restoreAllMocks()
})

describe('HighlightPopover structure', () => {
  /**
   * The product decision this component exists to hold: fixed structure,
   * optional content. If the actions ever reorder or come and go with the
   * length of the selection, muscle memory never forms.
   */
  it('paints the same actions in the same order for a word and for a sentence', () => {
    const word = render({ definition: { status: 'found', word: 'run', definition: 'To move.' } })
    const wordActions = actions(word)

    act(() => root?.unmount())
    host?.remove()

    const sentence = render({
      definition: null,
      draft: {
        annotation: null,
        cfiRange: 'epubcfi(/6/2!/4/4,/1:0,/1:30)',
        text: 'He kept running until it was dark.',
        rect: { left: 100, top: 300, width: 400, height: 40 },
      },
    })

    expect(wordActions).toEqual(['vocabulary', 'note', 'search', 'copy', 'delete'])
    expect(actions(sentence)).toEqual(wordActions)
  })

  it('renders the definition area only for a single word, always at the top', () => {
    const word = render()
    const area = word.querySelector('[data-testid="popover-definition"]')
    expect(area).not.toBeNull()
    // First child of the panel: the definition is the top of the popover.
    expect(area!.parentElement!.firstElementChild).toBe(area)

    act(() => root?.unmount())
    host?.remove()

    const sentence = render({ definition: null })
    // Not rendered at all — never rendered empty.
    expect(sentence.querySelector('[data-testid="popover-definition"]')).toBeNull()
    expect(actions(sentence)).toHaveLength(5)
  })

  it('disables rather than removes the actions that do not apply', () => {
    const sentence = render({ definition: null })
    // A sentence has no vocabulary entry, but the button holds its place.
    expect(action(sentence, 'vocabulary').disabled).toBe(true)
    // Nothing highlighted yet, so there is nothing to delete — still in place.
    expect(action(sentence, 'delete').disabled).toBe(true)
  })

  it('enables delete once the selection is a stored highlight', () => {
    const annotation: Annotation = {
      id: 'a1',
      bookId: 'b1',
      cfiRange: 'epubcfi(/6/2!/4/2,/1:0,/1:7)',
      text: 'running',
      note: '',
      color: 'yellow',
      chapterTitle: null,
      source: 'local',
      createdAt: '2026-08-22T10:00:00.000Z',
      updatedAt: '2026-08-22T10:00:00.000Z',
    }
    const container = render({
      draft: {
        annotation,
        cfiRange: annotation.cfiRange,
        text: annotation.text,
        rect: { left: 200, top: 300, width: 60, height: 18 },
      },
    })
    expect(action(container, 'delete').disabled).toBe(false)
  })
})

describe('HighlightPopover anchoring', () => {
  const topOf = (container: HTMLElement) =>
    Number.parseInt(container.querySelector<HTMLElement>('[role="dialog"]')!.style.top, 10)

  it('never anchors above the top of the reading area, note open or shut', () => {
    // Just enough room above for the collapsed popover and not for the note
    // editor. `preferAbove` is decided from the same estimate that the note
    // grows, so opening it flips the popover below rather than off the top.
    const container = render({
      draft: {
        annotation: null,
        cfiRange: 'epubcfi(/6/2!/4/2,/1:0,/1:7)',
        text: 'running',
        rect: { left: 200, top: 250, width: 60, height: 18 },
      },
    })
    expect(topOf(container)).toBeGreaterThanOrEqual(0)

    act(() => action(container, 'note').click())
    expect(topOf(container)).toBeGreaterThanOrEqual(0)
  })

  it('keeps the panel inside the reading area for a selection at the very top', () => {
    const container = render({
      draft: {
        annotation: null,
        cfiRange: 'epubcfi(/6/2!/4/2,/1:0,/1:7)',
        text: 'running',
        rect: { left: 0, top: 0, width: 60, height: 18 },
      },
    })
    expect(topOf(container)).toBeGreaterThanOrEqual(0)
    act(() => action(container, 'note').click())
    expect(topOf(container)).toBeGreaterThanOrEqual(0)
  })
})

describe('HighlightPopover definition area', () => {
  const cases: [string, DefinitionState, string][] = [
    ['the entry it found', { status: 'found', word: 'run', definition: 'To move swiftly.' }, 'To move swiftly.'],
    ['that it is still looking', { status: 'loading' }, '查询中'],
    ['that there is no entry', { status: 'missing', word: 'zzz' }, 'zzz'],
    [
      'that this target cannot install a dictionary',
      { status: 'unavailable', download: null },
      '此版本没有词典',
    ],
  ]

  for (const [name, state, expected] of cases) {
    it(`shows ${name}`, () => {
      const container = render({ definition: state })
      expect(container.querySelector('[data-testid="popover-definition"]')!.textContent).toContain(
        expected,
      )
    })
  }

  it('offers one explicit download and reports its progress', () => {
    const onDownloadDictionary = vi.fn()
    const container = render({
      definition: {
        status: 'unavailable',
        download: { status: 'available', sizeBytes: 27_324_416 },
      },
      onDownloadDictionary,
    })

    const button = container.querySelector<HTMLButtonElement>('[data-testid="dictionary-download"]')!
    expect(button.textContent).toContain('27.3 MB')
    act(() => button.click())
    expect(onDownloadDictionary).toHaveBeenCalledOnce()

    act(() => {
      root!.render(
        <HighlightPopover
          draft={{
            annotation: null,
            cfiRange: 'epubcfi(/6/2!/4/2,/1:0,/1:7)',
            text: 'running',
            rect: { left: 200, top: 300, width: 60, height: 18 },
          }}
          bounds={{ width: 900, height: 700 }}
          definition={{
            status: 'unavailable',
            download: {
              status: 'downloading',
              downloadedBytes: 13_662_208,
              totalBytes: 27_324_416,
            },
          }}
          vocabulary="none"
          onApply={() => {}}
          onDelete={() => {}}
          onClose={() => {}}
          onVocabularyChange={() => {}}
          onSearch={() => {}}
          onCopy={async () => true}
          onDownloadDictionary={onDownloadDictionary}
        />,
      )
    })
    expect(container.textContent).toContain('50%')
    expect(container.querySelector('[data-testid="dictionary-download"]')).toBeNull()
  })

  it('shows the actual installation failure instead of blaming the network', () => {
    const container = render({
      definition: {
        status: 'unavailable',
        download: {
          status: 'failed',
          sizeBytes: 27_324_416,
          message: 'HTTP status client error (404 Not Found)',
        },
      },
    })

    expect(container.textContent).toContain('词典安装失败')
    expect(container.textContent).toContain('404 Not Found')
    expect(container.textContent).not.toContain('检查网络')
  })

  it('starts each numbered dictionary sense on a new line', () => {
    expect(
      formatDefinition(
        '1. First sense. Gen. vii. 17. John iii. 30. 2. Second sense. 3. Third sense.',
      ),
    ).toBe('1. First sense. Gen. vii. 17. John iii. 30.\n2. Second sense.\n3. Third sense.')
  })

  it('does not treat a numbered Bible citation as the next sense', () => {
    expect(
      formatDefinition('1. First. Col. iii. 2. The quotation continues. 2. Actual second sense.'),
    ).toBe('1. First. Col. iii. 2. The quotation continues.\n2. Actual second sense.')
  })

  it('preserves separate dictionary paragraphs', () => {
    expect(formatDefinition('One form.\n\n            1. Another form. 2. Next sense.')).toBe(
      'One form.\n\n1. Another form.\n2. Next sense.',
    )
  })
})

describe('HighlightPopover across a save', () => {
  /**
   * Picking a colour turns a fresh selection into a stored highlight. The
   * popover is keyed by the passage rather than by the saved row's id, so that
   * transition does not remount it — which is what lets a colour tap be
   * followed by writing a note, the thing this popover promises.
   */
  it('keeps a note being written when the selection becomes a saved highlight', () => {
    const cfiRange = 'epubcfi(/6/2!/4/2,/1:0,/1:7)'
    const rect = { left: 200, top: 300, width: 60, height: 18 }
    const container = render({ draft: { annotation: null, cfiRange, text: 'running', rect } })

    act(() => action(container, 'note').click())
    act(() => type(container.querySelector('textarea')!, 'half a thought'))
    expect(container.querySelector('textarea')!.value).toBe('half a thought')

    // Re-render the same root at the same key, now pointing at the saved row.
    const saved: Annotation = {
      id: 'a-new',
      bookId: 'b1',
      cfiRange,
      text: 'running',
      note: '',
      color: 'green',
      chapterTitle: null,
      source: 'local',
      createdAt: '2026-08-22T10:00:00.000Z',
      updatedAt: '2026-08-22T10:00:00.000Z',
    }
    act(() => {
      root!.render(
        <HighlightPopover
          key={cfiRange}
          draft={{ annotation: saved, cfiRange, text: 'running', rect }}
          bounds={{ width: 900, height: 700 }}
          definition={{ status: 'found', word: 'running', definition: 'Act of running.' }}
          vocabulary="none"
          onApply={() => {}}
          onDelete={() => {}}
          onClose={() => {}}
          onVocabularyChange={() => {}}
          onSearch={() => {}}
          onCopy={async () => true}
          onDownloadDictionary={() => {}}
        />,
      )
    })

    // Still open, still holding what was typed — and delete is live now.
    expect(container.querySelector('textarea')).not.toBeNull()
    expect(container.querySelector('textarea')!.value).toBe('half a thought')
    expect(action(container, 'delete').disabled).toBe(false)
  })
})

describe('HighlightPopover as a hub', () => {
  it('cycles the word through learning, known and out again', () => {
    const onVocabularyChange = vi.fn()

    const container = render({ vocabulary: 'none', onVocabularyChange })
    act(() => action(container, 'vocabulary').click())
    expect(onVocabularyChange).toHaveBeenLastCalledWith('learning')

    act(() => root?.unmount())
    host?.remove()
    const learning = render({ vocabulary: 'learning', onVocabularyChange })
    act(() => action(learning, 'vocabulary').click())
    expect(onVocabularyChange).toHaveBeenLastCalledWith('known')

    act(() => root?.unmount())
    host?.remove()
    const known = render({ vocabulary: 'known', onVocabularyChange })
    act(() => action(known, 'vocabulary').click())
    expect(onVocabularyChange).toHaveBeenLastCalledWith('none')
  })

  it('hands searching and copying to the reader without closing', async () => {
    const onSearch = vi.fn()
    const onCopy = vi.fn(async () => true)
    const onClose = vi.fn()

    const container = render({ onSearch, onCopy, onClose })
    act(() => action(container, 'search').click())
    await act(async () => action(container, 'copy').click())

    expect(onSearch).toHaveBeenCalledTimes(1)
    expect(onCopy).toHaveBeenCalledTimes(1)
    // The popover is a hub: doing one thing does not end the interaction.
    expect(onClose).not.toHaveBeenCalled()
  })

  it('shows copied only after the clipboard write succeeds', async () => {
    const failed = render({ onCopy: async () => false })
    await act(async () => action(failed, 'copy').click())
    expect(action(failed, 'copy').getAttribute('aria-label')).toContain('复制')

    act(() => root?.unmount())
    host?.remove()
    const succeeded = render({ onCopy: async () => true })
    await act(async () => action(succeeded, 'copy').click())
    expect(action(succeeded, 'copy').getAttribute('aria-label')).toContain('已复制')
  })

  it('does not save a highlight until a colour is explicitly chosen', () => {
    const onApply = vi.fn()
    const container = render({ onApply })
    const swatches = container.querySelectorAll<HTMLButtonElement>('button[aria-pressed]')

    // Opening the dictionary/action popover is only a transient selection.
    expect(onApply).not.toHaveBeenCalled()
    act(() => swatches[1].click())

    expect(onApply).toHaveBeenCalledWith('green', '')
  })
})
