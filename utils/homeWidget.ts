// What the app's home-screen widgets show (iOS WidgetKit, Android
// AppWidget): a small JSON snapshot the app writes whenever it has fresh data
// (mobile/composables/useHomeWidget.ts), which the widget reads without
// talking to the server. So a widget shows what the app last saw, and says
// how long ago. Labels are written here, in the person's language and the
// clinic's clock, so the native widgets only lay them out. Pure; shared with
// mobile/.
//
// What staff get depends on who they are, decided by get_home_widget: an
// owner the clinic's figures, a practitioner their own day, the front desk
// the clinic's day.

export interface PatientWidgetSnapshot {
  kind: 'patient'
  updatedAt: string
  clinic: string | null
  next: { at: string; label: string; what: string | null; who: string | null } | null
  bono: { name: string; left: number; total: number } | null
}
/** Where a tap on the widget goes: the app's own path after this prefix (mobile/plugins/widget-links.client.ts). */
export const WIDGET_LINK_PREFIX = 'quiroflow://widget'

export type WidgetLang = 'es' | 'en'

const WIDGET_PATH = /^\/(?:my-day|numbers|calendar)(?:\/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})?(?:\?(?:period=(?:today|week|month)|scope=clinic))?$/i

/**
 * The app path a widget tap opens (quiroflow://widget/calendar?scope=clinic
 * -> /calendar?scope=clinic), or null for anything else. Only the handful of
 * screens the widget links to: a URL scheme is something any app or web page
 * can open, so it never gets to steer the app anywhere else.
 */
export function widgetLinkPath(url: string | null | undefined): string | null {
  const text = (url ?? '').trim()
  if (!text.startsWith(`${WIDGET_LINK_PREFIX}/`)) return null
  const path = text.slice(WIDGET_LINK_PREFIX.length)
  return WIDGET_PATH.test(path) ? path : null
}

/**
 * The widget's fixed words, in the person's app language. The native widgets
 * lay these out and fill %d / %@; they keep a Spanish copy only as a fallback.
 */
export type WidgetLabels = Record<
  'now' | 'minAgo' | 'hoursAgo' | 'daysAgo' | 'updatedYesterday' | 'untilYesterday' | 'untilDate' | 'noToday' | 'openToUpdate' | 'left' | 'done' | 'waiting' | 'toArrive' | 'inRoom' | 'next' | 'nextArrival' | 'nothingMore' | 'ahead' | 'toArriveCount',
  string
>

export interface WidgetVisit {
  /** Always toISOString's shape: the Android widget parses exactly that. */
  at: string
  time: string
  name: string
  what: string | null
  arrived: boolean
  /** Whom the visit is with, on the clinic's list ("Sergio V."); null on someone's own. */
  with: string | null
  link: string
}

interface WidgetBase {
  updatedAt: string
  /** "21:14" in the clinic's clock, for "Actualizado ayer, 21:14". */
  updatedTime: string
  /** The clinic's day the snapshot describes (yyyy-mm-dd), and its zone, to tell when it has gone stale. */
  date: string
  dateLabel: string
  timeZone: string
  lang: WidgetLang
  labels: WidgetLabels
}

/** A day's visits: someone's own (a practitioner) or the whole clinic's (the front desk). */
export interface StaffWidgetSnapshot extends WidgetBase {
  kind: 'staff'
  scope: 'own' | 'clinic'
  who: string
  /** "Hoy · Lucía Ferrer", or "Hoy en la clínica". */
  title: string
  remaining: number
  done: number
  arrived: number
  link: string
  /** Today's visits still to come (the widget drops each as its time passes), at most eight. */
  next: WidgetVisit[]
}

/** An owner's: the clinic's month and today, and their own day (or the clinic's) for the large size. */
export interface ClinicWidgetSnapshot extends WidgetBase {
  kind: 'clinic'
  clinic: string
  /** "Clínica Demo · octubre". */
  title: string
  link: string
  money: { label: string; smallLabel: string; value: string; range: string; link: string }
  patients: { label: string; done: number; total: number; note: string; link: string }
  bonos: { label: string; smallLabel: string; count: number; value: string; link: string }
  list: StaffWidgetSnapshot | null
}

export type WidgetSnapshot = PatientWidgetSnapshot | StaffWidgetSnapshot | ClinicWidgetSnapshot

