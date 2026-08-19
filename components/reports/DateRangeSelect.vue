<script setup lang="ts">
import { computePresetRange, STANDARD_PRESETS, type DateRange, type DateRangePreset } from '~/composables/useDateRangePresets'

const props = withDefaults(defineProps<{ modelValue: DateRange; presets?: DateRangePreset[] }>(), {
  presets: () => STANDARD_PRESETS,
})
const emit = defineEmits<{ 'update:modelValue': [value: DateRange] }>()

const open = ref(false)
const customFrom = ref(props.modelValue.from)
const customTo = ref(props.modelValue.to)
const rootEl = ref<HTMLElement | null>(null)

watch(
  () => props.modelValue,
  (v) => {
    customFrom.value = v.from
    customTo.value = v.to
  },
)

function formatDate(iso: string) {
  return new Date(`${iso}T00:00:00`).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' })
}

const matchedPresetLabel = computed(() => {
  const match = props.presets.find((p) => {
    const r = computePresetRange(p)
    return r.from === props.modelValue.from && r.to === props.modelValue.to
  })
  return match?.label ?? null
})

const buttonLabel = computed(() => matchedPresetLabel.value ?? `${formatDate(props.modelValue.from)} – ${formatDate(props.modelValue.to)}`)

function selectPreset(p: DateRangePreset) {
  emit('update:modelValue', computePresetRange(p))
  open.value = false
}

function applyCustom() {
  if (!customFrom.value || !customTo.value || customFrom.value > customTo.value) return
  emit('update:modelValue', { from: customFrom.value, to: customTo.value })
  open.value = false
}

function onClickOutside(e: MouseEvent) {
  if (rootEl.value && !rootEl.value.contains(e.target as Node)) open.value = false
}
onMounted(() => document.addEventListener('click', onClickOutside))
onUnmounted(() => document.removeEventListener('click', onClickOutside))
</script>

<template>
  <div ref="rootEl" class="relative inline-block">
    <button
      type="button"
      class="flex items-center gap-2 rounded-md border border-gray-300 bg-white px-3 py-1.5 text-sm text-gray-700 hover:bg-gray-50"
      @click="open = !open"
    >
      <svg class="h-4 w-4 text-gray-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2">
        <path stroke-linecap="round" stroke-linejoin="round" d="M8 7V3m8 4V3m-9 8h10M5 21h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z" />
      </svg>
      {{ buttonLabel }}
      <svg class="h-4 w-4 text-gray-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2">
        <path stroke-linecap="round" stroke-linejoin="round" d="M19 9l-7 7-7-7" />
      </svg>
    </button>

    <div v-if="open" class="absolute left-0 z-30 mt-1 w-80 rounded-md border border-gray-200 bg-white p-2 shadow-lg">
      <button
        v-for="p in presets"
        :key="p.label"
        type="button"
        class="block w-full rounded px-2 py-1.5 text-left text-sm hover:bg-gray-50"
        :class="matchedPresetLabel === p.label ? 'font-medium text-indigo-600' : 'text-gray-700'"
        @click="selectPreset(p)"
      >
        {{ p.label }}
      </button>
      <div class="mt-1 border-t border-gray-100 pt-2">
        <p class="px-2 text-xs font-medium uppercase tracking-wide text-gray-400">Custom range</p>
        <div class="mt-1 flex items-center gap-1.5 px-2">
          <input v-model="customFrom" type="date" :max="customTo" class="min-w-0 flex-1 rounded border border-gray-300 px-1.5 py-1 text-xs" />
          <span class="shrink-0 text-gray-400">–</span>
          <input v-model="customTo" type="date" :min="customFrom" class="min-w-0 flex-1 rounded border border-gray-300 px-1.5 py-1 text-xs" />
        </div>
        <button
          type="button"
          :disabled="!customFrom || !customTo"
          class="mt-2 w-full rounded-md bg-indigo-600 px-2 py-1.5 text-xs font-medium text-white hover:bg-indigo-700 disabled:opacity-50"
          @click="applyCustom"
        >
          Apply
        </button>
      </div>
    </div>
  </div>
</template>
