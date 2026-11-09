<script setup lang="ts">
// Exercises: everyone's home exercises in one place. Three tabs --
//
//   Patients   who has what, how their week went, and assigning, ending or
//              typing many at once (ExercisesOverview)
//   Library    the clinic's exercises, programmes, schedules and QuiroFlow's
//              catalogue (ExercisesLibrary, formerly Settings > Exercise
//              Library, whose address redirects here)
//   By type    what each patient type brings (ExercisesTypeDefaults)
//
// Behind exercises_manage (utils/routePermissions.ts). The tab is in the URL
// (?section=), the library's own sub-tab beside it (?tab=), so a refresh or
// a shared link lands where it was.
const t = useT()
const route = useRoute()
const router = useRouter()

const SECTIONS = ['patients', 'library', 'types'] as const
type Section = (typeof SECTIONS)[number]
const section = computed<Section>({
  get: () => (SECTIONS.includes(route.query.section as Section) ? (route.query.section as Section) : 'patients'),
  set: (v) => router.replace({ query: { section: v === 'patients' ? undefined : v } }),
})
const tabs = computed(() => [
  { key: 'patients' as const, label: t('Patients', 'Pacientes') },
  { key: 'library' as const, label: t('Library', 'Biblioteca') },
  { key: 'types' as const, label: t('By type', 'Por tipo') },
])
function onTabKey(e: KeyboardEvent) {
  const step = e.key === 'ArrowRight' ? 1 : e.key === 'ArrowLeft' ? -1 : 0
  if (!step) return
  e.preventDefault()
  const next = SECTIONS[(SECTIONS.indexOf(section.value) + step + SECTIONS.length) % SECTIONS.length]!
  section.value = next
  nextTick(() => document.getElementById(`section-tab-${next}`)?.focus())
}
</script>

<template>
  <div class="flex h-full flex-col">
    <PageHeader :title="t('Exercises', 'Ejercicios')" />
    <div class="flex-1 overflow-y-auto bg-surface-page px-4 pb-24 pt-3 sm:px-6 lg:pb-10">
      <div role="tablist" :aria-label="t('Exercises sections', 'Secciones de ejercicios')" class="mb-4 flex gap-1 overflow-x-auto border-b border-line [scrollbar-width:none] [&::-webkit-scrollbar]:hidden" @keydown="onTabKey">
        <button
          v-for="tb in tabs"
          :id="`section-tab-${tb.key}`"
          :key="tb.key"
          type="button"
          role="tab"
          :aria-selected="section === tb.key"
          :aria-controls="`section-panel-${tb.key}`"
          :tabindex="section === tb.key ? 0 : -1"
          :data-cy="`section-tab-${tb.key}`"
          class="-mb-px flex h-11 shrink-0 items-center border-b-2 px-3 text-[14px] font-semibold"
          :class="section === tb.key ? 'border-brand text-ink-900' : 'border-transparent text-ink-muted hover:text-ink-700'"
          @click="section = tb.key"
        >
          {{ tb.label }}
        </button>
      </div>
      <div :id="`section-panel-${section}`" role="tabpanel" :aria-labelledby="`section-tab-${section}`">
        <ExercisesOverview v-if="section === 'patients'" />
        <ExercisesLibrary v-else-if="section === 'library'" />
        <ExercisesTypeDefaults v-else />
      </div>
    </div>
  </div>
</template>
