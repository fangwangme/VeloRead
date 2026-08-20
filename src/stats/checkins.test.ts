import { describe, expect, it } from 'vitest'
import { checkinState, monthCheckinSummary } from './checkins'

describe('reading check-ins', () => {
  const today = new Date(2026, 7, 20, 12)

  it('distinguishes completed, partial, empty, and future days', () => {
    expect(checkinState(new Date(2026, 7, 20), 15, 15, today)).toBe('complete')
    expect(checkinState(new Date(2026, 7, 19), 8, 15, today)).toBe('partial')
    expect(checkinState(new Date(2026, 7, 18), 0, 15, today)).toBe('empty')
    expect(checkinState(new Date(2026, 7, 21), 30, 15, today)).toBe('future')
  })

  it('summarizes only elapsed days in the current local month', () => {
    expect(
      monthCheckinSummary(
        {
          '2026-08-18': { durationMinutes: 15 },
          '2026-08-19': { durationMinutes: 8 },
          '2026-08-20': { durationMinutes: 30 },
          '2026-08-21': { durationMinutes: 60 },
          '2026-07-31': { durationMinutes: 60 },
        },
        15,
        today,
      ),
    ).toEqual({ completedDays: 2, activeDays: 3, todayMinutes: 30 })
  })
})
