<script setup lang="ts">
// The bar every full-height screen opens with: the same height, type and back
// chevron everywhere (there were five variants). `back` shows the chevron and
// emits `back`; `backHidden` hides it at a width where the screen sits beside
// its list (the iPad split views). Anything on the right goes in the slot.
defineProps<{ title: string; back?: boolean; backHiddenClass?: string }>()
const emit = defineEmits<{ back: [] }>()
const t = useT()
</script>

<template>
  <div class="flex h-14 shrink-0 items-center gap-2 border-b border-line bg-surface px-3 md:px-5">
    <button
      v-if="back"
      type="button"
      class="-ml-1 flex h-11 w-11 shrink-0 items-center justify-center text-brand-text"
      :class="backHiddenClass"
      :aria-label="t('Back', 'Atrás')"
      data-cy="page-back"
      @click="emit('back')"
    >
      <AppChevron dir="left" :size="24" />
    </button>
    <h1 class="min-w-0 flex-1 truncate text-[17px] font-semibold text-ink-900" :class="back ? '' : 'pl-1'">{{ title }}</h1>
    <slot />
  </div>
</template>
