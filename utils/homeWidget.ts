// What the app's home-screen widgets show (iOS WidgetKit, Android
// AppWidget): a small JSON snapshot the app writes whenever it has fresh data
// (mobile/composables/useHomeWidget.ts), which the widget reads without
// talking to the server. So a widget shows what the app last saw, and says
// how long ago. Labels are written here, in Spanish and in the clinic's
// clock, so the native widgets only lay them out. Pure; shared with mobile/.

export interface PatientWidgetSnapshot {
  kind: 'patient'
  updatedAt: string
  clinic: string | null
  next: { at: string; label: string; what: string | null; who: string | null } | null
  bono: { name: string; left: number; total: number } | null
}
export interface StaffWidgetSnapshot {
  kind: 'staff'
  updatedAt: string
  who: string
  remaining: number
  done: number
  arrived: number
  /** Today's visits still to come (the widget drops each as its time passes), at most eight. */
  next: { at: string; time: string; name: string; what: string | null; arrived: boolean }[]
}
export type WidgetSnapshot = PatientWidgetSnapshot | StaffWidgetSnapshot

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

export function staffWidgetSnapshot(
  input: {
    who: string
    appointments: { starts_at: string; status: string; checked_in_at: string | null; patients?: { first_name: string; last_name: string | null } | null; appointment_types?: { name: string } | null }[]
    timeZone: string
    /** "A. S." instead of names, as the app shows them in privacy mode. */
    privacy?: boolean
  },
  now = new Date(),
): StaffWidgetSnapshot {
  const live = input.appointments.filter((a) => !['cancelled', 'no_show'].includes(a.status))
  const isDone = (a: (typeof live)[number]) => a.status === 'completed'
  const upcoming = live.filter((a) => !isDone(a) && Date.parse(a.starts_at) >= now.getTime() - 15 * 60_000).sort((a, b) => a.starts_at.localeCompare(b.starts_at))
  const name = (p: { first_name: string; last_name: string | null } | null | undefined) => {
    if (!p) return '—'
    if (input.privacy) return [p.first_name, p.last_name].filter(Boolean).map((s) => `${s!.trim()[0]?.toUpperCase() ?? ''}.`).join(' ')
    return `${p.first_name} ${p.last_name ?? ''}`.trim()
  }
  return {
    kind: 'staff',
    updatedAt: now.toISOString(),
    who: input.who,
    remaining: live.filter((a) => !isDone(a)).length,
    done: live.filter(isDone).length,
    arrived: live.filter((a) => !isDone(a) && a.checked_in_at).length,
    next: upcoming.slice(0, 8).map((a) => ({ at: new Date(a.starts_at).toISOString(), time: clock(a.starts_at, input.timeZone), name: name(a.patients), what: a.appointment_types?.name ?? null, arrived: !!a.checked_in_at })),
  }
}
