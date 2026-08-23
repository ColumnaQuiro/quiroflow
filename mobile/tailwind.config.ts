import type { Config } from 'tailwindcss'
import rootConfig from '../tailwind.config'

// Same design tokens as the web app (colors, radii, shadows) so shared
// components render identically -- see ../tailwind.config.ts.
export default <Partial<Config>>{
  ...rootConfig,
  content: ['./components/**/*.{vue,js,ts}', './pages/**/*.vue', './app.vue', '../components/**/*.vue'],
}
