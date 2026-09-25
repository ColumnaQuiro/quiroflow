<script setup lang="ts">
interface LabelOption {
  id: string
  name: string
  color: string
}

const props = defineProps<{ labels: LabelOption[]; modelValue: string | null }>()
const emit = defineEmits<{ 'update:modelValue': [value: string | null] }>()

const t = useT()
const open = ref(false)
const activeLabel = computed(() => props.labels.find((l) => l.id === props.modelValue) ?? null)

function pick(id: string | null) {
  emit('update:modelValue', id)
  open.value = false
}

const rootEl = ref<HTMLElement | null>(null)
function onClickOutside(e: MouseEvent) {
  if (rootEl.value && !rootEl.value.contains(e.target as Node)) open.value = false
}
onMounted(() => document.addEventListener('click', onClickOutside))
onUnmounted(() => document.removeEventListener('click', onClickOutside))
</script>

<template>
  <div ref="rootEl" class="relative">
    <button
      type="button"
      data-cy="inbox-label-filter"
      class="flex h-8 touch:h-11 items-center gap-1.5 rounded-pill border px-3 text-[13px] font-semibold"
      :class="activeLabel ? 'border-brand-tintBorder bg-brand-tint text-brand-text' : 'border-line-control text-ink-700 hover:bg-surface-subtle'"
      @click="open = !open"
    >
      <span v-if="activeLabel" class="h-[8px] w-[8px] shrink-0 rounded-full" :style="{ backgroundColor: activeLabel.color }" />
      <svg v-else class="h-3.5 w-3.5" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.4">
        <path d="M2 7.5 7.5 2H13a1 1 0 0 1 1 1v5.5L8 14 2 8Z" stroke-linejoin="round" />
        <circle cx="10" cy="5" r="1" fill="currentColor" stroke="none" />
      </svg>
      {{ activeLabel ? activeLabel.name : t('Label', 'Etiqueta') }}
    </button>

    <div v-if="open" class="absolute left-0 top-[calc(100%+4px)] z-20 w-56 rounded-card border border-line bg-surface p-1.5 shadow-popover">
      <button type="button" class="flex min-h-9 touch:min-h-11 w-full items-center rounded-ctlSm px-2.5 text-left text-[13.5px] text-ink-muted hover:bg-surface-subtle" @click="pick(null)">{{ t('All conversations', 'Todas las conversaciones') }}</button>
      <div v-if="labels.length > 0" class="my-1 border-t border-line-divider" />
      <button
        v-for="l in labels"
        :key="l.id"
        type="button"
        class="flex min-h-9 touch:min-h-11 w-full items-center gap-2 rounded-ctlSm px-2.5 text-left text-[13.5px] hover:bg-surface-subtle"
        :class="modelValue === l.id ? 'text-ink-900' : 'text-ink-700'"
        @click="pick(l.id)"
      >
        <span class="h-[8px] w-[8px] shrink-0 rounded-full" :style="{ backgroundColor: l.color }" />
        <span class="flex-1 truncate">{{ l.name }}</span>
        <svg v-if="modelValue === l.id" viewBox="0 0 16 16" class="h-3 w-3 shrink-0 text-brand-text" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round">
          <path d="M3 8l3.5 3.5L13 5" />
        </svg>
      </button>
    </div>
  </div>
</template>
