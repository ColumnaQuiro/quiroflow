<script setup lang="ts">
import { COUNTRIES_BY_NAME, countryByCode } from '~/utils/countries'
import { normalizeSearchTerm } from '~/utils/searchText'

// The default-dial-code picker.
//
// A native <select> cannot show a flag, cannot be searched, and on a ~100-item
// list forces a clinic to scroll for its own country. This is a real combobox:
// one tab stop, arrows to move, type to filter, Escape to leave it alone.
//
// Below lg it becomes a bottom sheet. A popover anchored under the trigger has
// nowhere to go on a 844px-tall phone once the keyboard is up.
const props = defineProps<{ id: string; describedBy?: string }>()

const model = defineModel<string>({ required: true })

const t = useT()

const open = ref(false)
const query = ref('')
const activeIndex = ref(0)
const trigger = ref<HTMLButtonElement | null>(null)
const search = ref<HTMLInputElement | null>(null)
const listEl = ref<HTMLElement | null>(null)
const root = ref<HTMLElement | null>(null)

const selected = computed(() => countryByCode(model.value))

const results = computed(() => {
  const term = normalizeSearchTerm(query.value)
  if (!term) return COUNTRIES_BY_NAME
  // Dial codes are searched with and without the +, because nobody types the
  // plus when they are hunting for "34".
  const bare = term.replace(/^\+/, '')
  return COUNTRIES_BY_NAME.filter(
    (c) => normalizeSearchTerm(c.name).includes(term) || c.dial.replace(/^\+/, '').startsWith(bare) || normalizeSearchTerm(c.code) === term,
  )
})

watch(results, () => {
  activeIndex.value = 0
})

async function openList() {
  if (open.value) return
  open.value = true
  query.value = ''
  activeIndex.value = Math.max(0, COUNTRIES_BY_NAME.findIndex((c) => c.code === model.value))
  await nextTick()
  search.value?.focus()
  scrollActiveIntoView()
}

function closeList(restoreFocus = true) {
  if (!open.value) return
  open.value = false
  if (restoreFocus) trigger.value?.focus()
}

function choose(code: string) {
  model.value = code
  closeList()
}

function scrollActiveIntoView() {
  const node = listEl.value?.querySelector<HTMLElement>(`[data-index="${activeIndex.value}"]`)
  node?.scrollIntoView({ block: 'nearest' })
}

function move(delta: number) {
  const count = results.value.length
  if (!count) return
  activeIndex.value = (activeIndex.value + delta + count) % count
  nextTick(scrollActiveIntoView)
}

// Enter and Space are opened from keydown, and preventDefault() is what keeps
// that from double-firing: a <button> turns both keys into a click, and
// without it openList() ran and the click's toggle shut the list again in the
// same keystroke. Handling them here rather than leaving it to the click also
// means the keyboard path is the same one in a real browser and under Cypress,
// which does not synthesise the click a browser would.
function onTriggerKeydown(event: KeyboardEvent) {
  if (['Enter', ' ', 'Spacebar', 'ArrowDown', 'ArrowUp'].includes(event.key)) {
    event.preventDefault()
    openList()
  }
}

function onSearchKeydown(event: KeyboardEvent) {
  if (event.key === 'ArrowDown') {
    event.preventDefault()
    move(1)
  } else if (event.key === 'ArrowUp') {
    event.preventDefault()
    move(-1)
  } else if (event.key === 'Enter') {
    event.preventDefault()
    const country = results.value[activeIndex.value]
    if (country) choose(country.code)
  } else if (event.key === 'Escape') {
    event.preventDefault()
    closeList()
  } else if (event.key === 'Tab') {
    // Tab out closes rather than leaving an orphaned popover behind, but does
    // not steal the focus move the browser is about to make.
    closeList(false)
  }
}

function onPointerDown(event: PointerEvent) {
  if (!open.value) return
  if (!root.value?.contains(event.target as Node)) closeList(false)
}

onMounted(() => document.addEventListener('pointerdown', onPointerDown))
onBeforeUnmount(() => document.removeEventListener('pointerdown', onPointerDown))

const listboxId = computed(() => `${props.id}-listbox`)
</script>

