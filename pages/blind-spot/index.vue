<script setup lang="ts">
import { blindSpotAsymmetry, formatBlindSpotArea } from '~/utils/blindSpot'

// The home of an account that bought only Blind Spot (accounts.product =
// 'blind_spot'): its latest tests, a new one for any patient, and the way
// to the whole of QuiroFlow. A clinic on the full product runs tests from the
// patient record instead; the route guard keeps this page to the standalone.

const t = useT()
const supabase = useSupabaseClient()
const store = useAccountStore()
const { showToast } = useToast()
const lang = computed(() => (t('en', 'es') === 'es' ? 'es' : 'en'))

interface Row {
  session_id: string
  phase: 'single' | 'pre' | 'post'
  right_area: number | null
  left_area: number | null
  tested_at: string
  patient_id: string
  patients: { first_name: string | null; last_name: string | null } | null
}

const rows = ref<Row[]>([])
const monthCount = ref(0)
const loading = ref(true)
onMounted(async () => {
  const monthStart = new Date()
  monthStart.setDate(1)
  monthStart.setHours(0, 0, 0, 0)
  const [{ data }, { count }] = await Promise.all([
    supabase.from('blind_spot_tests').select('session_id, phase, right_area, left_area, tested_at, patient_id, patients(first_name, last_name)').order('tested_at', { ascending: false }).limit(200),
    supabase.from('blind_spot_tests').select('id', { count: 'exact', head: true }).gte('tested_at', monthStart.toISOString()),
  ])
  rows.value = (data ?? []) as unknown as Row[]
  monthCount.value = count ?? 0
  loading.value = false
})

// One line per session, showing where it ended (the "after" of a pair).
const sessions = computed(() => {
  const seen = new Map<string, Row[]>()
  for (const r of rows.value) seen.set(r.session_id, [...(seen.get(r.session_id) ?? []), r])
  return [...seen.values()]
    .map((list) => {
      const last = list.find((r) => r.phase === 'post') ?? list.find((r) => r.phase === 'single') ?? list[0]!
      const first = list.find((r) => r.phase === 'pre')
      const asym = blindSpotAsymmetry(last.right_area, last.left_area)
      return {
        id: last.session_id,
        patientId: last.patient_id,
        name: [last.patients?.first_name, last.patients?.last_name].filter(Boolean).join(' ') || t('Patient', 'Paciente'),
        testedAt: last.tested_at,
        left: formatBlindSpotArea(last.left_area, lang.value),
        right: formatBlindSpotArea(last.right_area, lang.value),
        asymmetry: asym?.percent ?? null,
        paired: !!first && last.phase === 'post',
      }
    })
    .slice(0, 30)
})
const patientsTested = computed(() => new Set(rows.value.map((r) => r.patient_id)).size)

function when(iso: string) {
  return new Date(iso).toLocaleDateString(lang.value === 'es' ? 'es-ES' : 'en-GB', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })
}

// ---- New test: pick a patient, or add one.
const picking = ref(false)
const adding = ref(false)
const search = ref('')
const found = ref<Array<{ id: string; first_name: string | null; last_name: string | null }>>([])
let searchToken = 0
watch(search, async (q) => {
  const token = ++searchToken
  const term = q.trim()
  if (term.length < 2) {
    found.value = []
    return
  }
  const like = `%${term.replace(/[%_,()]/g, ' ')}%`
  const { data } = await supabase.from('patients').select('id, first_name, last_name').or(`first_name.ilike.${like},last_name.ilike.${like}`).order('last_name').limit(8)
  if (token === searchToken) found.value = data ?? []
})
function startFor(id: string) {
  void navigateTo(`/patients/blind-spot/${id}`)
}

// ---- The whole of QuiroFlow.
const upgrading = ref(false)
async function useWholeProduct() {
  upgrading.value = true
  try {
    await useStaffFetch('/api/blind-spot/product', { method: 'POST', body: { product: 'clinic' } })
    store.reset()
    await store.load()
    await navigateTo('/dashboard')
  } catch (e) {
    showToast((e as { data?: { statusMessage?: string } })?.data?.statusMessage ?? t('That did not work. Try again.', 'No ha funcionado. Inténtalo de nuevo.'), 'error')
  } finally {
    upgrading.value = false
  }
}
</script>

