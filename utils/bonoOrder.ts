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
