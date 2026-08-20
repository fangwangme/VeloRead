import { createContext } from 'react'
import { zh } from './messages.zh'
import { en } from './messages.en'
import { format } from './format'
import type { Language, Messages, Translate } from './types'

export const DICTIONARIES: Record<Language, Messages> = { zh, en }

export interface I18nValue {
  language: Language
  /** BCP 47 tag for `Intl`, derived from `language`. */
  locale: string
  t: Translate
}

export function createTranslate(language: Language): Translate {
  const messages = DICTIONARIES[language]
  const translate = ((key, values) =>
    format(messages[key], values)) as Translate
  translate.plural = (key, count, values) => {
    // English needs the pair; Chinese defines both to the same string. Zero
    // takes the plural form, as it does in English.
    const form = count === 1 ? `${key}.one` : `${key}.other`
    return format(messages[form as keyof Messages], { n: count, ...values })
  }
  return translate
}

export function localeOf(language: Language): string {
  return language === 'zh' ? 'zh-CN' : 'en-US'
}

/** Chinese by default, so a component rendered outside the provider still reads. */
export const I18nContext = createContext<I18nValue>({
  language: 'zh',
  locale: localeOf('zh'),
  t: createTranslate('zh'),
})
