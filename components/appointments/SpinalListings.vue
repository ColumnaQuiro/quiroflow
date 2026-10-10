<script setup lang="ts">
import { EXTREMITY_LEVELS, SPINE_LEVELS, hasSide, listingSummary, toggleListing, type Listings } from '../../utils/spinalListings'

// Spinal listings for one visit (visit_listings): a grid of segments, tap L
// or R, saved as you tap. Shows what was listed on the patient's previous
// visit, which is what a chiropractor checks first. Beside the visit notes on
// the web (AppointmentsNotesPanel) and in the staff app's visit screen.
const props = defineProps<{ appointmentId: string; accountId: string; teamMemberId: string | null; editable: boolean }>()

const t = useT()
const supabase = useSupabaseClient()
const listings = ref<Listings>({})
const previous = ref<{ listings: Listings; day: string } | null>(null)
const loading = ref(true)
const open = ref(false)
const showExtremities = ref(false)
const saving = ref(false)
const saveError = ref('')

const EXTREMITY_ES: Record<string, string> = { TMJ: 'ATM', Shoulder: 'Hombro', Elbow: 'Codo', Wrist: 'Muñeca', Hand: 'Mano', Ribs: 'Costillas', Hip: 'Cadera', Knee: 'Rodilla', Ankle: 'Tobillo', Foot: 'Pie' }
const extremityName = (l: string) => t(l, EXTREMITY_ES[l] ?? l)

async function load() {
  loading.value = true
  const [{ data: mine }, { data: appt }] = await Promise.all([
    supabase.from('visit_listings').select('listings').eq('appointment_id', props.appointmentId).maybeSingle(),
    supabase.from('appointments').select('patient_id, starts_at').eq('id', props.appointmentId).maybeSingle(),
  ])
  listings.value = ((mine as { listings: Listings } | null)?.listings ?? {}) as Listings
  showExtremities.value = Object.keys(listings.value).some((k) => (EXTREMITY_LEVELS as readonly string[]).includes(k))
  previous.value = null
  const a = appt as { patient_id: string | null; starts_at: string } | null
  if (a?.patient_id) {
    // The patient's visits before this one, newest first, and the first of
    // them that has listings.
    const { data: before } = await supabase.from('appointments').select('id, starts_at').eq('patient_id', a.patient_id).lt('starts_at', a.starts_at).is('deleted_at', null).order('starts_at', { ascending: false }).limit(20)
    const ids = ((before as { id: string; starts_at: string }[] | null) ?? []).map((b) => b.id)
    if (ids.length) {
      const { data: rows } = await supabase.from('visit_listings').select('appointment_id, listings').in('appointment_id', ids)
      const byId = new Map(((rows as { appointment_id: string; listings: Listings }[] | null) ?? []).map((r) => [r.appointment_id, r.listings]))
      const hit = ((before as { id: string; starts_at: string }[] | null) ?? []).find((b) => Object.keys(byId.get(b.id) ?? {}).length)
      if (hit) previous.value = { listings: byId.get(hit.id)!, day: hit.starts_at }
    }
  }
  loading.value = false
}
watch(() => props.appointmentId, load, { immediate: true })

// Saved per tap; a tap while one is in flight waits for it, so the last tap wins.
let chain: Promise<void> = Promise.resolve()
function tap(level: string, side: 'L' | 'R') {
  if (!props.editable) return
  listings.value = toggleListing(listings.value, level, side)
  const snapshot = { ...listings.value }
  chain = chain.then(async () => {
    saving.value = true
    saveError.value = ''
    const { error } = await supabase
      .from('visit_listings')
      .upsert({ account_id: props.accountId, appointment_id: props.appointmentId, listings: snapshot, updated_by: props.teamMemberId, updated_at: new Date().toISOString() } as never, { onConflict: 'appointment_id' })
    saving.value = false
    if (error) saveError.value = t("Couldn't save the listings. Try again.", 'No se han podido guardar los listados. Inténtalo de nuevo.')
  })
}
function copyPrevious() {
  if (!previous.value) return
  for (const [level, side] of Object.entries(previous.value.listings)) {
    if (side === 'B') {
      tap(level, 'L')
      tap(level, 'R')
    } else tap(level, side)
  }
}

const summary = computed(() => listingSummary(listings.value, extremityName))
const prevSummary = computed(() => (previous.value ? listingSummary(previous.value.listings, extremityName) : ''))
const prevDay = computed(() => (previous.value ? new Date(previous.value.day).toLocaleDateString(t('en-GB', 'es-ES'), { day: 'numeric', month: 'short' }) : ''))
const sideBtn = (on: boolean) =>
  `h-7 w-7 rounded-ctlSm text-[11.5px] font-bold ${on ? 'bg-brand text-white' : 'border border-line-control bg-surface text-ink-muted'} ${props.editable ? '' : 'cursor-default'}`
