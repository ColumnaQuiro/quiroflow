// What handover-reminder-cron does with one open handover task: remind the
// team once more, note that a person already picked it up, or leave it for a
// later tick.
//
// A plain module (no Nuxt auto-imports), so the unit tests pin it.

export interface HandoverTask {
  created_at: string
  due_at: string | null
}

export type HandoverReminderDecision = 'remind' | 'answered' | 'wait'

/**
 * `lastPersonReplyAt` is the newest message a person sent in the conversation
 * (by hand: not the receptionist, a template or an automation). `clinicOpen`
 * is clinicOpenAt(): null when the clinic has no hours set, read as open --
 * a reminder that might arrive at night beats one that never comes.
 *
 * Outside opening hours it waits rather than reminding: the push would land
 * in a closed clinic and be gone by morning, which is the problem this
 * reminder exists to fix.
 */
export function handoverReminderDecision(task: HandoverTask, lastPersonReplyAt: string | null, clinicOpen: boolean | null, now: Date): HandoverReminderDecision {
  if (lastPersonReplyAt && new Date(lastPersonReplyAt).getTime() > new Date(task.created_at).getTime()) return 'answered'
  if (!task.due_at || new Date(task.due_at).getTime() > now.getTime()) return 'wait'
  if (clinicOpen === false) return 'wait'
  return 'remind'
}

/** The push body: the task's own words, which already say who and why. */
export function handoverReminderBody(title: string): string {
  return `Sigue sin respuesta. ${title}`.slice(0, 300)
}