/** What get_home_widget returns (20261020142327_home_widget.sql). */
export interface HomeWidgetRpc {
  view: 'clinic' | 'day' | 'desk' | 'none'
  who: string
  clinic?: string
  today: string
  time_zone: string
  figures?: { payments_cents: number; visits_done: number; visits_total: number; no_shows: number; bonos_count: number; bonos_cents: number }
  day?: {
    scope: 'own' | 'clinic'
    total: number
    done: number
    arrived: number
    next: { id: string; starts_at: string; first_name?: string; last_name?: string; type_name?: string; practitioner?: string; arrived: boolean }[]
  }
}

const clock = (iso: string, tz: string) => new Date(iso).toLocaleTimeString('es-ES', { timeZone: tz, hour: '2-digit', minute: '2-digit' })

export function patientWidgetSnapshot(
  input: {
    next: { starts_at: string; appointment_types?: { name: string } | null; team_members?: { full_name: string } | null } | null
    packages: { package_name: string; sessions_total: number; sessions_used: number }[]
    clinic: string | null
    timeZone: string
  },
  now = new Date(),
): PatientWidgetSnapshot {
  const n = input.next
  // The bono with the most sessions left: the one they are working through.
  const bono = [...input.packages].map((p) => ({ name: p.package_name, left: Math.max(0, p.sessions_total - p.sessions_used), total: p.sessions_total })).sort((a, b) => b.left - a.left)[0] ?? null
  return {
    kind: 'patient',
    updatedAt: now.toISOString(),
    clinic: input.clinic,
    next: n
      ? {
          // Always toISOString's shape: the Android widget parses exactly that.
          at: new Date(n.starts_at).toISOString(),
          label: `${new Date(n.starts_at).toLocaleDateString('es-ES', { timeZone: input.timeZone, weekday: 'short', day: 'numeric', month: 'short' })} · ${clock(n.starts_at, input.timeZone)}`,
          what: n.appointment_types?.name ?? null,
          who: n.team_members?.full_name ?? null,
        }
      : null,
    bono: bono && bono.total > 0 ? bono : null,
  }
}

const LABELS: Record<WidgetLang, WidgetLabels> = {
  es: {
    now: 'ahora',
    minAgo: 'hace %d min',
    hoursAgo: 'hace %d h',
    daysAgo: 'hace %d días',
    updatedYesterday: 'Actualizado ayer, %@',
    untilYesterday: 'hasta ayer',
    untilDate: 'hasta el %@',
    noToday: 'sin datos de hoy',
    openToUpdate: 'Abre QuiroFlow para actualizar',
    left: 'quedan',
    done: 'hechas',
    waiting: 'en sala',
    toArrive: 'por llegar',
    inRoom: 'En sala',
    next: 'Siguiente',
    nextArrival: 'Siguiente llegada',
    nothingMore: 'Nada más hoy',
    ahead: '%d por delante',
    toArriveCount: '%d por llegar',
  },
  en: {
    now: 'now',
    minAgo: '%d min ago',
    hoursAgo: '%d h ago',
    daysAgo: '%d days ago',
    updatedYesterday: 'Updated yesterday, %@',
    untilYesterday: 'to yesterday',
    untilDate: 'to %@',
    noToday: 'nothing for today yet',
    openToUpdate: 'Open QuiroFlow to update',
    left: 'left',
    done: 'done',
    waiting: 'waiting',
    toArrive: 'to arrive',
    inRoom: 'Waiting',
    next: 'Next',
    nextArrival: 'Next arrival',
    nothingMore: 'Nothing else today',
    ahead: '%d ahead',
    toArriveCount: '%d to arrive',
  },
}

const link = (path: string) => `${WIDGET_LINK_PREFIX}/${path}`

function initials(first: string | null | undefined, last: string | null | undefined) {
  return [first, last].filter(Boolean).map((s) => `${s!.trim()[0]?.toUpperCase() ?? ''}.`).join(' ')
}

/** Whole euros: a widget has no room for cents. "18.640 €", "€18,640"; masked in privacy mode. */
function euros(cents: number, lang: WidgetLang, privacy: boolean) {
  if (privacy) return lang === 'es' ? '•••• €' : '€••••'
  return (cents / 100).toLocaleString(lang === 'es' ? 'es-ES' : 'en-IE', { style: 'currency', currency: 'EUR', maximumFractionDigits: 0, minimumFractionDigits: 0 })
}

/**
 * The widget's snapshot from what get_home_widget returned: an owner's clinic
 * figures, or a day of visits. Null when there is nothing to show this person
 * (the app then clears the widget). Labels in the person's language, times in
 * the clinic's clock, names as initials in privacy mode -- and money masked.
 */
