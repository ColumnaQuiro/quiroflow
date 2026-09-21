<script setup lang="ts">
// Flags for the country picker, drawn inline.
//
// The emoji flags utils/countries.ts derives are unusable here: Windows ships
// no flag glyphs at all (Chrome on Windows renders "ES", not a Spanish flag),
// and where they do render they follow the system font rather than the design.
//
// This file is the ONE place in the onboarding flow allowed literal hexes --
// #C60B1E is Spain's red in both themes, the same way pages/inbox.vue paints
// WhatsApp's own green. check-theme-tokens.mjs skips it by name for that
// reason; nothing else here may do the same.
//
// Only the countries the design draws are drawn. The list is ~100 long, and a
// hand-guessed flag for the rest would be worse than none -- a wrong flag
// against a real dial code is a mistake a clinic would spot and we would not.
// Everything else gets a neutral tile carrying the country's two letters,
// which is honest about what it knows.
defineProps<{ code: string; width?: number }>()

const DRAWN = ['ES', 'PT', 'FR', 'IT', 'DE', 'GB']
</script>

<template>
  <span
    class="block shrink-0 overflow-hidden rounded-[3px]"
    :style="{ width: `${width ?? 20}px`, height: `${Math.round((width ?? 20) * 0.7)}px`, boxShadow: 'inset 0 0 0 1px rgb(var(--color-ink-900) / 0.12)' }"
  >
    <svg v-if="DRAWN.includes(code)" viewBox="0 0 20 14" preserveAspectRatio="none" aria-hidden="true" class="h-full w-full">
      <template v-if="code === 'ES'">
        <rect width="20" height="14" fill="#C60B1E" />
        <rect y="3.5" width="20" height="7" fill="#F1BF00" />
      </template>
      <template v-else-if="code === 'PT'">
        <rect width="20" height="14" fill="#DA291C" />
        <rect width="8" height="14" fill="#046A38" />
        <circle cx="8" cy="7" r="2.6" fill="#F1BF00" />
      </template>
      <template v-else-if="code === 'FR'">
        <rect width="20" height="14" fill="#FFFFFF" />
        <rect width="6.7" height="14" fill="#002395" />
        <rect x="13.3" width="6.7" height="14" fill="#ED2939" />
      </template>
      <template v-else-if="code === 'IT'">
        <rect width="20" height="14" fill="#FFFFFF" />
        <rect width="6.7" height="14" fill="#008C45" />
        <rect x="13.3" width="6.7" height="14" fill="#CD212A" />
      </template>
      <template v-else-if="code === 'DE'">
        <rect width="20" height="14" fill="#FFCE00" />
        <rect width="20" height="9.33" fill="#DD0000" />
        <rect width="20" height="4.67" fill="#000000" />
      </template>
      <template v-else-if="code === 'GB'">
        <rect width="20" height="14" fill="#012169" />
        <path d="M0 0L20 14M20 0L0 14" stroke="#FFFFFF" stroke-width="3" />
        <path d="M0 0L20 14M20 0L0 14" stroke="#C8102E" stroke-width="1.6" />
        <path d="M10 0V14M0 7H20" stroke="#FFFFFF" stroke-width="4.6" />
        <path d="M10 0V14M0 7H20" stroke="#C8102E" stroke-width="2.6" />
      </template>
    </svg>
    <span
      v-else
      aria-hidden="true"
      class="flex h-full w-full items-center justify-center bg-chip-bg font-semibold text-ink-muted"
      :style="{ fontSize: `${Math.round((width ?? 20) * 0.45)}px` }"
    >{{ code }}</span>
  </span>
</template>
