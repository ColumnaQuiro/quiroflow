<script setup lang="ts">
import type { Tables } from '~/types/database.types'

// The choices on a patient's "Referred by" field.
//
// patients.referral_source stores the source's NAME, not an id, so a source
// that patients already have is retired (status 'inactive': off the field,
// still on those patients and in reports) rather than deleted. Delete is
// offered only once nobody has it, which is the one case where removing the
// row loses nothing.
//
// The Private/Public "visibility" column is no longer shown: nothing in the
// app has ever read it. It stays in the schema, at its default, so nothing
// deployed breaks.

type Source = Tables<'referral_sources'>

const supabase = useSupabaseClient()
const store = useAccountStore()
const t = useT()
const { showToast } = useToast()

const sources = ref<Source[]>([])
const counts = ref<Record<string, number>>({})
const loading = ref(true)

async function load() {
  const { data } = await supabase.from('referral_sources').select('*').order('name')
  sources.value = data ?? []
  loading.value = false
  // One head count per source: a select of every patient's source would hit
  // PostgREST's row cap on any clinic with more than a thousand patients.
  const results = await Promise.all(
    sources.value.map((s) => supabase.from('patients').select('id', { count: 'exact', head: true }).eq('referral_source', s.name)),
  )
  counts.value = Object.fromEntries(sources.value.map((s, i) => [s.id, results[i].count ?? 0]))
}
onMounted(load)

const active = computed(() => [...sources.value.filter((s) => s.status === 'active')].sort((a, b) => (counts.value[b.id] ?? 0) - (counts.value[a.id] ?? 0) || a.name.localeCompare(b.name)))
const inactive = computed(() => sources.value.filter((s) => s.status !== 'active'))
const maxCount = computed(() => Math.max(1, ...active.value.map((s) => counts.value[s.id] ?? 0)))

function countLabel(s: Source) {
  const n = counts.value[s.id]
  if (n === undefined) return ''
  if (n === 0) return t('No patients', 'Ningún paciente')
  return n === 1 ? t('1 patient', '1 paciente') : t(`${n} patients`, `${n} pacientes`)
}
function barWidth(s: Source) {
  return `${Math.round(((counts.value[s.id] ?? 0) / maxCount.value) * 100)}%`
}
const unused = (s: Source) => counts.value[s.id] === 0

// --- adding ---

const name = ref('')
const saving = ref(false)
const addError = ref('')
const nameInput = ref<HTMLInputElement | null>(null)

async function addSource() {
  addError.value = ''
  const value = name.value.trim()
  if (!value) return
  if (sources.value.some((s) => s.name.toLowerCase() === value.toLowerCase())) {
    addError.value = t('There is already a source with that name.', 'Ya hay una fuente con ese nombre.')
    return
  }
  saving.value = true
  const { error } = await supabase.from('referral_sources').insert({ account_id: store.accountId!, name: value })
  saving.value = false
  if (error) {
    addError.value = error.message
    return
  }
  name.value = ''
  await load()
}

async function setStatus(s: Source, status: 'active' | 'inactive') {
  const { error } = await supabase.from('referral_sources').update({ status }).eq('id', s.id)
  if (error) {
    showToast(error.message, 'error')
    return
  }
  s.status = status
}

async function removeSource(s: Source) {
  const { error } = await supabase.from('referral_sources').delete().eq('id', s.id)
  if (error) {
    showToast(error.message, 'error')
    return
  }
  await load()
}

const iconBtn = 'flex h-9 w-9 touch:h-11 touch:w-11 shrink-0 items-center justify-center rounded-ctl text-ink-muted hover:bg-surface-subtle hover:text-ink-700'
</script>

