import type { serverSupabaseServiceRole } from '#supabase/server'
import type { Database } from '~/types/database.types'
import { sendPushToUsers } from '~/server/utils/pushNotifications'
import { sendResendEmail } from '~/server/utils/resend'
import { DEFAULT_CLINIC_TIMEZONE, clinicDateOf, nextDate, startOfLocalDate } from '~/utils/clinicClock'
import { digestDue, digestEmailHtml, digestPushBody, digestWeek, type DigestPayment, type DigestWeek } from '~/utils/weeklyDigest'

// The owner's Monday summary of last week: an email and a push to each owner
// who has not switched it off (Avisos > Resumen semanal, the
// staff_push_preferences row). Rides on same-day-cron, which already runs
// every 15 minutes and reads each clinic's clock -- a cron of its own would be
// one more pg_cron job to create by hand in production.
//
// Sent at 8:00 on Monday in the account's first clinic's time zone, over the
// seven days before (Monday to Sunday there), beside the seven before those.
// What it counts is utils/weeklyDigest.ts. Best-effort: never throws.
type Service = ReturnType<typeof serverSupabaseServiceRole<Database>>

const SEEDED_METHOD_ES: Record<string, string> = { cash: 'Efectivo', card: 'Tarjeta', transfer: 'Transferencia bancaria', bizum: 'Bizum', other: 'Otro' }

async function allRows<T>(page: (from: number, to: number) => PromiseLike<{ data: T[] | null; error: unknown }>): Promise<T[]> {
  const out: T[] = []
  for (let from = 0; from < 100_000; from += 1000) {
    const { data, error } = await page(from, from + 999)
    if (error) throw error
    out.push(...(data ?? []))
    if (!data || data.length < 1000) break
  }
  return out
}

/** Last week's figures for one account, between two instants. */
async function weekFigures(service: Service, accountId: string, from: Date, to: Date): Promise<DigestWeek> {
  const [payments, invoices, visits] = await Promise.all([
    allRows<{ amount_cents: number; method: string; invoices: { status: string } | null }>((a, b) =>
      service.from('payments').select('amount_cents, method, invoices!payments_invoice_id_fkey(status)').eq('account_id', accountId).gte('paid_at', from.toISOString()).lt('paid_at', to.toISOString()).order('id').range(a, b) as never,
    ),
    allRows<{ total_cents: number }>((a, b) =>
      service.from('invoices').select('total_cents').eq('account_id', accountId).neq('status', 'void').gte('created_at', from.toISOString()).lt('created_at', to.toISOString()).order('id').range(a, b) as never,
    ),
    allRows<{ status: string; patient_id: string | null }>((a, b) =>
      service.from('appointments').select('status, patient_id').eq('account_id', accountId).is('deleted_at', null).gte('starts_at', from.toISOString()).lt('starts_at', to.toISOString()).order('id').range(a, b) as never,
    ),
  ])
  // New: their first attended visit ever was this week -- the Retention
  // report's "new patient", not anyone whose record was created.
  const attended = [...new Set(visits.filter((v) => v.status === 'completed' && v.patient_id).map((v) => v.patient_id!))]
  const seenBefore = new Set<string>()
  for (let i = 0; i < attended.length; i += 200) {
    const chunk = attended.slice(i, i + 200)
    const { data } = await service.from('appointments').select('patient_id').eq('status', 'completed').is('deleted_at', null).lt('starts_at', from.toISOString()).in('patient_id', chunk)
    for (const r of (data as { patient_id: string }[] | null) ?? []) seenBefore.add(r.patient_id)
  }
  return digestWeek({
    payments: payments.map((p): DigestPayment => ({ amount_cents: p.amount_cents, method: p.method, invoice_status: p.invoices?.status ?? null })),
    invoicedCents: invoices.reduce((s, i) => s + i.total_cents, 0),
    visits,
    newPatients: attended.filter((id) => !seenBefore.has(id)).length,
  })
}

