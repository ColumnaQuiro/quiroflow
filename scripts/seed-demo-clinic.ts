// Seeds "Clínica Demo", a fictional clinic for screenshots, demos and
// marketing images -- G2/Capterra listings, store screenshots, sales calls.
// Every person, phone and address in it is invented. Never point it at
// production: it refuses any Supabase URL that is not a local one.
//
//   eval "$(cd supabase && supabase status -o env | sed 's/^/export /')"
//   NUXT_PUBLIC_SUPABASE_URL=$API_URL NUXT_PUBLIC_SUPABASE_KEY=$ANON_KEY NUXT_SUPABASE_SECRET_KEY=$SERVICE_ROLE_KEY \
//     npx jiti scripts/seed-demo-clinic.ts
//
// Run through jiti (TypeScript, ships with Nuxt) so it can reuse the Cypress
// seeding helpers in cypress/support/tasks/db.ts and the posture maths in
// utils/posture.ts rather than restating them.
//
// What it makes:
//   - three practitioners (the owner, Sara Molina, plus Álex Prieto and Inés
//     Ramos), three rooms, the appointment types and two bonos;
//   - ~60 patients with nine months of visits, receipts and payments behind
//     them, so the reports have cohorts to show;
//   - a full Monday-to-Friday week around DEMO_DAY across all three rooms;
//   - a care plan that has fallen behind (Marta Gil), others on track;
//   - a 10-session bono sold on its own receipt (Pablo Herrero);
//   - a WhatsApp conversation about moving a visit, and a few more threads;
//   - two posture assessments on illustrated figures, not photos (Daniel Ortega);
//   - a patient-app login (Alba Serrano).
//
// DEMO_DAY (YYYY-MM-DD) is the "today" of the demo, the most recent weekday by
// default. Screenshots should freeze the browser's clock on it (10:18 looks
// like a working morning); keep it in the past, because a clock frozen ahead
// of real time expires the session token.
//
// Rerunning replaces the previous demo clinic (found by its owner's email):
// deleted, or retired once it holds a factura. Logins are printed at the end.
import { randomUUID } from 'node:crypto'
import { createClient } from '@supabase/supabase-js'
import { dbTasks } from '../cypress/support/tasks/db'
import { facturaDescription, facturaKind } from '../composables/useFacturas'
import { facturaTaxFor } from '../utils/facturaTax'
import { measureAll, type PostureView, type Pt, type StoredViews } from '../utils/posture'

const url = process.env.NUXT_PUBLIC_SUPABASE_URL || 'http://127.0.0.1:54321'
const serviceKey =
  process.env.NUXT_SUPABASE_SECRET_KEY ||
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZS1kZW1vIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImV4cCI6MTk4MzgxMjk5Nn0.EGIM96RAZx35lJzdJsyH-qQwv8Hdp7fsn3W0YpN81IU'
const anonKey =
  process.env.NUXT_PUBLIC_SUPABASE_KEY ||
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZS1kZW1vIiwicm9sZSI6ImFub24iLCJleHAiOjE5ODM4MTI5OTZ9.CRXP1A7WOeoJeXxjNni43kdQwgnWNReilDMblYTn_I0'
if (!/^https?:\/\/(127\.0\.0\.1|localhost)(:\d+)?/.test(url)) {
  console.error(`Refusing to seed ${url}: local Supabase only.`)
  process.exit(1)
}
const admin = createClient(url, serviceKey, { auth: { autoRefreshToken: false, persistSession: false } })

const DOMAIN = 'clinica-demo.test'
const PASSWORD = 'Demo1234!'
const OWNER_EMAIL = `demo@${DOMAIN}`
const PATIENT_APP_EMAIL = `alba.serrano@${DOMAIN}`
const ZONE = 'Europe/Madrid'

// --- small helpers -----------------------------------------------------------

function ok<T>(r: { data: T; error: unknown }): NonNullable<T> {
  if (r.error) throw r.error
  return r.data as NonNullable<T>
}
async function insertAll<T = { id: string }>(table: string, rows: object[], select = 'id'): Promise<T[]> {
  const out: T[] = []
  for (let i = 0; i < rows.length; i += 500) {
    const { data, error } = await admin.from(table).insert(rows.slice(i, i + 500)).select(select)
    if (error) throw new Error(`${table}: ${error.message}`)
    out.push(...(data as T[]))
  }
  return out
}

// Deterministic, so a rerun gives the same clinic.
let seed = 20261030
function rand() {
  seed = (seed + 0x6d2b79f5) >>> 0
  let t = seed
  t = Math.imul(t ^ (t >>> 15), t | 1)
  t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296
}
const pick = <T>(list: T[]): T => list[Math.floor(rand() * list.length)]!
const chance = (p: number) => rand() < p

// Madrid wall-clock time -> instant, whatever timezone this runs in.
function zoneOffset(day: string): string {
  const probe = new Date(`${day}T12:00:00Z`)
  const name = new Intl.DateTimeFormat('en-US', { timeZone: ZONE, timeZoneName: 'longOffset' }).formatToParts(probe).find((p) => p.type === 'timeZoneName')!.value
  return name.replace('GMT', '') || '+00:00'
}
function at(day: string, hm: string): Date {
  return new Date(`${day}T${hm}:00${zoneOffset(day)}`)
}
function addDays(day: string, n: number): string {
  const [y, m, d] = day.split('-').map(Number)
  return new Date(Date.UTC(y!, m! - 1, d! + n)).toISOString().slice(0, 10)
}
function weekday(day: string): number {
  return new Date(`${day}T12:00:00Z`).getUTCDay() // 0 = Sunday
}
function madridToday(): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: ZONE }).format(new Date())
}
function lastWeekday(day: string): string {
  let d = day
  while (weekday(d) === 0 || weekday(d) === 6) d = addDays(d, -1)
  return d
}
const plusMinutes = (d: Date, m: number) => new Date(d.getTime() + m * 60000)

const DEMO_DAY = process.env.DEMO_DAY || lastWeekday(madridToday())
const NOW = at(DEMO_DAY, '10:18')
const MONDAY = addDays(DEMO_DAY, -((weekday(DEMO_DAY) + 6) % 7))
const HISTORY_FROM = addDays(MONDAY, -270)

// --- start clean -------------------------------------------------------------

// A previous demo clinic is deleted -- or, once it has issued a factura,
// retired instead: factura_records is append-only, so nothing may delete it.
// Retiring renames the old clinic and moves its logins to another domain, so
// the new clinic gets the same emails.
async function removePreviousDemo() {
  const { data } = await admin.auth.admin.listUsers({ perPage: 1000 })
  const demoUsers = (data?.users ?? []).filter((u) => u.email?.endsWith(`@${DOMAIN}`))
  const owner = demoUsers.find((u) => u.email === OWNER_EMAIL)
  const { data: tm } = owner ? await admin.from('team_members').select('account_id').eq('user_id', owner.id).maybeSingle() : { data: null }
  const deleted = tm?.account_id ? !(await admin.from('accounts').delete().eq('id', tm.account_id)).error : true
  if (deleted) {
    for (const u of demoUsers) await admin.auth.admin.deleteUser(u.id)
    return
  }
  const stamp = Date.now()
  ok(await admin.from('accounts').update({ name: `Clínica Demo (retirada ${stamp})` }).eq('id', tm!.account_id).select('id'))
  for (const u of demoUsers) {
    const { error } = await admin.auth.admin.updateUserById(u.id, { email: u.email!.replace(`@${DOMAIN}`, `.${stamp}@retired.${DOMAIN}`) })
    if (error) throw error
  }
}

