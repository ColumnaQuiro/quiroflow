import { describe, expect, it } from 'vitest'
import { exerciseReminderDue } from '../../utils/exerciseReminderDue'

const MADRID = 'Europe/Madrid'
const CANARY = 'Atlantic/Canary'
// 9 Oct 2026, 18:05 UTC = 20:05 in Madrid (CEST), 19:05 in the Canaries (WEST).
const at = new Date(Date.UTC(2026, 9, 9, 18, 5))

describe('the daily exercise reminder', () => {
  it("is due in the patient's chosen hour, in their clinic's time zone", () => {
    expect(exerciseReminderDue({ exercise_reminder_hour: 20, exercise_reminded_on: null }, at, MADRID)).toEqual({ due: true, day: '2026-10-09' })
    expect(exerciseReminderDue({ exercise_reminder_hour: 20, exercise_reminded_on: null }, at, CANARY).due).toBe(false)
    expect(exerciseReminderDue({ exercise_reminder_hour: 19, exercise_reminded_on: null }, at, CANARY).due).toBe(true)
  })

  it('goes out once a clinic day, however many ticks fall in the hour', () => {
    expect(exerciseReminderDue({ exercise_reminder_hour: 20, exercise_reminded_on: '2026-10-09' }, at, MADRID).due).toBe(false)
    expect(exerciseReminderDue({ exercise_reminder_hour: 20, exercise_reminded_on: '2026-10-08' }, at, MADRID).due).toBe(true)
  })

  it('is off when the patient has not switched it on, and outside the window', () => {
    expect(exerciseReminderDue({ exercise_reminder_hour: null, exercise_reminded_on: null }, at, MADRID).due).toBe(false)
    const late = new Date(Date.UTC(2026, 9, 9, 18, 25)) // 20:25 Madrid
    expect(exerciseReminderDue({ exercise_reminder_hour: 20, exercise_reminded_on: null }, late, MADRID).due).toBe(false)
  })
})
