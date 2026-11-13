<script setup lang="ts">
// The bar every full-height screen opens with: the same height, type and back
// chevron everywhere (there were five variants). `back` shows the chevron and
// emits `back`; `backHidden` hides it at a width where the screen sits beside
// its list (the iPad split views). Anything on the right goes in the slot.
//
// It is the screen's back plane (assets/css/main.css): the title in white on
// the indigo, and the sheet's rounded edge at its foot, which the content
// below continues. The slot's buttons are the same components as before; the
// plane re-colours them. `lip="surface"` when the screen's content starts on
// white (a toolbar) rather than on the sheet's tint, `lip="none"` when the
// plane carries on below it (My Day's figures, a calendar's toolbar). `sub`
// is a line under the title, for the screens whose title alone does not say
// whose it is.
withDefaults(defineProps<{ title: string; back?: boolean; backHiddenClass?: string; lip?: 'sheet' | 'surface' | 'none'; sub?: string }>(), { lip: 'sheet', sub: undefined, backHiddenClass: undefined })
const emit = defineEmits<{ back: [] }>()
const t = useT()
</script>

<template>
  <div class="qf-plane shrink-0 px-3 md:px-5" :class="[lip !== 'none' && 'qf-lip', lip === 'surface' && 'qf-lip-surface']">
    <div class="flex min-h-14 items-center gap-2 pt-1">
      <button
        v-if="back"
        type="button"
        class="-ml-1 flex h-11 w-11 shrink-0 items-center justify-center rounded-full text-ink-900 active:bg-surface"
        :class="backHiddenClass"
        :aria-label="t('Back', 'Atrás')"
        data-cy="page-back"
        @click="emit('back')"
      >
        <AppChevron dir="left" :size="24" />
      </button>
      <div class="min-w-0 flex-1" :class="back ? '' : 'pl-1'">
        <h1 class="truncate text-[22px] font-[650] leading-tight tracking-[-0.02em] text-ink-900">{{ title }}</h1>
        <p v-if="sub" class="truncate text-[13.5px] text-ink-muted">{{ sub }}</p>
      </div>
      <slot />
    </div>
  </div>
</template>
