<script setup lang="ts">
import { dayKeyFor, hasBusinessHoursConfigured, type BusinessHours } from '~/utils/businessHours'
import { dayRangesText } from '~/utils/clinicHours'
import { utcOffsetLabel, zoneFromId } from '~/utils/timeZones'

// Settings -> Clinics: the locations, each opening onto its own page
// (/settings/clinics/<id>) where everything about it is edited in one place.
// Archived locations sit apart at the bottom, with their history intact.

const supabase = useSupabaseClient()
const store = useAccountStore()
const router = useRouter()
const t = useT()
const { showToast } = useToast()

interface ClinicRow {
  id: string
  name: string
  address: string | null
  phone: string | null
  business_hours: BusinessHours | null
  timezone: string
  online_booking_enabled: boolean
  tax_id: string | null
  archived_at: string | null
}

const clinics = ref<ClinicRow[]>([])
const allowance = ref<number | null>(null)
const archivedCounts = ref<Record<string, { appointments: number; patients: number }>>({})
const ready = ref(false)

const active = computed(() => clinics.value.filter((c) => !c.archived_at))
const archived = computed(() => clinics.value.filter((c) => c.archived_at))
const planFull = computed(() => allowance.value !== null && active.value.length >= allowance.value)

async function load() {
  const [{ data, error }, { data: cap }] = await Promise.all([
    supabase.from('clinics').select('id, name, address, phone, business_hours, timezone, online_booking_enabled, tax_id, archived_at').order('name'),
    supabase.rpc('clinic_location_allowance', { target_account_id: store.accountId! }),
  ])
  if (error) {
    showToast(error.message, 'error')
    return
  }
  clinics.value = (data ?? []) as unknown as ClinicRow[]
  // null: no cap -- a free trial, or a comped account.
  allowance.value = typeof cap === 'number' ? cap : null
  loadArchivedCounts()
}

async function loadArchivedCounts() {
  const out: Record<string, { appointments: number; patients: number }> = {}
  await Promise.all(
    archived.value.map(async (c) => {
      const [{ count: appointments }, { count: patients }] = await Promise.all([
        supabase.from('appointments').select('id', { count: 'exact', head: true }).eq('clinic_id', c.id),
        supabase.from('patients').select('id', { count: 'exact', head: true }).eq('clinic_id', c.id),
      ])
      out[c.id] = { appointments: appointments ?? 0, patients: patients ?? 0 }
    }),
  )
  archivedCounts.value = out
}

onMounted(async () => {
  if (!store.accountId) await store.load()
  await load()
  ready.value = true
})

function initials(name: string) {
  return name.split(/\s+/).filter(Boolean).slice(0, 2).map((p) => p[0]?.toUpperCase()).join('') || '·'
}

function metaLine(c: ClinicRow) {
  const today = dayRangesText(c.business_hours, dayKeyFor(new Date()), t('and', 'y'))
  const zone = zoneFromId(c.timezone)
  return [
    !hasBusinessHoursConfigured(c.business_hours) ? t('No opening hours set', 'Sin horario') : today ? t(`Today ${today}`, `Hoy ${today}`) : t('Closed today', 'Hoy cerrada'),
    c.phone ?? t('No phone', 'Sin teléfono'),
    `${zone.city} (${utcOffsetLabel(c.timezone)})`,
  ].join(' · ')
}

function formatDay(iso: string) {
  return new Date(iso).toLocaleDateString('es-ES', { day: 'numeric', month: 'short', year: 'numeric' })
}

// --- Add a location --------------------------------------------------------------
const addOpen = ref(false)
const newName = ref('')
const newZone = ref('Europe/Madrid')
const adding = ref(false)
const addError = ref('')

function openAdd() {
  newName.value = ''
  newZone.value = active.value[0]?.timezone ?? 'Europe/Madrid'
  addError.value = ''
  addOpen.value = true
}

async function addClinic() {
  addError.value = ''
  if (!newName.value.trim() || adding.value) return
  adding.value = true
  const { data, error } = await supabase
    .from('clinics')
    .insert({ account_id: store.accountId!, name: newName.value.trim(), timezone: newZone.value })
    .select('id')
    .single()
  adding.value = false
  if (error) {
    // PT402 is the plan's location cap (enforce_clinic_location_cap); its
    // message already says what to do.
    addError.value = error.message
    return
  }
  addOpen.value = false
  await store.load()
  router.push(`/settings/clinics/${data!.id}`)
}

