import { useT } from '../i18n/useT'

/**
 * What is left when a subtree throws: what happened, and a way out that is not
 * "quit the app".
 */
export function CrashScreen({
  error,
  onRetry,
  onBackToLibrary,
}: {
  error: Error
  onRetry: () => void
  /** Omitted when the library is what crashed — there is nowhere to go back to. */
  onBackToLibrary?: () => void
}) {
  const t = useT()

  return (
    <div className="flex min-h-dvh flex-col items-center justify-center gap-4 bg-[#FBFBFA] px-6 text-center dark:bg-[#121214]">
      <p className="text-sm font-semibold tracking-tight text-neutral-800 dark:text-neutral-200">
        {t('crash.title')}
      </p>
      <p className="max-w-sm text-xs leading-relaxed text-neutral-500 dark:text-neutral-400">
        {t('crash.body')}
      </p>
      {/* The message is the one thing that makes a report actionable. */}
      <code className="max-w-lg overflow-x-auto rounded-xl border border-black/[0.10] bg-black/[0.03] px-3 py-2 text-left font-mono text-[10px] text-neutral-600 dark:border-white/[0.08] dark:bg-white/[0.04] dark:text-neutral-300">
        {error.message || String(error)}
      </code>
      <div className="mt-1 flex items-center gap-2">
        {onBackToLibrary && (
          <button
            type="button"
            onClick={onBackToLibrary}
            className="rounded-xl bg-blue-600 px-3.5 py-1.5 text-xs font-medium text-white transition hover:bg-blue-700 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue-500"
          >
            {t('crash.backToLibrary')}
          </button>
        )}
        <button
          type="button"
          onClick={onRetry}
          className="rounded-xl border border-black/[0.10] px-3.5 py-1.5 text-xs font-medium text-neutral-700 transition hover:bg-black/5 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue-500 dark:border-white/[0.10] dark:text-neutral-300 dark:hover:bg-white/10"
        >
          {t('crash.retry')}
        </button>
      </div>
    </div>
  )
}
