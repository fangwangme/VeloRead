import { describe, expect, it } from 'vitest'
import { EpubParseError, parseEpubMetadata, resolveHref } from './metadata'
import { buildFixtureEpub, fixtureCoverBytes } from '../test/fixture-epub'

describe('parseEpubMetadata', () => {
  it('reads title, author, language and cover out of the package document', async () => {
    const epub = await buildFixtureEpub({
      title: 'Tender Is the Night',
      author: 'F. Scott Fitzgerald',
      language: 'en-GB',
    })

    const metadata = await parseEpubMetadata(epub)

    expect(metadata.title).toBe('Tender Is the Night')
    expect(metadata.author).toBe('F. Scott Fitzgerald')
    expect(metadata.language).toBe('en-GB')
    expect(metadata.cover?.mime).toBe('image/png')
    // The cover href is relative to OEBPS/content.opf, so finding these exact
    // bytes proves the manifest href was resolved against the OPF directory.
    expect(metadata.cover?.data).toEqual(fixtureCoverBytes())
  })

  it('reports no cover when the manifest declares none', async () => {
    const metadata = await parseEpubMetadata(await buildFixtureEpub({ withCover: false }))
    expect(metadata.cover).toBeNull()
  })

  it('rejects a file that is not a zip archive', async () => {
    const notAnEpub = new TextEncoder().encode('this is a plain text file, not an EPUB')
    await expect(parseEpubMetadata(notAnEpub)).rejects.toBeInstanceOf(EpubParseError)
  })
})

describe('resolveHref', () => {
  it('resolves against the directory holding the OPF', () => {
    expect(resolveHref('OEBPS/content.opf', 'images/cover.png')).toBe('OEBPS/images/cover.png')
    expect(resolveHref('OEBPS/content.opf', '../cover.png')).toBe('cover.png')
    expect(resolveHref('content.opf', 'cover.png')).toBe('cover.png')
    expect(resolveHref('OEBPS/content.opf', '/cover.png')).toBe('cover.png')
    expect(resolveHref('OEBPS/content.opf', 'My%20Cover.png')).toBe('OEBPS/My Cover.png')
  })
})
