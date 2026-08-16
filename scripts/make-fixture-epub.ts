/**
 * Writes the generated fixture EPUB to `.local/fixtures/fixture.epub` so the
 * browser smoke check has a real book to import. Never downloads anything.
 *
 *   bun run fixture
 */
import { mkdir, writeFile } from 'node:fs/promises'
import { dirname } from 'node:path'
import { buildFixtureEpub } from '../src/test/fixture-epub'

const OUTPUT = '.local/fixtures/fixture.epub'

const epub = await buildFixtureEpub({
  title: 'VeloRead Fixture',
  author: 'Ada Fixture',
  // Long enough that the paginated reader has several pages to turn through.
  chapters: 4,
  paragraphsPerChapter: 25,
})

await mkdir(dirname(OUTPUT), { recursive: true })
await writeFile(OUTPUT, epub)
console.log(`wrote ${OUTPUT} (${epub.byteLength} bytes)`)