// --- people --------------------------------------------------------------------

// Invented. First names and surname pairs are common Spanish ones put
// together at random; none is anyone in particular.
const FEATURED = [
  { first: 'Marta', last: 'Gil Herrero', gender: 'female', dob: '1984-03-12', complaint: 'Lumbalgia mecánica', city: 'Valencia' },
  { first: 'Pablo', last: 'Herrero Campos', gender: 'male', dob: '1979-07-02', complaint: 'Cervicalgia', city: 'Valencia' },
  { first: 'Carmen', last: 'Vidal Soler', gender: 'female', dob: '1991-11-23', complaint: 'Dolor de hombro derecho', city: 'Burjassot' },
  { first: 'Daniel', last: 'Ortega Ruiz', gender: 'male', dob: '1988-01-30', complaint: 'Postura y dolor dorsal', city: 'Valencia' },
  { first: 'Alba', last: 'Serrano Pastor', gender: 'female', dob: '1995-05-17', complaint: 'Ciática izquierda', city: 'Mislata' },
  { first: 'Lucía', last: 'Navarro Ferrer', gender: 'female', dob: '1972-09-08', complaint: 'Cefalea tensional', city: 'Valencia' },
  { first: 'Hugo', last: 'Castillo Mora', gender: 'male', dob: '2001-02-14', complaint: 'Esguince de tobillo', city: 'Paterna' },
  { first: 'Elena', last: 'Marín Gallego', gender: 'female', dob: '1966-12-01', complaint: 'Artrosis de rodilla', city: 'Valencia' },
  { first: 'Javier', last: 'Cano Esteve', gender: 'male', dob: '1983-04-26', complaint: 'Lumbalgia', city: 'Alboraya' },
  { first: 'Sofía', last: 'Romero Llorens', gender: 'female', dob: '1999-08-19', complaint: 'Dolor cervical por ordenador', city: 'Valencia' },
  { first: 'Andrés', last: 'Peña Ibáñez', gender: 'male', dob: '1975-06-04', complaint: 'Hernia discal L5-S1', city: 'Torrent' },
  { first: 'Irene', last: 'Lozano Vera', gender: 'female', dob: '1987-10-11', complaint: 'Postparto, dolor pélvico', city: 'Valencia' },
  { first: 'Raúl', last: 'Benítez Sanz', gender: 'male', dob: '1993-03-29', complaint: 'Tendinopatía rotuliana', city: 'Valencia' },
  { first: 'Nuria', last: 'Domínguez Roig', gender: 'female', dob: '1980-01-15', complaint: 'Fascitis plantar', city: 'Quart de Poblet' },
  { first: 'Óscar', last: 'Vicente Montero', gender: 'male', dob: '1969-11-05', complaint: 'Dolor de espalda', city: 'Valencia' },
  { first: 'Paula', last: 'Crespo Aguilar', gender: 'female', dob: '2004-07-22', complaint: 'Escoliosis leve', city: 'Valencia' },
  { first: 'Miguel', last: 'Fuentes Bravo', gender: 'male', dob: '1958-02-09', complaint: 'Rigidez cervical', city: 'Manises' },
  { first: 'Clara', last: 'Iglesias Rubio', gender: 'female', dob: '1990-06-30', complaint: 'Migraña', city: 'Valencia' },
  { first: 'Tomás', last: 'Reyes Calvo', gender: 'male', dob: '1986-09-14', complaint: 'Lesión de isquiotibiales', city: 'Valencia' },
  { first: 'Rocío', last: 'Molina Durán', gender: 'female', dob: '1977-04-03', complaint: 'Dolor de cadera', city: 'Godella' },
]
const BG_FIRST = ['Laura', 'Adrián', 'Cristina', 'Sergio', 'Beatriz', 'Iván', 'Patricia', 'Rubén', 'Silvia', 'Marcos', 'Eva', 'Gonzalo', 'Ana', 'Víctor', 'Marina', 'Jorge', 'Teresa', 'Alberto', 'Lorena', 'Diego', 'Noelia', 'Fernando', 'Pilar', 'Samuel']
const BG_LAST = ['Pascual', 'Gimeno', 'Sáez', 'Climent', 'Ferrando', 'Tomás', 'Mateu', 'Bosch', 'Ortiz', 'Prats', 'Puig', 'Sancho', 'Cortés', 'Hidalgo', 'Lara', 'Vázquez', 'Medina', 'Garrido', 'Arnau', 'Segura']

const TEAM = [
  { name: 'Sara Molina', color: '#4f46e5', title: 'Quiropráctica' },
  { name: 'Álex Prieto', color: '#14b8a6', title: 'Fisioterapeuta' },
  { name: 'Inés Ramos', color: '#ec4899', title: 'Osteópata' },
]
const TYPES = [
  { key: 'first', name: 'Primera visita', minutes: 45, cents: 6000, stage: 'first_visit', color: '#8b5cf6' },
  { key: 'report', name: 'Informe de resultados', minutes: 30, cents: 4500, stage: 'report', color: '#0ea5e9' },
  { key: 'adjust', name: 'Ajuste quiropráctico', minutes: 30, cents: 4400, stage: 'adjustment', color: '#4f46e5' },
  { key: 'physio', name: 'Fisioterapia', minutes: 45, cents: 5000, stage: 'adjustment', color: '#14b8a6' },
  { key: 'osteo', name: 'Osteopatía', minutes: 45, cents: 5500, stage: 'adjustment', color: '#ec4899' },
  { key: 'revision', name: 'Revisión', minutes: 30, cents: 4400, stage: 'revision', color: '#f59e0b' },
  { key: 'maint', name: 'Mantenimiento', minutes: 30, cents: 4000, stage: 'maintenance', color: '#64748b' },
] as const
type TypeKey = (typeof TYPES)[number]['key']
const HOURS = { mon: [['09:00', '14:00'], ['16:00', '20:00']], tue: [['09:00', '14:00'], ['16:00', '20:00']], wed: [['09:00', '14:00'], ['16:00', '20:00']], thu: [['09:00', '14:00'], ['16:00', '20:00']], fri: [['09:00', '14:00'], ['16:00', '19:00']] }

// --- the posture figures ------------------------------------------------------

