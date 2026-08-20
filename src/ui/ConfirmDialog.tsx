import { useCallback } from 'react'
import { useModalDialog } from './useModalDialog'

export interface ConfirmRequest {
  title: string
  /** Optional second line: what exactly is lost, in the user's own data terms. */
  body?: string
  confirmLabel: string
  cancelLabel: string
  tone?: 'danger' | 'default'
}

/**
 * In-app confirmation for destructive actions.
 *
 * Not `window.confirm`: wry's `WKUIDelegate` does not implement
 * `runJavaScriptConfirmPanel`, so in the packaged macOS app WKWebView shows no
 * dialog at all and `confirm()` returns `false` immediately — the action then
 * silently never happens. It also cannot be themed or translated.
 */
export function ConfirmDialog({
  request,
  onResolve,
}: {
  request: ConfirmRequest
  onResolve: (confirmed: boolean) => void
}) {
  const cancel = useCallback(() => onResolve(false), [onResolve])
  const dialogRef = useModalDialog<HTMLDivElement>(cancel)
  const danger = request.tone !== 'default'

  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center p-4">
      <div
        className="fixed inset-0 bg-black/40 backdrop-blur-sm vr-animate-fade"
        onClick={cancel}
        aria-hidden="true"
      />
      <div
        ref={dialogRef}
        role="alertdialog"
        aria-modal="true"
        aria-labelledby="confirm-dialog-title"
        aria-describedby={request.body ? 'confirm-dialog-body' : undefined}
        tabIndex={-1}
        className="relative z-10 w-full max-w-sm rounded-3xl border border-black/[0.08] bg-white/96 p-5 shadow-[0_30px_70px_rgba(0,0,0,0.22)] backdrop-blur-3xl vr-animate-pop dark:border-white/[0.08] dark:bg-[#1C1C1E]/96 dark:text-neutral-100"
      >
        <h2 id="confirm-dialog-title" className="text-sm font-semibold tracking-tight">
          {request.title}
        </h2>
        {request.body && (
          <p
            id="confirm-dialog-body"
            className="mt-2 text-xs leading-relaxed text-neutral-500 dark:text-neutral-400"
          >
            {request.body}
          </p>
        )}
        {/* Cancel first in the DOM, so the focus trap lands there rather than on
            the button that destroys something. */}
        <div className="mt-5 flex justify-end gap-2">
          <button
            type="button"
            onClick={cancel}
            className="rounded-xl border border-black/[0.08] px-3.5 py-1.5 text-xs font-medium text-neutral-700 transition hover:bg-black/5 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue-500 dark:border-white/[0.08] dark:text-neutral-300 dark:hover:bg-white/10"
          >
            {request.cancelLabel}
          </button>
          <button
            type="button"
            onClick={() => onResolve(true)}
            className={`rounded-xl px-3.5 py-1.5 text-xs font-medium text-white transition focus-visible:outline-2 focus-visible:outline-offset-2 ${
              danger
                ? 'bg-red-600 hover:bg-red-700 focus-visible:outline-red-500'
                : 'bg-blue-600 hover:bg-blue-700 focus-visible:outline-blue-500'
            }`}
          >
            {request.confirmLabel}
          </button>
        </div>
      </div>
    </div>
  )
}
