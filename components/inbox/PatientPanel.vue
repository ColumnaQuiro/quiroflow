<script setup lang="ts">
import { formatShortDate, formatTime } from '~/utils/billing'

// Beside an Inbox thread: the patient behind it, so a reply about a visit can
// be written without leaving to look it up. Balance and bono come from the
// same summary the patient record uses, so the two never disagree.
const props = defineProps<{ patientId: string }>()
const supabase = useSupabaseClient()
const t = useT()

const { outstandingCents, availableCents, activePackages } = usePatientFinancialSummary(() => props.patientId)

interface Visit {
  starts_at: string
  team_members: { full_name: string } | null
  appointment_types: { name: string } | null
  clinics: { name: string } | null
}
const name = ref('')
const phone = ref<string | null>(null)
const next = ref<Visit | null>(null)
const last = ref<Visit | null>(null)
const recall = ref<{ status: string | null; snoozedUntil: string | null; days: number | null }>({ status: null, snoozedUntil: null, days: null })
const ready = ref(false)

onMounted(async () => {
  const now = new Date().toISOString()
  const visitCols = 'starts_at, team_members(full_name), appointment_types(name), clinics(name)'
  const [p, numbers, upcoming, past, candidate] = await Promise.all([
    supabase.from('patients').select('first_name, last_name, recall_status, recall_snoozed_until').eq('id', props.patientId).maybeSingle(),
    supabase.from('patient_contact_numbers').select('number, country_code, is_whatsapp').eq('patient_id', props.patientId),
    supabase.from('appointments').select(visitCols).eq('patient_id', props.patientId).is('deleted_at', null).neq('status', 'cancelled').gte('starts_at', now).order('starts_at').limit(1).maybeSingle(),
    supabase.from('appointments').select(visitCols).eq('patient_id', props.patientId).is('deleted_at', null).not('status', 'in', '(cancelled,no_show)').lt('starts_at', now).order('starts_at', { ascending: false }).limit(1).maybeSingle(),
    supabase.from('recall_candidates').select('days_since_last_appointment').eq('patient_id', props.patientId).maybeSingle(),
  ])
  name.value = p.data ? `${p.data.first_name} ${p.data.last_name ?? ''}`.trim() : ''
  const n = (numbers.data ?? []).find((x) => x.is_whatsapp) ?? numbers.data?.[0]
  phone.value = n?.number ?? null
  next.value = (upcoming.data as unknown as Visit) ?? null
  last.value = (past.data as unknown as Visit) ?? null
  recall.value = { status: p.data?.recall_status ?? null, snoozedUntil: p.data?.recall_snoozed_until ?? null, days: candidate.data?.days_since_last_appointment ?? null }
  ready.value = true
})

function when(v: Visit) {
  return `${new Date(v.starts_at).toLocaleDateString('es-ES', { weekday: 'short', day: 'numeric', month: 'short' })} · ${formatTime(v.starts_at)}`
}
const recallText = computed(() => {
  if (next.value) return t('Up to date: has a visit booked.', 'Al día: tiene cita reservada.')
  if (recall.value.status === 'dismissed') return t('Dismissed from recalls.', 'Descartado de recordatorios.')
  if (recall.value.snoozedUntil && recall.value.snoozedUntil > new Date().toISOString().slice(0, 10)) {
    return t(`Snoozed until ${formatShortDate(recall.value.snoozedUntil)}.`, `Pospuesto hasta el ${formatShortDate(recall.value.snoozedUntil)}.`)
  }
  if (recall.value.days !== null) {
    const w = Math.floor(recall.value.days / 7)
    return w >= 1 ? t(`${w} weeks since the last visit, nothing booked.`, `${w} semanas desde la última visita, sin cita.`) : t('Seen recently, nothing booked.', 'Vino hace poco, sin cita.')
  }
  return t('No visits yet.', 'Aún sin visitas.')
})
const bonos = computed(() => activePackages.value.filter((b) => b.sessions_total > b.sessions_used))
</script>

<template>
  <aside :aria-label="t('Patient', 'Paciente')" class="w-[300px] shrink-0 flex-col 2xl:w-[340px] gap-3 overflow-y-auto border-l border-line bg-surface-subtle p-4" data-cy="inbox-patient-panel" :data-ready="ready ? 'true' : undefined">
    <div class="flex flex-col gap-0.5">
      <strong class="text-[16px] text-ink-900">{{ name }}</strong>
      <span v-if="phone" class="text-[13px] text-ink-muted">{{ phone }}</span>
    </div>
    <div class="flex gap-2">
      <NuxtLink :to="`/patients/${patientId}`" class="flex h-9 touch:h-11 flex-1 items-center justify-center rounded-ctl border border-line-control bg-surface text-[14px] font-semibold text-ink-700 hover:bg-surface-subtle">{{ t('Open record', 'Abrir ficha') }}</NuxtLink>
      <NuxtLink to="/calendar" class="flex h-9 touch:h-11 flex-1 items-center justify-center rounded-ctl bg-brand text-[14px] font-bold text-surface hover:bg-brand-hover">{{ t('Book visit', 'Reservar cita') }}</NuxtLink>
    </div>
    <div class="flex flex-col gap-1 rounded-card border border-line bg-surface p-3.5" data-cy="inbox-panel-next">
      <span class="text-[12px] font-bold uppercase tracking-[.04em] text-ink-muted">{{ t('Next visit', 'Próxima cita') }}</span>
      <template v-if="next">
        <strong class="text-[14.5px] text-ink-900">{{ when(next) }}</strong>
        <span class="text-[13px] text-ink-500">{{ [next.appointment_types?.name, next.team_members?.full_name, next.clinics?.name].filter(Boolean).join(' · ') }}</span>
      </template>
      <strong v-else class="text-[14.5px] text-ink-700">{{ t('Nothing booked', 'Sin próxima cita') }}</strong>
    </div>
    <div class="grid grid-cols-2 gap-2.5">
      <div class="flex flex-col gap-1 rounded-card border border-line bg-surface p-3.5">
        <span class="text-[12px] font-bold uppercase tracking-[.04em] text-ink-muted">{{ t('Last visit', 'Última visita') }}</span>
        <strong class="text-[14.5px] text-ink-900">{{ last ? formatShortDate(last.starts_at) : '—' }}</strong>
      </div>
      <div class="flex flex-col items-start gap-1 rounded-card border border-line bg-surface p-3.5">
        <span class="text-[12px] font-bold uppercase tracking-[.04em] text-ink-muted">{{ t('Balance', 'Saldo') }}</span>
        <UiBalancePill :available-cents="availableCents" :outstanding-cents="outstandingCents" />
      </div>
    </div>
    <div class="flex flex-col gap-1 rounded-card border border-line bg-surface p-3.5" data-cy="inbox-panel-recall">
      <span class="text-[12px] font-bold uppercase tracking-[.04em] text-ink-muted">{{ t('Recall', 'Recordatorio') }}</span>
      <span class="text-[14px] text-ink-900">{{ recallText }}</span>
    </div>
    <div v-if="bonos.length" class="flex flex-col gap-1 rounded-card border border-line bg-surface p-3.5">
      <span class="text-[12px] font-bold uppercase tracking-[.04em] text-ink-muted">{{ t('Bono', 'Bono') }}</span>
      <span v-for="b in bonos" :key="b.id" class="text-[14px] text-ink-900">{{ b.package_name }} · {{ t(`${b.sessions_total - b.sessions_used} left`, `quedan ${b.sessions_total - b.sessions_used}`) }}</span>
    </div>
  </aside>
</template>
