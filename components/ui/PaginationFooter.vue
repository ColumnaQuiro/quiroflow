<script setup lang="ts">
// Shared visual shell for every paginated table's footer -- patients and
// recalls independently grew their own Previous/Next bar (recalls later
// added numbered page buttons, patients never did), so the two looked and
// behaved differently even though both are "a table with pages." Each
// caller still computes its own `visiblePages` and `hasNext`/`hasPrev`
// (patients has an exact total; recalls only knows "is there a next page"
// -- see its own comments on why), this component only owns how that
// state renders.
defineProps<{
  page: number
  visiblePages: number[]
  hasPrev: boolean
  hasNext: boolean
  summary: string
}>()
const emit = defineEmits<{ goToPage: [page: number] }>()
const t = useT()
</script>

<template>
  <div class="flex items-center justify-between bg-surface-subtle2 px-5 py-2.5 text-[12.5px] text-ink-muted2">
    <span>{{ summary }}</span>
    <div class="flex items-center gap-1">
      <button
        type="button"
        :disabled="!hasPrev"
        class="flex h-7 items-center rounded-ctlSm border border-line-control bg-surface px-2.5 text-[12.5px] text-ink-500 hover:border-line-controlHover disabled:cursor-not-allowed disabled:opacity-40"
        @click="emit('goToPage', page - 1)"
      >
        {{ t('Previous', 'Anterior') }}
      </button>
      <button
        v-for="p in visiblePages"
        :key="p"
        type="button"
        class="flex h-7 w-7 items-center justify-center rounded-ctlSm border text-[12.5px]"
        :class="p === page ? 'border-brand-tintBorder bg-brand-tint font-semibold text-brand-text' : 'border-line-control bg-surface text-ink-500 hover:border-line-controlHover'"
        @click="emit('goToPage', p)"
      >
        {{ p }}
      </button>
      <button
        type="button"
        :disabled="!hasNext"
        class="flex h-7 items-center rounded-ctlSm border border-line-control bg-surface px-2.5 text-[12.5px] text-ink-500 hover:border-line-controlHover disabled:cursor-not-allowed disabled:opacity-40"
        @click="emit('goToPage', page + 1)"
      >
        {{ t('Next', 'Siguiente') }}
      </button>
    </div>
  </div>
</template>
