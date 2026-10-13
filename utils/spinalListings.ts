// Spinal listings (visit_listings.listings): which segments were adjusted
// on a visit and on which side. A map from level to "L", "R" or "B" (both);
// a level that is not in the map was not listed.

export type ListingSide = 'L' | 'R' | 'B'
export type Listings = Record<string, ListingSide>

export const SPINE_LEVELS = [
  'OCC', 'C1', 'C2', 'C3', 'C4', 'C5', 'C6', 'C7',
  'T1', 'T2', 'T3', 'T4', 'T5', 'T6', 'T7', 'T8', 'T9', 'T10', 'T11', 'T12',
  'L1', 'L2', 'L3', 'L4', 'L5', 'Sacrum', 'SI', 'Pelvis', 'Coccyx',
] as const

export const EXTREMITY_LEVELS = ['TMJ', 'Shoulder', 'Elbow', 'Wrist', 'Hand', 'Ribs', 'Hip', 'Knee', 'Ankle', 'Foot'] as const

const ORDER = [...SPINE_LEVELS, ...EXTREMITY_LEVELS] as string[]

/** Tapping a side: on if off, off if it was the only one, the other kept with "both". */
export function toggleListing(listings: Listings, level: string, side: 'L' | 'R'): Listings {
  const now = listings[level]
  const next = { ...listings }
  if (!now) next[level] = side
  else if (now === side) delete next[level]
  else if (now === 'B') next[level] = side === 'L' ? 'R' : 'L'
  else next[level] = 'B'
  return next
}

export function hasSide(listings: Listings, level: string, side: 'L' | 'R'): boolean {
  const v = listings[level]
  return v === side || v === 'B'
}

/** The letters for each side in the reader's language: L / R, or I / D (izquierda / derecha). */
export interface SideLetters { L: string; R: string }
export const SIDES_EN: SideLetters = { L: 'L', R: 'R' }
export function sideLettersFor(t: (en: string, es: string) => string): SideLetters {
  return { L: t('L', 'I'), R: t('R', 'D') }
}
export function sideText(side: ListingSide, letters: SideLetters = SIDES_EN): string {
  return side === 'B' ? `${letters.L}/${letters.R}` : letters[side]
}

/** "C5 R · T4 L · L5 L/R" (or "C5 D · T4 I · L5 I/D"), head to foot, then the extremities. */
export function listingSummary(listings: Listings | null | undefined, extremityName: (level: string) => string = (l) => l, letters: SideLetters = SIDES_EN): string {
  if (!listings) return ''
  return Object.keys(listings)
    .filter((k) => listings[k] === 'L' || listings[k] === 'R' || listings[k] === 'B')
    .sort((a, b) => (ORDER.indexOf(a) === -1 ? 999 : ORDER.indexOf(a)) - (ORDER.indexOf(b) === -1 ? 999 : ORDER.indexOf(b)))
    .map((k) => `${(EXTREMITY_LEVELS as readonly string[]).includes(k) ? extremityName(k) : k} ${sideText(listings[k]!, letters)}`)
    .join(' · ')
}

// The listing, written into the note's Action as its first line -- "Ajustado:
// C5 D · L5 I/D" -- so the signed note and the notes history carry it. The
// line is recognised by its prefix in either language and kept in step as the
// segments are tapped; everything after it in Action is the practitioner's.
const LISTING_LINE_PREFIXES = ['Adjusted:', 'Ajustado:']

export function listingActionLine(summary: string, t: (en: string, es: string) => string): string {
  return summary ? t(`Adjusted: ${summary}`, `Ajustado: ${summary}`) : ''
}

/** Action with its listing line set to `line` -- replaced, added at the top, or removed when empty. */
export function syncListingLine(action: string, line: string): string {
  const lines = action ? action.split('\n') : []
  const has = lines.length > 0 && LISTING_LINE_PREFIXES.some((p) => lines[0]!.startsWith(p))
  if (has) {
    if (line) lines[0] = line
    else lines.shift()
  } else if (line) {
    lines.unshift(line)
  }
  return lines.join('\n')
}
