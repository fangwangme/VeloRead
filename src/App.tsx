import { useCallback, useEffect, useRef, useState } from 'react'
import { useLibrary } from './library/store'
import { Library } from './library/Library'
import { Reader } from './reader/Reader'
import { getStorage } from './platform'
import type { AppSettings } from './platform/types'

const DEFAULT_APP_SETTINGS: AppSettings = {
  themeMode: 'auto',
  pacerWpm: 250,
  pacerCpm: 300,
  pacerChunkSize: 3,
  pacerCjkCharCount: 8,
  dailyReadingGoalMinutes: 15,
}

export default function App() {
  const view = useLibrary((s) => s.view)
  const load = useLibrary((s) => s.load)
  const [appSettings, setAppSettings] = useState<AppSettings>(DEFAULT_APP_SETTINGS)
  const appSettingsRef = useRef(appSettings)
  const appSettingsVersionRef = useRef(0)

  useEffect(() => {
    void load()
    const loadVersion = appSettingsVersionRef.current
    void getStorage()
      .then((storage) => storage.getAppSettings())
      .then((stored) => {
        if (appSettingsVersionRef.current !== loadVersion) return
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

  if (view.name === 'reader') {
    return (
      <Reader
        key={view.bookId}
        bookId={view.bookId}
        appSettings={appSettings}
        onAppSettingsChange={updateAppSettings}
      />
    )
  }
  return <Library appSettings={appSettings} onAppSettingsChange={updateAppSettings} />
}