<template>
  <div ref="root" class="relative">
    <button
      :id="id"
      ref="trigger"
      type="button"
      aria-haspopup="listbox"
      :aria-expanded="open"
      :aria-controls="open ? listboxId : undefined"
      :aria-describedby="describedBy"
      class="flex h-11 w-full items-center gap-[9px] rounded-ctl border bg-surface px-3 text-left outline-none lg:h-[38px] lg:px-[11px]"
      :class="open ? 'border-brand shadow-focus' : 'border-line-control focus-visible:border-brand focus-visible:shadow-focus'"
      @click="open ? closeList() : openList()"
      @keydown="onTriggerKeydown"
    >
      <OnboardingCountryFlag :code="selected.code" />
      <span class="text-[15px] font-semibold text-ink-900 lg:text-[14px]">{{ selected.dial || '—' }}</span>
      <span class="truncate text-[15px] text-ink-500 lg:text-[14px]">{{ selected.name }}</span>
      <span class="flex-1" />
      <svg viewBox="0 0 16 16" fill="none" aria-hidden="true" class="h-3.5 w-3.5 shrink-0 text-ink-muted">
        <path :d="open ? 'M4 10L8 6L12 10' : 'M4 6.5L8 10.5L12 6.5'" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" />
      </svg>
    </button>

    <!-- Backdrop, bottom sheet only. -->
    <div v-if="open" class="fixed inset-0 z-40 bg-ink-900/25 lg:hidden" aria-hidden="true" @click="closeList(false)" />

    <div
      v-if="open"
      class="fixed inset-x-0 bottom-0 z-50 max-h-[70vh] rounded-t-card border border-line-control bg-surface p-1.5 shadow-popover lg:absolute lg:inset-x-auto lg:bottom-auto lg:left-0 lg:top-[calc(100%+6px)] lg:max-h-[300px] lg:w-full lg:rounded-card"
      style="padding-bottom: max(env(safe-area-inset-bottom), 0.375rem)"
    >
      <div class="mb-1 flex items-center gap-2 border-b border-line-divider px-[9px] pb-1">
        <svg viewBox="0 0 16 16" fill="none" aria-hidden="true" class="h-3.5 w-3.5 shrink-0 text-ink-faint">
          <circle cx="7.2" cy="7.2" r="4.4" stroke="currentColor" stroke-width="1.5" />
          <path d="M10.6 10.6L13.5 13.5" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" />
        </svg>
        <input
          ref="search"
          v-model="query"
          type="text"
          role="combobox"
          aria-autocomplete="list"
          :aria-controls="listboxId"
          :aria-expanded="true"
          :aria-activedescendant="results[activeIndex] ? `${id}-option-${results[activeIndex].code}` : undefined"
          :placeholder="t('Search countries or dial codes', 'Busca países o prefijos')"
          :aria-label="t('Search countries or dial codes', 'Busca países o prefijos')"
          class="h-10 w-full bg-transparent text-[14px] text-ink-900 outline-none placeholder:text-ink-muted lg:h-8 lg:text-[13.5px]"
          @keydown="onSearchKeydown"
        />
      </div>

      <div :id="listboxId" ref="listEl" role="listbox" :aria-label="t('Country', 'País')" class="max-h-[54vh] overflow-y-auto lg:max-h-[240px]">
        <div
          v-for="(country, i) in results"
          :id="`${id}-option-${country.code}`"
          :key="country.code"
          role="option"
          :data-index="i"
          :aria-selected="country.code === model"
          class="flex h-11 cursor-pointer items-center gap-2.5 rounded-ctlSm px-[9px] lg:h-[33px]"
          :class="[
            country.code === model && 'bg-brand-tint',
            i === activeIndex && country.code !== model && 'bg-surface-subtle',
          ]"
          @click="choose(country.code)"
          @mousemove="activeIndex = i"
        >
          <OnboardingCountryFlag :code="country.code" />
          <span class="w-[42px] shrink-0 text-[13.5px] font-semibold text-ink-900">{{ country.dial }}</span>
          <span class="flex-1 truncate text-[13.5px] text-ink-700">{{ country.name }}</span>
          <svg v-if="country.code === model" viewBox="0 0 12 12" fill="none" aria-hidden="true" class="h-[13px] w-[13px] shrink-0 text-brand-text">
            <path d="M2.4 6.3L4.8 8.7L9.6 3.5" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" />
          </svg>
        </div>
        <p v-if="!results.length" class="px-[9px] py-3 text-[13.5px] text-ink-muted">
          {{ t('No country matches that.', 'Ningún país coincide.') }}
        </p>
      </div>
    </div>
  </div>
</template>
