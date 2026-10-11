<script setup lang="ts">
import { DEFAULT_CLINIC_TIMEZONE, clinicDateOf } from '../../utils/clinicClock'
import { formatPhoneDisplay } from '../../utils/phone'
import { NO_SHOW_RISK_RANK, confirmWindowEnd, noShowRiskReason, type NoShowRisk } from '../../utils/noShowRisk'

// "Por confirmar": the visits between now and the end of tomorrow that nobody
// has confirmed -- no "yes" to the WhatsApp reminder, no tap in the app, no
// tick from the desk -- riskiest first (utils/noShowRisk.ts), so the calls
// that matter get made before the day fills up. Call, message, or mark it
// confirmed once they have said so on the phone. Web My Day and the staff
// app's both show it.
//
// Hidden when there is nothing to confirm.
const props = defineProps<{
  /** One clinic (the web's selected one); null for all of them (the app). */
  clinicId: string | null
  /** One practitioner's visits; null for everyone's. */
  practitionerId: string | null
  /** When the host knows it (the app's context); otherwise read from the clinic. */
  timeZone?: string | null
  privacyMode?: boolean
  /** Offers the Mine / Everyone switch: for roles that see the whole diary. */
  canSeeAll?: boolean
}>()
const emit = defineEmits<{ message: [patientId: string] }>()

const supabase = useSupabaseClient()
const t = useT()
const { riskFor } = useNoShowRisk()
const locale = computed(() => t('en-GB', 'es-ES'))

interface Row {
  id: string
  patient_id: string
  starts_at: string
  confirmation_status: string | null
  patients: { first_name: string; last_name: string | null } | null
  team_members: { full_name: string } | null
}
interface Phone { patient_id: string; number: string; country_code: string; is_whatsapp: boolean }

const rows = ref<Row[]>([])
const risk = ref<Map<string, NoShowRisk>>(new Map())
const phones = ref<Map<string, Phone>>(new Map())
const loaded = ref(false)
const zone = ref(props.timeZone || DEFAULT_CLINIC_TIMEZONE)
// Front desk confirm for everyone; a practitioner mostly for themselves.
const everyone = ref(false)
const confirmingId = ref<string | null>(null)
const showAll = ref(false)
// Inline rather than a toast: the staff app has no toast host.
const error = ref('')

async function load() {
  if (!props.timeZone && props.clinicId) {
    const { data } = await supabase.from('clinics').select('timezone').eq('id', props.clinicId).maybeSingle()
    zone.value = (data as { timezone: string | null } | null)?.timezone || DEFAULT_CLINIC_TIMEZONE
  }
  const now = new Date()
  let q = supabase
    .from('appointments')
    .select('id, patient_id, starts_at, confirmation_status, patients(first_name, last_name), team_members(full_name)')
    .eq('status', 'booked')
    .is('deleted_at', null)
    .is('checked_in_at', null)
    .or('confirmation_status.is.null,confirmation_status.neq.confirmed')
    .gte('starts_at', now.toISOString())
    .lt('starts_at', confirmWindowEnd(now, zone.value).toISOString())
    .order('starts_at')
    .limit(200)
  if (props.clinicId) q = q.eq('clinic_id', props.clinicId)
  if (props.practitionerId && !everyone.value) q = q.eq('practitioner_id', props.practitionerId)
  const { data } = await q
  const list = ((data as unknown as Row[] | null) ?? []).filter((r) => r.patient_id)
  const ids = list.map((r) => r.patient_id)
  const [riskMap, { data: nums }] = await Promise.all([
    riskFor(ids),
    ids.length
      ? supabase.from('patient_contact_numbers').select('patient_id, number, country_code, is_whatsapp').in('patient_id', [...new Set(ids)]).order('created_at')
      : Promise.resolve({ data: [] as Phone[] }),
  ])
  // The first number on file, as the patient record's Call button takes it.
  const byPatient = new Map<string, Phone>()
  for (const n of (nums as Phone[] | null) ?? []) if (!byPatient.has(n.patient_id)) byPatient.set(n.patient_id, n)
  risk.value = riskMap
  phones.value = byPatient
  rows.value = list
  loaded.value = true
}
watch(() => [props.clinicId, props.practitionerId, everyone.value], load, { immediate: true })

// Riskiest first, then soonest. A request to move the visit outranks them
// all: it is a conversation already waiting for an answer.
const ordered = computed(() =>
  rows.value.slice().sort((a, b) => {
    const ma = a.confirmation_status === 'reschedule_requested' ? -1 : NO_SHOW_RISK_RANK[risk.value.get(a.patient_id)?.level ?? 'none']
    const mb = b.confirmation_status === 'reschedule_requested' ? -1 : NO_SHOW_RISK_RANK[risk.value.get(b.patient_id)?.level ?? 'none']
    return ma - mb || a.starts_at.localeCompare(b.starts_at)
  }),
)
const SHOWN = 6
const visible = computed(() => (showAll.value ? ordered.value : ordered.value.slice(0, SHOWN)))
const atRisk = computed(() => rows.value.filter((r) => ['high', 'some'].includes(risk.value.get(r.patient_id)?.level ?? '')).length)

