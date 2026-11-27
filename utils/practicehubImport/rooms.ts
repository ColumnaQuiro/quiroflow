// Which room here each PracticeHub appointment was in. Pure; the Appointments
// planner (./appointments.ts) reads the lists and the clinic's rooms.
//
// A Classic appointment says where it is with two numbers: `location_id`
// (which of the clinic's PracticeHub locations) and `resource_id` (the room,
// table or bench on that location's calendar). The names behind them come
// from PracticeHub 2.0's /resources ('/v3/resources' in the copy), whose ids
// are the ones Classic's appointments carry. `columns`, also on every Classic
// appointment, is how many calendar columns the booking spans, not a room.
//
// Three rules keep a visit out of a room it was not in:
//
// - Only a room that already exists in the clinic being imported into. The
//   import never creates one: a clinic sets its rooms up in Settings, and
//   anything unmatched comes in with no room, as every visit did before.
// - Only visits at the PracticeHub location that clinic IS. The import puts
//   every PracticeHub appointment into one clinic here, and a clinic with
//   several PracticeHub locations has a room "1" at each of them; a visit in
//   another location's room "1" was not in this clinic's room "1". The
//   location is the one holding more than half of the appointments -- a clinic
//   imports its main location -- and with no such majority, no visit gets a
//   room.
// - The resource must sit at the visit's own location. It always does when
//   the two APIs agree on ids; when they do not, nothing matches rather than
//   something matching wrongly.
//
// Names are compared ignoring case, accents and spacing ("Sala 1" is
// "sala 1"). A name that only matches once a leading word like "Sala" or
// "Camilla" is dropped ("Sala 1" against a room called "1") is taken only when
// that leaves exactly one room on each side, so "Sala 1" and "Camilla 1" at
// the same location never both land in room "1".

/** A PracticeHub 2.0 /resources record, as far as the import reads it. */
export interface PHV3Resource {
  id: number | string
  location_id?: number | string | null
  /** The internal name shown on PracticeHub's calendar. */
  name?: string | null
  /** 'active' or 'inactive'. An inactive room still names the visits it held. */
  status?: string | null
}

/** A Classic /appointments record's place on the calendar. */
export interface PHPlacedAppointment {
  id: number | string
  location_id?: number | string | null
  resource_id?: number | string | null
}

export interface RoomHere {
  id: string
  name: string
}

// Words a clinic puts in front of a room's number. Dropped only for the
// second, stricter comparison described above.
const ROOM_WORDS = new Set(['sala', 'room', 'consulta', 'box', 'gabinete', 'camilla', 'cabina', 'despacho', 'habitacion', 'mesa', 'table', 'bench'])

/** A room name as compared: lower case, no accents, single spaces. */
export function roomNameKey(name: string | null | undefined): string {
  return (name ?? '')
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[\s._-]+/g, ' ')
    .trim()
}

/** roomNameKey without a leading word like "Sala" ("sala 1" -> "1"); the key itself when nothing would be left. */
export function roomNameBare(name: string | null | undefined): string {
  const key = roomNameKey(name)
  const [first, ...rest] = key.split(' ')
  return first && ROOM_WORDS.has(first) && rest.length ? rest.join(' ') : key
}

const idText = (v: number | string | null | undefined) => (v === null || v === undefined ? '' : String(v))

/** The PracticeHub location holding more than half of these appointments, or null when none does. */
export function practiceHubMainLocation(appointments: readonly PHPlacedAppointment[]): string | null {
  const counts = new Map<string, number>()
  let total = 0
  for (const a of appointments) {
    const loc = idText(a.location_id)
    if (!loc) continue
    total++
    counts.set(loc, (counts.get(loc) ?? 0) + 1)
  }
  for (const [loc, n] of counts) if (n * 2 > total) return loc
  return null
}

/**
 * Which room here each PracticeHub resource at `locationId` is, by resource
 * id; undefined for one with no room here. Resources at other locations are
 * left out. `roomsHere` in a fixed order: of two rooms with the same name, the
 * first wins.
 */
export function practiceHubRoomMatches(input: {
  resources: readonly PHV3Resource[]
  roomsHere: readonly RoomHere[]
  locationId: string
}): Map<string, RoomHere | undefined> {
  const atLocation = input.resources.filter((r) => idText(r.location_id) === input.locationId)

  const byKey = new Map<string, RoomHere>()
  const bareCount = new Map<string, number>()
  const byBare = new Map<string, RoomHere>()
  for (const room of input.roomsHere) {
    const key = roomNameKey(room.name)
    if (key && !byKey.has(key)) byKey.set(key, room)
    const bare = roomNameBare(room.name)
    if (!bare) continue
    bareCount.set(bare, (bareCount.get(bare) ?? 0) + 1)
    if (!byBare.has(bare)) byBare.set(bare, room)
  }
  const resourceBareCount = new Map<string, number>()
  for (const r of atLocation) {
    const bare = roomNameBare(r.name)
    if (bare) resourceBareCount.set(bare, (resourceBareCount.get(bare) ?? 0) + 1)
  }

  const matches = new Map<string, RoomHere | undefined>()
  for (const r of atLocation) {
    const exact = byKey.get(roomNameKey(r.name))
    const bare = roomNameBare(r.name)
    const loose = bare && bareCount.get(bare) === 1 && resourceBareCount.get(bare) === 1 ? byBare.get(bare) : undefined
    matches.set(idText(r.id), exact ?? loose)
  }
  return matches
}

export interface PracticeHubRoomPlan {
  /** The room here for a PracticeHub appointment id, or null. */
  roomFor(appointmentId: string): RoomHere | null
  /** The PracticeHub location this clinic is taken to be, or null when none holds most of the visits. */
  locationId: string | null
  /** Each of that location's PracticeHub rooms that holds visits, and what it matched here. */
  rooms: { name: string; room: RoomHere | undefined; visits: number }[]
  /** Visits at another PracticeHub location, which come in with no room. */
  elsewhere: number
}

/** Puts the rules above together for one copy of PracticeHub and one clinic's rooms. */
export function practiceHubRoomPlan(input: {
  appointments: readonly PHPlacedAppointment[]
  resources: readonly PHV3Resource[]
  roomsHere: readonly RoomHere[]
}): PracticeHubRoomPlan {
  const locationId = practiceHubMainLocation(input.appointments)
  const matches = locationId ? practiceHubRoomMatches({ resources: input.resources, roomsHere: input.roomsHere, locationId }) : new Map<string, RoomHere | undefined>()

  const roomOf = new Map<string, RoomHere>()
  const visits = new Map<string, number>()
  let elsewhere = 0
  for (const a of input.appointments) {
    const loc = idText(a.location_id)
    if (!locationId || loc !== locationId) {
      if (loc) elsewhere++
      continue
    }
    const res = idText(a.resource_id)
    if (!matches.has(res)) continue
    visits.set(res, (visits.get(res) ?? 0) + 1)
    const room = matches.get(res)
    if (room) roomOf.set(idText(a.id), room)
  }

  const rooms = input.resources
    .filter((r) => matches.has(idText(r.id)))
    .map((r) => ({ name: (r.name ?? '').trim() || `#${idText(r.id)}`, room: matches.get(idText(r.id)), visits: visits.get(idText(r.id)) ?? 0 }))
    .filter((r) => r.visits > 0)

  return { roomFor: (id) => roomOf.get(id) ?? null, locationId, rooms, elsewhere }
}
