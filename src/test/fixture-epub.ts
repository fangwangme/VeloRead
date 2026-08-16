import JSZip from 'jszip'

/**
 * Builds a minimal but valid EPUB 2 in memory.
 *
 * Tests and the browser smoke check need a real book without downloading one,
 * so the fixture is generated rather than committed. Content lives under
 * `OEBPS/` on purpose: it exercises href resolution relative to the OPF.
 */
export interface FixtureOptions {
  title?: string
  author?: string
  language?: string
  chapters?: number
  /** Bumped by the CLI generator so the smoke test has pages to turn. */
  paragraphsPerChapter?: number
  withCover?: boolean
}

/** A 1×1 PNG — the smallest thing that is unambiguously an image. */
const COVER_PNG_BASE64 =
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg=='

export async function buildFixtureEpub(options: FixtureOptions = {}): Promise<Uint8Array> {
  const {
    title = 'Fixture Book',
    author = 'Ada Fixture',
    language = 'en',
    chapters = 2,
    paragraphsPerChapter = 3,
    withCover = true,
  } = options

  const chapterIds = Array.from({ length: chapters }, (_, index) => `chapter${index + 1}`)
  const zip = new JSZip()

  // The mimetype entry must come first and be stored uncompressed.
  zip.file('mimetype', 'application/epub+zip', { compression: 'STORE' })

  zip.file(
    'META-INF/container.xml',
    `<?xml version="1.0" encoding="UTF-8"?>
<container version="1.0" xmlns="urn:oasis:names:tc:opendocument:xmlns:container">
  <rootfiles>
    <rootfile full-path="OEBPS/content.opf" media-type="application/oebps-package+xml"/>
  </rootfiles>
</container>`,
  )

  zip.file('OEBPS/content.opf', packageDocument({ title, author, language, chapterIds, withCover }))
  zip.file('OEBPS/toc.ncx', navigationDocument(title, chapterIds))

  for (const [index, id] of chapterIds.entries()) {
    zip.file('OEBPS/' + id + '.xhtml', chapterDocument(index + 1, paragraphsPerChapter))
  }

  if (withCover) {
    zip.file('OEBPS/cover.png', COVER_PNG_BASE64, { base64: true })
  }

  return zip.generateAsync({ type: 'uint8array' })
}

/** The exact bytes the fixture stores as its cover, for assertions. */
export function fixtureCoverBytes(): Uint8Array {
  const binary = atob(COVER_PNG_BASE64)
  return Uint8Array.from(binary, (character) => character.charCodeAt(0))
}

function packageDocument(input: {
  title: string
  author: string
  language: string
  chapterIds: string[]
  withCover: boolean
}): string {
  const manifest = input.chapterIds
    .map((id) => `    <item id="${id}" href="${id}.xhtml" media-type="application/xhtml+xml"/>`)
    .join('\n')
  const spine = input.chapterIds.map((id) => `    <itemref idref="${id}"/>`).join('\n')

  return `<?xml version="1.0" encoding="UTF-8"?>
<package xmlns="http://www.idpf.org/2007/opf" version="2.0" unique-identifier="bookid">
  <metadata xmlns:dc="http://purl.org/dc/elements/1.1/" xmlns:opf="http://www.idpf.org/2007/opf">
    <dc:identifier id="bookid">urn:uuid:veloread-fixture</dc:identifier>
    <dc:title>${input.title}</dc:title>
    <dc:creator>${input.author}</dc:creator>
    <dc:language>${input.language}</dc:language>
${input.withCover ? '    <meta name="cover" content="cover-image"/>' : ''}
  </metadata>
  <manifest>
    <item id="ncx" href="toc.ncx" media-type="application/x-dtbncx+xml"/>
${input.withCover ? '    <item id="cover-image" href="cover.png" media-type="image/png"/>' : ''}
${manifest}
  </manifest>
  <spine toc="ncx">
${spine}
  </spine>
</package>`
}

function navigationDocument(title: string, chapterIds: string[]): string {
  const points = chapterIds
    .map(
      (id, index) => `    <navPoint id="nav-${id}" playOrder="${index + 1}">
      <navLabel><text>Chapter ${index + 1}</text></navLabel>
      <content src="${id}.xhtml"/>
    </navPoint>`,
    )
    .join('\n')

  return `<?xml version="1.0" encoding="UTF-8"?>
<ncx xmlns="http://www.daisy.org/z3986/2005/ncx/" version="2005-1">
  <head><meta name="dtb:uid" content="urn:uuid:veloread-fixture"/></head>
  <docTitle><text>${title}</text></docTitle>
  <navMap>
${points}
  </navMap>
</ncx>`
}

function chapterDocument(number: number, paragraphs: number): string {
  const body = Array.from(
    { length: paragraphs },
    (_, index) =>
      `  <p>Chapter ${number}, paragraph ${index + 1}. ` +
      'The quick brown fox jumps over the lazy dog. '.repeat(12) +
      '</p>',
  ).join('\n')

  return `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE html>
<html xmlns="http://www.w3.org/1999/xhtml">
<head><title>Chapter ${number}</title></head>
<body>
  <h1>Chapter ${number}</h1>
${body}
</body>
</html>`
}
