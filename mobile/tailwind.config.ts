import type { Config } from 'tailwindcss'
import { tokens, touchVariant } from '../tailwind.tokens'

// Same design tokens as the web app (colors, radii, shadows) so shared
// components render identically -- see ../tailwind.tokens.ts.
//
// The TOKENS, deliberately, not ../tailwind.config: that file imports
// 'tailwindcss/plugin', which Node resolves from the repo root, and Xcode
// Cloud installs mobile/ only. Spreading it broke every cloud build the day
// the root config gained a plugin.
export default <Partial<Config>>{
  ...tokens,
  content: ['./components/**/*.{vue,js,ts}', './pages/**/*.vue', './app.vue', '../components/**/*.vue'],
  // The shared components size controls with touch:h-11; without the variant
  // they would be 36px on a phone.
  plugins: [touchVariant],
}
