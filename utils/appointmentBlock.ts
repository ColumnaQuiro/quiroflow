import type { AppointmentStage } from './appointmentStage'

// What an appointment block has room to say.
//
// A block is as big as its duration and its column allow, which on an iPad in
// week view is 82 px wide and on a 15-minute visit is 26 px tall. Everything
// cannot fit, so the details are ranked and the lowest-ranked go first:
//
//   1 name              always (week: initial + surname)
//   1½ practitioner     whole-clinic tab only: their initials in their
//                       colour. On that tab "whose visit is this" is the
//                       first question, and the block had no other place
//                       that answered it at every size. Before the name;
//                       on a two-line week block, before the time instead,
//                       which gives way to it (the grid's axis has the
//                       time) -- at 71px, a week column split into rooms,
//                       the badge beside the name cut "P. Mateu" to "P. Ma…"
//   2 stage             always -- the border; the label only where it fits
//   2½ re-exam visit    always -- an icon beside the name; the care plan's
//                       review is what the visit IS, so it outranks the money
//   3 owes              always (day: the amount; week: a € dot)
//   4 time·type·pract   day, two-line blocks; week: the time, if it fits
//   5 bono left         day, two-line blocks
//   6 forms pending     an icon beside the name; week: only where the
//                       short name and the stage icon leave room for it
//   6½ no next visit    an icon beside the name (a calendar struck
//                       through), only when it applies -- in the room or
//                       done today with nothing booked after. It was a
//                       "Sin próxima" chip on the detail line, last in the
//                       ladder, so it only ever showed on tall day blocks:
//                       the moment to book the next visit went unflagged
//                       in week view and on every 30-minute block. Week:
//                       where the forms icon leaves room for it
//   7 clinical note     day; an icon beside the name
//   8 moved count       day, two-line blocks
//
// Pure, so the ladder can be pinned in a spec without rendering anything --
// the block measures itself and asks this what to draw.

export type BlockDensity = 'day' | 'week'

export interface LadderInput {
  density: BlockDensity
  /** Rendered size in px. */
  width: number
  height: number
  stage: AppointmentStage
  owes: boolean
  bono: boolean
  note: boolean
  moved: number
  noNext: boolean
  /** The patient has forms sent and not completed (pendingFormsFlag). */
  forms?: boolean
  /** A care plan's re-exam visit. */
  marker?: boolean
  /** The practitioner badge's initials, when the block draws one (the
   *  whole-clinic tab). Where it goes, and what gives way to it, is the
   *  ladder's call: see Ladder.badge. */
  badgeText?: string
  /** The stage label as it will print, for sizing the pill. */
  pillText: string
  /** The patient's name as it will print. The name outranks the label, so
   *  the label gives way to its icon before the name would be cut. */
  nameText?: string
  /** Week view only, where `nameText` is the short "L. Gómez": the name's
   *  two columns (patients.first_name, and last_name with both surnames),
   *  for printing more of it wherever the block has the room. */
  firstName?: string
  lastName?: string
  /** The red-flags icon is drawn after the name (it is never dropped). */
  redFlag?: boolean
  /** The money label as it will print ("Debe 45,00 €"). */
  owesText?: string
  bonoText?: string
}

export interface Ladder {
  /** One line, vertically centred. */
  compact: boolean
  shortName: boolean
  /** Week view: the fuller name this column has room for on one line, to
   *  print in place of the short one; null where only the short one fits. */
  fullerName: string | null
  /** Week view, where no fuller name fits on one line and the block is tall
   *  enough: the first name, and the surnames on a line of their own. */
  nameLines: [string, string] | null
  /** Three lines in a block only just tall enough for them. */
  tight: boolean
  pill: 'none' | 'icon' | 'label'
  owes: 'none' | 'inline' | 'meta' | 'dot'
  meta: 'none' | 'time' | 'full'
  note: boolean
  forms: boolean
  bono: boolean
  moved: boolean
  noNext: boolean
  marker: boolean
  /** Where the practitioner badge goes: before the name, or leading the
   *  detail line (two-line week blocks). Never dropped for room once asked
   *  for: on the whole-clinic tab it is what the block is read for. */
  badge: 'none' | 'name' | 'meta'
  /** Tall enough that the detail row may wrap instead of dropping anything. */
  wrap: boolean
}

