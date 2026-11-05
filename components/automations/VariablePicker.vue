<script setup lang="ts">
import { VARIABLE_GROUPS, say, type VariableGroup } from '~/utils/automationCatalog'
import { normalizeSearchTerm } from '~/utils/searchText'

// The merge fields an email or message can use, as one searchable list
// grouped by what they are about, instead of a row of chips that crowds the
// editor's toolbar. Two ways in:
//
// - from a button: `searchable`, with its own search box, focused, handling
//   its own arrows and Enter;
// - from typing "{{" in a field: the field keeps the focus and passes what
//   was typed after the braces as `query`, and forwards the arrow keys, Enter
//   and Escape through `handleKey`, so someone who types {{first_name}} by
//   hand is never interrupted.
//
// Teleported and fixed to the viewport, so a drawer's overflow never clips it.

export interface PickerVariable {
  key: string
  label: string
  group?: VariableGroup
  /** What the example patient's value looks like, shown beside the name. */
  sample?: string
}

const props = defineProps<{
  variables: PickerVariable[]
  /** Viewport coordinates of the point the list hangs from (bottom-left of the caret or the button). */
  at: { x: number; y: number }
  searchable?: boolean
  query?: string
}>()
const emit = defineEmits<{ pick: [key: string]; close: [] }>()
const t = useT()

const own = ref('')
const term = computed(() => normalizeSearchTerm((props.searchable ? own.value : props.query ?? '').trim()))
const matches = computed(() =>
  props.variables.filter((v) => !term.value || normalizeSearchTerm(v.label).includes(term.value) || v.key.toLowerCase().includes(term.value)),
)
// Grouped in the catalog's order; anything without a group (the three a
// settings email offers) goes first, under no heading.
const sections = computed(() => {
  const out: { key: string; label: string | null; items: PickerVariable[] }[] = []
  const loose = matches.value.filter((v) => !v.group)
  if (loose.length) out.push({ key: '_', label: null, items: loose })
  for (const g of VARIABLE_GROUPS) {
    const items = matches.value.filter((v) => v.group === g.key)
    if (items.length) out.push({ key: g.key, label: say(t, g.label), items })
  }
  return out
})
const flat = computed(() => sections.value.flatMap((s) => s.items))
const active = ref(0)
watch(term, () => (active.value = 0))

const listRef = ref<HTMLElement | null>(null)
function move(delta: number) {
  if (!flat.value.length) return
  active.value = (active.value + delta + flat.value.length) % flat.value.length
  nextTick(() => listRef.value?.querySelector(`[data-index="${active.value}"]`)?.scrollIntoView({ block: 'nearest' }))
}
function choose() {
  const v = flat.value[active.value]
  if (v) emit('pick', v.key)
}
/** For the field that keeps the focus: true when the picker used the key. */
function handleKey(e: KeyboardEvent): boolean {
  if (e.key === 'ArrowDown') move(1)
  else if (e.key === 'ArrowUp') move(-1)
  else if ((e.key === 'Enter' || e.key === 'Tab') && flat.value.length) choose()
  else if (e.key === 'Escape') emit('close')
  else return false
  e.preventDefault()
  return true
}
defineExpose({ handleKey })

const panel = ref<HTMLElement | null>(null)
const search = ref<HTMLInputElement | null>(null)
// Kept inside the window: flipped above the point when there is no room
// below, and pulled left when it would run off the right edge.
const WIDTH = 300
const style = ref<Record<string, string>>({})
function place() {
  const h = panel.value?.offsetHeight ?? 320
  const below = props.at.y + 6
  const top = below + h > window.innerHeight - 8 ? Math.max(8, props.at.y - h - 30) : below
  const left = Math.min(Math.max(8, props.at.x), window.innerWidth - WIDTH - 8)
  style.value = { top: `${top}px`, left: `${left}px`, width: `${WIDTH}px` }
}
watch(() => props.at, () => nextTick(place), { deep: true })
watch(matches, () => nextTick(place))

function onOutside(e: PointerEvent) {
  if (panel.value && !panel.value.contains(e.target as Node)) emit('close')
}
onMounted(() => {
  nextTick(place)
  if (props.searchable) nextTick(() => search.value?.focus())
  // On the next tick, so the click that opened the picker does not close it.
  setTimeout(() => document.addEventListener('pointerdown', onOutside, true))
})
onUnmounted(() => document.removeEventListener('pointerdown', onOutside, true))
</script>

<template>
  <Teleport to="body">
    <div
      ref="panel"
      role="dialog"
      :aria-label="t('Insert a field', 'Insertar un campo')"
      class="fixed z-[70] flex max-h-[340px] flex-col rounded-card border border-line bg-surface p-1.5 shadow-popover"
      :style="style"
      data-test="variable-picker"
      @mousedown="!searchable && $event.preventDefault()"
    >
      <input
        v-if="searchable"
        ref="search"
        v-model="own"
        type="search"
        class="mb-1 h-9 w-full shrink-0 rounded-ctl border border-line-control bg-surface px-2.5 text-[13px] text-ink-900 focus:border-brand focus:outline-none touch:h-11"
        :placeholder="t('Search fields…', 'Buscar campo…')"
        data-test="variable-search"
        @keydown="(e) => (e.key === 'Escape' ? emit('close') : handleKey(e))"
      />
      <div ref="listRef" class="min-h-0 overflow-y-auto" role="listbox">
        <p v-if="!flat.length" class="px-2.5 py-2 text-[12.5px] text-ink-muted">{{ t('No field matches.', 'Ningún campo coincide.') }}</p>
        <template v-for="s in sections" :key="s.key">
          <p v-if="s.label" class="px-2.5 pb-0.5 pt-2 text-[11px] font-bold uppercase tracking-[.06em] text-ink-faint">{{ s.label }}</p>
          <button
            v-for="v in s.items"
            :key="v.key"
            type="button"
            role="option"
            :aria-selected="flat.indexOf(v) === active"
            :data-index="flat.indexOf(v)"
            class="flex w-full items-center justify-between gap-3 rounded-ctlSm px-2.5 py-1.5 text-left text-[13px] touch:min-h-11"
            :class="flat.indexOf(v) === active ? 'bg-brand-tint text-brand-text' : 'text-ink-700 hover:bg-surface-subtle'"
            :data-test="`variable-${v.key}`"
            @mousedown.prevent
            @mouseenter="active = flat.indexOf(v)"
            @click="emit('pick', v.key)"
          >
            <span class="min-w-0 truncate">{{ v.label }}</span>
            <span v-if="v.sample" class="max-w-[120px] shrink-0 truncate text-[11.5px] text-ink-muted">{{ v.sample }}</span>
          </button>
        </template>
      </div>
    </div>
  </Teleport>
</template>
