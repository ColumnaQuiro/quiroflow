import { describe, expect, it } from 'vitest'
import { handoverReminderBody, handoverReminderDecision } from '../../utils/handoverReminder'

// handover-reminder-cron's choice for one open handover task.
describe('handoverReminderDecision', () => {
  const task = { created_at: '2026-10-16T11:00:00Z', due_at: '2026-10-16T13:00:00Z' }
  const afterDue = new Date('2026-10-16T13:15:00Z')

  it('reminds once the task is overdue, nobody has replied and the clinic is open', () => {
    expect(handoverReminderDecision(task, null, true, afterDue)).toBe('remind')
  })

  it('waits until the task is due', () => {
    expect(handoverReminderDecision(task, null, true, new Date('2026-10-16T12:59:00Z'))).toBe('wait')
  })

  it('waits while the clinic is closed, rather than pushing into an empty clinic', () => {
    expect(handoverReminderDecision(task, null, false, afterDue)).toBe('wait')
  })

  it('reads a clinic with no hours set as open', () => {
    expect(handoverReminderDecision(task, null, null, afterDue)).toBe('remind')
  })

  it('is answered when a person wrote after the handover, open or not', () => {
    expect(handoverReminderDecision(task, '2026-10-16T12:00:00Z', true, afterDue)).toBe('answered')
    expect(handoverReminderDecision(task, '2026-10-16T12:00:00Z', false, afterDue)).toBe('answered')
  })

  it('does not count a reply from before the handover', () => {
    expect(handoverReminderDecision(task, '2026-10-16T10:00:00Z', true, afterDue)).toBe('remind')
  })

  it('never reminds about a task with no due date', () => {
    expect(handoverReminderDecision({ ...task, due_at: null }, null, true, afterDue)).toBe('wait')
  })
})

describe('handoverReminderBody', () => {
  it('leads with the fact it is still waiting, then the task', () => {
    expect(handoverReminderBody('Responder a Ana: ha enviado una foto')).toBe('Sigue sin respuesta. Responder a Ana: ha enviado una foto')
  })
})
