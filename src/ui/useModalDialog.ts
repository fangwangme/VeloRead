import { useEffect, useRef } from 'react'

const FOCUSABLE = [
  'button:not([disabled])',
  'input:not([disabled])',
  'select:not([disabled])',
  'textarea:not([disabled])',
  'a[href]',
  '[tabindex]:not([tabindex="-1"])',
].join(',')

/**
 * Every mounted dialog, innermost last.
 *
 * Dialogs nest — a delete confirmation opens on top of the TOC drawer — and
 * both listen on `document`, where `stopPropagation` does not reach a sibling
 * listener. Without knowing which one is on top, one Escape cancelled the
 * confirmation *and* closed the drawer under it, and two focus traps fought
 * over Tab.
 */
const modalStack: symbol[] = []

/** Keyboard and focus behavior shared by the app's modal dialogs. */
export function useModalDialog<T extends HTMLElement>(onClose: () => void) {
  const dialogRef = useRef<T>(null)
  const onCloseRef = useRef(onClose)

  useEffect(() => {
    onCloseRef.current = onClose
  }, [onClose])

  useEffect(() => {
    const token = Symbol('modal-dialog')
    modalStack.push(token)
    const isTopmost = () => modalStack[modalStack.length - 1] === token

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
      if (!isTopmost()) return
      if (event.key === 'Escape') {
        event.preventDefault()
        // Escape dismisses one layer. Stopping here also keeps the reader's
        // own window-level Escape from closing the book behind the dialog.
        event.stopPropagation()
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
      const index = modalStack.lastIndexOf(token)
      if (index !== -1) modalStack.splice(index, 1)
      previousFocus?.focus()
    }
  }, [])

  return dialogRef
}
