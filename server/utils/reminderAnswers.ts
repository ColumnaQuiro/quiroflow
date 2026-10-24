import { answeredAReminder } from '~/utils/appointmentReminderDue'

// Which of these visits the patient has answered IN REPLY TO A REMINDER, for
// the reminder automations that pass over an answered visit
// (hours-before-cron.post.ts before a rule starts, automationEngine.ts before
// a run's next step). The rule is utils/appointmentReminderDue.ts's
// answeredAReminder; this reads what it compares: when the patient answered,
// and every reminder the visit has had -- a reminder automation's send
// (automation_rule_sends), the WhatsApp it sent (purpose 'reminder'), and the
// clinic's own reminder (appointments.reminder_sent_at).

export interface AnswerableVisit {
  id: string
  confirmation_status: string | null
  confirmation_answered_at: string | null
  reminder_sent_at?: string | null
}

export function isAnswered(visit: Pick<AnswerableVisit, 'confirmation_status'>): boolean {
  return visit.confirmation_status === 'confirmed' || visit.confirmation_status === 'reschedule_requested'
}

export async function answeredAReminderAmong(supabase: any, visits: AnswerableVisit[]): Promise<Set<string>> {
  const answered = visits.filter((v) => isAnswered(v) && v.confirmation_answered_at)
  if (answered.length === 0) return new Set()
  const ids = answered.map((v) => v.id)
  const [{ data: sends }, { data: messages }] = await Promise.all([
    supabase.from('automation_rule_sends').select('appointment_id, sent_at').in('appointment_id', ids),
    supabase.from('whatsapp_messages').select('appointment_id, created_at').in('appointment_id', ids).eq('direction', 'outbound').eq('purpose', 'reminder'),
  ])
  const reminders = new Map<string, string[]>()
  const add = (id: string, at: string | null) => {
    if (!at) return
    reminders.set(id, [...(reminders.get(id) ?? []), at])
  }
  for (const s of (sends ?? []) as { appointment_id: string; sent_at: string | null }[]) add(s.appointment_id, s.sent_at)
  for (const m of (messages ?? []) as { appointment_id: string; created_at: string }[]) add(m.appointment_id, m.created_at)
  for (const v of answered) add(v.id, v.reminder_sent_at ?? null)
  return new Set(answered.filter((v) => answeredAReminder(v.confirmation_answered_at, reminders.get(v.id) ?? [])).map((v) => v.id))
}
