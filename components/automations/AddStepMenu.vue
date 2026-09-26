<script setup lang="ts">
import { STEP_GROUPS, STEP_TYPES, say } from '~/utils/automationCatalog'

// The menu behind a "+": every kind of step, grouped, with a search. Lead
// steps are offered only in a lead automation, and without Growth they are
// shown locked rather than hidden, so it is clear what Growth adds.

const props = defineProps<{ isLead: boolean; hasGrowth: boolean }>()
const emit = defineEmits<{ pick: [type: string]; close: [] }>()
const t = useT()

const query = ref('')
const input = ref<HTMLInputElement | null>(null)
onMounted(() => input.value?.focus())

const groups = computed(() => {
  const q = query.value.trim().toLowerCase()
  return STEP_GROUPS.map((g) => ({
    ...g,
    items: STEP_TYPES.filter((s) => s.group === g.key)
      .filter((s) => !s.leadOnly || props.isLead)
      .filter((s) => !q || `${say(t, s.label)} ${say(t, s.hint)}`.toLowerCase().includes(q)),
  })).filter((g) => g.items.length > 0)
})

function pick(type: string, locked: boolean) {
  if (!locked) emit('pick', type)
}
</script>

<template>
  <div role="menu" :aria-label="t('Add a step', 'Añadir un paso')" class="flex max-h-[min(520px,70vh)] w-[300px] flex-col overflow-hidden rounded-card border border-line bg-surface shadow-popover" data-test="add-step-menu" @keydown.esc="emit('close')">
    <div class="border-b border-line-divider p-2">
      <input
        ref="input"
        v-model="query"
        :placeholder="t('Search for a step', 'Buscar un paso')"
        :aria-label="t('Search for a step', 'Buscar un paso')"
        class="h-9 w-full rounded-ctl border border-line-control bg-surface px-3 text-[13px] text-ink-900 focus:border-brand focus:outline-none touch:h-11"
      />
    </div>
    <div class="overflow-y-auto p-1.5">
      <template v-for="g in groups" :key="g.key">
        <span class="block px-2.5 pb-1 pt-2 text-[10.5px] font-bold uppercase tracking-[.06em] text-ink-faint">{{ say(t, g.label) }}</span>
        <button
          v-for="s in g.items"
          :key="s.type"
          type="button"
          role="menuitem"
          class="flex w-full items-start gap-2.5 rounded-ctl px-2.5 py-2 text-left touch:min-h-11"
          :class="s.leadOnly && !hasGrowth ? 'cursor-not-allowed opacity-60' : 'hover:bg-surface-subtle'"
          :aria-disabled="s.leadOnly && !hasGrowth"
          :data-test="`add-step-${s.type}`"
          @click="pick(s.type, !!s.leadOnly && !hasGrowth)"
        >
          <span class="flex min-w-0 flex-col">
            <span class="flex items-center gap-1.5">
              <strong class="text-[13px] font-semibold text-ink-900">{{ say(t, s.label) }}</strong>
              <span v-if="s.leadOnly" class="rounded-pill bg-brand-tint px-1.5 py-px text-[9.5px] font-bold tracking-[.04em] text-brand-text">GROWTH</span>
            </span>
            <span class="text-[11.5px] text-ink-muted">{{ say(t, s.hint) }}</span>
          </span>
        </button>
      </template>
      <p v-if="groups.length === 0" class="px-2.5 py-3 text-[12px] text-ink-muted">{{ t('No step matches.', 'Ningún paso coincide.') }}</p>
    </div>
  </div>
</template>
