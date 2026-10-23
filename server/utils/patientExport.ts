import type { SupabaseClient } from '@supabase/supabase-js'
import type { Database } from '~/types/database.types'
import { createZip, toCsv, type ZipEntry } from '~/server/utils/zipStore'

// Everything QuiroFlow holds about one patient, for a right of access request
// (RGPD art. 15): their details, visits, clinical record, money, messages and
// files, in a ZIP with a README saying what each part is. Read through the
// caller's own client, so it holds what RLS lets them read -- the endpoint
// only lets an owner ask, and owners read everything.
//
// Internal bookkeeping is left out on purpose (automation runs, Stripe
// customer ids, upload tokens, staff tasks): they are not the patient's data
// so much as the clinic's machinery around it.

type Db = SupabaseClient<Database>
type Row = Record<string, unknown>

async function rows(q: PromiseLike<{ data: unknown; error: unknown }>): Promise<Row[]> {
  const { data } = await q
  return (data as Row[] | null) ?? []
}
async function inChunks(ids: string[], fetch: (chunk: string[]) => PromiseLike<{ data: unknown; error: unknown }>): Promise<Row[]> {
  const out: Row[] = []
  for (let i = 0; i < ids.length; i += 200) out.push(...(await rows(fetch(ids.slice(i, i + 200)))))
  return out
}
const json = (v: unknown) => JSON.stringify(v, null, 2)
// eslint-disable-next-line no-control-regex -- control characters are exactly what a filename must not carry
const safeName = (s: string) => s.normalize('NFC').replace(/[\\/:*?"<>|\u0000-\u001f]/g, '_').slice(0, 120)

export async function buildPatientExport(supabase: Db, patientId: string, meta: { clinicName: string; requestedBy: string }): Promise<{ zip: Uint8Array; fileName: string; counts: Record<string, number> } | null> {
  const { data: patient } = await supabase.from('patients').select('*').eq('id', patientId).maybeSingle()
  if (!patient) return null
  const p = patient as Row

  const [numbers, appointments, carePlans, exercises, memberships, purchases, invoices, payments, facturas, credits, docs, files, whatsapp, emails, appMessages, contactLog, reviews, access] = await Promise.all([
    rows(supabase.from('patient_contact_numbers').select('number, country_code, is_whatsapp, created_at').eq('patient_id', patientId)),
    rows(supabase.from('appointments').select('id, starts_at, ends_at, status, note, checked_in_at, created_at, deleted_at, appointment_types(name), team_members(full_name), clinics(name)').eq('patient_id', patientId).order('starts_at')),
    rows(supabase.from('care_plans').select('*').eq('patient_id', patientId)),
    rows(supabase.from('patient_exercises').select('*').eq('patient_id', patientId)),
    rows(supabase.from('patient_memberships').select('*').eq('patient_id', patientId)),
    rows(supabase.from('package_purchases').select('package_name, sessions_total, sessions_used, price_cents, purchased_at, is_closed').eq('patient_id', patientId)),
    rows(supabase.from('invoices').select('invoice_number, status, total_cents, is_refund, created_at').eq('patient_id', patientId)),
    rows(supabase.from('payments').select('paid_at, amount_cents, method, purpose, external_reference').eq('patient_id', patientId)),
    rows(supabase.from('facturas').select('number, kind, issued_at, description, amount_cents, tax_base_cents, tax_rate_bp, tax_amount_cents, recipient_nif').eq('patient_id', patientId)),
    rows(supabase.from('account_credits').select('created_at, amount_cents, reason, method').eq('patient_id', patientId)),
    rows(supabase.from('patient_docs').select('title, fields, created_at, completed_at').eq('patient_id', patientId)),
    rows(supabase.from('patient_files').select('file_name, file_type, size_bytes, storage_path, created_at').eq('patient_id', patientId)),
    rows(supabase.from('whatsapp_messages').select('*').eq('patient_id', patientId)),
    rows(supabase.from('email_messages').select('*').eq('patient_id', patientId)),
    rows(supabase.from('patient_app_messages').select('*').eq('patient_id', patientId)),
    rows(supabase.from('contact_log').select('*').eq('patient_id', patientId)),
    rows(supabase.from('review_requests').select('sent_at, opened_at').eq('patient_id', patientId)),
    rows(supabase.from('patient_access_log').select('created_at, kind, actor_name').eq('patient_id', patientId).order('created_at')),
  ])
  // The clinic's own fields (patient_attributes), archived ones included: the
  // answers are still held. Clinical ones go with the clinical record.
  const customFields = await rows(supabase.from('patient_attribute_values').select('value, updated_at, patient_attributes(label, section, kind, archived_at)').eq('patient_id', patientId))
  const customOf = (section: string) =>
    customFields
      .filter((r) => (r.patient_attributes as Row | null)?.section === section)
      .map((r) => ({ campo: (r.patient_attributes as Row).label, valor: r.value, actualizado: r.updated_at, archivado: !!(r.patient_attributes as Row).archived_at }))

  // Clinical record, keyed by the visits -- deleted ones included: the
  // export is what is held, and a deleted visit's row is still held.
  const apptIds = appointments.map((a) => a.id as string)
  const [notes, listings, pain, surveys] = await Promise.all([
    inChunks(apptIds, (c) => supabase.from('visit_notes').select('appointment_id, body, created_at').in('appointment_id', c)),
    inChunks(apptIds, (c) => supabase.from('visit_listings').select('appointment_id, listings, updated_at').in('appointment_id', c)),
    inChunks(apptIds, (c) => supabase.from('visit_pain_scores').select('appointment_id, practitioner_score, patient_score').in('appointment_id', c)),
    inChunks(apptIds, (c) => supabase.from('satisfaction_surveys').select('appointment_id, sent_at, score, comment, answered_at').in('appointment_id', c)),
  ])
  const visitDay = new Map(appointments.map((a) => [a.id as string, a.starts_at as string]))
  const byVisit = (r: Row) => ({ visita: visitDay.get(r.appointment_id as string) ?? null, ...r, appointment_id: undefined })

  const entries: ZipEntry[] = []
  const name = `${p.first_name ?? ''} ${p.last_name ?? ''}`.trim() || 'Paciente'
  const counts: Record<string, number> = {
    citas: appointments.length,
    notas: notes.length,
    facturas: facturas.length,
    pagos: payments.length,
    documentos: docs.length,
    mensajes: whatsapp.length + emails.length + appMessages.length,
    archivos: 0,
  }

  entries.push({ name: '01_datos_personales.json', data: json({ paciente: p, telefonos: numbers, membresias: memberships, campos_personalizados: customOf('admin') }) })
  entries.push({
    name: '02_citas.csv',
    data: toCsv(appointments.map((a) => ({ fecha: a.starts_at, fin: a.ends_at, estado: a.status, tipo: (a.appointment_types as Row | null)?.name ?? '', profesional: (a.team_members as Row | null)?.full_name ?? '', centro: (a.clinics as Row | null)?.name ?? '', llegada: a.checked_in_at, notas_de_la_cita: a.note, borrada: a.deleted_at }))),
  })
  entries.push({
    name: '03_historia_clinica.json',
    data: json({ notas_de_visita: notes.map(byVisit), listados: listings.map(byVisit), dolor: pain.map(byVisit), planes_de_tratamiento: carePlans, ejercicios: exercises, valoraciones: surveys.map(byVisit), campos_clinicos_personalizados: customOf('clinical') }),
  })
  entries.push({ name: '04_facturacion/facturas.csv', data: toCsv(facturas) })
  entries.push({ name: '04_facturacion/recibos.csv', data: toCsv(invoices) })
  entries.push({ name: '04_facturacion/pagos.csv', data: toCsv(payments) })
  entries.push({ name: '04_facturacion/saldo.csv', data: toCsv(credits) })
  entries.push({ name: '04_facturacion/bonos.csv', data: toCsv(purchases) })
  entries.push({ name: '05_documentos_firmados.json', data: json(docs) })
  entries.push({ name: '06_comunicaciones.json', data: json({ whatsapp, correo: emails, mensajes_app: appMessages, registro_de_contactos: contactLog, solicitudes_de_resena: reviews }) })
  entries.push({ name: '08_registro_de_accesos.json', data: json(access) })

  // The files themselves, as they were uploaded.
  const used = new Set<string>()
  for (const f of files) {
    if (!f.storage_path) continue
    const { data: blob } = await supabase.storage.from('patient-files').download(f.storage_path as string)
    if (!blob) continue
    let fileName = safeName(String(f.file_name ?? 'archivo'))
    for (let i = 2; used.has(fileName); i++) fileName = safeName(String(f.file_name)).replace(/(\.[^.]*)?$/, ` (${i})$1`)
    used.add(fileName)
    entries.push({ name: `07_archivos/${fileName}`, data: new Uint8Array(await blob.arrayBuffer()) })
    counts.archivos!++
  }

  const generatedAt = new Date()
  entries.unshift({
    name: 'LEEME.txt',
    data: [
      `Copia de los datos de ${name}`,
      `${meta.clinicName} · generada el ${generatedAt.toLocaleString('es-ES', { timeZone: 'Europe/Madrid' })} por ${meta.requestedBy}`,
      '',
      'Contenido:',
      '  01_datos_personales.json   Datos de contacto, teléfonos, consentimientos, membresías y campos propios de la clínica',
      `  02_citas.csv               Citas (${counts.citas})`,
      `  03_historia_clinica.json   Notas de visita (${counts.notas}), listados, dolor, planes, ejercicios, valoraciones y campos clínicos propios de la clínica`,
      `  04_facturacion/            Facturas (${counts.facturas}), recibos, pagos (${counts.pagos}), saldo y bonos`,
      `  05_documentos_firmados.json Formularios y consentimientos (${counts.documentos})`,
      `  06_comunicaciones.json     WhatsApp, correos y mensajes de la app (${counts.mensajes})`,
      `  07_archivos/               Archivos subidos a su ficha (${counts.archivos})`,
      '  08_registro_de_accesos.json Quién ha consultado su ficha y cuándo',
      '',
      'Los archivos .csv se abren con Excel; los .json, con cualquier editor de texto.',
    ].join('\r\n'),
  })

  const stamp = generatedAt.toISOString().slice(0, 10)
  return { zip: createZip(entries, generatedAt), fileName: `datos-${safeName(name).replace(/\s+/g, '-').toLowerCase()}-${stamp}.zip`, counts }
}
