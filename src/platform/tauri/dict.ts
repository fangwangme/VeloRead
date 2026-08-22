import { invoke } from '@tauri-apps/api/core'
import type {
  DictLookup,
  DictPort,
  DictStatus,
  VocabularyEntry,
  VocabularyLookupInput,
  VocabularyStatus,
  VocabularyWord,
} from '../types'

/**
 * Tauri implementation of `DictPort`.
 *
 * Two databases behind one port: the dictionary is a read-only asset in
 * `dictionary.db` (`src-tauri/src/dictionary.rs`), the vocabulary list is the
 * user's own data in `veloread.db` (`src-tauri/src/library.rs`). The split is a
 * storage decision, not an interface one — a component only ever wanted "look
 * this word up and keep it".
 */
export function createTauriDict(): DictPort {
  return {
    init() {
      return invoke<DictStatus>('dict_init')
    },

    status() {
      return invoke<DictStatus>('dict_status')
    },

    lookup(candidates: string[]) {
      return invoke<DictLookup>('dict_lookup', { candidates })
    },

    listVocabulary() {
      return invoke<VocabularyEntry[]>('library_list_vocabulary')
    },

    recordLookup(input: VocabularyLookupInput) {
      return invoke<VocabularyWord>('library_record_vocabulary_lookup', { input })
    },

    setWordStatus(id: string, status: VocabularyStatus) {
      return invoke<void>('library_set_vocabulary_status', { id, status })
    },

    deleteWord(id: string) {
      return invoke<void>('library_delete_vocabulary', { id })
    },
  }
}
