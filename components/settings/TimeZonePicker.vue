<script setup lang="ts">
import { allZones, FREQUENT_ZONES, searchZones, utcOffsetLabel, zoneFromId } from '~/utils/timeZones'

// Any IANA time zone, searchable. In the page's flow rather than floating, so
// it can sit inside a dialog without being clipped by it.
const props = defineProps<{ modelValue: string }>()
const emit = defineEmits<{ 'update:modelValue': [string] }>()
const t = useT()

const open = ref(false)
const query = ref('')
const search = ref<HTMLInputElement | null>(null)
const zones = allZones()
const LIMIT = 50

const current = computed(() => zoneFromId(props.modelValue))
const matches = computed(() => (query.value.trim() ? searchZones(zones, query.value) : FREQUENT_ZONES))
const shown = computed(() => matches.value.slice(0, LIMIT))
const listId = `tz-${Math.random().toString(36).slice(2, 9)}`

function toggle() {
  open.value = !open.value
  query.value = ''
  if (open.value) nextTick(() => search.value?.focus())
}
function pick(id: string) {
  emit('update:modelValue', id)
  open.value = false
}
</script>

<template>
  <div class="flex flex-col gap-2" data-cy="tz-picker">
    <button
      type="button"
      data-cy="tz-picker-button"
      class="flex h-9 touch:h-11 items-center gap-2.5 rounded-ctl border border-line-control bg-surface px-3 text-left text-[15px] text-ink-900 hover:border-line-controlHover"
      :aria-expanded="open"
      :aria-controls="listId"
      @click="toggle"
    >
      <span class="min-w-0 flex-1 truncate">
        {{ current.city }}<span v-if="current.region" class="text-ink-muted"> · {{ current.region }}</span>
      </span>
      <span class="font-mono text-[13px] text-ink-500">{{ utcOffsetLabel(modelValue) }}</span>
      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M6 9l6 6 6-6" /></svg>
    </button>
    <div v-if="open" class="flex flex-col gap-1 rounded-card border border-line bg-surface p-2 shadow-popover">
      <input
        ref="search"
        v-model="query"
        type="search"
        data-cy="tz-picker-search"
        :aria-label="t('Search time zones', 'Buscar zona horaria')"
        :placeholder="t('Search a city, country or zone', 'Busca una ciudad, país o zona')"
        class="h-9 touch:h-11 rounded-ctl border border-line-control bg-surface px-3 text-[14px] text-ink-900 focus:border-brand focus:outline-none focus:ring-1 focus:ring-brand"
      />
      <span class="px-2 pt-1.5 text-[11.5px] font-bold uppercase tracking-[.04em] text-ink-muted">
        {{ query.trim() ? t('Results', 'Resultados') : t('Frequent · or search them all', 'Frecuentes · o busca entre todas') }}
      </span>
      <div :id="listId" role="listbox" :aria-label="t('Time zones', 'Zonas horarias')" class="flex max-h-64 flex-col overflow-y-auto">
        <button
          v-for="z in shown"
          :key="z.id"
          type="button"
          role="option"
          data-cy="tz-option"
          :data-zone="z.id"
          :aria-selected="z.id === modelValue"
          class="flex min-h-9 touch:min-h-11 items-center gap-2.5 rounded-ctlSm px-2.5 text-left text-[14px] text-ink-900"
          :class="z.id === modelValue ? 'bg-brand-tint' : 'hover:bg-surface-subtle'"
          @click="pick(z.id)"
        >
          <span class="min-w-0 flex-1 truncate">{{ z.city }}<span v-if="z.region" class="text-ink-muted"> · {{ z.region }}</span></span>
          <span class="font-mono text-[12.5px] text-ink-500">{{ utcOffsetLabel(z.id) }}</span>
        </button>
        <p v-if="shown.length === 0" class="px-2.5 py-3 text-[13.5px] text-ink-muted">{{ t('No zone matches.', 'Ninguna zona coincide.') }}</p>
        <p v-else-if="matches.length > LIMIT" class="px-2.5 py-2 text-[12.5px] text-ink-muted">
          {{ t(`${matches.length - LIMIT} more -- keep typing to narrow it down.`, `${matches.length - LIMIT} más -- sigue escribiendo para acotar.`) }}
        </p>
      </div>
    </div>
  </div>
</template>
