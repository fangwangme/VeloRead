import { useContext } from 'react'
import { I18nContext } from './context'
import type { Translate } from './types'

/** The translate function for the active language. */
export function useT(): Translate {
  return useContext(I18nContext).t
}

/** The active language and its `Intl` locale, for date and number formatting. */
export function useLanguage() {
  const { language, locale } = useContext(I18nContext)
  return { language, locale }
}
