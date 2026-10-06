<script setup lang="ts">
// The patients list: the Patients tab on a phone, and the left column of the
// record on a wide iPad (pages/patients/[id].vue), with the open one marked.
defineProps<{ selectedId?: string }>()

interface Patient {
  id: string
  first_name: string
  last_name: string | null
  status: string
}

const supabase = useSupabaseClient()
const t = useT()
// Kept across remounts: on a wide iPad this list sits inside the record page,
// which Nuxt rebuilds for every patient tapped -- the search used to clear
// itself on each tap.
const search = useState('staff-patient-search', () => '')
const patients = ref<Patient[]>([])
const loading = ref(true)
const loadError = ref(false)
const adding = ref(false)
// A new patient opens straight on their record, where booking is one tap.
function created(p: { id: string }) {
  adding.value = false
  navigateTo(`/patients/${p.id}`)
}

// Every word has to match the first name or the surname, so "Elena Martín"
// finds her (the whole phrase was matched against each column and found
// nobody). Characters PostgREST reads as filter syntax are dropped -- a comma
// used to invalidate the query, which then read as "No patients found". Only
// the newest search's answer is kept. The same rules as NewVisitSheet.
let run = 0
async function load() {
  const mine = ++run
  loading.value = true
  loadError.value = false
  let query = supabase.from('patients').select('id, first_name, last_name, status').eq('status', 'active').order('first_name').limit(100)
  const words = search.value.trim().split(/\s+/).map((w) => w.replace(/[,()%*\\]/g, '')).filter(Boolean)
  for (const w of words) query = query.or(`first_name.ilike.%${w}%,last_name.ilike.%${w}%`)
  const { data, error } = await query
  if (mine !== run) return
  if (error) loadError.value = true
  else patients.value = (data as Patient[] | null) ?? []
  loading.value = false
}
onMounted(load)

let debounceTimer: ReturnType<typeof setTimeout>
watch(search, () => {
  clearTimeout(debounceTimer)
  debounceTimer = setTimeout(load, 300)
})
</script>

<template>
  <div class="flex h-full min-h-0 flex-col bg-surface">
    <div class="shrink-0 border-b border-line bg-surface px-4 py-3">
      <div class="mb-2 flex items-center justify-between gap-2">
        <h1 class="text-[17px] font-semibold text-ink-900">{{ t('Patients', 'Pacientes') }}</h1>
        <button type="button" class="flex h-8 items-center gap-1 rounded-ctl bg-brand px-3 text-[13px] font-semibold text-white" data-cy="patients-new" @click="adding = true">
          <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" aria-hidden="true"><path d="M12 5v14M5 12h14" /></svg>
          {{ t('New', 'Nuevo') }}
        </button>
      </div>
      <input
        v-model="search"
        type="search"
        :placeholder="t('Search patients…', 'Buscar pacientes…')"
        class="w-full rounded-ctl border border-line-control bg-surface-page px-3 py-2 text-[14px] text-ink-700 focus:border-brand focus:outline-none"
      />
    </div>

    <div v-if="loading && patients.length === 0" class="flex flex-1 items-center justify-center text-sm text-ink-faint">{{ t('Loading…', 'Cargando…') }}</div>
    <div v-else-if="loadError && patients.length === 0" class="flex flex-1 flex-col items-center justify-center gap-2 px-6 text-center" data-cy="patients-load-error">
      <p class="text-sm text-danger-text">{{ t('Could not load the patients.', 'No se han podido cargar los pacientes.') }}</p>
      <button type="button" class="h-10 rounded-ctl border border-line-control px-4 text-[13.5px] font-medium text-ink-700" @click="load">{{ t('Try again', 'Reintentar') }}</button>
    </div>
    <p v-else-if="patients.length === 0" class="flex flex-1 items-center justify-center px-6 text-center text-sm text-ink-muted">{{ t('No patients found.', 'No se encontraron pacientes.') }}</p>

    <div v-else class="flex-1 overflow-y-auto">
      <NuxtLink
        v-for="p in patients"
        :key="p.id"
        :to="`/patients/${p.id}`"
        class="flex items-center gap-3 border-b border-line-row px-4 py-3 active:bg-surface-subtle"
        :class="p.id === selectedId ? 'bg-brand-tint' : ''"
        :aria-current="p.id === selectedId ? 'page' : undefined"
      >
        <span class="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-brand-tint text-[13px] font-semibold text-brand-text">
          {{ p.first_name.slice(0, 1).toUpperCase() }}{{ (p.last_name ?? '').slice(0, 1).toUpperCase() }}
        </span>
        <p class="truncate text-[14px] font-[560] text-ink-900">{{ p.first_name }} {{ p.last_name ?? '' }}</p>
      </NuxtLink>
    </div>
    <NewPatientSheet v-if="adding" :initial-name="search" @created="created" @close="adding = false" />
  </div>
</template>
