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

/** "C5 R · T4 L · L5 L/R", head to foot, then the extremities. */
export function listingSummary(listings: Listings | null | undefined, extremityName: (level: string) => string = (l) => l): string {
  if (!listings) return ''
  return Object.keys(listings)
    .filter((k) => listings[k] === 'L' || listings[k] === 'R' || listings[k] === 'B')
    .sort((a, b) => (ORDER.indexOf(a) === -1 ? 999 : ORDER.indexOf(a)) - (ORDER.indexOf(b) === -1 ? 999 : ORDER.indexOf(b)))
    .map((k) => `${(EXTREMITY_LEVELS as readonly string[]).includes(k) ? extremityName(k) : k} ${listings[k] === 'B' ? 'L/R' : listings[k]}`)
    .join(' · ')
}
