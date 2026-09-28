// A clinic's worth of history for the reports and the dashboard, generated
// rather than hand-written, and deterministic: the same `seed` and `now`
// always produce the same rows, amounts and times (only the uuids differ).
//
// Two callers, at two scales:
//
//   - cypress/support/tasks/db.ts (db:seedReportDataset) seeds a small one
//     against a FIXED `now`, and the specs under cypress/e2e/dashboard pin
//     every figure the reports and widgets show for it. Fixed so the figures
//     cannot drift with the calendar -- the spec freezes the browser's Date to
//     the same instant.
//   - scripts/seed-report-scale.mjs seeds a production-sized one (the live
//     clinic in Sep 2026: ~1,600 patients, ~9,000 appointments over two years,
//     ~7,000 invoices, ~3,400 payments, ~530 bonos, ~3,600 WhatsApp messages)
//     against the real `now`, to measure the pages at the size they are
//     actually used.
//
// It covers the populations the report code treats specially, because those
// are where a figure changes if a query changes shape: void invoices, credit
// and write-off payments, bono and on-account money with no invoice or
// appointment behind it, PracticeHub-imported payments, patients with no
// practitioner, appointments with no practitioner, soft-deleted appointments,
// quick invoices with no appointment, bono sessions settled by the bono, and
// untagged appointment types.
//
// Times are LOCAL wall-clock times of the process that runs this, so the
// browser reading them back (same machine, same timezone) buckets them into
// the same days, weeks and months whatever that timezone is.

const FIRST_NAMES = ['Lucía', 'Hugo', 'Martina', 'Mateo', 'Sofía', 'Leo', 'Julia', 'Pablo', 'Valeria', 'Daniel', 'Paula', 'Álvaro', 'Emma', 'Manuel', 'Carla', 'Adrián', 'Sara', 'David', 'Noa', 'Mario', 'Carmen', 'Javier', 'Elena', 'Diego']
const LAST_NAMES = ['García', 'Rodríguez', 'González', 'Fernández', 'López', 'Martínez', 'Sánchez', 'Pérez', 'Gómez', 'Martín', 'Jiménez', 'Ruiz', 'Hernández', 'Díaz', 'Moreno', 'Muñoz', 'Álvarez', 'Romero', 'Alonso', 'Navarro']

const TYPES = [
  { name: 'Primera visita', stage: 'first_visit', price: 6000, weight: 8 },
  { name: 'Oferta primera visita', stage: 'first_visit_offer', price: 2500, weight: 3 },
  { name: 'Informe', stage: 'report', price: 6000, weight: 7 },
  { name: 'Ajuste', stage: 'adjustment', price: 4400, weight: 50 },
  { name: 'Revisión', stage: 'revision', price: 4400, weight: 7 },
  { name: 'Mantenimiento', stage: 'maintenance', price: 4000, weight: 20 },
  { name: 'Sin etiquetar', stage: null, price: 3000, weight: 5 },
]
const PACKAGES = [
  { name: 'Bono 5', sessions: 5, price: 20000 },
  { name: 'Bono 10', sessions: 10, price: 38000 },
  { name: 'Bono 12 sesiones', sessions: 12, price: 44000 },
]
const SERVICES = [
  { name: 'Informe radiológico', price: 1500 },
  { name: 'Almohada cervical', price: 4500 },
  { name: 'Plantillas', price: 9000 },
]

export const PROD_SCALE = { patients: 1600, appointments: 9000, invoices: 7000, payments: 3400, purchases: 534, messages: 3600, memberships: 40, daysBack: 730, daysAhead: 30 }
export const SMALL_SCALE = { patients: 60, appointments: 420, invoices: 300, payments: 170, purchases: 24, messages: 160, memberships: 6, daysBack: 120, daysAhead: 14 }

