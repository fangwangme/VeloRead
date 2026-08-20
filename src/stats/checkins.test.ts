import { describe, expect, it } from 'vitest'
import { checkinState, isCurrentMonth, monthCheckinSummary, shiftMonth } from './checkins'

describe('reading check-ins', () => {
  const today = new Date(2026, 7, 20, 12)

  it('grades a day as empty, partial, complete, or exceeded', () => {
    expect(checkinState(new Date(2026, 7, 20), 30, 15, today)).toBe('exceeded')
    expect(checkinState(new Date(2026, 7, 20), 29, 15, today)).toBe('complete')
    expect(checkinState(new Date(2026, 7, 20), 15, 15, today)).toBe('complete')
    expect(checkinState(new Date(2026, 7, 19), 8, 15, today)).toBe('partial')
    expect(checkinState(new Date(2026, 7, 18), 0, 15, today)).toBe('empty')
    expect(checkinState(new Date(2026, 7, 21), 30, 15, today)).toBe('future')
  })

  it('treats a zero or negative goal as one minute rather than grading everything exceeded', () => {
    expect(checkinState(new Date(2026, 7, 20), 0, 0, today)).toBe('empty')
    expect(checkinState(new Date(2026, 7, 20), 1, 0, today)).toBe('complete')
    expect(checkinState(new Date(2026, 7, 20), 2, 0, today)).toBe('exceeded')
  })

  const stats = {
    '2026-08-18': { durationMinutes: 15 },
    '2026-08-19': { durationMinutes: 8 },
    '2026-08-20': { durationMinutes: 40 },
    '2026-08-21': { durationMinutes: 60 },
    '2026-07-05': { durationMinutes: 60 },
    '2026-07-31': { durationMinutes: 10 },
  }

  it('summarizes only elapsed days in the requested month', () => {
    expect(monthCheckinSummary(stats, 15, today, today)).toEqual({
      completedDays: 2,
      exceededDays: 1,
      activeDays: 3,
      elapsedDays: 20,
      totalMinutes: 63,
      todayMinutes: 40,
    })
  })

  it('summarizes a past month in full', () => {
    expect(monthCheckinSummary(stats, 15, new Date(2026, 6, 1), today)).toEqual({
      completedDays: 1,
      exceededDays: 1,
      activeDays: 2,
      elapsedDays: 31,
      totalMinutes: 70,
      todayMinutes: 40,
    })
  })

  it('pages months without drifting on short months', () => {
    expect(shiftMonth(new Date(2026, 7, 31), -1)).toEqual(new Date(2026, 6, 1))
    expect(shiftMonth(new Date(2026, 0, 15), -1)).toEqual(new Date(2025, 11, 1))
    expect(isCurrentMonth(new Date(2026, 7, 1), today)).toBe(true)
    expect(isCurrentMonth(new Date(2026, 6, 1), today)).toBe(false)
  })
})
