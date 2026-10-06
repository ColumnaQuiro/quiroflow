<script setup lang="ts">
// Lista de espera on the app: who is waiting for a slot, adding someone, and
// taking them off -- the web's pages/waitlist/index.vue, with its reads and
// writes. Reached from My Day; gated as the web sidebar gates it
// (recalls_access).
//
// The offer itself is not here, as it is not on the web page: a cancelled
// visit is offered to the first fitting entry by CancelVisitSheet (the web's
// CancelStep), through /api/waitlist/offer-next.
import { normalizeSearchTerm, sanitizeSearchToken } from '../../utils/searchText'
import { orderTypes } from '../../utils/appointmentTypes'

definePageMeta({ layout: 'practitioner' })

const user = useSupabaseUser()
watch(user, (u) => { if (!u) navigateTo('/login') }, { immediate: true })

type Status = 'waiting' | 'offered' | 'booked' | 'expired' | 'cancelled'
interface Row {
  id: string
  status: Status
  created_at: string
  offer_expires_at: string | null
  offered_starts_at: string | null
  patients: { id: string; first_name: string; last_name: string | null } | null
  appointment_types: { name: string } | null
  team_members: { full_name: string } | null
}
interface PatientOption { id: string; first_name: string; last_name: string | null }

const supabase = useSupabaseClient()
const t = useT()
const router = useRouter()
const { ask } = useAppConfirm()
const { context, loading: contextLoading, can } = usePractitionerContext()
const allowed = computed(() => can('recalls_access'))
const tz = computed(() => context.value?.timeZone ?? DEFAULT_CLINIC_TIMEZONE)

const STATUS: Record<Status, { label: [string, string]; cls: string }> = {
  waiting: { label: ['Waiting', 'Esperando'], cls: 'bg-chip-bg text-chip-text' },
  offered: { label: ['Offer sent', 'Oferta enviada'], cls: 'bg-brand-tint text-brand-text' },
  booked: { label: ['Booked', 'Reservada'], cls: 'bg-success-bg text-success-text' },
  expired: { label: ['Offer expired', 'Oferta caducada'], cls: 'bg-danger-bg text-danger-text' },
  cancelled: { label: ['Cancelled', 'Cancelada'], cls: 'bg-danger-bg text-danger-text' },
}

const rows = ref<Row[]>([])
const loading = ref(true)
const loadError = ref('')
const onlyActive = ref(true)
let run = 0
async function load() {
  if (!context.value || !allowed.value) return
  const mine = ++run
  loading.value = true
  loadError.value = ''
  let q = supabase
    .from('waitlist_entries')
    // Named by column: waitlist_entries points at appointment_types twice
    // (wanted, and offered), and a bare appointment_types(name) is refused
    // as ambiguous (PGRST201) -- the whole select, not just that column.
    .select('id, status, created_at, offer_expires_at, offered_starts_at, patients(id, first_name, last_name), appointment_types:appointment_type_id(name), team_members:practitioner_id(full_name)')
    .order('created_at', { ascending: true })
  if (onlyActive.value) q = q.in('status', ['waiting', 'offered'])
  const { data, error } = await q
  if (mine !== run) return
  if (error) loadError.value = t('Could not load the waitlist.', 'No se ha podido cargar la lista de espera.')
  else rows.value = (data as unknown as Row[]) ?? []
  loading.value = false
}
watch([() => context.value?.accountId, onlyActive, allowed], load, { immediate: true })

