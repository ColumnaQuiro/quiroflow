<script setup lang="ts">
import { parseVisitNote, type NoteSection } from '~/utils/visitNote'

// A visit note read section by section: S, O, A and P down a left margin, so
// a practitioner scanning past visits finds "what was the Plan" without
// reading the note. Shared by My Day's history and the patient's Clinical tab.
//
// The history used to print the stored text as it is -- "Subjective: …" in
// the same weight and colour as what was said -- which hid the structure the
// charting pane had written.
//
// `collapsible`: each section stops at three lines, every heading still
// showing, with one button to read the rest. Only offered when something was
// actually cut, which depends on the width, so it is measured, not guessed.
const props = defineProps<{ body: string; collapsible?: boolean }>()

const t = useT()
const parsed = computed(() => parseVisitNote(props.body))
const rows = computed<{ key: NoteSection | 'Note'; text: string }[]>(() => {
  const p = parsed.value
  if (!p.structured) return props.body.trim() ? [{ key: 'Note', text: props.body.trim() }] : []
  return [...(p.preamble ? [{ key: 'Note' as const, text: p.preamble }] : []), ...p.sections.map((s) => ({ key: s.label, text: s.text }))]
})

// Folded, a section's paragraphs run on as one: kept apart, a blank line
// inside the three lines left the ellipsis alone on a line of its own.
function flat(text: string) {
  return text.replace(/\s*\n\s*/g, ' ')
}

const expanded = ref(false)
const clamped = computed(() => props.collapsible && !expanded.value)
const root = ref<HTMLElement | null>(null)
const overflowing = ref(false)
function measure() {
  if (!clamped.value || !root.value) return
  overflowing.value = [...root.value.querySelectorAll<HTMLElement>('[data-clamp]')].some((el) => el.scrollHeight > el.clientHeight + 1)
}
let observer: ResizeObserver | null = null
onMounted(() => {
  measure()
  if (typeof ResizeObserver !== 'undefined' && root.value) {
    observer = new ResizeObserver(() => measure())
    observer.observe(root.value)
  }
})
onBeforeUnmount(() => observer?.disconnect())
watch(() => props.body, () => nextTick(measure))
</script>

<template>
  <div ref="root">
    <!-- A definition list: each section's name is the term, what was
         written is its definition -- which is also how a screen reader
         announces them. -->
    <dl class="divide-y divide-line-divider">
      <div
        v-for="row in rows"
        :key="row.key"
        class="flex flex-wrap gap-x-4 gap-y-1.5 py-3"
        data-cy="note-section"
        :data-section="row.key"
      >
        <dt class="w-[7.5rem] shrink-0 pt-px"><PatientsVisitNoteSectionLabel :section="row.key" /></dt>
        <dd
          class="min-w-[14rem] flex-1 whitespace-pre-wrap break-words text-[13.5px] leading-relaxed text-ink-700"
          :class="clamped ? 'line-clamp-3' : ''"
          data-clamp
        >{{ clamped ? flat(row.text) : row.text }}</dd>
      </div>
    </dl>
    <button
      v-if="collapsible && (overflowing || expanded)"
      type="button"
      class="-mx-1 mt-0.5 inline-flex h-8 items-center gap-1 rounded-ctlSm px-1 text-[12.5px] font-semibold text-brand-text hover:underline touch:h-10"
      :aria-expanded="expanded"
      data-cy="note-expand"
      @click="expanded = !expanded"
    >
      {{ expanded ? t('Show less', 'Ver menos') : t('Show full note', 'Ver nota completa') }}
      <svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" class="transition-transform" :class="expanded ? 'rotate-180' : ''" aria-hidden="true"><path d="m4 6 4 4 4-4" /></svg>
    </button>
  </div>
</template>
