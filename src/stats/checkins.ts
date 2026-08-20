import { localDateKey } from './tracking'

/**
 * Four graded outcomes plus "not yet". `exceeded` exists because "hit the goal"
 * and "read twice the goal" are very different days, and collapsing them makes a
 * long reading streak look identical to a string of bare passes.
 */
export type CheckinState = 'future' | 'empty' | 'partial' | 'complete' | 'exceeded'

/** A day counts as exceeded once it reaches this multiple of the daily goal. */
export const EXCEEDED_GOAL_MULTIPLE = 2

function startOfDay(date: Date): Date {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate())
}

export function checkinState(
  date: Date,
  minutes: number,
  goalMinutes: number,
  today = new Date(),
): CheckinState {
  if (startOfDay(date).getTime() > startOfDay(today).getTime()) return 'future'

  const goal = Math.max(1, goalMinutes)
  if (minutes >= goal * EXCEEDED_GOAL_MULTIPLE) return 'exceeded'
  if (minutes >= goal) return 'complete'
  if (minutes > 0) return 'partial'
  return 'empty'
}

export interface MonthCheckinSummary {
  /** Days that reached the goal, including the exceeded ones. */
  completedDays: number
  /** Subset of `completedDays` that reached twice the goal. */
  exceededDays: number
  /** Days with any reading at all, including days short of the goal. */
  activeDays: number
  /** Elapsed days in the month, i.e. the denominator for the ones above. */
  elapsedDays: number
  totalMinutes: number
  todayMinutes: number
}

/**
 * Summarize one calendar month. `month` selects which month to summarize so the
 * check-in page can page backwards; `today` still bounds which days count as
 * elapsed, so a past month summarizes in full and the current one stops at today.
 */
export function monthCheckinSummary(
  dailyStats: Record<string, { durationMinutes: number }>,
  goalMinutes: number,
  month: Date = new Date(),
  today = new Date(),
): MonthCheckinSummary {
  const year = month.getFullYear()
  const monthIndex = month.getMonth()
  const daysInMonth = new Date(year, monthIndex + 1, 0).getDate()
  const goal = Math.max(1, goalMinutes)
  const todayStart = startOfDay(today)

  let completedDays = 0
  let exceededDays = 0
  let activeDays = 0
  let elapsedDays = 0
  let totalMinutes = 0

  for (let day = 1; day <= daysInMonth; day++) {
    const date = new Date(year, monthIndex, day)
    if (date.getTime() > todayStart.getTime()) break
    elapsedDays += 1

    const minutes = dailyStats[localDateKey(date)]?.durationMinutes ?? 0
    totalMinutes += minutes
    if (minutes > 0) activeDays += 1
    if (minutes >= goal) completedDays += 1
    if (minutes >= goal * EXCEEDED_GOAL_MULTIPLE) exceededDays += 1
  }

  return {
    completedDays,
    exceededDays,
    activeDays,
    elapsedDays,
    totalMinutes,
    todayMinutes: dailyStats[localDateKey(today)]?.durationMinutes ?? 0,
  }
}

/** True when `month` contains `today`, i.e. paging forward makes no sense. */
export function isCurrentMonth(month: Date, today = new Date()): boolean {
  return month.getFullYear() === today.getFullYear() && month.getMonth() === today.getMonth()
}

/** Step a month cursor, normalized to the first of the month. */
export function shiftMonth(month: Date, delta: number): Date {
  return new Date(month.getFullYear(), month.getMonth() + delta, 1)
}
