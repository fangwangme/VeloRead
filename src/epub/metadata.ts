import JSZip from 'jszip'

const NS_CONTAINER = 'urn:oasis:names:tc:opendocument:xmlns:container'
const NS_OPF = 'http://www.idpf.org/2007/opf'
const NS_DC = 'http://purl.org/dc/elements/1.1/'

export interface EpubCover {
  mime: string
  data: Uint8Array
}

export interface EpubMetadata {
  /** Empty string when the OPF declares no `dc:title`; callers fall back to the filename. */
  title: string
  /** All `dc:creator` values joined with ", ", or null when there are none. */
  author: string | null
  language: string | null
  cover: EpubCover | null
}

/** Raised for anything that makes the file unusable as an EPUB. */
export class EpubParseError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'EpubParseError'
  }
}

/**
 * Read title/author/language/cover straight out of the OPF package document.
 *
 * Deliberately not routed through epub.js: importing a book must work before
 * anything is rendered, and a plain zip+XML path is testable under jsdom.
 */
export async function parseEpubMetadata(input: Uint8Array | ArrayBuffer): Promise<EpubMetadata> {
  const zip = await loadZip(input)

  const containerXml = await readText(zip, 'META-INF/container.xml')
  if (containerXml === null) {
    throw new EpubParseError('Not an EPUB: META-INF/container.xml is missing')
  }
  const opfPath = readRootfilePath(parseXml(containerXml, 'META-INF/container.xml'))

  const opfXml = await readText(zip, opfPath)
  if (opfXml === null) {
    throw new EpubParseError(`Broken EPUB: package document "${opfPath}" is missing`)
  }
  const opf = parseXml(opfXml, opfPath)

  return {
    title: textOf(findAll(opf, NS_DC, 'title')[0]),
    author: joinCreators(findAll(opf, NS_DC, 'creator')),
    language: textOf(findAll(opf, NS_DC, 'language')[0]) || null,
    cover: await readCover(zip, opf, opfPath),
  }
}

async function loadZip(input: Uint8Array | ArrayBuffer): Promise<JSZip> {
  try {
    return await JSZip.loadAsync(input)
  } catch (cause) {
    throw new EpubParseError(`Not an EPUB: the file is not a readable zip archive (${String(cause)})`)
  }
}

function readRootfilePath(container: Document): string {
  const rootfile = findAll(container, NS_CONTAINER, 'rootfile')[0]
  const path = rootfile?.getAttribute('full-path')?.trim()
  if (!path) {
    throw new EpubParseError('Broken EPUB: container.xml declares no rootfile full-path')
  }
  return decodeURIComponent(path)
}

async function readCover(zip: JSZip, opf: Document, opfPath: string): Promise<EpubCover | null> {
  const items = findAll(opf, NS_OPF, 'item')

  // EPUB 3 marks the cover on the manifest item itself.
  let item = items.find((el) => (el.getAttribute('properties') ?? '').split(/\s+/).includes('cover-image'))

  // EPUB 2 points at it from <meta name="cover" content="<id>">.
  if (!item) {
    const id = findAll(opf, NS_OPF, 'meta')
      .find((el) => el.getAttribute('name') === 'cover')
      ?.getAttribute('content')
    if (id) item = items.find((el) => el.getAttribute('id') === id)
  }

  const href = item?.getAttribute('href')
  const mime = item?.getAttribute('media-type')
  if (!href || !mime?.startsWith('image/')) return null

  const data = await zip.file(resolveHref(opfPath, href))?.async('uint8array')
  return data ? { mime, data } : null
}

/** Resolve a manifest href against the directory holding the OPF. */
export function resolveHref(opfPath: string, href: string): string {
  const decoded = decodeURIComponent(href)
  const fromRoot = decoded.startsWith('/')
  const baseDir = fromRoot || !opfPath.includes('/') ? '' : opfPath.slice(0, opfPath.lastIndexOf('/'))

  const out: string[] = []
  for (const segment of `${baseDir}/${decoded}`.split('/')) {
    if (segment === '' || segment === '.') continue
    if (segment === '..') out.pop()
    else out.push(segment)
  }
  return out.join('/')
}

function readText(zip: JSZip, path: string): Promise<string | null> {
  const file = zip.file(path)
  return file ? file.async('string') : Promise.resolve(null)
}

function parseXml(xml: string, path: string): Document {
  const doc = new DOMParser().parseFromString(xml, 'application/xml')
  if (doc.getElementsByTagName('parsererror').length > 0) {
    throw new EpubParseError(`Broken EPUB: "${path}" is not well-formed XML`)
  }
  return doc
}

/**
 * Namespace-aware element lookup with a prefix fallback, because EPUBs in the
 * wild ship package documents that declare no namespace at all.
 */
function findAll(doc: Document, namespace: string, localName: string): Element[] {
  const namespaced = Array.from(doc.getElementsByTagNameNS(namespace, localName))
  if (namespaced.length > 0) return namespaced
  return Array.from(doc.getElementsByTagName(localName)).filter((el) => el.namespaceURI === null)
}

function textOf(element: Element | undefined): string {
  return element?.textContent?.trim() ?? ''
}

function joinCreators(elements: Element[]): string | null {
  const names = elements.map(textOf).filter(Boolean)
  return names.length > 0 ? names.join(', ') : null
}
