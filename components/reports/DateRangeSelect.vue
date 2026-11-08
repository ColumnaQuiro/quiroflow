<script setup lang="ts">
import { computePresetRange, STANDARD_PRESETS, type DateRange, type DateRangePreset } from '~/composables/useDateRangePresets'

const props = withDefaults(defineProps<{ modelValue: DateRange; presets?: DateRangePreset[] }>(), {
  presets: () => STANDARD_PRESETS,
})
const emit = defineEmits<{ 'update:modelValue': [value: DateRange] }>()

const t = useT()
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

const presetLabel = (p: DateRangePreset) => (p.labelEs ? t(p.label ?? '', p.labelEs) : (p.label ?? ''))

const matchedPresetLabel = computed(() => {
  const match = props.presets.find((p) => {
    const r = computePresetRange(p)
    return r.from === props.modelValue.from && r.to === props.modelValue.to
  })
  return match ? presetLabel(match) : null
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
      :aria-expanded="open"
      class="flex h-8 items-center gap-2 rounded-ctl border border-line-control bg-surface px-3 text-[13px] text-ink-500 hover:border-line-controlHover touch:h-11"
      @click="open = !open"
    >
      <svg class="h-4 w-4 text-ink-faint" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="1.5" aria-hidden="true">
        <path stroke-linecap="round" stroke-linejoin="round" d="M8 7V3m8 4V3m-9 8h10M5 21h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z" />
      </svg>
      {{ buttonLabel }}
      <svg class="h-4 w-4 text-ink-faint" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="1.5" aria-hidden="true">
        <path stroke-linecap="round" stroke-linejoin="round" d="M19 9l-7 7-7-7" />
      </svg>
    </button>

    <div v-if="open" class="absolute left-0 z-30 mt-1 w-80 max-w-[calc(100vw-2rem)] rounded-ctl border border-line bg-surface p-2 shadow-popover">
      <button
        v-for="p in presets"
        :key="p.label"
        type="button"
        class="block w-full rounded-ctlSm px-2 py-1.5 text-left text-[13px] hover:bg-surface-subtle touch:py-2.5"
        :class="matchedPresetLabel === presetLabel(p) ? 'font-medium text-brand-text' : 'text-ink-600'"
        @click="selectPreset(p)"
      >
        {{ presetLabel(p) }}
      </button>
      <div class="mt-1 border-t border-line-divider pt-2">
        <p class="px-2 text-[11px] font-[640] uppercase tracking-[.07em] text-ink-faint2">{{ t('Custom range', 'Rango personalizado') }}</p>
        <div class="mt-1 flex items-center gap-1.5 px-2">
          <input v-model="customFrom" type="date" :max="customTo" class="h-8 min-w-0 flex-1 rounded-ctlSm border border-line-control bg-surface px-1.5 font-mono text-[12px] text-ink-600 touch:h-11" />
          <span class="shrink-0 text-ink-faint2">–</span>
          <input v-model="customTo" type="date" :min="customFrom" class="h-8 min-w-0 flex-1 rounded-ctlSm border border-line-control bg-surface px-1.5 font-mono text-[12px] text-ink-600 touch:h-11" />
        </div>
        <UiBtn variant="primary" size="sm" class="mt-2 w-full" :disabled="!customFrom || !customTo || customFrom > customTo" @click="applyCustom">
          {{ t('Apply', 'Aplicar') }}
        </UiBtn>
      </div>
    </div>
  </div>
</template>
