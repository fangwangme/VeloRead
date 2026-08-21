import type { zh } from './messages.zh'

/**
 * Chinese is the source language: it holds every key, and `Messages` forces the
 * English dictionary to be structurally identical. A missing or misspelled key
 * is a type error, not a string that renders as itself at runtime.
 */
export type MessageKey = keyof typeof zh
export type Messages = Record<MessageKey, string>

export type Language = 'zh' | 'en'
/** What the user picked. `auto` follows the system. */
export type LanguagePreference = 'auto' | Language

/** Base of a `.one` / `.other` pair, for `t.plural`. */
type PluralBaseOf<K> = K extends `${infer Base}.one` ? Base : never
export type PluralKey = PluralBaseOf<MessageKey>

export interface Translate {
  (key: MessageKey, values?: Record<string, string | number>): string
  /**
   * Chinese has no grammatical plural, so both forms are usually the same
   * string there; English needs the pair. Zero takes the plural form, as it
   * does in English.
   */
  plural(key: PluralKey, count: number, values?: Record<string, string | number>): string
}