/** Below this a block is a single line. */
export const COMPACT_BELOW_PX = 40
/** A week block with a practitioner badge keeps two lines down to this:
 *  a 30-minute visit at the narrowest week scale (81px an hour) is 38.5px,
 *  and fits the name line (13.2px) over the 14px badge in its 28.5px. One
 *  line would put the badge beside the name, which then lost half its
 *  letters on most of a work week split into rooms. */
export const WEEK_BADGE_TWO_LINES_FROM_PX = 38
/** A week block at least this tall holds a two-line name and the time under
 *  it: three 11px lines with the padding pulled in (Ladder.tight). */
export const WEEK_THREE_LINES_FROM_PX = 44
/** From here the three lines fit at the block's usual spacing. */
export const WEEK_THREE_LINES_ROOMY_FROM_PX = 56
/** At or above this the detail row wraps onto a third line rather than dropping items. */
export const WRAP_FROM_PX = 76
/** Narrower than this, a day block's stage pill shows its icon only. */
export const PILL_LABEL_FROM_PX = 200

// Rough text widths at the block's 11-11.5px type: good enough to decide what
// fits, which is all this is for -- the template still ellipsises.
const CHAR_PX = 6.2
const textPx = (s: string | undefined, pad = 0) => Math.ceil((s?.length ?? 0) * CHAR_PX) + pad

const NAME_MIN_PX = 56
// The name is bolder and larger (13px semibold) than the detail text.
const NAME_CHAR_PX = 7.4
const META_MIN_PX = 64
const NOTE_PX = 17
const FORMS_PX = 17
// Week blocks: 11px semibold, 5px padding a side plus the border.
const WEEK_NAME_CHAR_PX = 6.6
const WEEK_INNER_PAD_PX = 12
// The red-flags icon at week size.
const WEEK_ICON_PX = 11
const MARKER_PX = 14
const MOVED_PX = 26
const NO_NEXT_PX = 17
const GAP_PX = 6
// A circle for one letter (14px in week view, 18px in day), a pill a letter
// wider for two. 16 splits the difference; the template still ellipsises.
const badgePx = (text: string | undefined) => (text ? 16 + Math.max(0, text.length - 1) * 7 : 0)
// The week detail line: the type square and its gap, then "09:30".
const WEEK_SQUARE_PX = 14
const WEEK_TIME_PX = 31

