export interface ReadingActivityState {
  ready: boolean
  hasError: boolean
  visibilityState: DocumentVisibilityState
  windowFocused: boolean
  panelOpen: boolean
}

export function shouldAccumulateReading(state: ReadingActivityState): boolean {
  return (
    state.ready &&
    !state.hasError &&
    state.visibilityState === 'visible' &&
    state.windowFocused &&
    !state.panelOpen
  )
}

export function localDateKey(date: Date): string {
  const year = date.getFullYear()
  const month = String(date.getMonth() + 1).padStart(2, '0')
  const day = String(date.getDate()).padStart(2, '0')
  return `${year}-${month}-${day}`
}

export function calculateCurrentStreak(
  dailyStats: Record<string, { durationMinutes: number }>,
  today = new Date(),
): number {
  const cursor = new Date(today.getFullYear(), today.getMonth(), today.getDate())
  if (!hasReading(dailyStats, localDateKey(cursor))) {
    cursor.setDate(cursor.getDate() - 1)
  }

  let streak = 0
  while (hasReading(dailyStats, localDateKey(cursor))) {
    streak += 1
    cursor.setDate(cursor.getDate() - 1)
  }
  return streak
}

function hasReading(
  dailyStats: Record<string, { durationMinutes: number }>,
  date: string,
): boolean {
  return (dailyStats[date]?.durationMinutes ?? 0) > 0
}

export function shouldCreditDepartedPage(
  previousCfi: string | null,
  nextCfi: string,
  dwellSeconds: number,
  pacerConsumedPage: boolean,
  layoutChangeSuppressed: boolean,
): boolean {
  return (
    previousCfi !== null &&
    previousCfi !== nextCfi &&
    !layoutChangeSuppressed &&
    (dwellSeconds >= 3 || pacerConsumedPage)
  )
}
