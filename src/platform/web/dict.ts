import type {
  DictLookup,
  DictPort,
  DictStatus,
  VocabularyLookup,
  VocabularyLookupInput,
  VocabularyStatus,
  VocabularyWord,
} from '../types'
import { openVeloreadDb, VOCABULARY, VOCABULARY_LOOKUPS } from './storage'

/**
 * Browser implementation of `DictPort` — the vocabulary list in full, the
 * dictionary not at all.
 *
 * The 22 MB dictionary is the one capability that genuinely does not survive the
 * move to a page. It cannot be indexed on disk here, and pulling it into memory
 * is precisely the regression the desktop build exists to avoid
 * (docs/specs/overview.md §8). So `status().ready` is false, `lookup()` answers
 * that it knows nothing, and the reader shows the popover with its definition
 * area saying so — the actions beside it all keep working.
 *
 * Everything that is the *user's* data behaves exactly as it does on the
 * desktop, including the stem-based deduplication, so the browser target stays
 * usable for building this feature (AGENTS.md).
 */
export function createWebDict(): DictPort {
  let db: IDBDatabase | null = null

  function handle(): IDBDatabase {
    if (!db) throw new Error('dict port used before init()')
    return db
  }

  const unavailable: DictStatus = { ready: false, entries: 0, download: null }

  return {
    async init() {
      if (!db) db = await openVeloreadDb()
      return unavailable
    },

    async status() {
      return unavailable
    },

    async download() {
      throw new Error('The browser build cannot install a native SQLite dictionary')
    },

    async lookup() {
      // No dictionary: nothing is known, so the stem falls back to the rules
      // alone. See `resolveStem()` in src/vocabulary/lemma.ts.
      return { known: [], entry: null } satisfies DictLookup
    },

    async listVocabulary() {
      const tx = handle().transaction([VOCABULARY, VOCABULARY_LOOKUPS], 'readonly')
      const words = await request<VocabularyWord[]>(tx.objectStore(VOCABULARY).getAll())
      const lookups = await request<VocabularyLookup[]>(
        tx.objectStore(VOCABULARY_LOOKUPS).getAll(),
      )

      const byWord = new Map<string, VocabularyLookup[]>()
      for (const lookup of [...lookups].sort(byOldestFirst)) {
        const list = byWord.get(lookup.vocabularyId)
        if (list) list.push(lookup)
        else byWord.set(lookup.vocabularyId, [lookup])
      }

      // Newest word first, matching `ORDER BY created_at DESC, id DESC` in
      // `store::list_vocabulary`. The two must agree for the same data.
      return words
        .sort((a, b) => b.createdAt.localeCompare(a.createdAt) || b.id.localeCompare(a.id))
        .map((word) => ({ word, lookups: byWord.get(word.id) ?? [] }))
    },

    async recordLookup(input: VocabularyLookupInput) {
      const tx = handle().transaction([VOCABULARY, VOCABULARY_LOOKUPS], 'readwrite')
      const words = tx.objectStore(VOCABULARY)

      // Deduplicated on `(stem, lang)`, so meeting `ran` after `running` adds a
      // sentence to the entry that is already there. The stored form stays the
      // one it was first met in.
      const existing = await request<VocabularyWord | undefined>(
        words.index('by_stem').get([input.stem, input.lang]),
      )
      const word: VocabularyWord = existing ?? {
        id: input.wordId,
        word: input.word,
        stem: input.stem,
        lang: input.lang,
        status: 'learning',
        createdAt: input.createdAt,
      }
      if (!existing) words.add(word)

      tx.objectStore(VOCABULARY_LOOKUPS).put({
        id: input.lookupId,
        vocabularyId: word.id,
        bookId: input.bookId,
        locator: input.locator,
        sentence: input.sentence,
        createdAt: input.createdAt,
      } satisfies VocabularyLookup)

      await done(tx)
      return word
    },

    async setWordStatus(id: string, status: VocabularyStatus) {
      const tx = handle().transaction(VOCABULARY, 'readwrite')
      const store = tx.objectStore(VOCABULARY)
      const word = await request<VocabularyWord | undefined>(store.get(id))
      if (word) store.put({ ...word, status })
      await done(tx)
    },

    async deleteWord(id: string) {
      const tx = handle().transaction([VOCABULARY, VOCABULARY_LOOKUPS], 'readwrite')
      tx.objectStore(VOCABULARY).delete(id)

      // The sentences go with the word, as `ON DELETE CASCADE` does in SQLite.
      const lookups = tx.objectStore(VOCABULARY_LOOKUPS)
      const owned = await request<VocabularyLookup[]>(lookups.index('by_vocabularyId').getAll(id))
      for (const lookup of owned) lookups.delete(lookup.id)

      await done(tx)
    },
  }
}

function byOldestFirst(a: VocabularyLookup, b: VocabularyLookup): number {
  return a.createdAt.localeCompare(b.createdAt) || a.id.localeCompare(b.id)
}

function request<T>(req: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    req.onsuccess = () => resolve(req.result)
    req.onerror = () => reject(req.error ?? new Error('IndexedDB request failed'))
  })
}

function done(tx: IDBTransaction): Promise<void> {
  return new Promise((resolve, reject) => {
    tx.oncomplete = () => resolve()
    tx.onabort = () => reject(tx.error ?? new Error('IndexedDB transaction aborted'))
    tx.onerror = () => reject(tx.error ?? new Error('IndexedDB transaction failed'))
  })
}
