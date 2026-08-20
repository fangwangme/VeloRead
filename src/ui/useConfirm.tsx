import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react'
import { ConfirmDialog, type ConfirmRequest } from './ConfirmDialog'

/**
 * Promise-shaped confirmation, so a call site reads like the `confirm()` it
 * replaces instead of growing its own pending-dialog state.
 *
 * Render `confirmDialog` somewhere in the component and `await confirm({...})`
 * where the destructive action happens.
 */
export function useConfirm(): {
  confirm: (request: ConfirmRequest) => Promise<boolean>
  confirmDialog: ReactNode
} {
  const [pending, setPending] = useState<{
    request: ConfirmRequest
    resolve: (confirmed: boolean) => void
  } | null>(null)
  // The promise handle lives in the ref, not in the state updater: settling a
  // promise is a side effect, and an updater can run twice.
  const pendingRef = useRef<{
    request: ConfirmRequest
    resolve: (confirmed: boolean) => void
  } | null>(null)

  // An unmount mid-question must settle the promise rather than strand the
  // caller's `await` forever.
  useEffect(() => () => pendingRef.current?.resolve(false), [])

  const confirm = useCallback((request: ConfirmRequest) => {
    return new Promise<boolean>((resolve) => {
      // Only one question at a time; an older one resolves as declined.
      pendingRef.current?.resolve(false)
      const next = { request, resolve }
      pendingRef.current = next
      setPending(next)
    })
  }, [])

  const onResolve = useCallback((confirmed: boolean) => {
    pendingRef.current?.resolve(confirmed)
    pendingRef.current = null
    setPending(null)
  }, [])

  return {
    confirm,
    confirmDialog: pending ? (
      <ConfirmDialog request={pending.request} onResolve={onResolve} />
    ) : null,
  }
}
