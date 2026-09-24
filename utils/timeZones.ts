// Time zones for a clinic, which can be anywhere: the list is every IANA zone
// the browser knows, with the ones Spanish-speaking clinics use most first.

export interface ZoneOption {
  id: string
  city: string
  region: string
}

export const FREQUENT_ZONES: ZoneOption[] = [
  { id: 'Europe/Madrid', city: 'Madrid', region: 'Península y Baleares' },
  { id: 'Atlantic/Canary', city: 'Canarias', region: 'España' },
  { id: 'Europe/Lisbon', city: 'Lisboa', region: 'Portugal' },
  { id: 'Europe/London', city: 'Londres', region: 'Reino Unido' },
  { id: 'America/Mexico_City', city: 'Ciudad de México', region: 'México' },
  { id: 'America/Bogota', city: 'Bogotá', region: 'Colombia' },
  { id: 'America/Argentina/Buenos_Aires', city: 'Buenos Aires', region: 'Argentina' },
  { id: 'America/Santiago', city: 'Santiago', region: 'Chile' },
]

/** Every zone the runtime knows, frequent ones first; the frequent list alone where Intl cannot say. */
export function allZones(): ZoneOption[] {
  const intl = Intl as unknown as { supportedValuesOf?: (key: string) => string[] }
  const ids = intl.supportedValuesOf ? intl.supportedValuesOf('timeZone') : []
  const frequent = new Set(FREQUENT_ZONES.map((z) => z.id))
  const rest = ids.filter((id) => !frequent.has(id)).map(zoneFromId)
  return [...FREQUENT_ZONES, ...rest]
}

/** "America/Argentina/Buenos_Aires" -> city "Buenos Aires", region "America / Argentina". */
export function zoneFromId(id: string): ZoneOption {
  const known = FREQUENT_ZONES.find((z) => z.id === id)
  if (known) return known
  const parts = id.split('/')
  const city = (parts.pop() ?? id).replace(/_/g, ' ')
  return { id, city, region: parts.join(' / ').replace(/_/g, ' ') }
}

/** "UTC+2", "UTC−5", "UTC+5:30", "UTC" -- at the given moment, so summer time counts. */
export function utcOffsetLabel(id: string, at: Date = new Date()): string {
  try {
    const name = new Intl.DateTimeFormat('en-US', { timeZone: id, timeZoneName: 'shortOffset' })
      .formatToParts(at)
      .find((p) => p.type === 'timeZoneName')?.value ?? 'GMT'
    const m = name.match(/^GMT([+-])(\d{1,2})(?::(\d{2}))?$/)
    // Node says "GMT+0" where browsers say "GMT"; both are plain UTC.
    if (!m || (Number(m[2]) === 0 && !m[3])) return 'UTC'
    return `UTC${m[1] === '-' ? '−' : '+'}${Number(m[2])}${m[3] ? `:${m[3]}` : ''}`
  } catch {
    return ''
  }
}

function fold(s: string): string {
  return s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase()
}

/** Zones matching what was typed, by city, region or id, accents ignored. */
export function searchZones(zones: ZoneOption[], query: string): ZoneOption[] {
  const q = fold(query.trim())
  if (!q) return zones
  return zones.filter((z) => fold(`${z.city} ${z.region} ${z.id}`).includes(q))
}