function mulberry32(seed) {
  let a = seed >>> 0
  return () => {
    a = (a + 0x6d2b79f5) >>> 0
    let t = a
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

async function insertAll(admin, table, rows, select = 'id') {
  const out = []
  for (let i = 0; i < rows.length; i += 500) {
    const { data, error } = await admin.from(table).insert(rows.slice(i, i + 500)).select(select)
    if (error) throw new Error(`${table}: ${error.message}`)
    out.push(...data)
  }
  return out
}

/**
 * @param admin  a service-role supabase-js client
 * @param opts   { accountId, clinicIds: string[], practitioners: { id, name }[], ownerTeamMemberId, now: Date, scale, seed }
 */
export async function seedReportDataset(admin, opts) {
  const { accountId, clinicIds, practitioners, ownerTeamMemberId, scale } = opts
  const now = new Date(opts.now)
  const rand = mulberry32(opts.seed ?? 20260928)
  const pick = (list) => list[Math.floor(rand() * list.length)]
  const chance = (p) => rand() < p
  const between = (lo, hi) => lo + Math.floor(rand() * (hi - lo + 1))
  const weighted = (list) => {
    const total = list.reduce((s, x) => s + x.weight, 0)
    let r = rand() * total
    for (const x of list) if ((r -= x.weight) < 0) return x
    return list[list.length - 1]
  }
  // A local time `days` days before `now`, never after it: a date that
  // would land later today moves to the day before. Built from local fields
  // (setDate/setHours), not by subtracting milliseconds, so a daylight-saving
  // change in between shifts nothing -- the same seed gives the same wall
  // clock in every timezone.
  const past = (days, hh = between(8, 19), mm = pick([0, 10, 20, 30, 40, 50])) => {
    const d = localAt(-days, hh, mm)
    if (d > now) d.setDate(d.getDate() - 1)
    return d
  }
  const plusMinutes = (iso, minutes) => {
    const d = new Date(iso)
    d.setMinutes(d.getMinutes() + minutes)
    return d
  }
  // A local wall-clock time `dayOffset` days from `now`, at hh:mm.
  const localAt = (dayOffset, hh, mm) => {
    const d = new Date(now)
    d.setDate(d.getDate() + dayOffset)
    d.setHours(hh, mm, 0, 0)
    return d
  }

  // --- reference data
  const types = await insertAll(
    admin,
    'appointment_types',
    TYPES.map((t) => ({ account_id: accountId, name: t.name, stage: t.stage, duration_minutes: 30, default_price_cents: t.price })),
    'id, name',
  )
  const typeRows = TYPES.map((t, i) => ({ ...t, id: types[i].id }))
  const pkgs = await insertAll(admin, 'packages', PACKAGES.map((p) => ({ account_id: accountId, name: p.name, session_count: p.sessions, price_cents: p.price })), 'id')
  const pkgRows = PACKAGES.map((p, i) => ({ ...p, id: pkgs[i].id }))
  const svcs = await insertAll(admin, 'services_products', SERVICES.map((s) => ({ account_id: accountId, name: s.name, price_cents: s.price })), 'id')
  const svcRows = SERVICES.map((s, i) => ({ ...s, id: svcs[i].id }))

  // --- patients. ~10% have no practitioner of their own, which is what makes
  // money with no visit behind it unattributable.
  const patientSpecs = Array.from({ length: scale.patients }, (_, i) => ({
    account_id: accountId,
    clinic_id: pick(clinicIds),
    first_name: pick(FIRST_NAMES),
    last_name: `${pick(LAST_NAMES)} ${i + 1}`,
    default_practitioner_id: chance(0.9) ? pick(practitioners).id : null,
    preferred_language: chance(0.8) ? 'es' : 'en',
    confirmation_channel: pick(['whatsapp', 'whatsapp', 'email', 'none']),
    created_at: past(between(0, scale.daysBack), 9, 0).toISOString(),
  }))
  const patients = (await insertAll(admin, 'patients', patientSpecs, 'id')).map((p, i) => ({ ...patientSpecs[i], id: p.id }))

  // --- appointments, spread over the history and a little ahead. Every
  // patient gets at least one, and most several, of mixed stages -- enough
  // for the funnel (a report followed by an adjustment, a revision by
  // maintenance) and for retention to find returning patients.
  const apptSpecs = []
  for (let i = 0; i < scale.appointments; i++) {
    const patient = patients[i < patients.length ? i : between(0, patients.length - 1)]
    const dayOffset = -scale.daysBack + between(0, scale.daysBack + scale.daysAhead)
    const startsAt = localAt(dayOffset, between(8, 19), pick([0, 15, 30, 45]))
    const type = weighted(typeRows)
    const isPast = startsAt.getTime() < now.getTime()
    const r = rand()
    const status = isPast ? (r < 0.82 ? 'completed' : r < 0.91 ? 'cancelled' : r < 0.96 ? 'no_show' : 'booked') : r < 0.9 ? 'booked' : 'cancelled'
    const practitioner = chance(0.03) ? null : chance(0.7) && patient.default_practitioner_id ? practitioners.find((p) => p.id === patient.default_practitioner_id) : pick(practitioners)
    const soon = !isPast && dayOffset < 8
    apptSpecs.push({
      account_id: accountId,
      clinic_id: patient.clinic_id,
      patient_id: patient.id,
      practitioner_id: practitioner?.id ?? null,
      practitioner_name: practitioner?.name ?? null,
      appointment_type_id: type.id,
      starts_at: startsAt.toISOString(),
      ends_at: new Date(startsAt.getTime() + 30 * 60 * 1000).toISOString(),
      status,
      confirmation_status: soon && status === 'booked' ? pick(['pending', 'confirmed', 'confirmed', 'reschedule_requested', null]) : null,
      deleted_at: chance(0.01) ? now.toISOString() : null,
    })
  }
  // Two booked later today, for "Next up today" and the day's remaining visits.
  for (const minutes of [60, 150]) {
    const patient = patients[between(0, patients.length - 1)]
    const startsAt = new Date(now.getTime() + minutes * 60 * 1000)
    const practitioner = practitioners[0]
    apptSpecs.push({
      account_id: accountId, clinic_id: patient.clinic_id, patient_id: patient.id, practitioner_id: practitioner.id, practitioner_name: practitioner.name,
      appointment_type_id: typeRows[3].id, starts_at: startsAt.toISOString(), ends_at: new Date(startsAt.getTime() + 30 * 60 * 1000).toISOString(),
      status: 'booked', confirmation_status: 'confirmed', deleted_at: null,
    })
  }
  const appointments = (await insertAll(admin, 'appointments', apptSpecs, 'id')).map((a, i) => ({ ...apptSpecs[i], id: a.id }))
  const typeById = new Map(typeRows.map((t) => [t.id, t]))

  // --- bonos. Most were sold with no invoice (the current model), some with
  // a sale invoice (the old one); a few carry an explicit owed amount.
  const purchaseSpecs = Array.from({ length: scale.purchases }, () => {
    const patient = pick(patients)
    const pkg = pick(pkgRows)
    return {
      account_id: accountId,
      patient_id: patient.id,
      package_id: chance(0.9) ? pkg.id : null,
      package_name: pkg.name,
      sessions_total: pkg.sessions,
      sessions_used: between(0, pkg.sessions),
      price_cents: pkg.price,
      purchased_at: past(between(1, scale.daysBack)).toISOString(),
      owed_cents: chance(0.08) ? between(1, 10) * 2000 : null,
    }
  })
  const purchases = (await insertAll(admin, 'package_purchases', purchaseSpecs, 'id')).map((p, i) => ({ ...purchaseSpecs[i], id: p.id }))

  // --- invoices: one per completed visit until the target is reached, plus
  // quick invoices with no appointment, plus the old-model bono sale invoices.
  let invoiceNo = 0
  const invoiceSpecs = []
  const invoiceLines = []
  const completed = appointments.filter((a) => a.status === 'completed')
  for (const appt of completed) {
    if (invoiceSpecs.length >= scale.invoices * 0.93) break
    const type = typeById.get(appt.appointment_type_id)
    const r = rand()
    const status = r < 0.88 ? 'paid' : r < 0.96 ? 'unpaid' : 'void'
    const bonoSession = chance(0.12) ? purchases.find((p) => p.patient_id === appt.patient_id) : undefined
    const extra = chance(0.2) ? pick(svcRows) : null
    const total = type.price + (extra ? extra.price : 0)
    invoiceSpecs.push({ account_id: accountId, patient_id: appt.patient_id, appointment_id: appt.id, invoice_number: `R-${String(++invoiceNo).padStart(5, '0')}`, status, total_cents: total, created_at: new Date(new Date(appt.starts_at).getTime() + 35 * 60000).toISOString() })
    invoiceLines.push([
      { description: type.name, quantity: 1, price_cents: type.price, service_id: null, package_purchase_id: bonoSession?.id ?? null },
      ...(extra ? [{ description: extra.name, quantity: chance(0.2) ? 2 : 1, price_cents: extra.price, service_id: extra.id, package_purchase_id: null }] : []),
    ])
  }
  while (invoiceSpecs.length < scale.invoices * 0.97) {
    const patient = pick(patients)
    const svc = pick(svcRows)
    invoiceSpecs.push({ account_id: accountId, patient_id: patient.id, appointment_id: null, invoice_number: `R-${String(++invoiceNo).padStart(5, '0')}`, status: chance(0.8) ? 'paid' : 'unpaid', total_cents: svc.price, created_at: past(between(0, scale.daysBack)).toISOString() })
    invoiceLines.push([{ description: svc.name, quantity: 1, price_cents: svc.price, service_id: svc.id, package_purchase_id: null }])
  }
  const saleInvoiceFor = new Map()
  for (const purchase of purchases) {
    if (invoiceSpecs.length >= scale.invoices) break
    if (!chance(0.5)) continue
    saleInvoiceFor.set(invoiceSpecs.length, purchase)
    invoiceSpecs.push({ account_id: accountId, patient_id: purchase.patient_id, appointment_id: null, invoice_number: `R-${String(++invoiceNo).padStart(5, '0')}`, status: chance(0.7) ? 'paid' : 'unpaid', total_cents: purchase.price_cents, created_at: purchase.purchased_at })
    invoiceLines.push([{ description: purchase.package_name, quantity: 1, price_cents: purchase.price_cents, service_id: null, package_purchase_id: null }])
  }
  const invoices = (await insertAll(admin, 'invoices', invoiceSpecs, 'id')).map((inv, i) => ({ ...invoiceSpecs[i], id: inv.id }))
  await insertAll(
    admin,
    'invoice_line_items',
    invoices.flatMap((inv, i) => invoiceLines[i].map((line) => ({ account_id: accountId, invoice_id: inv.id, ...line }))),
  )
  const saleInvoices = []
  for (const [index, purchase] of saleInvoiceFor) {
    saleInvoices.push({ invoice: invoices[index], purchase })
    purchase.invoice_id = invoices[index].id
    const { error } = await admin.from('package_purchases').update({ invoice_id: invoices[index].id }).eq('id', purchase.id)
    if (error) throw new Error(`package_purchases: ${error.message}`)
  }

  // --- payments
  const methods = ['card', 'card', 'card', 'cash', 'cash', 'transfer', 'bizum', 'other']
  const paymentSpecs = []
  const push = (row) => paymentSpecs.push({ account_id: accountId, ...row })
  const later = (iso, maxMinutes) => plusMinutes(iso, between(5, maxMinutes)).toISOString()
  const target = scale.payments
  // Visit invoices: about 55% of the payments. Paid ones settle in full,
  // some unpaid ones in part, a few by spending credit or a write-off.
  for (const inv of invoices) {
    if (paymentSpecs.length >= target * 0.55) break
    if (inv.appointment_id === null && !chance(0.5)) continue
    if (inv.status === 'paid') {
      if (!chance(0.45)) continue // settled by a bono or imported unallocated: no linked payment
      const r = rand()
      const method = r < 0.05 ? 'credit' : r < 0.07 ? 'write_off' : pick(methods)
      push({ invoice_id: inv.id, patient_id: inv.patient_id, amount_cents: inv.total_cents, method, paid_at: later(inv.created_at, 4000), purpose: 'visit' })
    } else if (inv.status === 'unpaid' && chance(0.35)) {
      push({ invoice_id: inv.id, patient_id: inv.patient_id, amount_cents: Math.round(inv.total_cents / 2), method: pick(methods), paid_at: later(inv.created_at, 3000), purpose: 'visit' })
    } else if (inv.status === 'void' && chance(0.5)) {
      push({ invoice_id: inv.id, patient_id: inv.patient_id, amount_cents: inv.total_cents, method: pick(methods), paid_at: later(inv.created_at, 600), purpose: 'visit' })
    }
  }
  // Old-model bono sale invoices, paid against the invoice.
  for (const { invoice, purchase } of saleInvoices) {
    if (chance(0.6)) push({ invoice_id: invoice.id, patient_id: purchase.patient_id, amount_cents: chance(0.8) ? invoice.total_cents : Math.round(invoice.total_cents / 2), method: pick(methods), paid_at: later(invoice.created_at, 200), purpose: 'bono' })
  }
  // Current-model bonos: paid against the bono itself, no invoice.
  for (const purchase of purchases) {
    if (purchase.invoice_id || !chance(0.85)) continue
    push({ invoice_id: null, package_purchase_id: purchase.id, patient_id: purchase.patient_id, amount_cents: chance(0.85) ? purchase.price_cents : Math.round(purchase.price_cents / 2), method: pick(methods), paid_at: later(purchase.purchased_at, 120), purpose: 'bono' })
  }
  // Money on account and PracticeHub-imported unallocated payments.
  let ph = 0
  while (paymentSpecs.length < target) {
    const patient = pick(patients)
    const paidAt = past(between(0, scale.daysBack))
    if (chance(0.3)) push({ invoice_id: null, patient_id: patient.id, amount_cents: between(1, 10) * 1000, method: pick(methods), paid_at: paidAt.toISOString(), purpose: 'on_account' })
    else push({ invoice_id: null, patient_id: patient.id, amount_cents: pick([4000, 4400, 6000, 20000, 38000]), method: pick(methods), paid_at: paidAt.toISOString(), purpose: null, external_reference: `phpay-${++ph}` })
  }
  // Today's takings, so the day sheet has a day to show: an invoice settled,
  // a bono, credit spent, money on account and a refund-free PracticeHub row.
  const todays = [
    { invoice: invoices.find((i) => i.status === 'unpaid' && i.appointment_id), method: 'card', purpose: 'visit' },
    { invoice: invoices.find((i) => i.status === 'paid' && i.appointment_id), method: 'cash', purpose: 'visit' },
    { invoice: invoices.find((i) => i.status === 'paid' && !i.appointment_id), method: 'credit', purpose: 'visit' },
    { purchase: purchases.find((p) => !p.invoice_id), method: 'bizum', purpose: 'bono' },
    { method: 'transfer', purpose: 'on_account' },
    { method: 'card', purpose: null },
  ]
  todays.forEach((row, i) => {
    const paidAt = localAt(0, 8 + Math.floor(i / 2), (i % 2) * 25 + 5).toISOString()
    const patientId = row.invoice?.patient_id ?? row.purchase?.patient_id ?? patients[i].id
    const amount = row.invoice ? row.invoice.total_cents : row.purchase ? row.purchase.price_cents : 2500 * (i + 1)
    push({ invoice_id: row.invoice?.id ?? null, package_purchase_id: row.purchase?.id ?? null, patient_id: patientId, amount_cents: amount, method: row.method, paid_at: paidAt, purpose: row.purpose, ...(row.purpose === null ? { external_reference: `phpay-today-${i}` } : {}) })
  })
  // Nothing in the future: a payment is money that has arrived.
  for (const p of paymentSpecs) {
    if (new Date(p.paid_at) > now) p.paid_at = plusMinutes(now.toISOString(), -between(1, 90)).toISOString()
  }
  // Same shape for every row, so a batch insert does not reject mixed keys.
  await insertAll(admin, 'payments', paymentSpecs.map((p) => ({ package_purchase_id: null, external_reference: null, ...p })))

  // --- messages: reminders and confirmations out, replies in, a few numbers
  // on no patient, a few Instagram DMs, some in the patient app.
  const phoneOf = (patient) => `346${String(10000000 + patients.indexOf(patient)).slice(-8)}`
  const messageSpecs = []
  for (let i = 0; i < scale.messages; i++) {
    const createdAt = past(between(0, Math.min(365, scale.daysBack)), between(8, 21), between(0, 59))
    const r = rand()
    const patient = pick(patients)
    const base = { account_id: accountId, channel: 'whatsapp', created_at: createdAt.toISOString(), media_type: null, external_contact_id: null, error_code: null, error_message: null, purpose: null }
    if (r < 0.6) {
      const status = weighted([{ v: 'sent', weight: 15 }, { v: 'delivered', weight: 45 }, { v: 'read', weight: 35 }, { v: 'failed', weight: 5 }]).v
      messageSpecs.push({ ...base, patient_id: patient.id, phone_number: phoneOf(patient), direction: 'outbound', purpose: pick(['reminder', 'confirmation', 'recall']), status, body_preview: 'Recordatorio de su cita', template_name: 'appointment_reminder', error_code: status === 'failed' ? pick(['131026', '131047']) : null, error_message: status === 'failed' && chance(0.5) ? 'Message undeliverable' : null })
    } else if (r < 0.9) {
      messageSpecs.push({ ...base, patient_id: patient.id, phone_number: phoneOf(patient), direction: 'inbound', status: 'received', body_preview: pick(['Gracias', 'Confirmo', '¿Puedo cambiar la cita?', 'Ok']), template_name: null })
    } else if (r < 0.95) {
      messageSpecs.push({ ...base, patient_id: patient.id, phone_number: phoneOf(patient), direction: 'outbound', purpose: 'other', status: 'read', body_preview: 'Claro, le cambiamos la cita', template_name: null })
    } else if (r < 0.98) {
      messageSpecs.push({ ...base, patient_id: null, phone_number: `349${between(10000000, 99999999)}`, direction: 'inbound', status: 'received', body_preview: 'Hola, información por favor', template_name: null })
    } else {
      messageSpecs.push({ ...base, patient_id: null, phone_number: null, channel: 'instagram', external_contact_id: `ig-${between(1, 40)}`, direction: 'inbound', status: 'received', body_preview: 'Hola!', template_name: null })
    }
  }
  await insertAll(admin, 'whatsapp_messages', messageSpecs)
  const appMessageSpecs = Array.from({ length: Math.round(scale.messages * 0.08) }, () => ({
    account_id: accountId,
    patient_id: pick(patients).id,
    direction: chance(0.6) ? 'inbound' : 'outbound',
    body: 'Mensaje desde la app',
    created_at: past(between(0, Math.min(200, scale.daysBack))).toISOString(),
  }))
  await insertAll(admin, 'patient_app_messages', appMessageSpecs)

  // The owner has read some conversations, at some point, and archived a few.
  const keys = [...new Set([...messageSpecs.map((m) => m.patient_id ?? m.phone_number ?? m.external_contact_id), ...appMessageSpecs.map((m) => m.patient_id)])]
  const reads = []
  const archives = []
  for (const key of keys) {
    if (chance(0.7)) reads.push({ account_id: accountId, team_member_id: ownerTeamMemberId, conversation_key: key, last_read_at: past(between(0, Math.min(200, scale.daysBack)), 12, 0).toISOString() })
    if (chance(0.05)) archives.push({ account_id: accountId, team_member_id: ownerTeamMemberId, conversation_key: key })
  }
  await insertAll(admin, 'inbox_reads', reads, 'conversation_key')
  await insertAll(admin, 'whatsapp_conversation_archives', archives, 'conversation_key')

  // --- memberships, billed monthly since they started.
  const membershipSpecs = Array.from({ length: scale.memberships }, () => ({
    account_id: accountId,
    patient_id: pick(patients).id,
    membership_name: pick(['Mensual', 'Familiar']),
    price_cents: pick([4900, 7900]),
    status: weighted([{ v: 'active', weight: 7 }, { v: 'paused', weight: 1 }, { v: 'cancelled', weight: 2 }]).v,
    started_at: past(between(20, 400), 10, 0).toISOString(),
  }))
  const memberships = (await insertAll(admin, 'patient_memberships', membershipSpecs, 'id')).map((m, i) => ({ ...membershipSpecs[i], id: m.id }))
  const membershipPayments = []
  for (const m of memberships) {
    const cursor = new Date(m.started_at)
    cursor.setDate(1)
    while (cursor <= now) {
      const periodStart = `${cursor.getFullYear()}-${String(cursor.getMonth() + 1).padStart(2, '0')}-01`
      membershipPayments.push({ account_id: accountId, patient_membership_id: m.id, period_start: periodStart, amount_cents: m.price_cents, status: chance(0.94) ? 'paid' : 'failed' })
      cursor.setMonth(cursor.getMonth() + 1)
    }
  }
  await insertAll(admin, 'membership_payments', membershipPayments)

  return {
    patients: patients.length,
    appointments: appointments.length,
    invoices: invoices.length,
    payments: paymentSpecs.length,
    purchases: purchases.length,
    messages: messageSpecs.length + appMessageSpecs.length,
    memberships: memberships.length,
  }
}
