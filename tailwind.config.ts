import type { Config } from 'tailwindcss'
import plugin from 'tailwindcss/plugin'
import { tokens } from './tailwind.tokens'

// The tokens live in tailwind.tokens.ts so mobile/ can share them without
// loading the plugin import below -- see the comment there.
export default <Partial<Config>>{
  ...tokens,
  plugins: [
    // `touch:` -- sizes for a finger rather than a mouse. The front desk runs
    // on an iPad, where every control needs 44px, but a desktop sidebar at
    // 44px a row no longer fits on the screen; (pointer: coarse) gives each
    // its own.
    plugin(({ addVariant }) => {
      addVariant('touch', '@media (pointer: coarse)')
    }),
  ],
}
