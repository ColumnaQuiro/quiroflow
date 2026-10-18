import type { serverSupabaseServiceRole } from '#supabase/server'
import type { SupabaseClient } from '@supabase/supabase-js'
import type { Database } from '~/types/database.types'
import { DEFAULT_CLINIC_TIMEZONE, localDay } from '~/utils/clinicClock'
import { workdaysOf, formatWorked, workdayClock, workdayMonthBounds, WORKDAY_STALE_HOURS, type WorkdaySummary } from '~/utils/workday'
import { toCsv } from './zipStore'
import { sendPushToUsers } from './pushNotifications'

// Registro de jornada on the server: the month's export (CSV, and a PDF with
// a page per person to sign) and the 20:00 "your day is still open" push.
// Days are read with utils/workday, the same reading every screen uses.
type Service = ReturnType<typeof serverSupabaseServiceRole<Database>>

export interface TimeRecordPerson {
  name: string
  days: WorkdaySummary[]
  notes: Map<string, string[]>
  totalMinutes: number
}
export interface TimeRecords {
  month: string
  employer: { name: string; taxId: string | null }
  timeZone: string
  people: TimeRecordPerson[]
}

/**
 * The month for `memberIds`, read with the CALLER's client: RLS gives an
 * owner everyone and anyone else themselves, so asking for more than that
 * only returns less.
 */
export async function loadTimeRecords(supabase: SupabaseClient<Database>, month: string, memberIds: string[]): Promise<TimeRecords> {
  const { first, last } = workdayMonthBounds(month)
  const [{ data: clinic }, { data: members }, { data: entries }, { data: corrections }] = await Promise.all([
    supabase.from('clinics').select('timezone, legal_name, tax_id, name').is('archived_at', null).order('created_at').limit(1).maybeSingle(),
    supabase.from('team_members').select('id, full_name').in('id', memberIds).order('full_name'),
    supabase.from('time_entries').select('id, team_member_id, kind, at, work_date').in('team_member_id', memberIds).is('superseded_by', null).gte('work_date', first).lte('work_date', last).order('at'),
    supabase.from('time_corrections').select('id, team_member_id, work_date, kind, at, reason, status, replaces_entry_id').in('team_member_id', memberIds).eq('status', 'approved').gte('work_date', first).lte('work_date', last),
  ])
  const timeZone = clinic?.timezone || DEFAULT_CLINIC_TIMEZONE
  // What each approved correction replaced, for "corregida (antes 09:20)".
  const replacedIds = (corrections ?? []).map((c) => c.replaces_entry_id).filter((x): x is string => !!x)
  const { data: replaced } = replacedIds.length ? await supabase.from('time_entries').select('id, at').in('id', replacedIds) : { data: [] }
  const replacedAt = new Map((replaced ?? []).map((r) => [r.id, r.at]))
  const kindEs: Record<string, string> = { in: 'entrada', break_start: 'pausa', break_end: 'vuelta', out: 'salida' }

  const now = new Date()
  const people = (members ?? []).map((m) => {
    const days = workdaysOf((entries ?? []).filter((e) => e.team_member_id === m.id), now).reverse()
    const notes = new Map<string, string[]>()
    for (const c of (corrections ?? []).filter((x) => x.team_member_id === m.id)) {
      const was = c.replaces_entry_id ? replacedAt.get(c.replaces_entry_id) : null
      const line = `Corregida ${kindEs[c.kind] ?? c.kind} ${workdayClock(c.at, timeZone)}${was ? ` (antes ${workdayClock(was, timeZone)})` : ' (sin fichar)'}: ${c.reason}`
      notes.set(c.work_date, [...(notes.get(c.work_date) ?? []), line])
    }
    for (const d of days) if (d.missingOut) notes.set(d.date, [...(notes.get(d.date) ?? []), 'Sin salida fichada'])
    return { name: m.full_name, days, notes, totalMinutes: days.reduce((s, d) => s + (d.open ? 0 : d.workedMinutes), 0) }
  })
  return { month, employer: { name: clinic?.legal_name || clinic?.name || '', taxId: clinic?.tax_id ?? null }, timeZone, people }
}

