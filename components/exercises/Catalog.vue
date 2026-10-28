<script setup lang="ts">
import { EXERCISE_CATALOG, EXERCISE_CATALOG_PROGRAMS, EXERCISE_CATALOG_REGIONS, exerciseCatalogItem, type CatalogRegion } from '../../utils/exerciseCatalog'

// Settings > Exercise Library: QuiroFlow's starter catalogue, to browse with
// its demonstrations and add to the clinic's library one at a time, or as a
// starter programme (useExerciseCatalog). An exercise already in the
// library says so; one the clinic archived can be added again, which
// restores it.
const props = defineProps<{ accountId: string; teamMemberId: string | null; inLibrary: string[] }>()
const emit = defineEmits<{ changed: [] }>()

const t = useT()
const { showToast } = useToast()
const catalog = useExerciseCatalog()
// Which starter programmes the clinic has already, by name.
const programs = useExercisePrograms({ accountId: () => props.accountId })
onMounted(programs.load)
defineExpose({ reload: programs.load })

const region = ref<CatalogRegion | 'programs'>('programs')
const playing = ref<string | null>(null)
const busy = ref<string | null>(null)
const have = computed(() => new Set(props.inLibrary))
const haveProgram = computed(() => new Set(programs.programs.value.map((p) => p.name.trim().toLowerCase())))
const shown = computed(() => (region.value === 'programs' ? [] : EXERCISE_CATALOG.filter((e) => e.region === region.value)))

function doseLabel(slug: string) {
  const item = exerciseCatalogItem(slug)
  if (!item) return ''
  const d = catalog.dose(item)
  return [d.sets && d.reps ? `${d.sets} × ${d.reps}` : d.reps, d.frequency].filter(Boolean).join(' · ')
}

async function add(slug: string) {
  busy.value = slug
  const id = await catalog.addToLibrary(props.accountId, slug, props.teamMemberId)
  busy.value = null
  if (!id) {
    showToast(t("Couldn't add it. Try again.", 'No se ha podido añadir. Inténtalo de nuevo.'), 'error')
    return
  }
  emit('changed')
}

async function addProgram(slug: string) {
  busy.value = `program:${slug}`
  const result = await catalog.addProgram(props.accountId, slug, props.teamMemberId)
  busy.value = null
  if ('error' in result) {
    showToast(result.error === 'exists' ? t('You already have a programme with that name.', 'Ya tienes un programa con ese nombre.') : t("Couldn't add it. Try again.", 'No se ha podido añadir. Inténtalo de nuevo.'), 'error')
    return
  }
  await programs.load()
  emit('changed')
}

const chip = 'h-8 touch:h-10 shrink-0 rounded-full border px-3 text-[13px] font-medium'
</script>

<template>
  <section aria-labelledby="h-catalog" class="overflow-hidden rounded-card border border-line bg-surface" data-cy="exercise-catalog">
    <div class="px-[18px] pb-3 pt-4">
      <h2 id="h-catalog" class="text-[16px] font-bold text-ink-900">{{ t('QuiroFlow catalogue', 'Catálogo de QuiroFlow') }}</h2>
      <p class="mt-1 text-[13px] text-ink-muted">
        {{ t('Ready-made exercises with a demonstration video. Adding one puts a copy in your library, which you can then edit like any other.', 'Ejercicios ya preparados, con vídeo de demostración. Al añadir uno se guarda una copia en tu biblioteca, que puedes editar como cualquier otro.') }}
      </p>
    </div>
    <div class="flex gap-2 overflow-x-auto px-[18px] pb-3" role="tablist">
      <button type="button" role="tab" :aria-selected="region === 'programs'" :class="[chip, region === 'programs' ? 'border-brand bg-brand-tint text-brand-text' : 'border-line-control text-ink-700']" data-cy="catalog-region-programs" @click="region = 'programs'">
        {{ t('Programmes', 'Programas') }}
      </button>
      <button v-for="r in EXERCISE_CATALOG_REGIONS" :key="r.key" type="button" role="tab" :aria-selected="region === r.key" :class="[chip, region === r.key ? 'border-brand bg-brand-tint text-brand-text' : 'border-line-control text-ink-700']" :data-cy="`catalog-region-${r.key}`" @click="region = r.key">
        {{ t(r.label.en, r.label.es) }}
      </button>
    </div>

    <ul v-if="region === 'programs'" class="divide-y divide-line-row border-t border-line-row">
      <li v-for="p in EXERCISE_CATALOG_PROGRAMS" :key="p.slug" class="flex items-start gap-3 px-[18px] py-3" data-cy="catalog-program">
        <div class="min-w-0 flex-1">
          <strong class="text-[15px] text-ink-900">{{ t(p.name.en, p.name.es) }}</strong>
          <p class="text-[13px] text-ink-muted">{{ t(p.description.en, p.description.es) }}</p>
          <p class="mt-1 text-[12.5px] text-ink-500">{{ p.items.map((s) => { const i = exerciseCatalogItem(s); return i ? t(i.name.en, i.name.es) : s }).join(' · ') }}</p>
        </div>
        <span v-if="haveProgram.has(t(p.name.en, p.name.es).toLowerCase())" class="shrink-0 pt-1 text-[13px] text-success-text" data-cy="catalog-program-added">{{ t('✓ Added', '✓ Añadido') }}</span>
        <UiBtn v-else :disabled="busy !== null" data-cy="catalog-program-add" @click="addProgram(p.slug)">{{ busy === `program:${p.slug}` ? t('Adding…', 'Añadiendo…') : t('Add programme', 'Añadir programa') }}</UiBtn>
      </li>
    </ul>

    <div v-else class="grid gap-3 border-t border-line-row p-[18px] sm:grid-cols-2">
      <article v-for="e in shown" :key="e.slug" class="flex flex-col gap-2 rounded-ctl border border-line p-2.5" data-cy="catalog-exercise">
        <ExercisesCatalogVideo v-if="playing === e.slug" :slug="e.slug" :label="t(e.name.en, e.name.es)" autoplay />
        <button v-else type="button" class="relative block overflow-hidden rounded-ctl" :aria-label="t(`Play ${e.name.en}`, `Ver ${e.name.es}`)" data-cy="catalog-play" @click="playing = e.slug">
          <img :src="catalog.media(e.slug).poster" alt="" loading="lazy" class="aspect-video w-full bg-surface-subtle object-contain" />
          <span class="absolute inset-0 flex items-center justify-center">
            <span class="flex h-10 w-10 items-center justify-center rounded-full bg-brand text-white shadow-card">
              <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M8 5v14l11-7z" /></svg>
            </span>
          </span>
        </button>
        <div class="flex items-start gap-2">
          <div class="min-w-0 flex-1">
            <strong class="block text-[14px] text-ink-900" data-cy="catalog-exercise-name">{{ t(e.name.en, e.name.es) }}</strong>
            <span class="text-[12.5px] text-ink-muted">{{ doseLabel(e.slug) }}</span>
          </div>
          <span v-if="have.has(e.slug)" class="shrink-0 pt-1 text-[13px] text-success-text" data-cy="catalog-exercise-added">{{ t('✓ In library', '✓ En la biblioteca') }}</span>
          <UiBtn v-else :disabled="busy !== null" data-cy="catalog-exercise-add" @click="add(e.slug)">{{ busy === e.slug ? t('Adding…', 'Añadiendo…') : t('Add', 'Añadir') }}</UiBtn>
        </div>
      </article>
    </div>
  </section>
</template>
