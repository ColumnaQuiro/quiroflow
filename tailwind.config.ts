import type { Config } from 'tailwindcss'

// Design tokens from the "QuiroFlow UI Redesign" Claude Design handoff.
// Every color is a CSS variable (defined in assets/css/theme.css as an RGB
// triplet, light in :root and dark in [data-theme='dark']) rather than a
// literal hex, so useTheme() can flip the whole app's palette by setting one
// attribute on <html> instead of every screen needing its own dark variant.
function themeColor(variable: string) {
  return `rgb(var(${variable}) / <alpha-value>)`
}

export default <Partial<Config>>{
  theme: {
    extend: {
      fontFamily: {
        sans: ['"Instrument Sans"', 'ui-sans-serif', 'system-ui', 'sans-serif'],
        mono: ['"JetBrains Mono"', 'ui-monospace', 'SFMono-Regular', 'monospace'],
      },
      colors: {
        brand: {
          DEFAULT: themeColor('--color-brand'),
          hover: themeColor('--color-brand-hover'),
          text: themeColor('--color-brand-text'),
          text2: themeColor('--color-brand-text2'),
          tint: themeColor('--color-brand-tint'),
          tintBorder: themeColor('--color-brand-tintBorder'),
          tintDeep: themeColor('--color-brand-tintDeep'),
          tintDeepBorder: themeColor('--color-brand-tintDeepBorder'),
        },
        surface: {
          page: themeColor('--color-surface-page'),
          sidebar: themeColor('--color-surface-sidebar'),
          DEFAULT: themeColor('--color-surface'),
          subtle: themeColor('--color-surface-subtle'),
          subtle2: themeColor('--color-surface-subtle2'),
        },
        line: {
          DEFAULT: themeColor('--color-line'),
          control: themeColor('--color-line-control'),
          controlHover: themeColor('--color-line-controlHover'),
          divider: themeColor('--color-line-divider'),
          row: themeColor('--color-line-row'),
          row2: themeColor('--color-line-row2'),
          faint: themeColor('--color-line-faint'),
        },
        ink: {
          900: themeColor('--color-ink-900'),
          800: themeColor('--color-ink-800'),
          700: themeColor('--color-ink-700'),
          600: themeColor('--color-ink-600'),
          550: themeColor('--color-ink-550'),
          500: themeColor('--color-ink-500'),
          450: themeColor('--color-ink-450'),
          muted: themeColor('--color-ink-muted'),
          muted2: themeColor('--color-ink-muted2'),
          faint: themeColor('--color-ink-faint'),
          faint2: themeColor('--color-ink-faint2'),
          faint3: themeColor('--color-ink-faint3'),
        },
        success: {
          text: themeColor('--color-success-text'),
          deep: themeColor('--color-success-deep'),
          accent: themeColor('--color-success-accent'),
          bg: themeColor('--color-success-bg'),
          bg2: themeColor('--color-success-bg2'),
          border: themeColor('--color-success-border'),
          border2: themeColor('--color-success-border2'),
        },
        warning: {
          text: themeColor('--color-warning-text'),
          accent: themeColor('--color-warning-accent'),
          bg: themeColor('--color-warning-bg'),
          bg2: themeColor('--color-warning-bg2'),
          border: themeColor('--color-warning-border'),
        },
        danger: {
          text: themeColor('--color-danger-text'),
          bg: themeColor('--color-danger-bg'),
          bg2: themeColor('--color-danger-bg2'),
          bg3: themeColor('--color-danger-bg3'),
          border: themeColor('--color-danger-border'),
        },
        chip: {
          bg: themeColor('--color-chip-bg'),
          bg2: themeColor('--color-chip-bg2'),
          border: themeColor('--color-chip-border'),
          text: themeColor('--color-chip-text'),
        },
        chart: {
          cancelled: themeColor('--color-chart-cancelled'),
          projected: themeColor('--color-chart-projected'),
        },
        toggle: {
          off: themeColor('--color-toggle-off'),
        },
      },
      borderRadius: {
        card: '11px',
        ctl: '8px',
        ctlSm: '7px',
        pill: '20px',
      },
      boxShadow: {
        card: '0 1px 2px rgba(20,22,30,.04)',
        popover: '0 12px 32px rgba(20,22,30,.14)',
        drawer: '-16px 0 40px rgba(20,22,30,.12)',
        selected: '0 0 0 3px #EEF0FE',
      },
      letterSpacing: {
        tightTitle: '-.012em',
      },
    },
  },
}
