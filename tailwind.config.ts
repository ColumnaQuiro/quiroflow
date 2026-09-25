import type { Config } from 'tailwindcss'
import { tokens, touchVariant } from './tailwind.tokens'

// The tokens and the `touch:` variant live in tailwind.tokens.ts so mobile/
// can share them without a plugin import -- see the comments there.
export default <Partial<Config>>{
  ...tokens,
  plugins: [touchVariant],
}