function when(iso: string) {
  const d = new Date(iso)
  const time = d.toLocaleTimeString(locale.value, { hour: '2-digit', minute: '2-digit', timeZone: zone.value })
  return clinicDateOf(d, zone.value) === clinicDateOf(new Date(), zone.value) ? t(`Today ${time}`, `Hoy ${time}`) : t(`Tomorrow ${time}`, `Mañana ${time}`)
}
function telHref(p: Phone) {
  return `tel:${formatPhoneDisplay(p.number, p.country_code).replace(/[^\d+]/g, '')}`
}
function reason(r: Row) {
  if (r.confirmation_status === 'reschedule_requested') return t('Asked to move it', 'Pidió cambiarla')
  const k = risk.value.get(r.patient_id)
  return k ? noShowRiskReason(k, t) : ''
}

async function markConfirmed(r: Row) {
  confirmingId.value = r.id
  error.value = ''
  // Selected back: an update RLS refuses (a read-only diary) changes no row
  // and reports no error.
  const { data: changed, error: failed } = await supabase.from('appointments').update({ confirmation_status: 'confirmed' }).eq('id', r.id).select('id')
  confirmingId.value = null
  if (failed || !changed?.length) {
    error.value = t("Couldn't mark it confirmed. Try again.", 'No se ha podido marcar como confirmada. Inténtalo de nuevo.')
    return
  }
  rows.value = rows.value.filter((x) => x.id !== r.id)
}

defineExpose({ reload: load })
</script>

<template>
  <section v-if="loaded && (rows.length > 0 || everyone)" class="overflow-hidden rounded-card border border-line bg-surface shadow-card sm:mx-6" data-cy="needs-confirming">
    <header class="flex flex-wrap items-center justify-between gap-2 border-b border-line-row px-4 py-2.5">
      <div class="flex items-baseline gap-2">
        <h2 class="text-[13.5px] font-semibold text-ink-900">{{ t('Needs confirming', 'Por confirmar') }}</h2>
        <span class="text-[12px] text-ink-muted2" data-cy="needs-confirming-count">
          {{ rows.length }}<template v-if="atRisk > 0"> &middot; {{ t(`${atRisk} at risk`, `${atRisk} con riesgo`) }}</template>
        </span>
      </div>
      <div v-if="canSeeAll && practitionerId" class="flex h-7 overflow-hidden rounded-ctlSm border border-line-control text-[12px]">
        <button type="button" class="px-2.5" :class="!everyone ? 'bg-brand font-semibold text-white' : 'text-ink-500 hover:bg-surface-subtle'" @click="everyone = false">{{ t('Mine', 'Mías') }}</button>
        <button type="button" class="border-l border-line-control px-2.5" :class="everyone ? 'bg-brand font-semibold text-white' : 'text-ink-500 hover:bg-surface-subtle'" data-cy="needs-confirming-everyone" @click="everyone = true">{{ t('Everyone', 'Todos') }}</button>
      </div>
    </header>
    <p v-if="error" role="alert" class="border-b border-line-row px-4 py-2 text-[12.5px] text-danger-text">{{ error }}</p>
    <p v-if="rows.length === 0" class="px-4 py-3 text-[12.5px] text-ink-faint">{{ t('Everything until tomorrow night is confirmed.', 'Todo hasta mañana por la noche está confirmado.') }}</p>
    <ul v-else class="divide-y divide-line-row">
      <li v-for="r in visible" :key="r.id" class="flex flex-wrap items-center gap-x-3 gap-y-2 px-4 py-2.5" data-cy="needs-confirming-row">
        <span class="w-[100px] shrink-0 whitespace-nowrap text-[12px] font-medium text-ink-muted2">{{ when(r.starts_at) }}</span>
        <span class="min-w-0 flex-1">
          <span class="flex items-center gap-1.5">
            <span class="truncate text-[13.5px] font-[560] text-ink-900" :class="{ 'blur-sm select-none': privacyMode }">{{ r.patients?.first_name }} {{ r.patients?.last_name }}</span>
            <PractitionerNoShowRiskPill :risk="risk.get(r.patient_id)" />
          </span>
          <span class="block truncate text-[11.5px] text-ink-muted2">
            {{ reason(r) }}<template v-if="reason(r) && everyone && r.team_members?.full_name"> &middot; </template><template v-if="everyone && r.team_members?.full_name">{{ r.team_members.full_name }}</template>
          </span>
        </span>
        <span class="flex shrink-0 items-center gap-1.5">
          <a v-if="phones.get(r.patient_id)" :href="telHref(phones.get(r.patient_id)!)" class="flex h-8 items-center rounded-ctl border border-line-control px-2.5 text-[12.5px] font-medium text-ink-700 hover:bg-surface-subtle touch:h-10" data-cy="needs-confirming-call">{{ t('Call', 'Llamar') }}</a>
          <button type="button" class="flex h-8 items-center rounded-ctl border border-line-control px-2.5 text-[12.5px] font-medium text-ink-700 hover:bg-surface-subtle touch:h-10" data-cy="needs-confirming-message" @click="emit('message', r.patient_id)">{{ t('Message', 'Escribir') }}</button>
          <button type="button" class="flex h-8 items-center rounded-ctl bg-brand px-2.5 text-[12.5px] font-semibold text-white disabled:opacity-50 touch:h-10" :disabled="confirmingId === r.id" data-cy="needs-confirming-confirm" @click="markConfirmed(r)">{{ t('Confirmed', 'Confirmada') }}</button>
        </span>
      </li>
    </ul>
    <button v-if="ordered.length > SHOWN" type="button" class="w-full border-t border-line-row py-2 text-[12.5px] font-medium text-brand-text hover:bg-surface-subtle" @click="showAll = !showAll">
      {{ showAll ? t('Show fewer', 'Ver menos') : t(`Show all ${ordered.length}`, `Ver las ${ordered.length}`) }}
    </button>
  </section>
</template>
