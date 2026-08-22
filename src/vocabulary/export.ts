import type { BookRecord, VocabularyEntry } from '../platform/types'

/**
 * Getting the vocabulary list out as plain text.
 *
 * The point of the feature is that a Kindle will not let you do this
 * (docs/specs/vocabulary.md §2), so the format is chosen for whatever script
 * reads it next, not for how it looks: one record per word, a keyword in the
 * first column, tabs between fields, and a header that names the field order so
 * the file explains itself.
 *
 * Highlights leave in Kindle's `My Clippings.txt` shape because a whole
 * ecosystem already parses that. Nothing comparable exists for vocabulary —
 * `vocab.db` is a private SQLite file — so there is no format to align with and
 * being trivially parseable is the whole brief.
 *
 * No "already exported" marking: every export is the complete list (§8).
 */

const RECORD_SEPARATOR = '=========='
const FIELD_SEPARATOR = '\t'

/**
 * A word with the definition to print beside it.
 *
 * The definition is not stored on the vocabulary row — the dictionary already
 * holds it, and copying a paragraph of prose into the user's database once per
 * word would duplicate the asset the whole design keeps separate. It is looked
 * up again at export time, which is the only moment it is needed.
 */
export interface VocabularyExportEntry extends VocabularyEntry {
  definition: string | null
}

export interface VocabularyExportInput {
  entries: VocabularyExportEntry[]
  /** Titles for the books the sentences came from, by book id. */
  books: Record<string, BookRecord>
  /** ISO-8601, from the caller: this module does not read the clock. */
  exportedAt: string
}

/** Bare filename, never a path — `FsPort` rejects anything else. */
export const VOCABULARY_FILE_NAME = 'VeloRead Vocabulary.txt'

/**
 * Tabs and newlines are the record structure, so no field may contain one.
 *
 * A definition is a whole paragraph of prose and routinely holds both. Folding
 * the whitespace is lossless enough for a wordlist and keeps every record
 * exactly as many lines as it says it is.
 */
function oneLine(value: string): string {
  return value.replace(/\s+/gu, ' ').trim()
}

export function formatVocabulary({
  entries,
  books,
  exportedAt,
}: VocabularyExportInput): string {
  const header = [
    '# VeloRead vocabulary',
    `# Exported ${exportedAt}`,
    `# ${entries.length} words`,
    '#',
    '# One record per word, separated by a line of ten "=".',
    '# Every line is TAB-separated and starts with its field name:',
    '#   WORD<TAB>the form it was first met in',
    '#   STEM<TAB>what the word is filed under',
    '#   LANG<TAB>language tag',
    '#   STATUS<TAB>learning | known',
    '#   ADDED<TAB>ISO-8601 timestamp',
    '#   DEFINITION<TAB>dictionary entry, whitespace folded to single spaces',
    '#   SENTENCE<TAB>sentence<TAB>book title<TAB>locator<TAB>ISO-8601 timestamp',
    '# A word has one SENTENCE line per time it was looked up, oldest first.',
    '# DEFINITION is absent when the dictionary had no entry; a book title is',
    '# empty when that book is no longer in the library.',
  ]

  const records = entries.map((entry) => {
    const lines = [
      `WORD${FIELD_SEPARATOR}${oneLine(entry.word.word)}`,
      `STEM${FIELD_SEPARATOR}${oneLine(entry.word.stem)}`,
      `LANG${FIELD_SEPARATOR}${oneLine(entry.word.lang)}`,
      `STATUS${FIELD_SEPARATOR}${entry.word.status}`,
      `ADDED${FIELD_SEPARATOR}${entry.word.createdAt}`,
    ]
    if (entry.definition) {
      lines.push(`DEFINITION${FIELD_SEPARATOR}${oneLine(entry.definition)}`)
    }
    for (const lookup of entry.lookups) {
      const title = lookup.bookId ? (books[lookup.bookId]?.title ?? '') : ''
      lines.push(
        [
          'SENTENCE',
          oneLine(lookup.sentence),
          oneLine(title),
          oneLine(lookup.locator ?? ''),
          lookup.createdAt,
        ].join(FIELD_SEPARATOR),
      )
    }
    return lines.join('\n')
  })

  return [
    ...header,
    RECORD_SEPARATOR,
    ...records.flatMap((record) => [record, RECORD_SEPARATOR]),
    '',
  ].join('\n')
}
