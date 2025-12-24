import { useEffect } from 'react'
import { useSettingsStore } from '../store'

export function useThemeEffect() {
  const appTheme = useSettingsStore((state) => state.appTheme)

  useEffect(() => {
    const root = window.document.documentElement
    
    const applyTheme = (theme: 'light' | 'dark') => {
        root.classList.remove('light', 'dark')
        root.classList.add(theme)
        root.style.colorScheme = theme
    }

    if (appTheme === 'system') {
        const media = window.matchMedia('(prefers-color-scheme: dark)')
        const onChange = () => applyTheme(media.matches ? 'dark' : 'light')
        onChange()
        media.addEventListener('change', onChange)
        return () => media.removeEventListener('change', onChange)
    } else {
        applyTheme(appTheme)
    }
    
  }, [appTheme])
}
