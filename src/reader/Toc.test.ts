import { describe, expect, it } from 'vitest'
import type { TocItem } from '../platform/types'
import { resolveActiveTocId } from './tocActive'

const toc: TocItem[] = [
  { id: 'one', label: 'One', href: 'chapter.xhtml#one' },
  { id: 'two', label: 'Two', href: 'chapter.xhtml#two' },
  { id: 'next', label: 'Next', href: 'next.xhtml' },
]

describe('resolveActiveTocId', () => {
  it('selects exactly the requested fragment when several entries share a document', () => {
    expect(resolveActiveTocId(toc, null, 'chapter.xhtml#two')).toBe('two')
  })

  it('uses the renderer-resolved id when relocated href omits its fragment', () => {
    expect(resolveActiveTocId(toc, 'two', 'chapter.xhtml')).toBe('two')
  })

  it('falls back to one entry rather than highlighting all document matches', () => {
    expect(resolveActiveTocId(toc, null, 'chapter.xhtml')).toBe('one')
  })
})