const nameOf = (r: Row) => (r.patients ? `${r.patients.first_name} ${r.patients.last_name ?? ''}`.trim() : t('Unknown patient', 'Paciente desconocido'))
const when = (iso: string | null) => (iso ? new Date(iso).toLocaleString(t('en-GB', 'es-ES'), { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit', timeZone: tz.value }) : '—')
const since = (iso: string) => new Date(iso).toLocaleDateString(t('en-GB', 'es-ES'), { day: 'numeric', month: 'short', timeZone: tz.value })

const notice = ref('')
let noticeTimer: ReturnType<typeof setTimeout> | undefined
function say(m: string) {
  notice.value = m
  clearTimeout(noticeTimer)
  noticeTimer = setTimeout(() => (notice.value = ''), 3500)
}

async function remove(r: Row) {
  const ok = await ask({ title: t(`Take ${nameOf(r)} off the waitlist?`, `¿Quitar a ${nameOf(r)} de la lista de espera?`), confirmLabel: t('Remove', 'Quitar'), danger: true })
  if (!ok) return
  const { data, error } = await supabase.from('waitlist_entries').update({ status: 'cancelled' } as never).eq('id', r.id).select('id')
  if (error || !data?.length) {
    say(t('Could not remove them.', 'No se ha podido quitar.'))
    return
  }
  say(t('Removed from the waitlist.', 'Quitado de la lista de espera.'))
  load()
}

// -- Adding someone -------------------------------------------------------------
const addOpen = ref(false)
const query = ref('')
const results = ref<PatientOption[]>([])
const searching = ref(false)
const picked = ref<PatientOption | null>(null)
const types = ref<{ id: string; name: string; sort_order: number | null }[]>([])
const team = ref<{ id: string; full_name: string }[]>([])
const typeId = ref('')
const practitionerId = ref('')
const saving = ref(false)
const addError = ref('')

async function openAdd() {
  addOpen.value = true
  query.value = ''
  results.value = []
  picked.value = null
  typeId.value = ''
  practitionerId.value = ''
  addError.value = ''
  if (!types.value.length) {
    const [{ data: ty }, { data: tm }] = await Promise.all([
      // Archived types are not offered for a new entry, as on the web.
      supabase.from('appointment_types').select('id, name, sort_order').is('archived_at', null),
      supabase.from('team_members').select('id, full_name').is('deleted_at', null).eq('is_practitioner', true).order('full_name'),
    ])
    types.value = orderTypes((ty as typeof types.value | null) ?? [])
    team.value = (tm as typeof team.value | null) ?? []
  }
}
let searchTimer: ReturnType<typeof setTimeout> | undefined
let searchRun = 0
watch(query, (q) => {
  clearTimeout(searchTimer)
  if (!q.trim()) {
    results.value = []
    return
  }
  searchTimer = setTimeout(async () => {
    const mine = ++searchRun
    searching.value = true
    let s = supabase.from('patients').select('id, first_name, last_name')
    for (const word of q.trim().split(/\s+/).map(sanitizeSearchToken).filter(Boolean)) s = s.ilike('search_name', `%${normalizeSearchTerm(word)}%`)
    const { data } = await s.order('first_name').limit(12)
    if (mine !== searchRun) return
    results.value = (data as PatientOption[] | null) ?? []
    searching.value = false
  }, 250)
})
function pick(p: PatientOption) {
  picked.value = p
  query.value = ''
  results.value = []
}
async function add() {
  if (saving.value || !context.value) return
  if (!picked.value) {
    addError.value = t('Choose a patient.', 'Elige un paciente.')
    return
  }
  if (!context.value.clinicId) {
    addError.value = t('No clinic selected.', 'No hay ninguna clínica seleccionada.')
    return
  }
  saving.value = true
  addError.value = ''
  // Twice on the list would be offered two slots for one visit.
  const { data: already } = await supabase.from('waitlist_entries').select('id').eq('patient_id', picked.value.id).in('status', ['waiting', 'offered']).limit(1)
  if (already?.length) {
    saving.value = false
    addError.value = t(`${picked.value.first_name} is already on the waitlist.`, `${picked.value.first_name} ya está en la lista de espera.`)
    return
  }
  const { error } = await supabase.from('waitlist_entries').insert({
    account_id: context.value.accountId,
    clinic_id: context.value.clinicId,
    patient_id: picked.value.id,
    appointment_type_id: typeId.value || null,
    practitioner_id: practitionerId.value || null,
    created_by: context.value.teamMemberId,
  } as never)
  saving.value = false
  if (error) {
    addError.value = error.message
    return
  }
  addOpen.value = false
  say(t(`${picked.value.first_name} is on the waitlist.`, `${picked.value.first_name} está en la lista de espera.`))
  load()
}
const field = 'h-11 rounded-ctl border border-line-control bg-surface px-3 text-[15px] text-ink-900 focus:border-brand focus:outline-none'
</script>

<template>
  <div class="flex h-full min-h-0 flex-col bg-surface-page" data-cy="waitlist">
    <AppPageHeader :title="t('Waitlist', 'Lista de espera')" back @back="router.back()">
      <button v-if="allowed" type="button" class="flex h-9 shrink-0 items-center gap-1 rounded-ctl bg-brand px-3 text-[13.5px] font-semibold text-white" data-cy="waitlist-add" @click="openAdd">
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" aria-hidden="true"><path d="M12 5v14M5 12h14" /></svg>
        {{ t('Add', 'Añadir') }}
      </button>
    </AppPageHeader>

    <p v-if="!contextLoading && !allowed" class="m-4 rounded-card border border-line bg-surface px-3.5 py-3 text-[13.5px] text-ink-muted">{{ t('Your role does not include the waitlist.', 'Tu rol no incluye la lista de espera.') }}</p>
    <div v-else class="min-h-0 flex-1 overflow-y-auto px-3 py-3 md:px-5" style="padding-bottom: max(env(safe-area-inset-bottom), 1rem)">
      <div class="mx-auto flex max-w-[760px] flex-col gap-2">
        <button type="button" role="switch" :aria-checked="!onlyActive" class="flex min-h-9 items-center justify-between gap-3 px-1 text-left" data-cy="waitlist-all" @click="onlyActive = !onlyActive">
          <span class="text-[12.5px] text-ink-muted">{{ onlyActive ? t('Waiting or offered a slot', 'Esperando o con hueco ofrecido') : t('Everyone, including past entries', 'Todos, también los anteriores') }}</span>
          <span class="text-[12.5px] font-semibold text-brand-text">{{ onlyActive ? t('Show all', 'Ver todos') : t('Only active', 'Solo activos') }}</span>
        </button>

        <AppSkeletonList v-if="contextLoading || loading" :rows="4" />
        <p v-else-if="loadError" class="rounded-card border border-danger-border bg-danger-bg px-3.5 py-3 text-[13.5px] text-danger-text">
          {{ loadError }} <button type="button" class="ml-1 font-semibold underline" @click="load">{{ t('Try again', 'Reintentar') }}</button>
        </p>
        <div v-else-if="!rows.length" class="mt-8 px-6 text-center" data-cy="waitlist-empty">
          <p class="text-[14px] text-ink-muted">{{ t('No one on the waitlist.', 'Nadie en la lista de espera.') }}</p>
          <p class="mt-1.5 text-[12.5px] leading-snug text-ink-faint">{{ t('When a visit is cancelled, its slot is offered to the first person here it fits.', 'Cuando se cancela una cita, el hueco se ofrece a la primera persona de aquí a la que le encaje.') }}</p>
        </div>
        <article v-for="r in rows" :key="r.id" class="flex items-start gap-3 rounded-card border border-line bg-surface px-3.5 py-3 shadow-card" data-cy="waitlist-row">
          <NuxtLink v-if="r.patients" :to="`/patients/${r.patients.id}`" class="min-w-0 flex-1">
            <span class="block truncate text-[15px] font-semibold text-ink-900">{{ nameOf(r) }}</span>
            <span class="block truncate text-[12.5px] text-ink-muted">{{ r.appointment_types?.name ?? t('Any type', 'Cualquier tipo') }} · {{ r.team_members?.full_name ?? t('Any practitioner', 'Cualquier profesional') }}</span>
            <span v-if="r.status === 'offered'" class="block truncate text-[12.5px] text-brand-text">{{ t('Offered', 'Ofrecida') }} {{ when(r.offered_starts_at) }} · {{ t('expires', 'caduca') }} {{ when(r.offer_expires_at) }}</span>
            <span v-else class="block truncate text-[12px] text-ink-faint">{{ t('Waiting since', 'Esperando desde el') }} {{ since(r.created_at) }}</span>
          </NuxtLink>
          <span v-else class="min-w-0 flex-1 truncate text-[15px] font-semibold text-ink-900">{{ nameOf(r) }}</span>
          <div class="flex shrink-0 flex-col items-end gap-1.5">
            <span class="rounded-full px-2 py-0.5 text-[11.5px] font-semibold" :class="STATUS[r.status].cls">{{ t(...STATUS[r.status].label) }}</span>
            <button v-if="r.status === 'waiting'" type="button" class="flex h-9 items-center px-1 text-[13px] font-medium text-danger-text" data-cy="waitlist-remove" @click="remove(r)">{{ t('Remove', 'Quitar') }}</button>
          </div>
        </article>
      </div>
    </div>

    <div v-if="notice" class="pointer-events-none fixed inset-x-0 bottom-24 z-40 flex justify-center px-4 md:bottom-6" role="status">
      <span class="rounded-full bg-ink-900 px-4 py-2 text-[13px] font-medium text-surface shadow-popover" data-cy="waitlist-notice">{{ notice }}</span>
    </div>

    <div v-if="addOpen" class="fixed inset-0 z-50 flex flex-col justify-end bg-black/40 md:items-center md:justify-center" data-cy="waitlist-add-sheet" @click.self="addOpen = false">
      <form class="flex max-h-[92%] w-full flex-col gap-3 overflow-y-auto rounded-t-[22px] bg-surface px-4 pt-2.5 shadow-popover md:max-w-[460px] md:rounded-[18px] md:pt-5" style="padding-bottom: max(env(safe-area-inset-bottom), 1.25rem)" role="dialog" aria-modal="true" :aria-label="t('Add to the waitlist', 'Añadir a la lista de espera')" @submit.prevent="add">
        <div class="mx-auto mb-0.5 h-1 w-[38px] shrink-0 rounded-full bg-line-control md:hidden" />
        <p class="text-[17px] font-semibold text-ink-900">{{ t('Add to the waitlist', 'Añadir a la lista de espera') }}</p>

        <div class="flex flex-col gap-1 text-[12.5px] font-medium text-ink-muted">
          {{ t('Patient', 'Paciente') }}
          <div v-if="picked" class="flex h-11 items-center justify-between rounded-ctl border-[1.5px] border-brand bg-brand-tint px-3">
            <span class="truncate text-[15px] font-semibold text-ink-900" data-cy="waitlist-picked">{{ picked.first_name }} {{ picked.last_name }}</span>
            <button type="button" class="text-[13px] font-semibold text-brand-text" @click="picked = null">{{ t('Change', 'Cambiar') }}</button>
          </div>
          <template v-else>
            <input v-model="query" type="search" autocomplete="off" :placeholder="t('Search by name…', 'Busca por nombre…')" :class="field" data-cy="waitlist-search" />
            <div v-if="query.trim()" class="max-h-56 divide-y divide-line-row overflow-y-auto rounded-ctl border border-line">
              <button v-for="p in results" :key="p.id" type="button" class="flex min-h-11 w-full items-center px-3 text-left text-[14.5px] font-normal text-ink-900" data-cy="waitlist-result" @click="pick(p)">{{ p.first_name }} {{ p.last_name }}</button>
              <p v-if="!results.length && !searching" class="px-3 py-2.5 text-[13px] font-normal text-ink-faint">{{ t('No matches', 'Sin resultados') }}</p>
            </div>
          </template>
        </div>

        <label class="flex flex-col gap-1 text-[12.5px] font-medium text-ink-muted">
          {{ t('Appointment type', 'Tipo de cita') }}
          <select v-model="typeId" :class="field" class="px-2.5" data-cy="waitlist-type">
            <option value="">{{ t('Any type', 'Cualquier tipo') }}</option>
            <option v-for="a in types" :key="a.id" :value="a.id">{{ a.name }}</option>
          </select>
        </label>
        <label class="flex flex-col gap-1 text-[12.5px] font-medium text-ink-muted">
          {{ t('Practitioner', 'Profesional') }}
          <select v-model="practitionerId" :class="field" class="px-2.5" data-cy="waitlist-practitioner">
            <option value="">{{ t('Any practitioner', 'Cualquier profesional') }}</option>
            <option v-for="m in team" :key="m.id" :value="m.id">{{ m.full_name }}</option>
          </select>
        </label>
        <p class="text-[12px] leading-snug text-ink-muted">{{ t('When a matching visit is cancelled, they are offered the slot automatically (oldest entry first), with a link to claim it.', 'Cuando se cancela una cita que encaja, se le ofrece el hueco automáticamente (por orden de antigüedad), con un enlace para reservarlo.') }}</p>

        <p v-if="addError" role="alert" class="text-[13px] text-danger-text">{{ addError }}</p>
        <button type="submit" class="flex h-11 items-center justify-center rounded-card bg-brand text-[15px] font-semibold text-white disabled:opacity-50" :disabled="saving || !picked" data-cy="waitlist-save">
          {{ saving ? t('Adding…', 'Añadiendo…') : t('Add', 'Añadir') }}
        </button>
        <button type="button" class="flex min-h-11 items-center justify-center text-[13.5px] text-ink-muted" @click="addOpen = false">{{ t('Cancel', 'Cancelar') }}</button>
      </form>
    </div>
  </div>
</template>