// Not a photo: a plain mannequin drawn from the same points the assessment
// stores, standing in front of a posture grid. Coordinates are px of a
// 1120x1280 image, a phone photo cropped to the figure.
const W = 1120
const H = 1280
const C = W / 2
function figureSvg(view: PostureView, p: Record<string, Pt>, facing: 'right' | 'left' | null): string {
  const grid: string[] = []
  for (let x = C % 40; x <= W; x += 40) grid.push(`<line x1="${x}" y1="0" x2="${x}" y2="${H}" stroke="#d3dbe6" stroke-width="${(x - C) % 200 === 0 ? 2 : 1}"/>`)
  for (let y = 0; y <= H; y += 40) grid.push(`<line x1="0" y1="${y}" x2="${W}" y2="${y}" stroke="#d3dbe6" stroke-width="${y % 200 === 0 ? 2 : 1}"/>`)
  const skin = '#cfd4dc'
  const shade = '#b8bfca'
  const edge = '#8f99a8'
  const top = '#5b6b8c'
  const shorts = '#2f3b52'
  const limb = (a: Pt, b: Pt, w: number, c = skin) =>
    `<line x1="${a[0]}" y1="${a[1]}" x2="${b[0]}" y2="${b[1]}" stroke="${edge}" stroke-width="${w + 3}" stroke-linecap="round"/><line x1="${a[0]}" y1="${a[1]}" x2="${b[0]}" y2="${b[1]}" stroke="${c}" stroke-width="${w}" stroke-linecap="round"/>`
  const m = (a: Pt, b: Pt, t = 0.5): Pt => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t]
  const path = (d: string, fill: string, stroke = edge) => `<path d="${d}" fill="${fill}" stroke="${stroke}" stroke-width="2.5" stroke-linejoin="round"/>`
  let body = ''
  if (view === 'front' || view === 'back') {
    const [sR, sL, hR, hL, kR, kL, aR, aL, eR, eL] = [p.shoulderR!, p.shoulderL!, p.hipR!, p.hipL!, p.kneeR!, p.kneeL!, p.ankleR!, p.ankleL!, p.earR!, p.earL!]
    // Work in viewer-left (a) / viewer-right (b) so one drawing serves both views.
    const [sa, sb, ha, hb, ka, kb, aa, ab] = sR[0] < sL[0] ? [sR, sL, hR, hL, kR, kL, aR, aL] : [sL, sR, hL, hR, kL, kR, aL, aR]
    const head = m(eR, eL)
    const ms = m(sa, sb)
    const waistY = (ms[1] + m(ha, hb)[1]) / 2 + 40
    const elA: Pt = [sa[0] - 26, (sa[1] + ha[1]) / 2 - 6]
    const elB: Pt = [sb[0] + 26, (sb[1] + hb[1]) / 2 - 6]
    const hdA: Pt = [ha[0] - 58, ha[1] + 92]
    const hdB: Pt = [hb[0] + 58, hb[1] + 92]
    body += limb(elA, hdA, 38) + limb(elB, hdB, 38)
    body += `<circle cx="${hdA[0]}" cy="${hdA[1] + 10}" r="22" fill="${skin}" stroke="${edge}" stroke-width="2.5"/><circle cx="${hdB[0]}" cy="${hdB[1] + 10}" r="22" fill="${skin}" stroke="${edge}" stroke-width="2.5"/>`
    body += limb(ha, ka, 74) + limb(ka, aa, 56) + limb(hb, kb, 74) + limb(kb, ab, 56)
    body += `<ellipse cx="${aa[0] - 10}" cy="${aa[1] + 30}" rx="38" ry="17" fill="${skin}" stroke="${edge}" stroke-width="2.5"/><ellipse cx="${ab[0] + 10}" cy="${ab[1] + 30}" rx="38" ry="17" fill="${skin}" stroke="${edge}" stroke-width="2.5"/>`
    body += `<rect x="${head[0] - 26}" y="${head[1] + 30}" width="52" height="${ms[1] - head[1] - 30}" fill="${skin}" stroke="${edge}" stroke-width="2.5"/>`
    body += limb(sa, elA, 46) + limb(sb, elB, 46)
    body += path(
      `M${sa[0] - 30},${sa[1] + 18} Q${sa[0] - 24},${sa[1] - 22} ${sa[0] + 30},${sa[1] - 22} L${head[0] - 30},${ms[1] - 30} Q${head[0]},${ms[1] - 14} ${head[0] + 30},${ms[1] - 30} L${sb[0] - 30},${sb[1] - 22} Q${sb[0] + 24},${sb[1] - 22} ${sb[0] + 30},${sb[1] + 18} ` +
        `L${sb[0] + 14},${sb[1] + 120} Q${hb[0] - 6},${waistY} ${hb[0] + 34},${hb[1] - 20} L${ha[0] - 34},${ha[1] - 20} Q${ha[0] + 6},${waistY} ${sa[0] - 14},${sa[1] + 120} Z`,
      top,
    )
    body += path(`M${ha[0] - 38},${ha[1] - 26} L${hb[0] + 38},${hb[1] - 26} L${hb[0] + 44},${hb[1] + 120} L${m(ha, hb)[0] + 8},${hb[1] + 124} L${m(ha, hb)[0]},${m(ha, hb)[1] + 40} L${m(ha, hb)[0] - 8},${ha[1] + 124} L${ha[0] - 44},${ha[1] + 120} Z`, shorts)
    body += `<ellipse cx="${head[0]}" cy="${head[1] - 14}" rx="${Math.abs(eR[0] - eL[0]) / 2 + 6}" ry="68" fill="${skin}" stroke="${edge}" stroke-width="2.5"/>`
    body += `<ellipse cx="${eR[0]}" cy="${eR[1]}" rx="9" ry="17" fill="${shade}" stroke="${edge}" stroke-width="2"/><ellipse cx="${eL[0]}" cy="${eL[1]}" rx="9" ry="17" fill="${shade}" stroke="${edge}" stroke-width="2"/>`
  } else {
    const dir = facing === 'left' ? -1 : 1
    const [e, s, h, k, a] = [p.ear!, p.shoulder!, p.hip!, p.knee!, p.ankle!]
    const head: Pt = [e[0] + dir * 16, e[1] - 14]
    body += limb([e[0] - dir * 6, e[1] + 36], [s[0] + dir * 4, s[1] - 6], 50)
    body += limb(h, k, 80) + limb(k, a, 58)
    body += path(`M${a[0] - dir * 30},${a[1] + 6} Q${a[0] - dir * 34},${a[1] + 44} ${a[0] - dir * 20},${a[1] + 46} L${a[0] + dir * 74},${a[1] + 46} Q${a[0] + dir * 80},${a[1] + 30} ${a[0] + dir * 50},${a[1] + 22} L${a[0] + dir * 22},${a[1] + 6} Z`, skin)
    body += path(
      `M${s[0] - dir * 58},${s[1] - 4} Q${s[0] - dir * 20},${s[1] - 34} ${s[0] + dir * 40},${s[1] - 10} Q${s[0] + dir * 70},${s[1] + 60} ${s[0] + dir * 58},${s[1] + 140} ` +
        `Q${h[0] + dir * 40},${(s[1] + h[1]) / 2 + 80} ${h[0] + dir * 52},${h[1] - 20} L${h[0] - dir * 62},${h[1] - 10} Q${s[0] - dir * 54},${(s[1] + h[1]) / 2 + 40} ${s[0] - dir * 70},${s[1] + 90} Q${s[0] - dir * 76},${s[1] + 20} ${s[0] - dir * 58},${s[1] - 4} Z`,
      top,
    )
    body += path(`M${h[0] - dir * 66},${h[1] - 18} L${h[0] + dir * 56},${h[1] - 26} L${h[0] + dir * 62},${h[1] + 118} L${h[0] - dir * 54},${h[1] + 124} Z`, shorts)
    const elbow: Pt = [s[0] - dir * 4, (s[1] + h[1]) / 2 + 6]
    body += limb(s, elbow, 44) + limb(elbow, [h[0] + dir * 26, h[1] + 84], 38)
    body += `<circle cx="${h[0] + dir * 30}" cy="${h[1] + 100}" r="22" fill="${skin}" stroke="${edge}" stroke-width="2.5"/>`
    body += path(
      `M${head[0] - dir * 60},${head[1]} Q${head[0] - dir * 60},${head[1] - 70} ${head[0] + dir * 4},${head[1] - 70} Q${head[0] + dir * 58},${head[1] - 68} ${head[0] + dir * 60},${head[1] - 8} ` +
        `L${head[0] + dir * 72},${head[1] + 14} L${head[0] + dir * 58},${head[1] + 22} Q${head[0] + dir * 54},${head[1] + 66} ${head[0]},${head[1] + 68} Q${head[0] - dir * 62},${head[1] + 60} ${head[0] - dir * 60},${head[1]} Z`,
      skin,
    )
    body += `<ellipse cx="${e[0]}" cy="${e[1]}" rx="11" ry="18" fill="${shade}" stroke="${edge}" stroke-width="2"/>`
  }
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}"><rect width="100%" height="100%" fill="#eef2f7"/>${grid.join('')}<rect y="${H - 60}" width="${W}" height="60" fill="#dde4ee"/>${body}</svg>`
}

