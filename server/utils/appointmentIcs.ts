// A visit as an iCalendar file (RFC 5545), for "Añadir al calendario" in the
// patient app. Times are written in UTC (the trailing Z), so the phone's
// calendar shows the visit at the right moment whatever zone it is set to.
//
// Pure, so it can be tested and imported anywhere; the server route that
// hands it to a patient is server/api/portal/appointments/calendar-link.post.ts.

export interface IcsVisit {
  id: string
  startsAt: string
  endsAt: string
  title: string
  location?: string | null
  description?: string | null
}

function utcStamp(iso: string | Date): string {
  return new Date(iso).toISOString().replace(/[-:]/g, '').replace(/\.\d{3}/, '')
}

// Commas, semicolons and backslashes are separators in a TEXT value, and a
// newline has to be the two characters \n.
function escapeText(value: string): string {
  return value.replace(/\\/g, '\\\\').replace(/;/g, '\;').replace(/,/g, '\\,').replace(/\r?\n/g, '\\n')
}

// Lines longer than 75 octets are folded: CRLF plus one space, counted in
// bytes so an accented clinic name is not cut through a character.
function fold(line: string): string {
  const bytes = Buffer.from(line, 'utf8')
  if (bytes.length <= 75) return line
  const parts: string[] = []
  let start = 0
  let limit = 75
  while (start < bytes.length) {
    let end = Math.min(start + limit, bytes.length)
    // Do not split a multi-byte UTF-8 sequence (continuation bytes are 10xxxxxx).
    while (end < bytes.length && (bytes[end]! & 0xc0) === 0x80) end--
    parts.push(bytes.subarray(start, end).toString('utf8'))
    start = end
    limit = 74 // the leading space of a continuation line counts
  }
  return parts.join('\r\n ')
}

export function appointmentIcs(visit: IcsVisit, now: Date = new Date()): string {
  const lines = [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'PRODID:-//QuiroFlow//Citas//ES',
    'CALSCALE:GREGORIAN',
    'METHOD:PUBLISH',
    'BEGIN:VEVENT',
    `UID:${visit.id}@quiroflow.com`,
    `DTSTAMP:${utcStamp(now)}`,
    `DTSTART:${utcStamp(visit.startsAt)}`,
    `DTEND:${utcStamp(visit.endsAt)}`,
    `SUMMARY:${escapeText(visit.title)}`,
    ...(visit.location ? [`LOCATION:${escapeText(visit.location)}`] : []),
    ...(visit.description ? [`DESCRIPTION:${escapeText(visit.description)}`] : []),
    'END:VEVENT',
    'END:VCALENDAR',
  ]
  return lines.map(fold).join('\r\n') + '\r\n'
}
