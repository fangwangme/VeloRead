import { localDateKey } from './tracking'

export type CheckinState = 'future' | 'empty' | 'partial' | 'complete'

export function checkinState(
  date: Date,
  minutes: number,
  goalMinutes: number,
  today = new Date(),
): CheckinState {
  const day = new Date(date.getFullYear(), date.getMonth(), date.getDate())
  const current = new Date(today.getFullYear(), today.getMonth(), today.getDate())
  if (day.getTime() > current.getTime()) return 'future'
  if (minutes >= Math.max(1, goalMinutes)) return 'complete'
  if (minutes > 0) return 'partial'
  return 'empty'
}

export function monthCheckinSummary(
  dailyStats: Record<string, { durationMinutes: number }>,
  goalMinutes: number,
  today = new Date(),
): { completedDays: number; activeDays: number; todayMinutes: number } {
  const year = today.getFullYear()
  const month = today.getMonth()
  const daysInMonth = new Date(year, month + 1, 0).getDate()
  let completedDays = 0
  let activeDays = 0

  for (let day = 1; day <= daysInMonth; day++) {
    const date = new Date(year, month, day)
    if (date.getTime() > today.getTime()) break
    const minutes = dailyStats[localDateKey(date)]?.durationMinutes ?? 0
    if (minutes > 0) activeDays += 1
    if (minutes >= Math.max(1, goalMinutes)) completedDays += 1
  }

  return {
    completedDays,
    activeDays,
    todayMinutes: dailyStats[localDateKey(today)]?.durationMinutes ?? 0,
  }
}