// Two assessments seven weeks apart: the head comes back over the shoulders
// and the right shoulder levels out.
function posturePoints(improved: boolean): Record<'front' | 'right' | 'back', { points: Record<string, Pt>; facing: 'right' | 'left' | null }> {
  const dropR = improved ? 3 : 12
  const fwd = improved ? 18 : 42
  const at = (dx: number, y: number): Pt => [C + dx, y]
  const front: Record<string, Pt> = {
    earR: at(-44, 196), earL: at(44, 194), shoulderR: at(-118, 312 + dropR), shoulderL: at(118, 310), hipR: at(-72, 640 + Math.round(dropR / 2)), hipL: at(72, 636),
    kneeR: at(-58, 880), kneeL: at(58, 878), ankleR: at(-50, 1168), ankleL: at(50, 1168),
  }
  const back = Object.fromEntries(Object.entries(front).map(([k, [x, y]]) => [k, [W - x, y] as Pt]))
  const right: Record<string, Pt> = { ear: at(-8 + fwd, 200), shoulder: at(-12, 318), hip: at(-4, 640), knee: at(12, 882), ankle: at(-6, 1168) }
  return { front: { points: front, facing: null }, right: { points: right, facing: 'right' }, back: { points: back, facing: null } }
}

// --- main ------------------------------------------------------------------------