</script>

<template>
  <section class="rounded-ctl border border-line bg-surface" data-cy="spinal-listings">
    <button type="button" class="flex w-full items-center gap-2 px-3 py-2.5 text-left" :aria-expanded="open" data-cy="listings-toggle" @click="open = !open">
      <span class="text-[13px] font-semibold text-ink-900">{{ t('Listings', 'Listados') }}</span>
      <span class="min-w-0 flex-1 truncate text-[12.5px]" :class="summary ? 'text-ink-700' : 'text-ink-faint'" data-cy="listings-summary">
        {{ loading ? '' : summary || (editable ? t('None yet — tap to add', 'Ninguno aún — toca para añadir') : t('None', 'Ninguno')) }}
      </span>
      <span v-if="saving" class="text-[11px] text-ink-faint">{{ t('Saving…', 'Guardando…') }}</span>
      <svg width="12" height="12" viewBox="0 0 12 12" class="shrink-0 text-ink-muted transition-transform" :class="open ? 'rotate-180' : ''" aria-hidden="true"><path d="M2 4l4 4 4-4" fill="none" stroke="currentColor" stroke-width="1.5" /></svg>
    </button>

    <div v-if="open && !loading" class="border-t border-line-row px-3 pb-3 pt-2.5">
      <div v-if="previous" class="mb-2.5 flex flex-wrap items-center gap-2 rounded-ctlSm bg-surface-subtle px-2.5 py-1.5 text-[12px]" data-cy="listings-previous">
        <span class="text-ink-muted">{{ t(`Last visit (${prevDay}):`, `Visita anterior (${prevDay}):`) }}</span>
        <span class="font-medium text-ink-800">{{ prevSummary }}</span>
        <button v-if="editable && !summary" type="button" class="ml-auto font-semibold text-brand-text" data-cy="listings-copy-previous" @click="copyPrevious">{{ t('Same as last time', 'Igual que la última vez') }}</button>
      </div>

      <!-- Head to foot down each column, as a spine is read. -->
      <div class="grid grid-cols-1 gap-x-6 gap-y-1 sm:grid-flow-col sm:grid-cols-2 sm:grid-rows-[repeat(15,minmax(0,auto))]">
        <div v-for="level in SPINE_LEVELS" :key="level" class="flex items-center gap-1.5" :data-cy="`listing-${level}`">
          <button type="button" :class="sideBtn(hasSide(listings, level, 'L'))" :aria-pressed="hasSide(listings, level, 'L')" :aria-label="`${level} ${t('left', 'izquierda')}`" :disabled="!editable" data-cy="listing-L" @click="tap(level, 'L')">L</button>
          <span class="w-14 text-center text-[12.5px] font-medium text-ink-800">{{ level }}</span>
          <button type="button" :class="sideBtn(hasSide(listings, level, 'R'))" :aria-pressed="hasSide(listings, level, 'R')" :aria-label="`${level} ${t('right', 'derecha')}`" :disabled="!editable" data-cy="listing-R" @click="tap(level, 'R')">R</button>
        </div>
      </div>

      <button type="button" class="mt-2.5 text-[12.5px] font-medium text-brand-text" data-cy="listings-extremities" @click="showExtremities = !showExtremities">
        {{ showExtremities ? t('Hide extremities', 'Ocultar extremidades') : t('+ Extremities', '+ Extremidades') }}
      </button>
      <div v-if="showExtremities" class="mt-1.5 grid grid-cols-1 gap-x-6 gap-y-1 sm:grid-cols-2">
        <div v-for="level in EXTREMITY_LEVELS" :key="level" class="flex items-center gap-1.5" :data-cy="`listing-${level}`">
          <button type="button" :class="sideBtn(hasSide(listings, level, 'L'))" :aria-pressed="hasSide(listings, level, 'L')" :aria-label="`${extremityName(level)} ${t('left', 'izquierda')}`" :disabled="!editable" data-cy="listing-L" @click="tap(level, 'L')">L</button>
          <span class="w-20 text-center text-[12.5px] font-medium text-ink-800">{{ extremityName(level) }}</span>
          <button type="button" :class="sideBtn(hasSide(listings, level, 'R'))" :aria-pressed="hasSide(listings, level, 'R')" :aria-label="`${extremityName(level)} ${t('right', 'derecha')}`" :disabled="!editable" data-cy="listing-R" @click="tap(level, 'R')">R</button>
        </div>
      </div>
      <p v-if="saveError" role="alert" class="mt-2 text-[12.5px] text-danger-text">{{ saveError }}</p>
    </div>
  </section>
</template>
