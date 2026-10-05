<script setup lang="ts">
// "+ Nueva cita" on the agenda, or a free slot held down: who it is for,
// then the booking itself. The second half is BookVisitSheet -- the same free
// times, clash check, insert, automation and confirmation as "Book the next
// visit" on a patient's record -- opened on the chosen day with the held time
// preselected. A patient who is not on file yet is created on the way
// (NewPatientSheet), as the web's calendar does.
const props = defineProps<{
  /** YYYY-MM-DD, in the clinic's time zone. */
  date: string
  /** The exact start held down on the timeline, when there was one. */
  preferredStart?: string | null
  /** The column it was held in, on iPad. */
  practitionerId?: string | null
}>()
const emit = defineEmits<{ booked: [{ appointmentId: string; startsAt: string; endsAt: string }]; close: [] }>()

const supabase = useSupabaseClient()
const t = useT()
const { context } = usePractitionerContext()

interface Found {
  id: string
  first_name: string
  last_name: string | null
  patient_contact_numbers: { country_code: string; number: string }[] | null
}

const step = ref<'search' | 'new' | 'book'>('search')
const term = ref('')
const results = ref<Found[]>([])
const searching = ref(false)
const chosen = ref<{ id: string; name: string } | null>(null)
const input = ref<HTMLInputElement | null>(null)
onMounted(() => nextTick(() => input.value?.focus()))

// Every word has to match the first name or the surname, so "Elena Mar"
// finds Elena Martín. Characters PostgREST reads as syntax are dropped.
let run = 0
async function search() {
  const words = term.value.trim().split(/\s+/).map((w) => w.replace(/[,()%*\\]/g, '')).filter(Boolean)
  const mine = ++run
  if (!words.length) {
    results.value = []
    searching.value = false
    return
  }
  searching.value = true
  let query = supabase.from('patients').select('id, first_name, last_name, patient_contact_numbers(country_code, number)').eq('status', 'active').order('first_name').limit(8)
  for (const w of words) query = query.or(`first_name.ilike.%${w}%,last_name.ilike.%${w}%`)
  const { data } = await query
  if (mine !== run) return
  results.value = (data as unknown as Found[] | null) ?? []
  searching.value = false
}
let timer: ReturnType<typeof setTimeout>
watch(term, () => {
  clearTimeout(timer)
  timer = setTimeout(search, 250)
})

const nameOf = (p: { first_name: string; last_name: string | null }) => `${p.first_name} ${p.last_name ?? ''}`.trim()
const initials = (p: Found) => `${p.first_name[0] ?? ''}${p.last_name?.[0] ?? ''}`.toUpperCase()
const phoneOf = (p: Found) => {
  const n = p.patient_contact_numbers?.[0]
  return n ? formatPhoneDisplay(n.number, n.country_code) : ''
}

function pick(p: Found) {
  chosen.value = { id: p.id, name: nameOf(p) }
  step.value = 'book'
}
function created(p: { id: string; firstName: string; lastName: string | null }) {
  chosen.value = { id: p.id, name: `${p.firstName} ${p.lastName ?? ''}`.trim() }
  step.value = 'book'
}

const locale = computed(() => t('en-GB', 'es-ES'))
const dayLabel = computed(() => shortDayLabel(new Date(`${props.date}T12:00:00Z`), locale.value, 'UTC'))
</script>

<template>
  <BookVisitSheet
    v-if="step === 'book' && chosen"
    :patient-id="chosen.id"
    :practitioner-id="practitionerId"
    :suggested-date="date"
    :preferred-start="preferredStart"
    :title="t(`New visit · ${chosen.name}`, `Nueva cita · ${chosen.name}`)"
    @booked="(b) => emit('booked', b)"
    @close="emit('close')"
  />
  <NewPatientSheet v-else-if="step === 'new'" :initial-name="term" :practitioner-id="practitionerId" @created="created" @close="step = 'search'" />

  <div v-else class="fixed inset-0 z-50 flex flex-col justify-end bg-ink-900/40" data-cy="new-visit-sheet" @click.self="emit('close')">
    <div
      class="flex h-[78%] flex-col gap-3 rounded-t-[22px] bg-surface px-4 pt-2.5 shadow-popover"
      style="padding-bottom: max(env(safe-area-inset-bottom), 1.25rem)"
      role="dialog"
      aria-modal="true"
      :aria-label="t('New visit', 'Nueva cita')"
    >
      <div class="mx-auto mb-0.5 h-1 w-[38px] shrink-0 rounded-full bg-line-control" />
      <p class="text-[17px] font-semibold text-ink-900">
        {{ t('New visit', 'Nueva cita') }} · <span class="capitalize">{{ dayLabel }}</span><template v-if="preferredStart">, {{ clinicTimeLabel(new Date(preferredStart), context?.timeZone) }}</template>
      </p>
      <input
        ref="input"
        v-model="term"
        type="search"
        autocomplete="off"
        autocapitalize="words"
        :placeholder="t('Search the patient…', 'Busca el paciente…')"
        class="h-11 shrink-0 rounded-ctl border border-line-control bg-surface px-3 text-[15px] text-ink-900 focus:border-brand focus:outline-none focus:ring-2 focus:ring-brand-tint"
        data-cy="new-visit-search"
      />

      <div class="min-h-0 flex-1 overflow-y-auto rounded-card border border-line" :class="term.trim() || results.length ? '' : 'border-transparent'">
        <button
          v-for="p in results"
          :key="p.id"
          type="button"
          class="flex w-full items-center gap-3 border-b border-line-row px-3 py-2.5 text-left active:bg-surface-subtle"
          data-cy="new-visit-result"
          @click="pick(p)"
        >
          <span class="flex h-[30px] w-[30px] shrink-0 items-center justify-center rounded-full bg-brand-tint text-[11px] font-semibold text-brand-text">{{ initials(p) }}</span>
          <span class="min-w-0">
            <span class="block truncate text-[14px] font-semibold text-ink-900">{{ nameOf(p) }}</span>
            <span v-if="phoneOf(p)" class="block text-[12px] text-ink-muted">{{ phoneOf(p) }}</span>
          </span>
        </button>
        <p v-if="term.trim() && !searching && !results.length" class="px-3 py-3 text-[13px] text-ink-muted">{{ t('Nobody by that name.', 'Nadie con ese nombre.') }}</p>
        <button
          v-if="term.trim()"
          type="button"
          class="flex w-full items-center gap-3 px-3 py-2.5 text-left active:bg-surface-subtle"
          data-cy="new-visit-new-patient"
          @click="step = 'new'"
        >
          <span class="flex h-[30px] w-[30px] shrink-0 items-center justify-center rounded-full bg-chip-bg text-ink-muted">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" aria-hidden="true"><path d="M12 5v14M5 12h14" /></svg>
          </span>
          <span class="text-[14px] text-ink-900">{{ t('New patient', 'Paciente nuevo') }}: «{{ term.trim() }}»</span>
        </button>
      </div>

      <button type="button" class="py-1 text-[13.5px] text-ink-muted" @click="emit('close')">{{ t('Cancel', 'Cancelar') }}</button>
    </div>
  </div>
</template>
