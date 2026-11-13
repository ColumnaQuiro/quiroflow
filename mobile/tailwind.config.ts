import type { Config } from 'tailwindcss'
import { tokens, touchVariant } from '../tailwind.tokens'

// Same design tokens as the web app (colors, radii, shadows) so shared
// components render identically -- see ../tailwind.tokens.ts.
//
// The TOKENS, deliberately, not ../tailwind.config: that file imports
// 'tailwindcss/plugin', which Node resolves from the repo root, and Xcode
// Cloud installs mobile/ only. Spreading it broke every cloud build the day
// the root config gained a plugin.
//
// The app's own shapes on top of them (the three-planes look, see
// assets/css/main.css): rounder corners and cards that lift with a soft
// shadow instead of sitting flat on a hairline. Only the app compiles this
// config, so the shared components change shape here and nowhere else.
const extend = tokens.theme.extend
export default <Partial<Config>>{
  ...tokens,
  theme: {
    ...tokens.theme,
    extend: {
      ...extend,
      borderRadius: {
        ...extend.borderRadius,
        card: '20px',
        ctl: '14px',
        ctlSm: '11px',
        pill: '999px',
      },
      boxShadow: {
        ...extend.boxShadow,
        card: '0 1px 2px rgba(20,21,43,.04), 0 6px 18px rgba(20,21,43,.05)',
        popover: '0 16px 40px rgba(20,21,43,.18)',
        float: '0 12px 32px rgba(20,21,43,.18), 0 0 0 1px rgba(20,21,43,.05)',
      },
    },
  },
  content: ['./components/**/*.{vue,js,ts}', './pages/**/*.vue', './layouts/**/*.vue', './app.vue', '../components/**/*.vue'],
  // The shared components size controls with touch:h-11; without the variant
  // they would be 36px on a phone.
  plugins: [touchVariant],
}
