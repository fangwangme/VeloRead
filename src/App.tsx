import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useLibrary } from './library/store'
import { Library } from './library/Library'
import { Reader } from './reader/Reader'
import { getStorage } from './platform'
import type { AppSettings } from './platform/types'
import { I18nProvider } from './i18n/I18nProvider'
import { resolveLanguage } from './i18n/resolveLanguage'
import { useT } from './i18n/useT'

const DEFAULT_APP_SETTINGS: AppSettings = {
  themeMode: 'auto',
  language: 'auto',
  pacerWpm: 250,
  pacerCpm: 300,
  pacerChunkSize: 3,
  pacerCjkCharCount: 4,
  dailyReadingGoalMinutes: 15,
}

export default function App() {
  const view = useLibrary((s) => s.view)
  const load = useLibrary((s) => s.load)
  const [appSettings, setAppSettings] = useState<AppSettings>(DEFAULT_APP_SETTINGS)
  const [settingsHydrated, setSettingsHydrated] = useState(false)
  const appSettingsRef = useRef(appSettings)
  const appSettingsVersionRef = useRef(0)

  useEffect(() => {
    let cancelled = false
    void load()
    const loadVersion = appSettingsVersionRef.current
    void getStorage()
      .then((storage) => storage.getAppSettings())
      .then((stored) => {
        if (cancelled || appSettingsVersionRef.current !== loadVersion) return
        const normalized = {
          ...DEFAULT_APP_SETTINGS,
          ...stored,
          themeMode:
            stored.themeMode ??
            (stored.autoNightMode === undefined
              ? DEFAULT_APP_SETTINGS.themeMode
              : stored.autoNightMode
                ? 'auto'
                : 'light'),
        }
        appSettingsRef.current = normalized
        setAppSettings(normalized)
      })
      .catch(() => undefined)
      .finally(() => {
        if (!cancelled) setSettingsHydrated(true)
      })
    return () => {
      cancelled = true
    }
  }, [load])

  useEffect(() => {
    const media = window.matchMedia('(prefers-color-scheme: dark)')
    const applyTheme = () => {
      const mode = appSettings.themeMode ?? 'auto'
      document.documentElement.classList.toggle(
        'dark',
        mode === 'dark' || (mode === 'auto' && media.matches),
      )
    }
    applyTheme()
    media.addEventListener('change', applyTheme)
    return () => media.removeEventListener('change', applyTheme)
  }, [appSettings.themeMode])

  // `navigator.languages` is stable for the life of the window, so resolving on
  // every settings change is enough to react to the picker.
  const language = useMemo(
    () =>
      resolveLanguage(
        appSettings.language,
        typeof navigator === 'undefined' ? [] : navigator.languages,
      ),
    [appSettings.language],
  )

  const updateAppSettings = useCallback(async (changes: Partial<AppSettings>) => {
    appSettingsVersionRef.current += 1
    const previous = appSettingsRef.current
    const next = { ...previous, ...changes }
    appSettingsRef.current = next
    setAppSettings(next)
    try {
      await (await getStorage()).saveAppSettings(changes)
    } catch (cause) {
      // Roll back only keys that have not been changed again by a newer save.
      const current = appSettingsRef.current
      const rollback = { ...current }
      for (const key of Object.keys(changes) as (keyof AppSettings)[]) {
        if (current[key] === changes[key]) {
          Object.assign(rollback, { [key]: previous[key] })
        }
      }
      appSettingsRef.current = rollback
      setAppSettings(rollback)
      throw cause
    }
  }, [])

  return (
    <I18nProvider language={language}>
      {!settingsHydrated ? (
        <BootScreen />
      ) : view.name === 'reader' ? (
        <Reader
          key={view.bookId}
          bookId={view.bookId}
          appSettings={appSettings}
          onAppSettingsChange={updateAppSettings}
        />
      ) : (
        <Library appSettings={appSettings} onAppSettingsChange={updateAppSettings} />
      )}
    </I18nProvider>
  )
}

function BootScreen() {
  const t = useT()
  return (
    <div className="flex min-h-dvh items-center justify-center bg-[#FBFBFA] text-xs text-neutral-500 dark:text-neutral-400 dark:bg-[#121214]">
      {t('app.loading')}
    </div>
  )
}
