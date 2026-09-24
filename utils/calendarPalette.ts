// The colours a team member can pick for themselves on the calendar.
//
// Colour on the calendar is data: team_members.color tints a practitioner's
// tab and dot, mixed against a surface token so it reads in both themes (see
// components/calendar). A free <input type="color"> let anyone choose a
// colour that vanished into the dark surface or read as an alarm, so /account
// offers these ten instead, each checked as a tint in light and dark.
//
// There is no red, on purpose: on the calendar red means money owed, and a
// practitioner painted red would read as a debt on every block of theirs.
//
// Hex here is stored data, not styling -- it is what goes in the column, the
// same way appointment_types.color does.

export interface PaletteColor {
  hex: string
  en: string
  es: string
}

export const CALENDAR_PALETTE: PaletteColor[] = [
  { hex: '#6366f1', en: 'Indigo', es: 'Índigo' },
  { hex: '#3b82f6', en: 'Blue', es: 'Azul' },
  { hex: '#0ea5e9', en: 'Sky', es: 'Celeste' },
  { hex: '#14b8a6', en: 'Teal', es: 'Turquesa' },
  { hex: '#22c55e', en: 'Green', es: 'Verde' },
  { hex: '#84cc16', en: 'Lime', es: 'Lima' },
  { hex: '#f59e0b', en: 'Amber', es: 'Ámbar' },
  { hex: '#f97316', en: 'Orange', es: 'Naranja' },
  { hex: '#d946ef', en: 'Fuchsia', es: 'Fucsia' },
  { hex: '#8b5cf6', en: 'Violet', es: 'Violeta' },
]

/** Whether a stored colour is one of the palette's (case-insensitive). */
export function isPaletteColor(hex: string | null | undefined): boolean {
  if (!hex) return false
  const h = hex.toLowerCase()
  return CALENDAR_PALETTE.some((c) => c.hex === h)
}
