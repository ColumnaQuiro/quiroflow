// The colours offered for the calendar: a practitioner's own colour
// (team_members.color) and an appointment type's (appointment_types.color).
//
// Colour on the calendar is data: it tints a practitioner's tab and dot, and
// an appointment block's fill and border, mixed against a surface token so it
// reads in both themes (see components/calendar). These presets are each
// checked as a tint in light and dark.
//
// Next to them, components/calendar/ColorPicker.vue offers a free colour, for
// clinics that want something deeper or louder than the presets. A free
// colour can vanish into one of the two surfaces or read as an alarm, so
// calendarColorWarnings() says so under the picker -- it warns, it does not
// refuse: the clinic knows what it wants on its own calendar.
//
// There is no red among the presets, on purpose: on the calendar red means
// money owed, and a practitioner or a type painted red reads as a debt on
// every block of theirs. The free picker warns about it.
//
// Hex here is stored data, not styling -- it is what goes in the column.
//
// Plain functions, no imports: keep it loadable from anywhere.

export interface PaletteColor {
  hex: string
  en: string
  es: string
}

// The first ten are the original palette, in their original order: new
// appointment types cycle through it from the start, and saved colours point
// at these hexes.
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
  // Deeper and extra hues, added Nov 2026.
  { hex: '#1e40af', en: 'Navy', es: 'Azul marino' },
  { hex: '#06b6d4', en: 'Cyan', es: 'Cian' },
  { hex: '#0f766e', en: 'Petrol', es: 'Petróleo' },
  { hex: '#10b981', en: 'Emerald', es: 'Esmeralda' },
  { hex: '#15803d', en: 'Forest', es: 'Verde bosque' },
  { hex: '#eab308', en: 'Yellow', es: 'Amarillo' },
  { hex: '#92400e', en: 'Brown', es: 'Marrón' },
  { hex: '#ec4899', en: 'Pink', es: 'Rosa' },
  { hex: '#7e22ce', en: 'Purple', es: 'Morado' },
  { hex: '#64748b', en: 'Slate', es: 'Gris' },
]

/** Whether a stored colour is one of the palette's (case-insensitive). */
export function isPaletteColor(hex: string | null | undefined): boolean {
  if (!hex) return false
  const h = hex.toLowerCase()
  return CALENDAR_PALETTE.some((c) => c.hex === h)
}

/** Lower-case #rrggbb from '#RGB' / '#RRGGBB'; null when it is not one. */
export function normalizeCalendarColor(input: string | null | undefined): string | null {
  const raw = (input ?? '').trim().toLowerCase().replace(/^#/, '')
  if (/^[0-9a-f]{3}$/.test(raw)) return `#${raw.split('').map((c) => c + c).join('')}`
  if (/^[0-9a-f]{6}$/.test(raw)) return `#${raw}`
  return null
}

export type CalendarColorWarning = 'red' | 'faint-light' | 'faint-dark'

type Rgb = [number, number, number]
// --color-surface in each theme (assets/css/theme.css).
const LIGHT_SURFACE: Rgb = [255, 255, 255]
const DARK_SURFACE: Rgb = [24, 25, 31]

function luminance([r, g, b]: Rgb): number {
  const lin = (v: number) => {
    const c = v / 255
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4
  }
  return 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b)
}

function contrast(a: Rgb, b: Rgb): number {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x) as [number, number]
  return (hi + 0.05) / (lo + 0.05)
}

/**
 * What is wrong with a colour on the calendar, if anything: it reads as red
 * (money owed), or it is so close to one theme's surface that its dot and
 * border all but disappear there. Every preset returns [].
 */
export function calendarColorWarnings(input: string | null | undefined): CalendarColorWarning[] {
  const hex = normalizeCalendarColor(input)
  if (!hex) return []
  const rgb = [1, 3, 5].map((i) => Number.parseInt(hex.slice(i, i + 2), 16)) as Rgb
  const out: CalendarColorWarning[] = []

  const [r, g, b] = rgb.map((v) => v / 255) as Rgb
  const max = Math.max(r, g, b)
  const min = Math.min(r, g, b)
  const l = (max + min) / 2
  const d = max - min
  const s = d === 0 ? 0 : d / (1 - Math.abs(2 * l - 1))
  let h = 0
  if (d !== 0) {
    if (max === r) h = 60 * (((g - b) / d) % 6)
    else if (max === g) h = 60 * ((b - r) / d + 2)
    else h = 60 * ((r - g) / d + 4)
  }
  if (h < 0) h += 360
  // Pink (~330) and orange (~25) stay out; crimson, scarlet and brick-red in.
  if ((h < 15 || h > 345) && s > 0.45 && l > 0.2 && l < 0.75) out.push('red')

  if (contrast(rgb, LIGHT_SURFACE) < 1.5) out.push('faint-light')
  if (contrast(rgb, DARK_SURFACE) < 1.5) out.push('faint-dark')
  return out
}