const breaksText = (d: WorkdaySummary, tz: string) => d.breaks.map((b) => `${workdayClock(b.start, tz)}-${b.end ? workdayClock(b.end, tz) : '?'}`).join(', ')

export function timeRecordsCsv(r: TimeRecords): string {
  const rows: Record<string, unknown>[] = []
  for (const p of r.people) {
    for (const d of p.days) {
      rows.push({
        Persona: p.name,
        Fecha: d.date,
        Entrada: d.firstIn ? workdayClock(d.firstIn, r.timeZone) : '',
        Pausas: breaksText(d, r.timeZone),
        Salida: d.lastOut ? workdayClock(d.lastOut, r.timeZone) : '',
        Total: d.open ? '' : formatWorked(d.workedMinutes),
        Minutos: d.open ? '' : d.workedMinutes,
        Notas: (p.notes.get(d.date) ?? []).join(' | '),
      })
    }
  }
  return toCsv(rows)
}

export async function timeRecordsPdf(r: TimeRecords): Promise<Buffer> {
  const { default: PDFDocument } = await import('pdfkit')
  const monthName = new Date(`${r.month}-15T12:00:00Z`).toLocaleDateString('es-ES', { month: 'long', year: 'numeric', timeZone: 'UTC' })
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({ size: 'A4', margin: 50 })
    const chunks: Buffer[] = []
    doc.on('data', (chunk) => chunks.push(chunk))
    doc.on('end', () => resolve(Buffer.concat(chunks)))
    doc.on('error', reject)

    const people = r.people.length ? r.people : [{ name: '', days: [], notes: new Map(), totalMinutes: 0 }]
    people.forEach((p, i) => {
      if (i > 0) doc.addPage()
      doc.fontSize(16).font('Helvetica-Bold').fillColor('#000').text('Registro de jornada', 50, 50)
      doc.fontSize(10).font('Helvetica').fillColor('#333')
      doc.text(`Empresa: ${r.employer.name}${r.employer.taxId ? ` · CIF/NIF ${r.employer.taxId}` : ''}`)
      doc.text(`Persona trabajadora: ${p.name}`)
      doc.text(`Periodo: ${monthName}`)
      doc.moveDown(1)

      const col = { day: 50, in: 120, breaks: 170, out: 280, total: 330, notes: 385 }
      let y = doc.y
      const header = () => {
        doc.fontSize(9).font('Helvetica-Bold').fillColor('#000')
        doc.text('Día', col.day, y)
        doc.text('Entrada', col.in, y)
        doc.text('Pausas', col.breaks, y)
        doc.text('Salida', col.out, y)
        doc.text('Total', col.total, y)
        doc.text('Notas', col.notes, y)
        doc.moveTo(50, y + 13).lineTo(545, y + 13).strokeColor('#ccc').stroke()
        y += 18
        doc.font('Helvetica').fillColor('#222').fontSize(8.5)
      }
      header()
      for (const d of p.days) {
        const notes = (p.notes.get(d.date) ?? []).join('; ')
        const h = Math.max(13, doc.heightOfString(notes || ' ', { width: 160 }) + 3)
        if (y + h > 660) {
          doc.addPage()
          y = 50
          header()
        }
        const label = new Date(`${d.date}T12:00:00Z`).toLocaleDateString('es-ES', { weekday: 'short', day: 'numeric', timeZone: 'UTC' })
        doc.text(label, col.day, y, { width: 65 })
        doc.text(d.firstIn ? workdayClock(d.firstIn, r.timeZone) : '—', col.in, y)
        doc.text(breaksText(d, r.timeZone) || '—', col.breaks, y, { width: 105 })
        doc.text(d.lastOut ? workdayClock(d.lastOut, r.timeZone) : '—', col.out, y)
        doc.text(d.open ? '—' : formatWorked(d.workedMinutes), col.total, y)
        if (notes) doc.text(notes, col.notes, y, { width: 160 })
        y += h
      }
      if (!p.days.length) {
        doc.text('Ningún día fichado este mes.', col.day, y)
        y += 14
      }
      doc.moveTo(50, y + 2).lineTo(545, y + 2).strokeColor('#ccc').stroke()
      doc.font('Helvetica-Bold').fontSize(9.5).text(`Total del mes: ${formatWorked(p.totalMinutes)}`, col.day, y + 8)

      // Signatures, at the foot of the person's last page.
      const sy = 690
      doc.font('Helvetica').fontSize(9).fillColor('#000')
      doc.rect(50, sy, 230, 60).strokeColor('#999').stroke()
      doc.rect(315, sy, 230, 60).strokeColor('#999').stroke()
      doc.text('Firma de la empresa', 56, sy + 6)
      doc.text('Firma de la persona trabajadora', 321, sy + 6)
      doc.fontSize(7.5).fillColor('#666').text(
        'Registro diario de jornada conforme al art. 34.9 del Estatuto de los Trabajadores. Se conserva durante cuatro años. Las horas las registra el servidor; las correcciones aprobadas constan junto al fichaje original.',
        50, sy + 70, { width: 495 },
      )
    })
    doc.end()
  })
}