// --- Reactivate --------------------------------------------------------------------
const reactivating = ref<string | null>(null)
async function reactivate(c: ClinicRow) {
  reactivating.value = c.id
  const { error } = await supabase.from('clinics').update({ archived_at: null }).eq('id', c.id)
  reactivating.value = null
  if (error) {
    // The plan's cap applies to bringing one back, too.
    showToast(error.message, 'error', 8000)
    return
  }
  showToast(t(`${c.name} is active again.`, `${c.name} vuelve a estar activa.`))
  await Promise.all([load(), store.load()])
}
</script>

<template>
  <div class="flex h-full flex-col">
    <PageHeader :title="t('Clinics', 'Clínicas')">
      <button
        type="button"
        data-cy="clinic-add"
        class="h-11 rounded-ctl bg-brand px-4 text-[14px] font-bold text-surface hover:bg-brand-hover"
        @click="openAdd"
      >
        {{ t('Add location', 'Añadir sede') }}
      </button>
    </PageHeader>
    <div class="flex-1 overflow-y-auto">
      <div class="flex gap-8 p-6">
        <SettingsNav />
        <div class="flex min-w-0 max-w-[720px] flex-1 flex-col gap-4" data-cy="clinics-page" :data-ready="ready ? 'true' : undefined">
          <p class="text-[13.5px] text-ink-muted">
            {{ t('The locations you work from. Each has its own hours, contact details and billing details.', 'Las sedes desde las que trabajáis. Cada una tiene su horario, su contacto y sus datos de facturación.') }}
          </p>

          <div v-if="allowance !== null" class="flex items-center gap-3 rounded-card border border-line bg-surface px-4 py-3.5" data-cy="clinics-plan">
            <div class="flex flex-1 flex-col gap-2">
              <span class="text-[14px] text-ink-700">
                <strong>{{ t(`${active.length} of ${allowance} locations`, `${active.length} de ${allowance} sedes`) }}</strong>
                {{ t('included in your plan', 'incluidas en tu plan') }}
              </span>
              <div
                role="progressbar"
                :aria-label="t('Locations in use', 'Sedes usadas')"
                :aria-valuenow="active.length"
                aria-valuemin="0"
                :aria-valuemax="allowance"
                class="h-1.5 overflow-hidden rounded-full bg-line-row"
              >
                <div class="h-full bg-brand" :style="{ width: `${Math.min(100, (active.length / Math.max(1, allowance)) * 100)}%` }" />
              </div>
            </div>
            <NuxtLink to="/subscription" class="text-[13.5px] font-semibold text-brand-text hover:underline">{{ t('See plans', 'Ver planes') }}</NuxtLink>
          </div>

          <NuxtLink
            v-for="c in active"
            :key="c.id"
            :to="`/settings/clinics/${c.id}`"
            data-cy="clinic-card"
            :data-clinic-id="c.id"
            class="flex items-center gap-4 rounded-card border border-line bg-surface px-5 py-4 hover:border-line-controlHover"
          >
            <span class="flex h-12 w-12 shrink-0 items-center justify-center rounded-ctl bg-brand-tint text-[15px] font-bold text-brand-text">{{ initials(c.name) }}</span>
            <div class="flex min-w-0 flex-1 flex-col gap-1">
              <div class="flex flex-wrap items-center gap-2">
                <strong class="text-[16px] text-ink-900">{{ c.name }}</strong>
                <span v-if="c.online_booking_enabled" class="rounded-pill bg-success-bg px-2 py-0.5 text-[12px] font-bold text-success-text">{{ t('Online booking', 'Reserva online') }}</span>
                <span v-if="!c.tax_id" class="rounded-pill bg-warning-bg px-2 py-0.5 text-[12px] font-bold text-warning-text" data-cy="clinic-card-missing-nif">{{ t('No tax ID', 'Falta el NIF') }}</span>
              </div>
              <span class="truncate text-[13.5px] text-ink-500">{{ c.address ?? t('No address', 'Sin dirección') }}</span>
              <span class="text-[13px] text-ink-muted">{{ metaLine(c) }}</span>
            </div>
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="shrink-0 text-ink-muted" aria-hidden="true"><path d="M9 6l6 6-6 6" /></svg>
          </NuxtLink>

          <details v-if="archived.length > 0" class="rounded-card border border-line bg-surface" data-cy="clinics-archived" open>
            <summary class="flex min-h-[52px] cursor-pointer items-center px-5 text-[14px] font-semibold text-ink-700">
              {{ t(`Archived · ${archived.length}`, `Archivadas · ${archived.length}`) }}
            </summary>
            <div v-for="c in archived" :key="c.id" class="flex items-center gap-4 border-t border-line-row px-5 py-3.5" data-cy="clinic-archived-row" :data-clinic-id="c.id">
              <span class="flex h-10 w-10 shrink-0 items-center justify-center rounded-ctl bg-chip-bg text-[13px] font-bold text-chip-text">{{ initials(c.name) }}</span>
              <div class="flex min-w-0 flex-1 flex-col gap-0.5">
                <strong class="text-[15px] text-ink-700">{{ c.name }}</strong>
                <span class="text-[13px] text-ink-muted">
                  {{ t(`Archived ${formatDay(c.archived_at!)}`, `Archivada el ${formatDay(c.archived_at!)}`) }}<template v-if="archivedCounts[c.id]"> · {{ t(`${archivedCounts[c.id].appointments} appointments and ${archivedCounts[c.id].patients} patients kept`, `${archivedCounts[c.id].appointments} citas y ${archivedCounts[c.id].patients} pacientes conservados`) }}</template>
                </span>
              </div>
              <button
                type="button"
                data-cy="clinic-reactivate"
                class="h-11 rounded-ctl border border-line-control bg-surface px-4 text-[14px] font-semibold text-ink-700 hover:bg-surface-subtle disabled:opacity-60"
                :disabled="reactivating === c.id"
                @click="reactivate(c)"
              >
                {{ t('Reactivate', 'Reactivar') }}
              </button>
            </div>
          </details>

          <p class="text-[12.5px] text-ink-muted">
            {{ t('Who works at each location is set per person in', 'Quién trabaja en cada sede se decide por persona en') }}
            <NuxtLink to="/settings/team" class="text-brand-text hover:underline">{{ t('Team', 'Equipo') }}</NuxtLink>.
          </p>
        </div>
      </div>
    </div>

    <UiConfirmDialog
      v-if="addOpen && planFull"
      :title="t('Your plan has no more locations', 'Tu plan no incluye más sedes')"
      :confirm-label="t('See plans', 'Ver planes')"
      :cancel-label="t('Cancel', 'Cancelar')"
      @confirm="router.push('/subscription')"
      @cancel="addOpen = false"
    >
      <p class="text-[14px] leading-relaxed text-ink-500" data-cy="clinic-add-plan-full">
        {{ t(`Your plan includes ${allowance} location(s) and all are in use. To open another, change plan or archive one you no longer use.`, `Tu plan incluye ${allowance} sede(s) y todas están en uso. Para abrir otra, cambia de plan o archiva una que ya no uséis.`) }}
      </p>
    </UiConfirmDialog>
    <UiConfirmDialog
      v-else-if="addOpen"
      :title="t('Add location', 'Añadir sede')"
      :confirm-label="adding ? t('Adding…', 'Añadiendo…') : t('Add location', 'Añadir sede')"
      :cancel-label="t('Cancel', 'Cancelar')"
      :busy="adding || !newName.trim()"
      @confirm="addClinic"
      @cancel="addOpen = false"
    >
      <label class="flex flex-col gap-1.5 text-[13px] font-semibold text-ink-700">
        {{ t('Name', 'Nombre') }}
        <input
          v-model="newName"
          data-cy="clinic-add-name"
          type="text"
          class="h-11 rounded-ctl border border-line-control bg-surface px-3 text-[15px] font-normal text-ink-900 focus:border-brand focus:outline-none focus:ring-1 focus:ring-brand"
          @keydown.enter.prevent="addClinic"
        />
      </label>
      <div class="flex flex-col gap-1.5">
        <span class="text-[13px] font-semibold text-ink-700">{{ t('Time zone', 'Zona horaria') }}</span>
        <SettingsTimeZonePicker v-model="newZone" />
        <span class="text-[12.5px] text-ink-muted">{{ t('Hours, contact and billing details are filled in next, on the location\'s own page.', 'Horario, contacto y datos fiscales se completan después, en la ficha de la sede.') }}</span>
      </div>
      <p v-if="allowance !== null" class="rounded-ctl border border-line bg-surface-subtle px-3.5 py-3 text-[13.5px] text-ink-700">
        {{ t(`${allowance - active.length} location(s) left in your plan.`, `Te quedan ${allowance - active.length} sede(s) en tu plan.`) }}
      </p>
      <p v-if="addError" class="text-[13px] font-semibold text-danger-text" data-cy="clinic-add-error">{{ addError }}</p>
    </UiConfirmDialog>
  </div>
</template>
