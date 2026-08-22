/**
 * Deciding when a definition the reader saw was actually a *lookup*.
 *
 * On a Kindle the two are the same thing: a long press is deliberate, so
 * everything you look up goes into the vocabulary builder and
 * docs/specs/vocabulary.md §3 was written to match. A desktop is not a Kindle.
 * Double-clicking a word is how you put the caret somewhere, how you clear a
 * selection, and what a slipped finger does — recording all of that would fill
 * the list with words nobody asked about, and a vocabulary list is worth
 * exactly as much as its signal-to-noise ratio.
 *
 * So the definition is free and the row costs something: the popover has to
 * survive `LOOKUP_INTENT_DWELL_MS`, or the reader has to do something further
 * with the word. Either is evidence; a flick of a double-click is neither.
 */

/**
 * How long a definition has to stay on screen before reading it counts as
 * looking the word up.
 *
 * Long enough that dismissing a mis-click never records anything — that takes a
 * fraction of a second — and short enough that actually reading the first line
 * of a definition always does.
 */
export const LOOKUP_INTENT_DWELL_MS = 1200

export interface LookupIntent {
  /**
   * A definition was shown. Starts the clock; `onQualify` is called once, the
   * moment the evidence is in.
   */
  open(onQualify: () => void): void
  /**
   * The reader did something further with this word — highlighted it, saved it,
   * searched for it, copied it. Immediate evidence, no waiting.
   */
  act(): void
  /** The popover went away. Cancels the clock if it has not fired. */
  close(): void
}

/**
 * A one-shot dwell timer per opening.
 *
 * A controller rather than a `useEffect` so the rule is one testable thing
 * instead of a timeout scattered through a component: a named constant, and a
 * plain function that never touches React.
 *
 * `dwellMs` is a parameter so a test does not have to agree with the product
 * decision to exercise the mechanism.
 */
export function createLookupIntent(dwellMs = LOOKUP_INTENT_DWELL_MS): LookupIntent {
  let timer: ReturnType<typeof setTimeout> | null = null
  let pending: (() => void) | null = null

  const cancel = () => {
    if (timer !== null) clearTimeout(timer)
    timer = null
  }

  const qualify = () => {
    const settle = pending
    if (!settle) return
    // Cleared first, so this fires at most once per opening however it is
    // reached — the timer and an action can both arrive.
    pending = null
    cancel()
    settle()
  }

  return {
    open(onQualify: () => void) {
      cancel()
      pending = onQualify
      timer = setTimeout(qualify, dwellMs)
    },
    act() {
      qualify()
    },
    close() {
      cancel()
      pending = null
    },
  }
}