const REMINDER_HOUR = 20
const REMINDER_WINDOW_MINUTES = 20

/**
 * At 20:00 where the clinic is: a push to everyone whose day is still open,
 * once per person and day (time_clock_reminders). Rides same-day-cron, like
 * the morning summary, rather than needing a pg_cron job of its own.
 * Best-effort: a failure here never stops the cron's other work.
 */
export async function sendOpenDayReminders(service: Service, now = new Date()) {
  let sent = 0
  try {
    const { data: clinics } = await service.from('clinics').select('account_id, timezone').is('archived_at', null)
    const accounts = new Set<string>()
    for (const c of clinics ?? []) {
      const m = localDay(now, c.timezone || DEFAULT_CLINIC_TIMEZONE).minutesSinceMidnight
      if (m >= REMINDER_HOUR * 60 && m < REMINDER_HOUR * 60 + REMINDER_WINDOW_MINUTES) accounts.add(c.account_id)
    }
    if (!accounts.size) return 0
    const since = new Date(now.getTime() - WORKDAY_STALE_HOURS * 3600_000).toISOString()
    const { data: recent } = await service
      .from('time_entries')
      .select('account_id, team_member_id, kind, at, work_date')
      .in('account_id', [...accounts])
      .is('superseded_by', null)
      .gte('at', since)
      .order('at')
    const last = new Map<string, { account_id: string; kind: string; work_date: string }>()
    for (const e of recent ?? []) last.set(e.team_member_id, e)
    const open = [...last.entries()].filter(([, e]) => e.kind !== 'out')
    if (!open.length) return 0
    const { data: members } = await service
      .from('team_members')
      .select('id, user_id, language_preference')
      .in('id', open.map(([id]) => id))
      .is('deleted_at', null)
    for (const m of members ?? []) {
      const e = last.get(m.id)!
      // Claimed before sending: a second tick in the window finds it taken.
      const { data: claimed } = await service
        .from('time_clock_reminders')
        .upsert({ team_member_id: m.id, work_date: e.work_date, account_id: e.account_id }, { onConflict: 'team_member_id,work_date', ignoreDuplicates: true })
        .select('team_member_id')
      if (!claimed?.length) continue
      const es = m.language_preference !== 'en'
      await sendPushToUsers(service, [m.user_id], {
        title: es ? 'Tu jornada sigue abierta' : 'Your working day is still open',
        body: es ? 'Si ya has terminado, ficha la salida en Mi día.' : "If you've finished, clock out on My Day.",
        data: { type: 'my_day' },
      })
      sent++
    }
  } catch (err) {
    console.error('[timeClock] open-day reminders failed', err)
  }
  return sent
}