export function blockLadder(input: LadderInput): Ladder {
  const week = input.density === 'week'
  const compact = input.height < (week && input.badgeText ? WEEK_BADGE_TWO_LINES_FROM_PX : COMPACT_BELOW_PX)
  // Completed needs no label: the muted fill already says so, and a pill on
  // every past visit is the noise this redesign exists to remove. Confirmed in
  // week view the same way -- it is the default, the other stages stand out
  // against it.
  const pillHidden = input.stage === 'completed' || (week && input.stage === 'confirmed')
  const badgeRoom = input.badgeText ? badgePx(input.badgeText) + GAP_PX : 0

  if (week) {
    // The short name is rank 1, so the forms icon only goes where it would
    // not cut it: in practice a confirmed visit (no stage icon) in a column
    // of 82px or more, or any visit in a wider one. The re-exam marker
    // (rank 2½) is always drawn, so it takes its room first.
    const lineRoom = input.width - WEEK_INNER_PAD_PX - (pillHidden ? 0 : 18 + GAP_PX) - (input.marker ? MARKER_PX + GAP_PX : 0) - (compact ? badgeRoom : 0)
    const room = lineRoom - Math.ceil((input.nameText?.length ?? 8) * WEEK_NAME_CHAR_PX)
    // Two lines: the badge leads the second, and the time keeps its place
    // beside it only where both fit.
    const timeFits = !input.badgeText || input.width - WEEK_INNER_PAD_PX - badgeRoom - WEEK_SQUARE_PX >= WEEK_TIME_PX
    const forms = !!input.forms && room >= FORMS_PX
    const noNext = input.noNext && room - (forms ? FORMS_PX + GAP_PX : 0) >= NO_NEXT_PX
    // The icons are decided against the short name, as they always were, and
    // the name then takes what is left: first name and both surnames where
    // the column has the room, first name and first surname where it has
    // less. Two patients called Laura are told apart by either.
    const iconsPx = (input.redFlag ? WEEK_ICON_PX + GAP_PX : 0) + (forms ? FORMS_PX + GAP_PX : 0) + (noNext ? NO_NEXT_PX + GAP_PX : 0)
    const fullerName = fullerPatientNames(input.firstName, input.lastName).find((n) => n !== input.nameText && Math.ceil(n.length * WEEK_NAME_CHAR_PX) <= lineRoom - iconsPx) ?? null
    // Where neither fits -- a day split into room columns leaves a block
    // some 70px, and "L. Gómez" itself was cut to "L. Gó…" there -- the name
    // takes two lines: the first name, then the surnames. The time keeps its
    // line under them from WEEK_THREE_LINES_FROM_PX; in the few blocks
    // shorter than that and still not one-line it gives way, the name being
    // rank 1 -- unless the practitioner badge is on that line, which always
    // stays, and then the name stays as it was.
    const threeLines = input.height >= WEEK_THREE_LINES_FROM_PX
    const first = (input.firstName ?? '').trim()
    const last = (input.lastName ?? '').trim()
    const nameLines: Ladder['nameLines'] = !compact && !fullerName && !!first && !!last && (threeLines || !input.badgeText) ? [first, last] : null
    return {
      compact,
      shortName: !fullerName && !nameLines,
      fullerName,
      nameLines,
      tight: !!nameLines && threeLines && input.height < WEEK_THREE_LINES_ROOMY_FROM_PX,
      pill: pillHidden ? 'none' : 'icon',
      owes: input.owes ? 'dot' : 'none',
      meta: compact || !timeFits || (nameLines && !threeLines) ? 'none' : 'time',
      forms,
      note: false,
      bono: false,
      moved: false,
      noNext,
      marker: !!input.marker,
      badge: !input.badgeText ? 'none' : compact ? 'name' : 'meta',
      wrap: false,
    }
  }

  const inner = input.width - 20 - badgeRoom // padding + border, and the badge before the name
  const owesPx = input.owes ? textPx(input.owesText ?? 'Debe 00,00 €', 14) : 0
  // Rank 1 before rank 2: the label is shown only if the whole name still
  // fits beside it (and beside the money, on a one-line block). Spanish
  // labels are long -- "Online · sin confirmar" -- and at iPad widths they
  // used to leave "Lucía Fern…".
  const namePx = input.nameText ? Math.ceil(input.nameText.length * NAME_CHAR_PX) : NAME_MIN_PX
  const beside = compact && input.owes ? owesPx + GAP_PX : 0
  const labelFits = inner - Math.max(namePx, NAME_MIN_PX) - beside - GAP_PX >= textPx(input.pillText, 26)
  const pill: Ladder['pill'] = pillHidden ? 'none' : input.width >= PILL_LABEL_FROM_PX && labelFits ? 'label' : 'icon'
  const pillPx = pill === 'none' ? 0 : pill === 'icon' ? 18 : textPx(input.pillText, 26)

  // Line one: name, [marker], [forms], [no next], [note], pill, and -- on a one-line
  // block -- the money.
  let line1 = inner - Math.max(namePx, NAME_MIN_PX) - (pillPx ? pillPx + GAP_PX : 0)
  if (compact && input.owes) line1 -= owesPx + GAP_PX
  const marker = !!input.marker
  if (marker) line1 -= MARKER_PX + GAP_PX
  const forms = !!input.forms && line1 >= FORMS_PX + GAP_PX
  if (forms) line1 -= FORMS_PX + GAP_PX
  const noNext = input.noNext && line1 >= NO_NEXT_PX + GAP_PX
  if (noNext) line1 -= NO_NEXT_PX + GAP_PX
  const note = input.note && line1 >= NOTE_PX + GAP_PX

  if (compact) {
    return { compact, shortName: false, fullerName: null, nameLines: null, tight: false, pill, owes: input.owes ? 'inline' : 'none', meta: 'none', forms, note, bono: false, moved: false, noNext, marker, badge: input.badgeText ? 'name' : 'none', wrap: false }
  }

  const wrap = input.height >= WRAP_FROM_PX
  // Line two, filled in rank order until it runs out: the money first (rank
  // 3), then enough of the time/type/practitioner text to be worth showing,
  // then the optional chips.
  let line2 = inner + badgeRoom - 14 // the type square and its gap; the badge is line one's only
  if (input.owes) line2 -= owesPx + GAP_PX
  const meta: Ladder['meta'] = wrap || line2 >= META_MIN_PX ? 'full' : 'none'
  if (meta === 'full') line2 -= META_MIN_PX
  // Strictly in rank order: once one item does not fit, nothing ranked below
  // it is shown either, even if it is narrower. A block showing "moved twice"
  // but not what the visit is would have its priorities upside down.
  let open = meta === 'full'
  const take = (want: boolean, px: number) => {
    if (!want) return false
    if (wrap) return true
    if (!open || line2 < px + GAP_PX) {
      open = false
      return false
    }
    line2 -= px + GAP_PX
    return true
  }
  const bono = take(input.bono, textPx(input.bonoText ?? 'Bono 00/00', 14))
  const moved = take(input.moved > 0, MOVED_PX)

  return { compact, shortName: false, fullerName: null, nameLines: null, tight: false, pill, owes: input.owes ? 'meta' : 'none', meta, forms, note, bono, moved, noNext, marker, badge: input.badgeText ? 'name' : 'none', wrap }
}