export async function sendOwnerWeeklyDigests(service: Service, origin: string, now = new Date()) {
  let sent = 0
  try {
    type ClinicRow = { account_id: string; name: string; timezone: string | null }
    const clinics = await allRows<ClinicRow>((a, b) => service.from('clinics').select('account_id, name, timezone').is('archived_at', null).order('name').range(a, b) as never)
    const firstClinic = new Map<string, ClinicRow>()
    for (const c of clinics) if (!firstClinic.has(c.account_id)) firstClinic.set(c.account_id, c)

    for (const [accountId, clinic] of firstClinic) {
      const tz = clinic.timezone || DEFAULT_CLINIC_TIMEZONE
      if (!digestDue(now, tz)) continue
      const today = clinicDateOf(now, tz)

      const { data: owners } = await service.from('team_members').select('id, user_id').eq('account_id', accountId).eq('is_owner', true).is('deleted_at', null).not('user_id', 'is', null)
      const ownerRows = (owners as { id: string; user_id: string }[] | null) ?? []
      if (!ownerRows.length) continue
      const { data: prefs } = await service.from('staff_push_preferences').select('team_member_id, weekly_digest').in('team_member_id', ownerRows.map((o) => o.id))
      const off = new Set(((prefs as { team_member_id: string; weekly_digest: boolean }[] | null) ?? []).filter((p) => p.weekly_digest === false).map((p) => p.team_member_id))

      // Claimed before anything is read or sent: a second tick in the window
      // finds every owner already done.
      const recipients: { id: string; user_id: string }[] = []
      for (const o of ownerRows.filter((x) => !off.has(x.id))) {
        await service.from('staff_push_preferences').upsert({ team_member_id: o.id, account_id: accountId } as never, { onConflict: 'team_member_id', ignoreDuplicates: true })
        const { data: claimed } = await service
          .from('staff_push_preferences')
          .update({ digest_sent_week: today } as never)
          .eq('team_member_id', o.id)
          .or(`digest_sent_week.is.null,digest_sent_week.neq.${today}`)
          .select('team_member_id')
        if ((claimed as unknown[] | null)?.length) recipients.push(o)
      }
      if (!recipients.length) continue

      let weekStart = today
      for (let i = 0; i < 7; i++) weekStart = previousDate(weekStart)
      let priorStart = weekStart
      for (let i = 0; i < 7; i++) priorStart = previousDate(priorStart)
      let nextWeekEnd = today
      for (let i = 0; i < 7; i++) nextWeekEnd = nextDate(nextWeekEnd)
      const at = (d: string) => startOfLocalDate(d, tz)

      const [thisWeek, lastWeek, owed, booked, methods, account] = await Promise.all([
        weekFigures(service, accountId, at(weekStart), at(today)),
        weekFigures(service, accountId, at(priorStart), at(weekStart)),
        allRows<{ outstanding_cents: number | null }>((a, b) => service.from('patient_live_balances').select('outstanding_cents').eq('account_id', accountId).gt('outstanding_cents', 0).order('patient_id').range(a, b) as never),
        service.from('appointments').select('id', { count: 'exact', head: true }).eq('account_id', accountId).eq('status', 'booked').is('deleted_at', null).gte('starts_at', at(today).toISOString()).lt('starts_at', at(nextWeekEnd).toISOString()),
        service.from('payment_methods').select('key, name').eq('account_id', accountId),
        service.from('accounts').select('name').eq('id', accountId).maybeSingle(),
      ])
      const names = new Map(((methods.data as { key: string; name: string }[] | null) ?? []).map((m) => [m.key, m.name]))
      const clinicName = (account.data as { name: string | null } | null)?.name || clinic.name
      const label = (d: string) => new Date(`${d}T12:00:00Z`).toLocaleDateString('es-ES', { day: 'numeric', month: 'short', timeZone: 'UTC' })
      const digest = {
        clinicName,
        weekLabel: `${label(weekStart)} – ${label(previousDate(today))}`,
        thisWeek,
        lastWeek,
        owedCents: owed.reduce((s, r) => s + (r.outstanding_cents ?? 0), 0),
        nextWeekBooked: booked.count ?? 0,
        methodName: (key: string) => {
          const name = names.get(key)
          // A seeded method keeps its English seed name until the clinic renames it.
          return name && !['Cash', 'Card', 'Bank transfer', 'Bizum', 'Other'].includes(name) ? name : (SEEDED_METHOD_ES[key] ?? name ?? key)
        },
        origin,
      }

      const html = digestEmailHtml(digest)
      for (const r of recipients) {
        try {
          const { data: user } = await service.auth.admin.getUserById(r.user_id)
          const email = user?.user?.email
          if (email) await sendResendEmail({ to: email, subject: `Tu semana en ${clinicName}: ${digestPushBody(digest).split(' · ')[0]}`, html })
        } catch (err) {
          console.error('[weekly-digest] email failed', accountId, r.id, err)
        }
      }
      await sendPushToUsers(service, recipients.map((r) => r.user_id), { title: 'Tu semana', body: digestPushBody(digest), data: { type: 'weekly_digest' } }).catch((err: unknown) => console.error('[weekly-digest] push failed', accountId, err))
      sent += recipients.length
    }
  } catch (err) {
    console.error('[weekly-digest] failed', err)
  }
  return sent
}

/** The calendar date before `date`, as YYYY-MM-DD. */
function previousDate(date: string): string {
  const [y, m, d] = date.split('-').map(Number)
  return new Date(Date.UTC(y!, m! - 1, d! - 1)).toISOString().slice(0, 10)
}