export function widgetSnapshotFromRpc(rpc: HomeWidgetRpc, opts: { lang: WidgetLang; privacy?: boolean }, now = new Date()): StaffWidgetSnapshot | ClinicWidgetSnapshot | null {
  if (rpc.view === 'none') return null
  const { lang } = opts
  const privacy = !!opts.privacy
  const tz = rpc.time_zone
  const locale = lang === 'es' ? 'es-ES' : 'en-GB'
  const base: WidgetBase = {
    updatedAt: now.toISOString(),
    updatedTime: clock(now.toISOString(), tz),
    date: rpc.today,
    dateLabel: new Date(`${rpc.today}T12:00:00Z`).toLocaleDateString(locale, { timeZone: 'UTC', day: 'numeric', month: 'short' }).replace('.', ''),
    timeZone: tz,
    lang,
    labels: LABELS[lang],
  }

  const day = rpc.day
  const list: StaffWidgetSnapshot | null = day
    ? {
        ...base,
        kind: 'staff',
        scope: day.scope,
        who: rpc.who,
        title: day.scope === 'own' ? `${lang === 'es' ? 'Hoy' : 'Today'} · ${rpc.who}` : lang === 'es' ? 'Hoy en la clínica' : 'Today at the clinic',
        remaining: day.total - day.done,
        done: day.done,
        arrived: day.arrived,
        link: link(day.scope === 'own' ? 'my-day' : 'calendar?scope=clinic'),
        next: day.next.map((v) => {
          const [pFirst, ...pRest] = (v.practitioner ?? '').trim().split(/\s+/)
          return {
            at: new Date(v.starts_at).toISOString(),
            time: clock(v.starts_at, tz),
            name: privacy ? initials(v.first_name, v.last_name) || '—' : `${v.first_name ?? ''} ${v.last_name ?? ''}`.trim() || '—',
            what: v.type_name ?? null,
            arrived: v.arrived,
            with: day.scope === 'clinic' && pFirst ? [pFirst, pRest.length ? `${pRest[0][0].toUpperCase()}.` : ''].filter(Boolean).join(' ') : null,
            link: link(`calendar/${v.id}`),
          }
        }),
      }
    : null

  if (rpc.view !== 'clinic' || !rpc.figures) return list

  const f = rpc.figures
  const month = new Date(`${rpc.today}T12:00:00Z`)
  const monthLong = month.toLocaleDateString(locale, { timeZone: 'UTC', month: 'long' })
  const monthShort = month.toLocaleDateString(locale, { timeZone: 'UTC', month: 'short' }).replace('.', '')
  const dayOfMonth = Number(rpc.today.slice(8, 10))
  const es = lang === 'es'
  const toSee = Math.max(0, f.visits_total - f.visits_done)
  const patientsNote = f.visits_total === 0
    ? (es ? 'sin citas hoy' : 'no visits today')
    : [
        toSee === 0 ? (es ? 'todos atendidos' : 'all seen') : es ? `${toSee} por atender` : `${toSee} still to see`,
        f.no_shows > 0 ? (es ? `${f.no_shows} no ${f.no_shows === 1 ? 'vino' : 'vinieron'}` : `${f.no_shows} no-show${f.no_shows === 1 ? '' : 's'}`) : null,
      ].filter(Boolean).join(' · ')
  const numbers = link('numbers?period=month')
  return {
    ...base,
    kind: 'clinic',
    clinic: rpc.clinic ?? 'QuiroFlow',
    title: `${rpc.clinic ?? 'QuiroFlow'} · ${monthLong}`,
    link: numbers,
    money: {
      label: es ? 'Cobrado' : 'Taken',
      smallLabel: `${es ? 'Cobrado' : 'Taken'} · ${monthLong}`,
      value: euros(f.payments_cents, lang, privacy),
      range: dayOfMonth === 1 ? `1 ${monthShort}` : `1–${dayOfMonth} ${monthShort}`,
      link: numbers,
    },
    patients: { label: es ? 'Pacientes hoy' : 'Patients today', done: f.visits_done, total: f.visits_total, note: patientsNote, link: link('calendar?scope=clinic') },
    bonos: {
      label: 'Bonos',
      smallLabel: `Bonos · ${monthShort}`,
      count: f.bonos_count,
      value: f.bonos_count === 0 ? (es ? 'ninguno aún' : 'none yet') : `${euros(f.bonos_cents, lang, privacy)} ${es ? 'en ventas' : 'in sales'}`,
      link: numbers,
    },
    list,
  }
}
