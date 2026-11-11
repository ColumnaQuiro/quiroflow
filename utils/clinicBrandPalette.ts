// A clinic's one colour, turned into every brand shade the app draws with.
//
// The app's colours are CSS variables (assets/css/theme.css): eight brand
// shades for the light theme, eight more for the dark one, and the colour of
// text on a brand fill. A clinic picks ONE colour in Settings > Brand; this
// derives the rest, the same way the QuiroFlow indigo relates to its own
// shades, and moves each one until what is drawn with it can be read:
//
//   - text in the brand colour reaches 4.5:1 on the tint it sits on;
//   - text on a brand fill is white or near-black, whichever reads better,
//     so a pale yellow gets dark text instead of being darkened into mustard;
//   - the dark theme gets a lightened version, since a deep navy on a
//     near-black page is invisible.
//
// So no colour a clinic can choose makes the app unreadable, and nobody has
// to pick sixteen shades.
//
// Plain functions, no imports: the mobile build, the settings preview and the
// unit tests all load this file.

type Rgb = [number, number, number]

export interface ClinicBrandShades {
  brand: Rgb
  hover: Rgb
  text: Rgb
  text2: Rgb
  tint: Rgb
  tintBorder: Rgb
  tintDeep: Rgb
  tintDeepBorder: Rgb
  on: Rgb
}

export interface ClinicBrandPalette {
  light: ClinicBrandShades
  dark: ClinicBrandShades
}

const WHITE: Rgb = [255, 255, 255]
const BLACK: Rgb = [0, 0, 0]
// The same near-black the dark palette uses for text on its fills.
const INK: Rgb = [15, 16, 20]
// --color-surface in each theme: what tints are mixed into.
const LIGHT_SURFACE: Rgb = [255, 255, 255]
const DARK_SURFACE: Rgb = [24, 25, 31]

/** Lower-case #rrggbb, from '#RGB', 'rrggbb' and friends; null when it is not a colour. */
export function normalizeBrandColor(input: string | null | undefined): string | null {
  const raw = (input ?? '').trim().toLowerCase().replace(/^#/, '')
  if (/^[0-9a-f]{3}$/.test(raw)) return `#${raw.split('').map((c) => c + c).join('')}`
  if (/^[0-9a-f]{6}$/.test(raw)) return `#${raw}`
  return null
}

function parse(hex: string): Rgb {
  return [1, 3, 5].map((i) => Number.parseInt(hex.slice(i, i + 2), 16)) as Rgb
}

function mix(a: Rgb, b: Rgb, amount: number): Rgb {
  return a.map((v, i) => Math.round(v + (b[i]! - v) * amount)) as Rgb
}

function luminance(rgb: Rgb): number {
  const [r, g, b] = rgb.map((v) => {
    const c = v / 255
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4
  }) as Rgb
  return 0.2126 * r + 0.7152 * g + 0.0722 * b
}

/** WCAG contrast ratio between two colours, 1 to 21. */
export function brandContrast(a: Rgb, b: Rgb): number {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x) as [number, number]
  return (hi + 0.05) / (lo + 0.05)
}

// Walks `from` towards `to` in small steps until `passes`, and stops at `to`
// if it never does (black on white always passes, so it always ends).
function towards(from: Rgb, to: Rgb, start: number, passes: (c: Rgb) => boolean): Rgb {
  for (let amount = start; amount < 1; amount += 0.04) {
    const c = mix(from, to, amount)
    if (passes(c)) return c
  }
  return to
}

function onFill(fill: Rgb): Rgb {
  return brandContrast(fill, WHITE) >= brandContrast(fill, INK) ? WHITE : INK
}