<template>
  <div class="flex h-full flex-col">
    <PageHeader :title="t('Referral Sources', 'Fuentes de Referencia')">
      <UiBtn variant="primary" @click="nameInput?.focus()">{{ t('New source', 'Nueva fuente') }}</UiBtn>
    </PageHeader>
    <div class="flex-1 overflow-y-auto">
      <div class="flex gap-8 p-6">
        <SettingsNav />
        <div class="flex min-w-0 max-w-[820px] flex-1 flex-col gap-4" data-cy="settings-list" :data-ready="loading ? undefined : 'true'">
          <p class="text-[13.5px] text-ink-muted">
            {{ t('The choices on a patient\'s "Referred by" field, and what reports group new patients by.', 'Las opciones del campo "Origen" de un paciente, y por lo que los informes agrupan a los pacientes nuevos.') }}
          </p>

          <section aria-labelledby="h-offered" class="overflow-hidden rounded-card border border-line bg-surface">
            <div class="flex items-baseline gap-3 px-[18px] pb-3 pt-4">
              <h2 id="h-offered" class="flex-1 text-[16px] font-bold text-ink-900">{{ t(`Offered · ${active.length}`, `Disponibles · ${active.length}`) }}</h2>
              <span class="text-[13px] text-ink-muted">{{ t('Patients', 'Pacientes') }}</span>
            </div>

            <template v-if="loading">
              <div v-for="i in 4" :key="i" class="flex items-center gap-4 border-t border-line-row px-[18px] py-4">
                <UiSkeleton class="h-4 w-40 rounded-ctlSm" />
                <UiSkeleton class="h-2 flex-1 rounded-pill" />
              </div>
            </template>
            <p v-else-if="active.length === 0" class="border-t border-line-row px-[18px] py-6 text-center text-[14px] text-ink-muted">
              {{ t('No referral sources yet. Add the first one below.', 'Aún no hay fuentes de referencia. Añade la primera abajo.') }}
            </p>

            <div v-for="s in active" :key="s.id" data-cy="source-row" class="flex min-h-[60px] items-center gap-4 border-t border-line-row py-2 pl-[18px] pr-3">
              <strong class="w-[200px] shrink-0 truncate text-[15px] text-ink-900 max-sm:flex-1" data-cy="source-name">{{ s.name }}</strong>
              <div class="h-2 flex-1 overflow-hidden rounded-pill bg-chip-bg max-sm:hidden" aria-hidden="true">
                <div class="h-full rounded-pill bg-brand" :style="{ width: barWidth(s) }" />
              </div>
              <span class="w-[92px] shrink-0 text-right text-[13.5px] text-ink-500" data-cy="source-count">{{ countLabel(s) }}</span>
              <button type="button" data-cy="source-retire" :class="iconBtn" :aria-label="t(`Stop offering ${s.name}`, `Dejar de ofrecer ${s.name}`)" :title="t('Stop offering', 'Dejar de ofrecer')" @click="setStatus(s, 'inactive')">
                <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M3 3l18 18M10.6 5.1A10 10 0 0 1 12 5c6 0 9.5 7 9.5 7a17 17 0 0 1-2.8 3.6M6.6 6.6C3.9 8.3 2.5 12 2.5 12S6 19 12 19a9.6 9.6 0 0 0 5.4-1.6M9.9 9.9a3 3 0 0 0 4.2 4.2" /></svg>
              </button>
              <button v-if="unused(s)" type="button" data-cy="source-delete" :class="iconBtn" :aria-label="t(`Delete ${s.name}`, `Eliminar ${s.name}`)" @click="removeSource(s)">
                <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M4 7h16M10 11v6M14 11v6M6 7l1 13h10l1-13M9 7V4h6v3" /></svg>
              </button>
              <span v-else class="w-9 shrink-0 touch:w-11" aria-hidden="true" />
            </div>

            <form class="flex flex-wrap items-center gap-2.5 border-t border-line-row bg-surface-subtle py-3 pl-[18px] pr-3" @submit.prevent="addSource">
              <input
                ref="nameInput"
                v-model="name"
                data-cy="source-new-name"
                type="text"
                :placeholder="t('Add a source, e.g. TikTok', 'Añade una fuente, ej. TikTok')"
                :aria-label="t('New source name', 'Nombre de la nueva fuente')"
                class="h-9 touch:h-11 min-w-0 flex-1 rounded-ctl border border-line-control bg-surface px-3 text-[14px] text-ink-900 focus:border-brand focus:outline-none focus:ring-1 focus:ring-brand"
              />
              <UiBtn type="submit" data-cy="source-new-save" :disabled="saving || !name.trim()">{{ saving ? t('Adding…', 'Añadiendo…') : t('Add', 'Añadir') }}</UiBtn>
              <p v-if="addError" class="w-full text-[12.5px] font-semibold text-danger-text">{{ addError }}</p>
            </form>
          </section>

          <section v-if="inactive.length > 0" aria-labelledby="h-retired" class="overflow-hidden rounded-card border border-line bg-surface" data-cy="sources-retired">
            <div class="px-[18px] pb-3 pt-4">
              <h2 id="h-retired" class="text-[16px] font-bold text-ink-900">{{ t(`No longer offered · ${inactive.length}`, `Ya no disponibles · ${inactive.length}`) }}</h2>
              <p class="mt-1 text-[13px] text-ink-muted">{{ t('Hidden from the field, still on the patients who have it and still in reports.', 'Ocultas en el campo, pero siguen en los pacientes que las tienen y en los informes.') }}</p>
            </div>
            <div v-for="s in inactive" :key="s.id" data-cy="source-retired-row" class="flex min-h-[60px] items-center gap-4 border-t border-line-row py-2 pl-[18px] pr-3">
              <div class="flex min-w-0 flex-1 flex-col gap-0.5">
                <strong class="truncate text-[15px] text-ink-500">{{ s.name }}</strong>
                <span class="text-[13px] text-ink-muted">{{ countLabel(s) }}</span>
              </div>
              <UiBtn data-cy="source-reoffer" @click="setStatus(s, 'active')">{{ t('Offer again', 'Volver a ofrecer') }}</UiBtn>
              <button v-if="unused(s)" type="button" data-cy="source-delete" :class="iconBtn" :aria-label="t(`Delete ${s.name}`, `Eliminar ${s.name}`)" @click="removeSource(s)">
                <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M4 7h16M10 11v6M14 11v6M6 7l1 13h10l1-13M9 7V4h6v3" /></svg>
              </button>
              <span v-else class="w-9 shrink-0 touch:w-11" aria-hidden="true" />
            </div>
          </section>

          <p class="rounded-ctl border border-line bg-surface-subtle px-3.5 py-3 text-[13.5px] leading-snug text-ink-700">
            {{ t('A source that patients already have can only be retired, so reports keep adding up. Delete appears once nobody has it.', 'Una fuente que ya tienen pacientes solo se puede retirar, para que los informes sigan cuadrando. Eliminar aparece cuando nadie la tiene.') }}
          </p>
        </div>
      </div>
    </div>
  </div>
</template>
