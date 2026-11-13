// The back plane in a clinic's own colour (assets/css/main.css, "three
// planes"). A patient whose clinic set a colour in Settings > Brand sees the
// plane as a deep shade of it rather than QuiroFlow's indigo.
//
// The plane carries white text, so the shade is walked towards near-black
// until white reaches 7:1 on it whatever the clinic picked -- a pale yellow
// becomes a deep olive rather than an unreadable header. The raised steps
// (buttons and chips on the plane) are the plane mixed with white, the way
// the indigo's own steps are.
//
// Plain functions, no imports, so the unit tests can load this file.

type Rgb = [number, number, number]

export interface PlaneShades {
  plane: Rgb
  raised: Rgb
  raised2: Rgb
  line: Rgb
  muted: Rgb
}

const WHITE: Rgb = [255, 255, 255]
// The deep end a plane is pulled towards: a blue-black, not a pure black, so
// a shade keeps some of its hue on the way down.
const DEEP: Rgb = [10, 9, 26]

function parse(hex: string): Rgb | null {
  const raw = hex.trim().toLowerCase().replace(/^#/, '')
  const full = /^[0-9a-f]{3}$/.test(raw) ? raw.split('').map((c) => c + c).join('') : raw
  if (!/^[0-9a-f]{6}$/.test(full)) return null
  return [0, 2, 4].map((i) => Number.parseInt(full.slice(i, i + 2), 16)) as Rgb
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

export function planeContrast(a: Rgb, b: Rgb): number {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x) as [number, number]
  return (hi + 0.05) / (lo + 0.05)
}

function shadesFrom(plane: Rgb, raisedBy: number): PlaneShades {
  return {
    plane,
    raised: mix(plane, WHITE, raisedBy),
    raised2: mix(plane, WHITE, raisedBy + 0.06),
    line: mix(plane, WHITE, raisedBy + 0.13),
    muted: mix(plane, WHITE, 0.74),
  }
}

/** The plane's shades for each theme, or null when the colour is not one. */
export function planePalette(color: string | null | undefined): { light: PlaneShades; dark: PlaneShades } | null {
  const brand = color ? parse(color) : null
  if (!brand) return null
  // Start a little below the brand itself, then walk down until white text
  // reads at 7:1. Stepping in 4% increments always ends: DEEP passes.
  let amount = 0.45
  let plane = mix(brand, DEEP, amount)
  while (planeContrast(plane, WHITE) < 7 && amount < 1) {
    amount = Math.min(1, amount + 0.04)
    plane = mix(brand, DEEP, amount)
  }
  // Dark theme: the same shade, a good deal deeper, so the plane still reads
  // as the back of the screen against the dark sheet.
  const darkPlane = mix(plane, DEEP, 0.55)
  return { light: shadesFrom(plane, 0.12), dark: shadesFrom(darkPlane, 0.1) }
}

function declarations(s: PlaneShades): string {
  return `--plane: ${s.plane.join(' ')}; --plane-raised: ${s.raised.join(' ')}; --plane-raised2: ${s.raised2.join(' ')}; --plane-line: ${s.line.join(' ')}; --plane-muted: ${s.muted.join(' ')};`
}

/** The stylesheet that puts the clinic's plane in place of the indigo one; empty for no colour. */
export function planeCss(color: string | null | undefined): string {
  const p = planePalette(color)
  if (!p) return ''
  return `:root:root { ${declarations(p.light)} }\n:root[data-theme='dark'] { ${declarations(p.dark)} }`
}
