import type { Language, LanguagePreference } from './types'

/**
 * Turn a stored preference plus the system's language list into the language to
 * render in.
 *
 * A system set to neither Chinese nor English falls back to Chinese, the
 * language every message is authored in.
 */
export function resolveLanguage(
  preference: LanguagePreference | undefined,
  systemLanguages: readonly string[] = [],
): Language {
  if (preference === 'zh' || preference === 'en') return preference
  for (const tag of systemLanguages) {
    if (/^zh\b/iu.test(tag) || /^zh-/iu.test(tag)) return 'zh'
    if (/^en\b/iu.test(tag) || /^en-/iu.test(tag)) return 'en'
  }
  return 'zh'
}

/** The languages the app offers, in the order the settings picker shows them. */
export const LANGUAGE_OPTIONS: LanguagePreference[] = ['auto', 'zh', 'en']