/** Every shade for both themes, or null when the colour is not one. */
export function clinicBrandPalette(color: string | null | undefined): ClinicBrandPalette | null {
  const hex = normalizeBrandColor(color)
  if (!hex) return null
  const chosen = parse(hex)

  // Light. The fill is the clinic's colour as chosen, unless it is so close
  // to white that a button drawn with it would have no edge.
  const brand = towards(chosen, BLACK, 0, (c) => brandContrast(c, LIGHT_SURFACE) >= 1.6)
  const on = onFill(brand)
  const tint = mix(LIGHT_SURFACE, brand, 0.09)
  const light: ClinicBrandShades = {
    brand,
    hover: mix(brand, BLACK, 0.12),
    text: towards(brand, BLACK, 0.12, (c) => brandContrast(c, tint) >= 4.5),
    text2: towards(brand, BLACK, 0.08, (c) => brandContrast(c, LIGHT_SURFACE) >= 4.5),
    tint,
    tintBorder: mix(LIGHT_SURFACE, brand, 0.2),
    tintDeep: mix(LIGHT_SURFACE, brand, 0.07),
    tintDeepBorder: mix(LIGHT_SURFACE, brand, 0.18),
    on,
  }

  // Dark. Lightened until it stands off the dark surface the way the dark
  // indigo does (about 5.5:1), and tints are the surface with some of it in.
  const darkBrand = towards(chosen, WHITE, 0, (c) => brandContrast(c, DARK_SURFACE) >= 5.5)
  const darkTint = mix(DARK_SURFACE, darkBrand, 0.17)
  const darkTintDeep = mix(DARK_SURFACE, darkBrand, 0.23)
  const dark: ClinicBrandShades = {
    brand: darkBrand,
    hover: mix(darkBrand, WHITE, 0.25),
    // On the deeper tint, which is the lighter (harder) of the two it sits on.
    text: towards(darkBrand, WHITE, 0.2, (c) => brandContrast(c, darkTintDeep) >= 4.5),
    text2: towards(darkBrand, WHITE, 0.32, (c) => brandContrast(c, darkTintDeep) >= 4.5),
    tint: darkTint,
    tintBorder: mix(DARK_SURFACE, darkBrand, 0.37),
    tintDeep: darkTintDeep,
    tintDeepBorder: mix(DARK_SURFACE, darkBrand, 0.43),
    on: onFill(darkBrand),
  }

  return { light, dark }
}

const VARIABLES: Record<keyof ClinicBrandShades, string> = {
  brand: '--color-brand',
  hover: '--color-brand-hover',
  text: '--color-brand-text',
  text2: '--color-brand-text2',
  tint: '--color-brand-tint',
  tintBorder: '--color-brand-tintBorder',
  tintDeep: '--color-brand-tintDeep',
  tintDeepBorder: '--color-brand-tintDeepBorder',
  on: '--color-brand-on',
}

/** One theme's shades as CSS declarations: `--color-brand: 1 2 3; …`. */
export function clinicBrandDeclarations(shades: ClinicBrandShades): string {
  return (Object.keys(VARIABLES) as (keyof ClinicBrandShades)[]).map((key) => `${VARIABLES[key]}: ${shades[key].join(' ')};`).join(' ')
}

/**
 * The stylesheet that puts a clinic's colour in place of QuiroFlow's across
 * the whole document, for both themes. The doubled selector outranks
 * theme.css's own `:root` and `[data-theme='dark']` wherever this is inserted.
 *
 * Empty when the colour is not one, so a bad value falls back to QuiroFlow's.
 */
export function clinicBrandCss(color: string | null | undefined): string {
  const palette = clinicBrandPalette(color)
  if (!palette) return ''
  return `:root:root { ${clinicBrandDeclarations(palette.light)} }\n:root[data-theme='dark'] { ${clinicBrandDeclarations(palette.dark)} }`
}

/** A few starting points for the picker. Any colour can be typed instead. */
export const CLINIC_BRAND_PRESETS: readonly string[] = ['#4f46e5', '#0f766e', '#15803d', '#0369a1', '#b45309', '#be123c', '#7e22ce', '#334155']