<template>
  <div class="flex h-full flex-col">
    <PageHeader :title="t('Tests', 'Pruebas')" :meta="t('Blind spot', 'Punto ciego')">
      <UiBtn variant="primary" data-cy="blind-spot-home-new" @click="picking = true">{{ t('New test', 'Nueva prueba') }}</UiBtn>
    </PageHeader>

    <div class="flex-1 overflow-y-auto bg-surface-page px-4 pb-10 pt-4 sm:px-6">
      <div class="mx-auto flex max-w-[1160px] flex-col gap-4">
        <section v-if="picking" class="flex flex-col gap-3 rounded-card border border-line bg-surface p-4 shadow-card" aria-labelledby="bs-pick" data-cy="blind-spot-pick">
          <div class="flex flex-wrap items-center gap-2">
            <h2 id="bs-pick" class="flex-1 text-[16px] font-semibold tracking-tightTitle text-ink-900">{{ t('Who is the test for?', '¿Para quién es la prueba?') }}</h2>
            <UiBtn @click="adding = true">{{ t('New patient', 'Paciente nuevo') }}</UiBtn>
            <UiBtn variant="ghost" @click="picking = false">{{ t('Cancel', 'Cancelar') }}</UiBtn>
          </div>
          <label for="bs-search" class="sr-only">{{ t('Search patient', 'Buscar paciente') }}</label>
          <input id="bs-search" v-model="search" type="search" :placeholder="t('Search by name', 'Buscar por nombre')" class="h-9 rounded-ctl border border-line-control bg-surface px-3 text-[13px] touch:h-11" data-cy="blind-spot-search" />
          <ul v-if="found.length" class="flex flex-col divide-y divide-line-row overflow-hidden rounded-card border border-line">
            <li v-for="p in found" :key="p.id">
              <button type="button" class="flex h-11 w-full items-center px-3.5 text-left text-[13.5px] text-ink-900 hover:bg-surface-subtle" @click="startFor(p.id)">
                {{ [p.first_name, p.last_name].filter(Boolean).join(' ') }}
              </button>
            </li>
          </ul>
          <p v-else-if="search.trim().length >= 2" class="text-[13px] text-ink-muted">{{ t('Nobody by that name. Add them as a new patient.', 'Nadie con ese nombre. Añádelo como paciente nuevo.') }}</p>
        </section>

        <div class="grid grid-cols-[repeat(auto-fit,minmax(200px,1fr))] gap-3">
          <div class="rounded-card border border-line bg-surface p-3.5 shadow-card">
            <p class="text-[11px] font-[640] uppercase tracking-[.04em] text-ink-muted">{{ t('Tests this month', 'Pruebas este mes') }}</p>
            <p class="mt-1 font-mono text-[22px] font-semibold text-ink-900">{{ monthCount }}</p>
          </div>
          <div class="rounded-card border border-line bg-surface p-3.5 shadow-card">
            <p class="text-[11px] font-[640] uppercase tracking-[.04em] text-ink-muted">{{ t('Patients tested', 'Pacientes evaluados') }}</p>
            <p class="mt-1 font-mono text-[22px] font-semibold text-ink-900">{{ patientsTested }}</p>
          </div>
        </div>

        <section class="overflow-hidden rounded-card border border-line bg-surface shadow-card" aria-labelledby="bs-recent">
          <div class="flex flex-wrap justify-between gap-2 border-b border-line-row px-4 py-3.5">
            <h2 id="bs-recent" class="text-[16px] font-semibold tracking-tightTitle text-ink-900">{{ t('Latest tests', 'Últimas pruebas') }}</h2>
            <span class="text-[12.5px] text-ink-muted">{{ t('Area in square degrees; after the adjustment when there was one', 'Área en grados²; tras el ajuste cuando lo hubo') }}</span>
          </div>
          <UiSkeleton v-if="loading" class="m-4 h-40" />
          <UiEmptyState v-else-if="!sessions.length" :title="t('No tests yet', 'Aún no hay pruebas')" :description="t('Start with New test: about two minutes for both eyes.', 'Empieza con Nueva prueba: unos dos minutos para los dos ojos.')" />
          <div v-else class="overflow-x-auto">
            <table class="w-full min-w-[640px] border-collapse text-[13px]" data-cy="blind-spot-home-table">
              <thead>
                <tr class="text-left text-[11px] font-[640] uppercase tracking-[.07em] text-ink-muted">
                  <th class="px-4 py-2.5 font-[640]">{{ t('Patient', 'Paciente') }}</th>
                  <th class="px-4 py-2.5 font-[640]">{{ t('Date', 'Fecha') }}</th>
                  <th class="px-4 py-2.5 text-right font-[640]">{{ t('L', 'OI') }}</th>
                  <th class="px-4 py-2.5 text-right font-[640]">{{ t('R', 'OD') }}</th>
                  <th class="px-4 py-2.5 font-[640]">{{ t('Difference', 'Diferencia') }}</th>
                </tr>
              </thead>
              <tbody>
                <tr v-for="s in sessions" :key="s.id" class="border-t border-line-row">
                  <td class="px-4 py-3"><NuxtLink :to="`/patients/${s.patientId}?tab=blind-spot`" class="font-semibold text-ink-900 hover:text-brand-text">{{ s.name }}</NuxtLink></td>
                  <td class="px-4 py-3 text-ink-muted">{{ when(s.testedAt) }}<span v-if="s.paired"> · {{ t('before/after', 'antes/después') }}</span></td>
                  <td class="px-4 py-3 text-right font-mono">{{ s.left }}</td>
                  <td class="px-4 py-3 text-right font-mono">{{ s.right }}</td>
                  <td class="px-4 py-3"><UiPill v-if="s.asymmetry !== null" :tone="s.asymmetry >= 15 ? 'warning' : 'neutral'">{{ s.asymmetry }} %</UiPill></td>
                </tr>
              </tbody>
            </table>
          </div>
        </section>

        <section v-if="store.isOwner" class="flex flex-wrap items-center gap-3 rounded-card border border-line bg-surface p-4 shadow-card">
          <div class="min-w-0 flex-1">
            <p class="font-semibold text-ink-900">{{ t('Diary, patient records and invoicing?', '¿Agenda, fichas y facturación?') }}</p>
            <p class="text-[13px] text-ink-muted">{{ t('Move to the whole of QuiroFlow: your patients and their tests stay where they are.', 'Pasa a QuiroFlow completo: tus pacientes y sus pruebas siguen donde están.') }}</p>
          </div>
          <UiBtn :disabled="upgrading" data-cy="blind-spot-upgrade" @click="useWholeProduct">{{ t('Use the whole of QuiroFlow', 'Pasar a QuiroFlow completo') }}</UiBtn>
        </section>
      </div>
    </div>

    <PatientsAddPatientModal v-if="adding" @close="adding = false" @created="startFor" />
  </div>
</template>
