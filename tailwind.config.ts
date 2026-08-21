import type { Config } from 'tailwindcss'

// Design tokens from the "QuiroFlow UI Redesign" Claude Design handoff.
// Values are the literal hex/px specs from that handoff, mapped onto named
// Tailwind theme keys so every screen pulls from the same palette instead of
// re-deriving close-enough grays ad hoc.
export default <Partial<Config>>{
  theme: {
    extend: {
      fontFamily: {
        sans: ['"Instrument Sans"', 'ui-sans-serif', 'system-ui', 'sans-serif'],
        mono: ['"JetBrains Mono"', 'ui-monospace', 'SFMono-Regular', 'monospace'],
      },
      colors: {
        brand: {
          DEFAULT: '#4F46E5',
          hover: '#4339CE',
          text: '#3B32C9',
          text2: '#4338CA',
          tint: '#EEF0FE',
          tintBorder: '#D8DCFB',
          tintDeep: '#F2F3FE',
          tintDeepBorder: '#DEE1FC',
        },
        surface: {
          page: '#F7F8FA',
          sidebar: '#FBFBFC',
          DEFAULT: '#FFFFFF',
          subtle: '#FAFAFB',
          subtle2: '#FCFCFD',
        },
        line: {
          DEFAULT: '#E8E9ED',
          control: '#E1E3EA',
          controlHover: '#CFD2DC',
          divider: '#F0F1F4',
          row: '#F1F2F5',
          row2: '#F3F4F7',
          faint: '#F5F6F8',
        },
        ink: {
          900: '#15171E',
          800: '#1B1E28',
          700: '#22252F',
          600: '#2B3040',
          550: '#31364A',
          500: '#3A3F52',
          450: '#4A4F60',
          muted: '#6B7180',
          muted2: '#8A8FA0',
          faint: '#9BA0B0',
          faint2: '#A2A7B6',
          faint3: '#B6BAC6',
        },
        success: {
          text: '#157F52',
          deep: '#136B47',
          accent: '#1D8A5B',
          bg: '#E9F6EF',
          bg2: '#F0F9F4',
          border: '#CBE9DA',
          border2: '#D7EEE2',
        },
        warning: {
          text: '#96591A',
          accent: '#B45309',
          bg: '#FEF6E7',
          bg2: '#FEF9EF',
          border: '#F2E3C9',
        },
        danger: {
          text: '#B4233C',
          bg: '#FDF0F2',
          bg2: '#FEF4F5',
          bg3: '#FFF8F8',
          border: '#F4DADE',
        },
        chip: {
          bg: '#F1F2F5',
          bg2: '#F4F5F8',
          border: '#E4E5EB',
          text: '#6B7180',
        },
        chart: {
          cancelled: '#F6C7CE',
          projected: '#C7CBFA',
        },
        toggle: {
          off: '#D8DAE2',
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
