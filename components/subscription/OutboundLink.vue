<script setup lang="ts">
// Everything that edits billing leaves the app for Stripe's hosted portal, so
// every one of those actions is drawn as leaving: the arrow is part of the
// control, and the accessible name says where it goes. A link that silently
// swapped the page for Stripe's would be the same click with none of the
// warning.
//
// 44px tall below lg. Every use of this is a standalone action rather than a
// link inside a sentence, so the tap target matters more than the tight line
// box -- these were 39px and 20px on a phone before.
withDefaults(defineProps<{ href?: string; as?: 'a' | 'button'; tone?: 'brand' | 'danger' }>(), {
  href: undefined,
  as: 'a',
  tone: 'brand',
})

const t = useT()
const TONE = { brand: 'text-brand-text hover:text-brand-hover', danger: 'text-danger-text hover:text-danger-text' }
</script>

<template>
  <component
    :is="as"
    v-bind="as === 'a' ? { href, target: '_blank', rel: 'noopener noreferrer' } : { type: 'button' }"
    class="inline-flex min-h-[44px] items-center gap-1 text-[13px] font-semibold outline-none focus-visible:underline lg:min-h-0"
    :class="TONE[tone]"
  >
    <span><slot /></span>
    <span class="sr-only">{{ t('(opens Stripe in a new tab)', '(abre Stripe en una pestaña nueva)') }}</span>
    <svg viewBox="0 0 16 16" fill="none" aria-hidden="true" class="h-3 w-3 shrink-0">
      <path d="M6 3.4h6.6V10" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" />
      <path d="M12.6 3.4L4.2 11.8" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" />
    </svg>
  </component>
</template>