async function main() {
  await removePreviousDemo()

  const owner = await dbTasks['db:createStaffAccount']({ email: OWNER_EMAIL, password: PASSWORD, accountName: 'Clínica Demo', clinicName: 'Clínica Demo', ownerName: TEAM[0]!.name })
  const accountId = owner.accountId as string
  const clinicId = owner.clinicId as string

  // A paying clinic with every module, so no trial banner or upsell sits on the screens.
  ok(await admin.from('subscriptions').update({ plan_id: 'pro', status: 'active', comped: true, extra_professionals: 2, growth_addon: true, trial_ends_at: null }).eq('account_id', accountId).select('id'))
  ok(
    await admin
      .from('clinics')
      .update({
        legal_name: 'Clínica Demo S.L.',
        tax_id: 'B12345678',
        address: 'Calle Ejemplo 12, 46001 Valencia',
        phone: '+34 960 000 000',
        email: `hola@${DOMAIN}`,
        invoice_footer_text: 'Gracias por tu confianza. Clínica Demo · Calle Ejemplo 12, Valencia',
        business_hours: HOURS,
        timezone: ZONE,
      })
      .eq('id', clinicId)
      .select('id'),
  )

  // --- team
  const team: { id: string; name: string }[] = [{ id: owner.teamMemberId as string, name: TEAM[0]!.name }]
  for (const m of TEAM.slice(1)) {
    const slug = m.name.split(' ')[0]!.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase()
    const created = await dbTasks['db:createTeamMemberWithRole']({ accountId, clinicId, roleName: 'Practitioner', email: `${slug}@${DOMAIN}`, password: PASSWORD, fullName: m.name, isPractitioner: true })
    team.push({ id: created.teamMemberId, name: m.name })
  }
  for (const [i, m] of team.entries()) {
    ok(await admin.from('team_members').update({ color: TEAM[i]!.color, business_hours: HOURS, language_preference: 'es' }).eq('id', m.id).select('id'))
  }
  const [sara, alex, ines] = team as [{ id: string; name: string }, { id: string; name: string }, { id: string; name: string }]

  // --- rooms: the default "Room 1" becomes Sala 1
  const { data: defaultRoom } = await admin.from('calendar_resources').select('id').eq('account_id', accountId).single()
  ok(await admin.from('calendar_resources').update({ name: 'Sala 1' }).eq('id', defaultRoom!.id).select('id'))
  const sala2 = await dbTasks['db:createRoom']({ accountId, clinicId, name: 'Sala 2' })
  const sala3 = await dbTasks['db:createRoom']({ accountId, clinicId, name: 'Sala 3' })
  const rooms = [defaultRoom!.id as string, sala2.id, sala3.id]

  // --- appointment types, bonos, products
  const typeRows = await insertAll<{ id: string; name: string }>(
    'appointment_types',
    TYPES.map((t, i) => ({ account_id: accountId, name: t.name, duration_minutes: t.minutes, default_price_cents: t.cents, stage: t.stage, color: t.color, sort_order: i + 1, online_booking_enabled: t.key !== 'report' })),
    'id, name',
  )
  const typeId = Object.fromEntries(TYPES.map((t, i) => [t.key, typeRows[i]!.id])) as Record<TypeKey, string>
  const typeOf = Object.fromEntries(TYPES.map((t) => [t.key, t])) as Record<TypeKey, (typeof TYPES)[number]>
  const bono10 = await dbTasks['db:createPackageTemplate']({ accountId, name: 'Bono 10 sesiones', sessionCount: 10, priceCents: 38000 })
  const bono5 = await dbTasks['db:createPackageTemplate']({ accountId, name: 'Bono 5 sesiones', sessionCount: 5, priceCents: 20000 })
  await insertAll('services_products', [
    { account_id: accountId, name: 'Almohada cervical', price_cents: 4500 },
    { account_id: accountId, name: 'Plantillas personalizadas', price_cents: 9000 },
  ])

  // --- patients
  const practitionerFor = (i: number) => team[i % 3]!
  const featuredRows = FEATURED.map((f, i) => ({
    account_id: accountId,
    clinic_id: clinicId,
    first_name: f.first,
    last_name: f.last,
    gender: f.gender,
    date_of_birth: f.dob,
    email: `${f.first.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase()}.${f.last.split(' ')[0]!.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase()}@example.com`,
    city: f.city,
    country: 'España',
    chief_complaint: f.complaint,
    default_practitioner_id: practitionerFor(i).id,
    preferred_language: 'es',
    confirmation_channel: 'whatsapp',
    reminder_channel: 'whatsapp',
    referral_source: pick(['Google', 'Instagram', 'Recomendación', 'Web', 'Recomendación']),
    occupation: pick(['Administrativa', 'Profesor', 'Enfermera', 'Ingeniero', 'Diseñadora', 'Comercial', 'Jubilado', 'Estudiante']),
  }))
  const bgNames = new Set<string>()
  const bgRows: typeof featuredRows = []
  while (bgRows.length < 42) {
    const first = pick(BG_FIRST)
    const last = `${pick(BG_LAST)} ${pick(BG_LAST)}`
    if (bgNames.has(first + last) || last.split(' ')[0] === last.split(' ')[1]) continue
    bgNames.add(first + last)
    bgRows.push({ ...featuredRows[0]!, first_name: first, last_name: last, gender: null as unknown as string, date_of_birth: null as unknown as string, email: null as unknown as string, chief_complaint: pick(['Lumbalgia', 'Cervicalgia', 'Dolor de hombro', 'Dolor de rodilla', 'Cefalea', 'Dorsalgia']), default_practitioner_id: practitionerFor(bgRows.length + 1).id, city: 'Valencia', referral_source: pick(['Google', 'Instagram', 'Recomendación', 'Web']), occupation: null as unknown as string })
  }
  const patients = (await insertAll<{ id: string; first_name: string; last_name: string; default_practitioner_id: string }>('patients', [...featuredRows, ...bgRows], 'id, first_name, last_name, default_practitioner_id'))
  const P = Object.fromEntries(patients.slice(0, FEATURED.length).map((p) => [p.first_name, p])) as Record<string, (typeof patients)[number]>
  await insertAll(
    'patient_contact_numbers',
    patients.map((p, i) => ({ account_id: accountId, patient_id: p.id, number: `+34 600 000 ${String(100 + i).padStart(3, '0')}`, country_code: 'ES', is_whatsapp: true })),
  )
  const phoneOf = (id: string) => `34600000${String(100 + patients.findIndex((p) => p.id === id)).padStart(3, '0')}`

  // --- appointments: history first, then the demo week
  type Appt = { patient_id: string; practitioner_id: string; type: TypeKey; start: Date; status: string; room_id: string | null; confirmation_status?: string | null; checked?: boolean }
  const appts: Appt[] = []
  const busy = new Map<string, Set<number>>() // practitioner -> start minutes
  const free = (practitioner: string, start: Date, minutes: number) => {
    const set = busy.get(practitioner) ?? new Set<number>()
    const s = Math.floor(start.getTime() / 60000)
    for (let m = s; m < s + minutes; m += 15) if (set.has(m)) return false
    return true
  }
  const book = (a: Appt) => {
    const set = busy.get(a.practitioner_id) ?? new Set<number>()
    const s = Math.floor(a.start.getTime() / 60000)
    for (let m = s; m < s + typeOf[a.type].minutes; m += 15) set.add(m)
    busy.set(a.practitioner_id, set)
    appts.push(a)
  }
  const roomOf = (practitionerId: string) => rooms[team.findIndex((t) => t.id === practitionerId)]!
  const mainType = (practitionerId: string): TypeKey => (practitionerId === sara.id ? 'adjust' : practitionerId === alex.id ? 'physio' : 'osteo')
  const slotOn = (day: string, practitionerId: string, minutes: number): Date | null => {
    for (let tries = 0; tries < 30; tries++) {
      const morning = chance(0.55)
      const h = morning ? 9 + Math.floor(rand() * 5) : 16 + Math.floor(rand() * 3)
      const start = at(day, `${String(h).padStart(2, '0')}:${pick(['00', '15', '30', '45'])}`)
      const end = plusMinutes(start, minutes)
      const close = at(day, morning ? '14:00' : weekday(day) === 5 ? '19:00' : '20:00')
      if (end <= close && free(practitionerId, start, minutes)) return start
    }
    return null
  }

  // Each history patient: a first visit, a report, then visits at a falling
  // cadence until they stop (some still coming, some dropped off).
  const demoPatients = new Set([P.Marta!.id, P.Pablo!.id, P.Daniel!.id, P.Alba!.id])
  for (const p of patients) {
    if (demoPatients.has(p.id)) continue
    const startOffset = Math.floor(rand() * 250)
    let day = lastWeekday(addDays(HISTORY_FROM, startOffset))
    const stopAfter = chance(0.25) ? 2 + Math.floor(rand() * 3) : 6 + Math.floor(rand() * 18)
    const pr = p.default_practitioner_id
    for (let n = 0; n < stopAfter && day < MONDAY; n++) {
      const type: TypeKey = n === 0 ? 'first' : n === 1 ? 'report' : n > 12 ? 'maint' : n % 6 === 0 ? 'revision' : mainType(pr)
      const start = slotOn(day, pr, typeOf[type].minutes)
      if (start) {
        const r = rand()
        book({ patient_id: p.id, practitioner_id: pr, type, start, status: r < 0.9 ? 'completed' : r < 0.96 ? 'cancelled' : 'no_show', room_id: roomOf(pr) })
      }
      const gap = n < 1 ? 2 : n < 6 ? 7 : n < 12 ? 14 : 28
      day = lastWeekday(addDays(day, gap + Math.floor(rand() * 3)))
    }
  }

  // Marta: twelve visits, twice a week, started five weeks ago -- two weeks
  // done, one visit the third week, nothing since and nothing booked. That is
  // "behind" on the record and on Retention.
  const planStart = addDays(MONDAY, -35)
  for (const [d, hm, type] of [[-49, '17:00', 'first'], [-46, '17:30', 'report'], [0, '17:00', 'adjust'], [3, '17:30', 'adjust'], [7, '17:00', 'adjust'], [10, '17:30', 'adjust'], [14, '17:00', 'adjust']] as const) {
    const day = d < 0 ? addDays(MONDAY, d) : addDays(planStart, d)
    book({ patient_id: P.Marta!.id, practitioner_id: sara.id, type, start: at(day, hm), status: 'completed', room_id: rooms[0]! })
  }
  // Pablo: on his bono, four sessions used.
  for (const [d, hm, type] of [[-63, '10:00', 'first'], [-60, '10:30', 'report'], [-28, '10:00', 'physio'], [-21, '10:00', 'physio'], [-14, '10:00', 'physio'], [-7, '10:00', 'physio']] as const) {
    book({ patient_id: P.Pablo!.id, practitioner_id: alex.id, type, start: at(addDays(MONDAY, d), hm), status: 'completed', room_id: rooms[1]! })
  }
  // Daniel: the posture patient, seen since the summer.
  for (const d of [-84, -81, -77, -70, -63, -56, -42, -28, -14]) {
    book({ patient_id: P.Daniel!.id, practitioner_id: sara.id, type: d === -84 ? 'first' : d === -81 ? 'report' : 'adjust', start: at(addDays(MONDAY, d + 1), '12:00'), status: 'completed', room_id: rooms[0]! })
  }

  // Alba: Inés's patient, the one with the patient app -- a visit today at
  // 13:00 and one next week.
  for (const [d, hm, type, status] of [[-40, '18:00', 'first', 'completed'], [-37, '18:30', 'report', 'completed'], [-33, '18:00', 'osteo', 'completed'], [-26, '18:00', 'osteo', 'completed'], [-19, '18:00', 'osteo', 'completed'], [-12, '18:00', 'osteo', 'completed'], [-5, '18:00', 'osteo', 'completed'], [0, '18:00', 'osteo', 'completed']] as const) {
    book({ patient_id: P.Alba!.id, practitioner_id: ines.id, type, start: at(addDays(MONDAY, d), hm), status, room_id: rooms[2]! })
  }
  book({ patient_id: P.Alba!.id, practitioner_id: ines.id, type: 'osteo', start: at(addDays(MONDAY, 4), '13:00'), status: 'booked', room_id: rooms[2]!, confirmation_status: 'confirmed' })
  book({ patient_id: P.Alba!.id, practitioner_id: ines.id, type: 'osteo', start: at(addDays(MONDAY, 9), '18:00'), status: 'booked', room_id: rooms[2]!, confirmation_status: 'pending' })
  ok(await admin.from('patients').update({ default_practitioner_id: ines.id }).eq('id', P.Alba!.id).select('id'))

  // The demo week: everyone's hours mostly full, across the three rooms.
  // Before NOW visits are done; after it, booked and mostly confirmed.
  const weekPatients = patients.filter((p) => ![P.Marta!.id, P.Carmen!.id, P.Pablo!.id, P.Alba!.id].includes(p.id))
  for (let d = 0; d < 5; d++) {
    const day = addDays(MONDAY, d)
    const seenToday = new Set<string>()
    for (const pr of team) {
      if (pr.id === ines.id && (d === 1 || d === 3)) continue // Inés: Monday, Wednesday, Friday
      for (const [from, to] of d === 4 ? [['09:00', '14:00'], ['16:00', '19:00']] : [['09:00', '14:00'], ['16:00', '20:00']]) {
        let cursor = at(day, from)
        const end = at(day, to)
        while (cursor < end) {
          const type: TypeKey = chance(0.08) ? 'first' : chance(0.1) ? 'revision' : chance(0.08) ? 'maint' : mainType(pr.id)
          const minutes = typeOf[type].minutes
          if (plusMinutes(cursor, minutes) > end) break
          if (chance(0.9) && free(pr.id, cursor, minutes)) {
            let patient = pick(weekPatients)
            while (seenToday.has(patient.id)) patient = pick(weekPatients)
            seenToday.add(patient.id)
            const past = plusMinutes(cursor, minutes) <= NOW
            const r = rand()
            // Each practitioner has a room; Álex takes Sala 3 too on the days Inés is out.
            const room = pr.id === alex.id && (d === 1 || d === 3) && chance(0.35) ? rooms[2]! : roomOf(pr.id)
            book({
              patient_id: patient.id,
              practitioner_id: pr.id,
              type,
              start: cursor,
              status: past ? (r < 0.93 ? 'completed' : 'no_show') : 'booked',
              room_id: room,
              confirmation_status: past ? null : r < 0.75 ? 'confirmed' : r < 0.92 ? 'pending' : 'reschedule_requested',
              checked: cursor <= NOW && plusMinutes(cursor, minutes) > NOW,
            })
          }
          cursor = plusMinutes(cursor, minutes + (chance(0.25) ? 15 : 0))
        }
      }
    }
  }
  // Carmen's visit is the one she moves in the Inbox, now on next Tuesday.
  const nextTuesday = addDays(MONDAY, 8)
  book({ patient_id: P.Carmen!.id, practitioner_id: alex.id, type: 'physio', start: at(nextTuesday, '18:00'), status: 'booked', room_id: rooms[1]!, confirmation_status: 'confirmed' })
  // A few more booked next week, so "next visit" is filled in for most.
  for (const p of patients.slice(0, 30)) {
    if ([P.Marta!.id, P.Carmen!.id, P.Alba!.id].includes(p.id)) continue
    const day = addDays(MONDAY, 7 + Math.floor(rand() * 5))
    const start = slotOn(day, p.default_practitioner_id, 30)
    if (start) book({ patient_id: p.id, practitioner_id: p.default_practitioner_id, type: mainType(p.default_practitioner_id) === 'adjust' ? 'adjust' : 'revision', start, status: 'booked', room_id: roomOf(p.default_practitioner_id), confirmation_status: 'pending' })
  }

  appts.sort((a, b) => a.start.getTime() - b.start.getTime())
  const apptRows = await insertAll<{ id: string }>(
    'appointments',
    appts.map((a) => {
      const minutes = typeOf[a.type].minutes
      const pr = team.find((t) => t.id === a.practitioner_id)!
      return {
        account_id: accountId,
        clinic_id: clinicId,
        patient_id: a.patient_id,
        practitioner_id: a.practitioner_id,
        practitioner_name: pr.name,
        appointment_type_id: typeId[a.type],
        room_id: a.room_id,
        starts_at: a.start.toISOString(),
        ends_at: plusMinutes(a.start, minutes).toISOString(),
        status: a.status,
        confirmation_status: a.confirmation_status ?? null,
        source: chance(0.2) ? 'online' : 'staff',
        created_at: plusMinutes(a.start, -60 * 24 * (3 + Math.floor(rand() * 10))).toISOString(),
        ...(a.status === 'completed' ? { checked_in_at: plusMinutes(a.start, -5).toISOString(), flow_with_practitioner_at: a.start.toISOString(), flow_checkout_at: plusMinutes(a.start, minutes).toISOString() } : {}),
        ...(a.checked ? { checked_in_at: plusMinutes(a.start, -4).toISOString(), flow_with_practitioner_at: plusMinutes(a.start, 1).toISOString() } : {}),
      }
    }),
  )
  const apptIds = apptRows.map((r) => r.id)
  // Patient since their first visit, not since the seed ran.
  const firstVisit = new Map<string, Date>()
  for (const a of appts) if (!firstVisit.has(a.patient_id)) firstVisit.set(a.patient_id, a.start)
  await Promise.all(
    [...firstVisit].map(async ([id, first]) => ok(await admin.from('patients').update({ created_at: plusMinutes(first, -60 * 24 * 2).toISOString() }).eq('id', id).select('id'))),
  )

  // --- receipts and payments for every completed visit. Pablo's bono visits
  // are charged at the bono's per-session rate and settled by it.
  const bonoBought = at(addDays(MONDAY, -28), '09:52')
  const invoices: { patient_id: string; appointment_id: string | null; total_cents: number; created_at: string }[] = []
  const lines: { description: string; quantity: number; price_cents: number; bono: boolean }[][] = []
  const sessions: { patient_id: string; appointment_id: string; used_at: string }[] = []
  const pays: { idx: number; method: string; at: string; purpose: string }[] = []
  appts.forEach((a, i) => {
    if (a.status !== 'completed') return
    const t = typeOf[a.type]
    const onBono = a.patient_id === P.Pablo!.id && a.type === 'physio'
    const created = plusMinutes(a.start, t.minutes + 2)
    const extra = !onBono && chance(0.05) ? { description: 'Almohada cervical', price: 4500 } : null
    invoices.push({ patient_id: a.patient_id, appointment_id: apptIds[i]!, total_cents: onBono ? 3800 : t.cents + (extra?.price ?? 0), created_at: created.toISOString() })
    lines.push([
      { description: onBono ? `${t.name} · Bono 10 sesiones` : t.name, quantity: 1, price_cents: onBono ? 3800 : t.cents, bono: onBono },
      ...(extra ? [{ description: extra.description, quantity: 1, price_cents: extra.price, bono: false }] : []),
    ])
    if (onBono) sessions.push({ patient_id: a.patient_id, appointment_id: apptIds[i]!, used_at: a.start.toISOString() })
    else pays.push({ idx: invoices.length - 1, method: pick(['card', 'card', 'card', 'cash', 'bizum', 'bizum', 'transfer']), at: plusMinutes(created, 1).toISOString(), purpose: 'visit' })
  })
  const numberOf = new Map([...invoices.keys()].sort((a, b) => invoices[a]!.created_at.localeCompare(invoices[b]!.created_at)).map((idx, n) => [idx, `INV-${String(n + 1).padStart(4, '0')}`]))
  const invRows = await insertAll<{ id: string }>(
    'invoices',
    invoices.map((inv, i) => ({ account_id: accountId, ...inv, invoice_number: numberOf.get(i), status: 'paid' })),
  )
  const [bono] = await insertAll<{ id: string }>('package_purchases', [{ account_id: accountId, patient_id: P.Pablo!.id, package_id: bono10.id, package_name: 'Bono 10 sesiones', sessions_total: 10, sessions_used: sessions.length, price_cents: 38000, purchased_at: bonoBought.toISOString(), created_by: alex.id }])
  await insertAll(
    'invoice_line_items',
    invRows.flatMap((inv, i) => lines[i]!.map(({ bono: onBono, ...l }) => ({ account_id: accountId, invoice_id: inv.id, ...l, package_purchase_id: onBono ? bono!.id : null }))),
  )
  await insertAll('package_sessions', sessions.map((s) => ({ account_id: accountId, package_purchase_id: bono!.id, amount_cents: 3800, ...s })))
  await insertAll(
    'payments',
    pays.map((p) => ({ account_id: accountId, invoice_id: invRows[p.idx]!.id, patient_id: invoices[p.idx]!.patient_id, amount_cents: invoices[p.idx]!.total_cents, method: p.method, paid_at: p.at, purpose: p.purpose })),
  )
  // The bono is paid against the bono itself, and its factura issued the way
  // the desk issues it: issue_factura as a signed-in member, with the
  // description and tax the app computes. A test chain, so no VeriFactu QR.
  const [bonoPayment] = await insertAll<{ id: string }>('payments', [{ account_id: accountId, invoice_id: null, package_purchase_id: bono!.id, patient_id: P.Pablo!.id, amount_cents: 38000, method: 'card', paid_at: plusMinutes(bonoBought, 2).toISOString(), purpose: 'bono', created_by: alex.id }])
  ok(await admin.from('patients').update({ national_id: '12345678Z', address: 'Calle Inventada 5, 3.º B', postal_code: '46002' }).eq('id', P.Pablo!.id).select('id'))
  const ownerClient = createClient(url, anonKey, { auth: { autoRefreshToken: false, persistSession: false } })
  {
    const { error } = await ownerClient.auth.signInWithPassword({ email: OWNER_EMAIL, password: PASSWORD })
    if (error) throw error
  }
  const { data: taxDefaults } = await admin.from('accounts').select('factura_tax_rate_bp, factura_tax_exemption_code').eq('id', accountId).single()
  const facturaInput = { accountId, patientId: P.Pablo!.id, paymentId: bonoPayment!.id, amountCents: 38000, purpose: 'bono' as const, bono: { packageName: 'Bono 10 sesiones', priceCents: 38000, sessionsTotal: 10 } }
  const tax = facturaTaxFor(38000, taxDefaults)
  const issued = ok(
    await ownerClient.rpc('issue_factura', {
      p_account_id: accountId,
      p_patient_id: P.Pablo!.id,
      p_payment_id: bonoPayment!.id,
      p_kind: facturaKind(facturaInput),
      p_description: facturaDescription(facturaInput),
      p_amount_cents: 38000,
      p_tax_base_cents: tax.taxBaseCents,
      p_tax_rate_bp: tax.taxRateBp,
      p_tax_amount_cents: tax.taxAmountCents,
      p_tax_exemption_code: tax.taxExemptionCode,
    }),
  )
  const facturaNumber = (Array.isArray(issued) ? issued[0] : issued).number as string
  const { data: factura } = await admin.from('facturas').select('id').eq('account_id', accountId).eq('number', facturaNumber).single()

  ok(await admin.from('invoice_number_sequences').upsert({ account_id: accountId, prefix: 'INV-', next_number: invoices.length + 1 }).select('account_id'))

  // --- care plans
  await dbTasks['db:createCarePlan']({ accountId, patientId: P.Marta!.id, totalVisits: 12, startedAt: planStart, name: 'Plan de corrección lumbar', frequencyValue: 1, frequencyUnit: 'week', visitsPerPeriod: 2 })
  await dbTasks['db:createCarePlan']({ accountId, patientId: P.Pablo!.id, totalVisits: 10, startedAt: addDays(MONDAY, -28), name: 'Fisioterapia cervical', frequencyValue: 1, frequencyUnit: 'week' })
  await dbTasks['db:createCarePlan']({ accountId, patientId: P.Daniel!.id, totalVisits: 12, startedAt: addDays(MONDAY, -76), name: 'Plan postural', frequencyValue: 2, frequencyUnit: 'week' })
  ok(
    await admin
      .from('patients')
      .update({
        goals: 'Volver a correr 10 km; Dormir sin dolor; Trabajar sentada 8 h',
        diagnosis: 'Lumbalgia mecánica crónica con restricción L4-L5',
        sticky_note: 'Prefiere citas por la tarde. Trae informe de resonancia.',
        tags: ['Plan activo'],
      })
      .eq('id', P.Marta!.id)
      .select('id'),
  )

  // --- the Inbox: Carmen moves her visit, and a few other threads
  const demoDay = (hm: string) => at(DEMO_DAY, hm).toISOString()
  const yesterday = (hm: string) => at(addDays(DEMO_DAY, -1), hm).toISOString()
  const carmen = P.Carmen!.id
  const msgs = [
    { patient_id: carmen, direction: 'outbound', status: 'read', purpose: 'reminder', template_name: 'appointment_reminder', body_preview: `Hola Carmen, te recordamos tu cita de mañana a las 17:30 con Álex Prieto en Clínica Demo. Responde SÍ para confirmar o escríbenos si necesitas cambiarla.`, created_at: yesterday('18:00') },
    { patient_id: carmen, direction: 'inbound', status: 'received', body_preview: 'Hola! Me ha surgido un imprevisto en el trabajo 😕 ¿Podría pasarla a la semana que viene?', created_at: demoDay('09:41') },
    { patient_id: carmen, direction: 'outbound', status: 'read', body_preview: 'Claro, Carmen. Tenemos hueco con Álex el martes a las 18:00 o el miércoles a las 10:30. ¿Cuál te viene mejor?', created_at: demoDay('09:44') },
    { patient_id: carmen, direction: 'inbound', status: 'received', body_preview: 'El martes a las 18:00 perfecto 🙌', created_at: demoDay('09:52') },
    { patient_id: carmen, direction: 'outbound', status: 'read', body_preview: 'Hecho ✅ Te esperamos el martes a las 18:00 con Álex. Te mandaremos un recordatorio el día antes.', created_at: demoDay('09:53') },
    { patient_id: carmen, direction: 'inbound', status: 'received', body_preview: '¡Mil gracias! Hasta el martes', created_at: demoDay('09:55') },
    { patient_id: P.Hugo!.id, direction: 'inbound', status: 'received', body_preview: '¿Tenéis algún hueco el sábado por la mañana? El tobillo va mucho mejor', created_at: demoDay('10:09') },
    { patient_id: P.Irene!.id, direction: 'outbound', status: 'delivered', purpose: 'confirmation', template_name: 'appointment_confirmation', body_preview: 'Hola Irene, tu cita con Inés Ramos es el lunes a las 11:00. ¿Nos confirmas?', created_at: yesterday('12:30') },
    { patient_id: P.Irene!.id, direction: 'inbound', status: 'received', body_preview: 'Confirmo, allí estaré 👍', created_at: demoDay('08:58') },
    { patient_id: P.Andrés!.id, direction: 'inbound', status: 'received', body_preview: 'Os envío el justificante de la mutua para la factura', created_at: demoDay('08:31') },
    { patient_id: P.Andrés!.id, direction: 'outbound', status: 'read', body_preview: 'Recibido, Andrés. Te la mandamos hoy por correo.', created_at: demoDay('08:40') },
    { patient_id: P.Nuria!.id, direction: 'inbound', status: 'received', body_preview: '¿Cuánto cuesta el bono de 10 sesiones?', created_at: yesterday('19:12') },
    { patient_id: P.Nuria!.id, direction: 'outbound', status: 'read', body_preview: 'El bono de 10 sesiones son 380 € (38 € la sesión) y puedes usarlo con cualquier fisio del centro.', created_at: yesterday('19:20') },
    { patient_id: P.Lucía!.id, direction: 'outbound', status: 'read', purpose: 'recall', template_name: 'recall', body_preview: 'Hola Lucía, hace un tiempo que no te vemos. ¿Te reservamos una revisión?', created_at: yesterday('11:00') },
    { patient_id: P.Lucía!.id, direction: 'inbound', status: 'received', body_preview: 'Sí, por favor, la semana que viene por la tarde', created_at: yesterday('13:47') },
    { patient_id: P.Raúl!.id, direction: 'inbound', status: 'received', body_preview: 'Perfecto, gracias por los ejercicios!', created_at: yesterday('17:05') },
  ].map((m) => ({ account_id: accountId, channel: 'whatsapp', phone_number: phoneOf(m.patient_id), purpose: null, template_name: null, ...m }))
  await insertAll('whatsapp_messages', msgs)
  // Read up to now for the quiet ones; Hugo and Carmen still to read.
  await insertAll('inbox_reads', [P.Irene!.id, P.Andrés!.id, P.Nuria!.id, P.Lucía!.id, P.Raúl!.id].map((id) => ({ account_id: accountId, team_member_id: sara.id, conversation_key: id, last_read_at: demoDay('10:15') })), 'conversation_key')

  // --- posture: two assessments on illustrated figures
  const { default: sharp } = await import('sharp')
  for (const [weeksAgo, improved] of [[8, false], [1, true]] as const) {
    const id = randomUUID()
    const sets = posturePoints(improved)
    const views: StoredViews = {}
    for (const view of ['front', 'right', 'back'] as const) {
      const path = `${accountId}/posture/${id}/${view}.jpg`
      const jpeg = await sharp(Buffer.from(figureSvg(view, sets[view].points, sets[view].facing))).jpeg({ quality: 88 }).toBuffer()
      const { error } = await admin.storage.from('patient-files').upload(path, jpeg, { contentType: 'image/jpeg', upsert: true })
      if (error) throw error
      views[view] = { photo: path, width: W, height: H, points: sets[view].points, facing: sets[view].facing }
    }
    const takenAt = at(addDays(MONDAY, -7 * weeksAgo + 1), '12:20')
    await insertAll('posture_assessments', [{
      id,
      account_id: accountId,
      patient_id: P.Daniel!.id,
      taken_by: sara.id,
      taken_at: takenAt.toISOString(),
      height_cm: 178,
      views,
      metrics: measureAll(views, 178),
      notes: improved ? 'Mejora clara de la anteriorización de la cabeza. Mantener ejercicios de retracción cervical.' : 'Cabeza adelantada y hombro derecho descendido. Empezamos plan postural.',
      shared_with_patient: improved,
    }])
  }

  // --- the patient app: Alba, with a bono on the go and a note to the clinic
  await dbTasks['db:givePatientAppLogin']({ accountId, patientId: P.Alba!.id, email: PATIENT_APP_EMAIL, password: PASSWORD })
  const albaBought = at(addDays(MONDAY, -14), '18:40')
  const [albaBono] = await insertAll<{ id: string }>('package_purchases', [{ account_id: accountId, patient_id: P.Alba!.id, package_id: bono5.id, package_name: 'Bono 5 sesiones', sessions_total: 5, sessions_used: 2, price_cents: 20000, purchased_at: albaBought.toISOString(), created_by: ines.id }])
  await insertAll('payments', [{ account_id: accountId, invoice_id: null, package_purchase_id: albaBono!.id, patient_id: P.Alba!.id, amount_cents: 20000, method: 'bizum', paid_at: plusMinutes(albaBought, 3).toISOString(), purpose: 'bono', created_by: ines.id }])
  await insertAll('patient_app_messages', [
    { account_id: accountId, patient_id: P.Alba!.id, direction: 'inbound', body: 'Hola Inés, desde la última sesión la pierna está mucho mejor. ¿Sigo con los estiramientos cada día?', created_at: yesterday('20:14') },
    { account_id: accountId, patient_id: P.Alba!.id, direction: 'outbound', body: '¡Qué buena noticia, Alba! Sí, cada mañana y antes de dormir. El viernes vemos cómo sigue 😊', created_at: demoDay('08:47') },
  ])

  console.log(
    JSON.stringify(
      {
        accountId,
        demoDay: DEMO_DAY,
        freezeBrowserAt: NOW.toISOString(),
        password: PASSWORD,
        staff: [OWNER_EMAIL, ...TEAM.slice(1).map((m) => `${m.name.split(' ')[0]!.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase()}@${DOMAIN}`)],
        patientApp: PATIENT_APP_EMAIL,
        patients: { carePlanBehind: P.Marta!.id, bono: P.Pablo!.id, bonoFactura: factura!.id, inbox: carmen, posture: P.Daniel!.id },
        counts: { patients: patients.length, appointments: appts.length, receipts: invRows.length },
      },
      null,
      2,
    ),
  )
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
