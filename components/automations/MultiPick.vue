<script setup lang="ts">
// A button that says what is chosen and opens a checklist -- the "value" half
// of a filter or condition row that can hold several things (appointment
// types, practitioners, locations, plans, lead stages).

const props = defineProps<{
  modelValue: string[]
  options: { value: string; label: string; muted?: boolean }[]
  placeholder: string
  testId?: string
}>()
const emit = defineEmits<{ 'update:modelValue': [value: string[]] }>()

const open = ref(false)
const root = ref<HTMLElement | null>(null)
const label = computed(() => {
  const chosen = props.options.filter((o) => props.modelValue.includes(o.value)).map((o) => o.label)
  return chosen.length ? chosen.join(', ') : props.placeholder
})
function toggle(value: string) {
  const next = props.modelValue.includes(value) ? props.modelValue.filter((v) => v !== value) : [...props.modelValue, value]
  emit('update:modelValue', next)
}
function onDocClick(e: MouseEvent) {
  if (open.value && root.value && !root.value.contains(e.target as Node)) open.value = false
}
onMounted(() => document.addEventListener('mousedown', onDocClick))
onBeforeUnmount(() => document.removeEventListener('mousedown', onDocClick))
</script>

<template>
  <div ref="root" class="relative min-w-0">
    <button
      type="button"
      class="flex h-9 w-full items-center justify-between gap-1.5 rounded-ctl border border-line-control bg-surface px-2.5 text-left text-[13px] text-ink-900 hover:border-line-controlHover touch:h-11"
      aria-haspopup="listbox"
      :aria-expanded="open"
      :data-test="testId"
      @click="open = !open"
      @keydown.esc="open = false"
    >
      <span class="truncate" :class="modelValue.length ? '' : 'text-ink-muted'">{{ label }}</span>
      <svg width="10" height="10" viewBox="0 0 10 10" fill="none" stroke="currentColor" stroke-width="1.5" class="shrink-0 text-ink-muted" aria-hidden="true"><path d="M2 3.5l3 3 3-3" /></svg>
    </button>
    <div v-if="open" role="listbox" aria-multiselectable="true" class="absolute left-0 right-0 z-20 mt-1 max-h-60 min-w-[200px] overflow-y-auto rounded-ctl border border-line bg-surface p-1 shadow-popover">
      <label
        v-for="o in options"
        :key="o.value"
        class="flex cursor-pointer items-center gap-2 rounded-ctlSm px-2 py-1.5 text-[13px] text-ink-700 hover:bg-surface-subtle touch:min-h-11"
      >
        <input type="checkbox" class="h-4 w-4 accent-brand" :checked="modelValue.includes(o.value)" @change="toggle(o.value)" />
        <span :class="o.muted ? 'text-ink-muted' : ''">{{ o.label }}</span>
      </label>
      <p v-if="options.length === 0" class="px-2 py-1.5 text-[12px] text-ink-muted">—</p>
    </div>
  </div>
</template>
