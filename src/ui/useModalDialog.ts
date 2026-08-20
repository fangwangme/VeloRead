import { useEffect, useRef } from 'react'

const FOCUSABLE = [
  'button:not([disabled])',
  'input:not([disabled])',
  'select:not([disabled])',
  'textarea:not([disabled])',
  'a[href]',
  '[tabindex]:not([tabindex="-1"])',
].join(',')

/** Keyboard and focus behavior shared by the library's modal dialogs. */
export function useModalDialog<T extends HTMLElement>(onClose: () => void) {
  const dialogRef = useRef<T>(null)
  const onCloseRef = useRef(onClose)

  useEffect(() => {
    onCloseRef.current = onClose
  }, [onClose])

  useEffect(() => {
    const dialog = dialogRef.current
    const previousFocus = document.activeElement instanceof HTMLElement
      ? document.activeElement
      : null
    const focusable = () =>
      dialog
        ? Array.from(dialog.querySelectorAll<HTMLElement>(FOCUSABLE)).filter(
            (element) => !element.hidden && element.getAttribute('aria-hidden') !== 'true',
          )
        : []

    focusable()[0]?.focus()

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.preventDefault()
        onCloseRef.current()
        return
      }
      if (event.key !== 'Tab') return

      const elements = focusable()
      if (elements.length === 0) {
        event.preventDefault()
        dialog?.focus()
        return
      }
      const first = elements[0]
      const last = elements[elements.length - 1]
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault()
        last.focus()
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault()
        first.focus()
      }
    }

    document.addEventListener('keydown', handleKeyDown)
    return () => {
      document.removeEventListener('keydown', handleKeyDown)
      previousFocus?.focus()
    }
  }, [])

  return dialogRef
}
