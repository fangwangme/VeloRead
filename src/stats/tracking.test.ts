import { describe, expect, it } from 'vitest'
import {
  calculateCurrentStreak,
  localDateKey,
  shouldAccumulateReading,
  shouldCreditDepartedPage,
} from './tracking'

describe('reading activity tracking', () => {
  it('does not count loading, failed, hidden, unfocused, or panel-covered time', () => {
    const active = {
      ready: true,
      hasError: false,
      visibilityState: 'visible' as const,
      windowFocused: true,
      panelOpen: false,
    }
    expect(shouldAccumulateReading(active)).toBe(true)
    expect(shouldAccumulateReading({ ...active, ready: false })).toBe(false)
    expect(shouldAccumulateReading({ ...active, hasError: true })).toBe(false)
    expect(shouldAccumulateReading({ ...active, visibilityState: 'hidden' })).toBe(false)
    expect(shouldAccumulateReading({ ...active, windowFocused: false })).toBe(false)
    expect(shouldAccumulateReading({ ...active, panelOpen: true })).toBe(false)
  })

  it('credits units only when leaving a distinct, genuinely read page', () => {
    expect(shouldCreditDepartedPage(null, 'cfi-1', 10, false, false)).toBe(false)
    expect(shouldCreditDepartedPage('cfi-1', 'cfi-1', 10, false, false)).toBe(false)
    expect(shouldCreditDepartedPage('cfi-1', 'cfi-2', 2, false, false)).toBe(false)
    expect(shouldCreditDepartedPage('cfi-1', 'cfi-2', 10, false, true)).toBe(false)
    expect(shouldCreditDepartedPage('cfi-1', 'cfi-2', 3, false, false)).toBe(true)
    expect(shouldCreditDepartedPage('cfi-1', 'cfi-2', 0, true, false)).toBe(true)
  })

  it('credits a fully consumed Pacer page but not a partial sub-three-second page', () => {
    expect(shouldCreditDepartedPage('cfi-1', 'cfi-2', 0, false, false)).toBe(false)
    expect(shouldCreditDepartedPage('cfi-1', 'cfi-2', 0, true, false)).toBe(true)
  })

  it('uses the reader local day rather than UTC for session keys', () => {
    const date = new Date(2026, 7, 20, 23, 30)
    expect(localDateKey(date)).toBe('2026-08-20')
  })

  it('counts a streak ending today or yesterday and stops at the first gap', () => {
    const today = new Date(2026, 7, 20, 23, 30)
    expect(
      calculateCurrentStreak(
        {
          '2026-08-20': { durationMinutes: 2 },
          '2026-08-19': { durationMinutes: 1 },
          '2026-08-17': { durationMinutes: 4 },
        },
        today,
      ),
    ).toBe(2)
    expect(
      calculateCurrentStreak(
        {
          '2026-08-19': { durationMinutes: 1 },
          '2026-08-18': { durationMinutes: 3 },
        },
        today,
      ),
    ).toBe(2)
  })
})
