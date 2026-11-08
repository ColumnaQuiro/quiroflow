// Chart.js's pieces, registered once, by whatever draws a chart: import this
// file for its side effect next to `vue-chartjs`.
//
// It was a global plugin (plugins/chartjs.client.ts), which put chart.js --
// 172 KB, the largest single library in the bundle -- into the entry chunk
// every page loads, the sign-in screen and the Inbox included, though only
// the reports and the dashboard's report blocks draw a chart. Imported from
// those, it arrives with them.
import { Chart as ChartJS, CategoryScale, LinearScale, BarElement, LineElement, PointElement, ArcElement, Title, Tooltip, Legend } from 'chart.js'

// Charts follow the theme.
//
// A canvas cannot read a CSS variable, so every chart drew in Chart.js's own
// defaults: #666 axis labels and rgba(0,0,0,.1) gridlines, picked for a white
// page. In dark mode the labels sat at about 3:1 on the card and the
// gridlines disappeared, while the bars kept the light theme's indigo hex
// rather than the lifted one the rest of the app uses there.
//
// So the defaults are read from the theme variables, and read again whenever
// useTheme() flips data-theme on <html>, with every chart on screen redrawn.
// Series colours go through chartColor(), which hands Chart.js a scriptable
// option: resolved at draw time, so a redraw is all a theme change needs.

/** `rgb()` for a theme token from assets/css/theme.css, e.g. 'brand' or 'ink-muted'. */
export function readThemeColor(token: string, alpha = 1): string {
  if (typeof document === 'undefined') return 'transparent'
  const triplet = getComputedStyle(document.documentElement).getPropertyValue(`--color-${token}`).trim()
  if (!triplet) return 'transparent'
  return alpha === 1 ? `rgb(${triplet})` : `rgb(${triplet} / ${alpha})`
}

/** A theme colour as a Chart.js scriptable option, for a dataset's colours. */
export const chartColor = (token: string, alpha = 1) => () => readThemeColor(token, alpha)

// Axis colours are scriptable rather than plain strings, and set BEFORE
// register(): registering a scale copies the scale defaults into its own, and
// each chart copies them again when it is built, so a string assigned to
// defaults.borderColor later never reached a chart already on screen (its
// gridlines stayed the dark theme's after switching to light). A function
// is copied as a function and called on every draw.
ChartJS.defaults.scale.grid.color = chartColor('line-divider')
// The axis line too: drawBorder() resolves it through setContext(), so a
// function is called like any scriptable, though the type says Color.
;(ChartJS.defaults.scale as unknown as { border: { color: unknown } }).border.color = chartColor('line')
ChartJS.defaults.scale.ticks.color = chartColor('ink-muted')

ChartJS.register(CategoryScale, LinearScale, BarElement, LineElement, PointElement, ArcElement, Title, Tooltip, Legend)

// The rest (legend labels, titles) reads defaults.color as a string, which a
// chart re-reads on update.
function applyTheme() {
  ChartJS.defaults.color = readThemeColor('ink-muted')
  for (const chart of Object.values(ChartJS.instances)) chart.update('none')
}

if (typeof document !== 'undefined') {
  ChartJS.defaults.font.family = "'Instrument Sans', 'Instrument Sans Fallback', ui-sans-serif, system-ui, sans-serif"
  ChartJS.defaults.font.size = 11
  applyTheme()
  new MutationObserver(applyTheme).observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] })
}
