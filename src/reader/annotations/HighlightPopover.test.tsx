import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { Annotation } from '../../platform/types'
import { HighlightPopover, type DefinitionState, type HighlightDraft } from './HighlightPopover'

/**
 * Rendered with `react-dom/client` rather than a testing library: the whole
 * question here is what the DOM looks like, and one `createRoot` answers it
 * without adding a dependency.
 */
let root: Root | null = null
let host: HTMLDivElement | null = null

function render(props: Partial<Parameters<typeof HighlightPopover>[0]> = {}) {
  const draft: HighlightDraft = {
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
        draft={draft}
        bounds={{ width: 900, height: 700 }}
        definition={{ status: 'found', word: 'running', definition: 'Act of running.' }}
        vocabulary="none"
        onApply={() => {}}
        onDelete={() => {}}
        onClose={() => {}}
        onVocabularyChange={() => {}}
        onSearch={() => {}}
        onCopy={() => {}}
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

describe('HighlightPopover definition area', () => {
  const cases: [string, DefinitionState, string][] = [
    ['the entry it found', { status: 'found', word: 'run', definition: 'To move swiftly.' }, 'To move swiftly.'],
    ['that it is still looking', { status: 'loading' }, '查询中'],
    ['that there is no entry', { status: 'missing', word: 'zzz' }, 'zzz'],
    ['that there is no dictionary', { status: 'unavailable' }, '此版本没有词典'],
  ]

  for (const [name, state, expected] of cases) {
    it(`shows ${name}`, () => {
      const container = render({ definition: state })
      expect(container.querySelector('[data-testid="popover-definition"]')!.textContent).toContain(
        expected,
      )
    })
  }
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

  it('hands searching and copying to the reader without closing', () => {
    const onSearch = vi.fn()
    const onCopy = vi.fn()
    const onClose = vi.fn()

    const container = render({ onSearch, onCopy, onClose })
    act(() => action(container, 'search').click())
    act(() => action(container, 'copy').click())

    expect(onSearch).toHaveBeenCalledTimes(1)
    expect(onCopy).toHaveBeenCalledTimes(1)
    // The popover is a hub: doing one thing does not end the interaction.
    expect(onClose).not.toHaveBeenCalled()
  })

  it('still saves a highlight from the colour swatches', () => {
    const onApply = vi.fn()
    const container = render({ onApply })
    const swatches = container.querySelectorAll<HTMLButtonElement>('button[aria-pressed]')

    act(() => swatches[1].click())

    expect(onApply).toHaveBeenCalledWith('green', '')
  })
})
