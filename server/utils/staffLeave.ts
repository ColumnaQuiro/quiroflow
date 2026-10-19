// Words for the leave pushes (server/api/staff-absences). In Spanish: they are
// read by a Spanish clinic's team on their phones.
export function absenceKindEs(kind: string): string {
  if (kind === 'vacation') return 'Vacaciones'
  if (kind === 'personal') return 'Asuntos propios'
  if (kind === 'sick') return 'Baja médica'
  if (kind === 'parental') return 'Maternidad / paternidad'
  return 'Formación'
}

/** "23 – 27 nov", "25 nov", "25 nov (medio día)", "desde el 3 oct, sin fecha de vuelta". */
export function leaveDatesLabel(startsOn: string, endsOn: string, halfDay: boolean): string {
  const f = (d: string) => new Date(`${d}T12:00:00Z`).toLocaleDateString('es-ES', { day: 'numeric', month: 'short', timeZone: 'UTC' })
  if (endsOn >= '2999-12-31') return `desde el ${f(startsOn)}, sin fecha de vuelta`
  if (startsOn === endsOn) return halfDay ? `${f(startsOn)} (medio día)` : f(startsOn)
  return `${f(startsOn)} – ${f(endsOn)}`
}
