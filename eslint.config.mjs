import { createConfigForNuxt } from '@nuxt/eslint-config/flat'

// A baseline, not a style guide: the rules that catch a real mistake are on,
// the ones that would only reformat 1,700 existing lines are off. Tighten
// one at a time, with the fix in the same PR, rather than all at once.
//
// `npm run lint` is part of `preflight`, so it runs before every push and in
// CI's typecheck job. The mobile app (mobile/) is its own Nuxt project with
// its own auto-imports and is not linted from here.
export default createConfigForNuxt({
  features: { stylistic: false },
})
  .append({
    ignores: ['dist/**', '.output/**', '.netlify/**', '.nuxt/**', 'mobile/**', 'cypress/screenshots/**', 'cypress/videos/**', 'cypress/downloads/**', 'android/**', 'ios/**', 'public/**'],
  })
  .append({
    rules: {
      // 1,179 of them today. Supabase's generated types and Nuxt's untyped
      // $fetch leave `any` all over the data layer; removing them is a
      // typing project, not a lint fix.
      '@typescript-eslint/no-explicit-any': 'off',
      // `a && b()` and `expect(x).to.be.true` style, 85 places, none a bug.
      '@typescript-eslint/no-unused-expressions': 'off',
      // `delete obj[key]` on plain records; six places, all intentional.
      '@typescript-eslint/no-dynamic-delete': 'off',
      // Formatting. Vue 3 allows several root nodes; attribute order,
      // self-closing tags and line breaks are a prettier question.
      'vue/html-self-closing': 'off',
      'vue/attributes-order': 'off',
      'vue/first-attribute-linebreak': 'off',
      'vue/no-multiple-template-root': 'off',
      'vue/require-default-prop': 'off',
      'vue/no-template-shadow': 'off',
      // `let x: T | null = null` before a try/catch that assigns it and
      // rethrows on failure: the initialiser is "unused", and also the only
      // thing TypeScript accepts. Nine places, the same shape.
      'no-useless-assignment': 'off',
      // Fires on `field.value as string | null` in a template: the `|` of a
      // TypeScript union, not a Vue 2 filter.
      'vue/no-deprecated-filter': 'off',
      // Fires on a component prop that happens to be called `slot`
      // (BookingSummary's time slot), not on Vue 2's slot attribute.
      'vue/no-deprecated-slot-attribute': 'off',
      // `v-for="g in [expr]" :key="..."` is the calendar's way of aliasing an
      // expression in a template; the key is unique without the loop
      // variable. vue/require-v-for-key still reports a missing key.
      'vue/valid-v-for': 'off',
      // A prop holding an object of refs (ClinicField's `clinic`) is shared
      // state by design; reassigning the prop itself is still reported.
      'vue/no-mutating-props': ['error', { shallowOnly: true }],
      // Unused locals are worth a warning in the editor, not a failed push:
      // most of the twenty today are leftovers of a refactor.
      '@typescript-eslint/no-unused-vars': ['warn', { argsIgnorePattern: '^_', varsIgnorePattern: '^_', caughtErrors: 'none' }],
    },
  })
