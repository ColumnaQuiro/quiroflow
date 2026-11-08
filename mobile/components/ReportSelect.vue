<script setup lang="ts">
// One filter of a report as a chip, opening the phone's own picker (a wheel
// on iOS, a list on Android): a native <select> laid invisibly over the chip,
// so it is as easy to hit as the chip and needs no sheet of its own.
// '' is "everything" and is labelled `allLabel`.
const props = defineProps<{ options: { id: string; name: string }[]; allLabel?: string; label: string }>()
const model = defineModel<string>({ default: '' })
const current = computed(() => props.options.find((o) => o.id === model.value)?.name ?? props.allLabel ?? '')
</script>

<template>
  <label
    class="relative flex h-9 shrink-0 items-center gap-1 rounded-full border pl-3 pr-2.5 text-[13px] font-semibold"
    :class="model ? 'border-brand-tintBorder bg-brand-tint text-brand-text' : 'border-line-control bg-surface text-ink-700'"
  >
    <span class="max-w-[11rem] truncate whitespace-nowrap">{{ current }}</span>
    <AppChevron dir="down" :size="14" class="opacity-70" />
    <select v-model="model" :aria-label="label" class="absolute inset-0 h-full w-full cursor-pointer opacity-0">
      <option v-if="allLabel !== undefined" value="">{{ allLabel }}</option>
      <option v-for="o in options" :key="o.id" :value="o.id">{{ o.name }}</option>
    </select>
  </label>
</template>
