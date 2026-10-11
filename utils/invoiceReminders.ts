// When an invoice.overdue automation looks at an invoice (server/utils/
// invoiceReminders.ts). Pure, so the window can be pinned without a database.
//
// Invoices raised between N and N + SLACK_DAYS days ago: the ones that have
// just crossed the line, with a few days' room for a cron run that did not
// happen. Older ones are never picked up, which is what keeps a reminder that
// is switched on today from messaging every patient with an old debt.
export const OVERDUE_SLACK_DAYS = 3

export function overdueWindow(daysOverdue: number, now: Date): { from: Date; to: Date } {
  const days = Math.max(1, Math.round(daysOverdue))
  const day = 86_400_000
  return { from: new Date(now.getTime() - (days + OVERDUE_SLACK_DAYS) * day), to: new Date(now.getTime() - days * day) }
}
