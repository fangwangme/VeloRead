import { useEffect, useMemo, type ReactNode } from 'react'
import { I18nContext, createTranslate, localeOf } from './context'
import type { Language } from './types'

export function I18nProvider({
  language,
  children,
}: {
  language: Language
  children: ReactNode
}) {
  const value = useMemo(
    () => ({ language, locale: localeOf(language), t: createTranslate(language) }),
    [language],
  )

  // Keeps hyphenation, quotation marks and screen readers in step with the UI.
  useEffect(() => {
    document.documentElement.lang = language
  }, [language])

  return <I18nContext.Provider value={value}>{children}</I18nContext.Provider>
}
