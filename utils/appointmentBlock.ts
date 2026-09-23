import type { AppointmentStage } from './appointmentStage'

// What an appointment block has room to say.
//
// A block is as big as its duration and its column allow, which on an iPad in
// week view is 82 px wide and on a 15-minute visit is 26 px tall. Everything
// cannot fit, so the details are ranked and the lowest-ranked go first:
//
//   1 name              always (week: initial + surname)
//   2 stage             always -- the border; the label only where it fits
//   3 owes              always (day: the amount; week: a € dot)
//   4 time·type·pract   day, two-line blocks; week: the time, if it fits
//   5 bono left         day, two-line blocks
//   6 clinical note     day; an icon beside the name
//   7 moved count       day, two-line blocks
//   8 "Sin próxima"     day, two-line blocks, and only when it applies
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
  /** The stage label as it will print, for sizing the pill. */
  pillText: string
  /** The patient's name as it will print. The name outranks the label, so
   *  the label gives way to its icon before the name would be cut. */
  nameText?: string
  /** The money label as it will print ("Debe 45,00 €"). */
  owesText?: string
  bonoText?: string
}

export interface Ladder {
  /** One line, vertically centred. */
  compact: boolean
  shortName: boolean
  pill: 'none' | 'icon' | 'label'
  owes: 'none' | 'inline' | 'meta' | 'dot'
  meta: 'none' | 'time' | 'full'
  note: boolean
  bono: boolean
  moved: boolean
  noNext: boolean
  /** Tall enough that the detail row may wrap instead of dropping anything. */
  wrap: boolean
}

/** Below this a block is a single line. */
export const COMPACT_BELOW_PX = 40
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
const MOVED_PX = 26
const NO_NEXT_PX = 82
const GAP_PX = 6

export function blockLadder(input: LadderInput): Ladder {
  const compact = input.height < COMPACT_BELOW_PX
  const week = input.density === 'week'
  // Completed needs no label: the muted fill already says so, and a pill on
  // every past visit is the noise this redesign exists to remove. Confirmed in
  // week view the same way -- it is the default, the other stages stand out
  // against it.
  const pillHidden = input.stage === 'completed' || (week && input.stage === 'confirmed')

  if (week) {
    return {
      compact,
      shortName: true,
      pill: pillHidden ? 'none' : 'icon',
      owes: input.owes ? 'dot' : 'none',
      meta: compact ? 'none' : 'time',
      note: false,
      bono: false,
      moved: false,
      noNext: false,
      wrap: false,
    }
  }

  const inner = input.width - 20 // padding + border
  const owesPx = input.owes ? textPx(input.owesText ?? 'Debe 00,00 €', 14) : 0
  // Rank 1 before rank 2: the label is shown only if the whole name still
  // fits beside it (and beside the money, on a one-line block). Spanish
  // labels are long -- "Online · sin confirmar" -- and at iPad widths they
  // used to leave "Sergio Nav…".
  const namePx = input.nameText ? Math.ceil(input.nameText.length * NAME_CHAR_PX) : NAME_MIN_PX
  const beside = compact && input.owes ? owesPx + GAP_PX : 0
  const labelFits = inner - Math.max(namePx, NAME_MIN_PX) - beside - GAP_PX >= textPx(input.pillText, 26)
  const pill: Ladder['pill'] = pillHidden ? 'none' : input.width >= PILL_LABEL_FROM_PX && labelFits ? 'label' : 'icon'
  const pillPx = pill === 'none' ? 0 : pill === 'icon' ? 18 : textPx(input.pillText, 26)

  // Line one: name, [note], pill, and -- on a one-line block -- the money.
  let line1 = inner - Math.max(namePx, NAME_MIN_PX) - (pillPx ? pillPx + GAP_PX : 0)
  if (compact && input.owes) line1 -= owesPx + GAP_PX
  const note = input.note && line1 >= NOTE_PX + GAP_PX

  if (compact) {
    return { compact, shortName: false, pill, owes: input.owes ? 'inline' : 'none', meta: 'none', note, bono: false, moved: false, noNext: false, wrap: false }
  }

  const wrap = input.height >= WRAP_FROM_PX
  // Line two, filled in rank order until it runs out: the money first (rank
  // 3), then enough of the time/type/practitioner text to be worth showing,
  // then the optional chips.
  let line2 = inner - 14 // the type square and its gap
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
  const noNext = take(input.noNext, NO_NEXT_PX)

  return { compact, shortName: false, pill, owes: input.owes ? 'meta' : 'none', meta, note, bono, moved, noNext, wrap }
}

/** "Laura Gómez" -> "L. Gómez", for week view's narrow columns. */
export function shortPatientName(first: string | null | undefined, last: string | null | undefined): string {
  const f = (first ?? '').trim()
  const l = (last ?? '').trim()
  if (!l) return f
  if (!f) return l
  return `${f[0]}. ${l.split(/\s+/)[0]}`
}