// "de la Fuente Ruiz" starts with a surname of three words, not one.
const SURNAME_PARTICLES = new Set(['de', 'del', 'la', 'las', 'los', 'da', 'das', 'do', 'dos', 'di', 'van', 'von', 'der', 'den', 'y', 'i'])
/** The first surname of "Gómez Pardo" or "de la Fuente Ruiz", particles kept. */
function firstSurname(last: string): string {
  const words = last.split(/\s+/)
  let end = 0
  while (end < words.length - 1 && SURNAME_PARTICLES.has(words[end]!.toLocaleLowerCase('es'))) end++
  return words.slice(0, end + 1).join(' ')
}

/** "Laura Gómez" -> "L. Gómez", for week view's narrow columns. */
export function shortPatientName(first: string | null | undefined, last: string | null | undefined): string {
  const f = (first ?? '').trim()
  const l = (last ?? '').trim()
  if (!l) return f
  if (!f) return l
  return `${f[0]}. ${firstSurname(l)}`
}

/**
 * A patient's name from most to least complete, for a week block to print
 * the first that fits on its line: "Laura Gómez Pardo", then "Laura Gómez".
 * `last_name` holds both surnames; there is no column for the second.
 */
export function fullerPatientNames(first: string | null | undefined, last: string | null | undefined): string[] {
  const f = (first ?? '').trim()
  const l = (last ?? '').trim()
  if (!f || !l) return []
  return [...new Set([`${f} ${l}`, `${f} ${firstSurname(l)}`])]
}

/**
 * The shortest initials that still tell a clinic's practitioners apart, for
 * the calendar's practitioner badge: "L" when Léa is the only L, "LM" and
 * "LS" when there are two. A badge is 16px, so one letter is the goal; the
 * second letter is only spent where the first would be ambiguous. Two people
 * whose two letters still match keep them, and their colours tell them apart.
 */
export function practitionerBadgeLabels(members: { id: string; full_name: string | null }[]): Map<string, string> {
  const words = (name: string | null) => (name ?? '').trim().split(/\s+/).filter(Boolean)
  const first = (name: string | null) => (words(name)[0]?.[0] ?? '?').toLocaleUpperCase('es')
  const two = (name: string | null) => {
    const w = words(name)
    return w.length > 1 ? `${w[0][0]}${w[w.length - 1][0]}`.toLocaleUpperCase('es') : first(name)
  }
  // Á and A are one letter for this: "Á" beside "A" at 16px is no help.
  const key = (name: string | null) => first(name).normalize('NFD').replace(/\p{M}/gu, '')
  const count = new Map<string, number>()
  for (const m of members) count.set(key(m.full_name), (count.get(key(m.full_name)) ?? 0) + 1)
  return new Map(members.map((m) => [m.id, (count.get(key(m.full_name)) ?? 0) > 1 ? two(m.full_name) : first(m.full_name)]))
}
