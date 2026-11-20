// The order a patient's bonos are listed in: the ones still in use first --
// open, with sessions left -- then the rest, each group newest first. Their
// own and those shared with them (a family bono) are one list: a shared bono
// they are using used to sit at the very end, below every bono of their own
// they had already finished.
export interface OrderableBono {
  is_closed: boolean
  sessions_total: number
  sessions_used: number
  purchased_at?: string | null
}

export function bonoInUse(b: OrderableBono): boolean {
  return !b.is_closed && b.sessions_total - b.sessions_used > 0
}

export function sortBonos<T extends OrderableBono>(list: T[]): T[] {
  return [...list].sort((a, b) => Number(bonoInUse(b)) - Number(bonoInUse(a)) || (b.purchased_at ?? '').localeCompare(a.purchased_at ?? ''))
}

// What the visit checkout opens selected, given the bonos the patient can draw
// from (their own and any shared with them, already sortBonos-ordered).
//
// One bono: that one -- the patient has already paid for this visit, so the
// bono is the obvious answer. None: money. Two or more: NOTHING, on purpose.
// Which bono pays for the visit is the front desk's call (their own bono, or
// the family one shared with them), and a preselected one is a choice made for
// them: one tap on "Process" drew from whichever happened to sort first.
// An empty choice keeps Process waiting until someone picks.
export function checkoutDefaultChoice(packages: { id: string }[]): string {
  if (packages.length === 0) return 'money'
  if (packages.length === 1) return packages[0].id
  return ''
}
