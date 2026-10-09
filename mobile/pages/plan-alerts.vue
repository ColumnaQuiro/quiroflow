<script setup lang="ts">
// Planes con retraso: patients on an active care plan whose next visit is
// overdue by the plan's own cadence, with nothing booked -- the web's Care
// Plan Alerts (pages/care-plan-alerts.vue, care_plan_continuity_alerts),
// gated as the web sidebar gates it (recalls_access). The plan-aware twin of
// Recordatorios, and the same row actions: WhatsApp (the template sheet),
// call, book.
//
// Below the plans, the patients who have stopped doing their home exercises
// (exercise_adherence_alerts), under the same Mine / Whole clinic switch.
import { formatPhoneDisplay } from '../../utils/phone'

definePageMeta({ layout: 'practitioner' })

const user = useSupabaseUser()
watch(user, (u) => { if (!u) navigateTo('/login') }, { immediate: true })

interface Alert {
  patient_id: string
  first_name: string
  last_name: string | null
  preferred_language: string | null
  care_plan_name: string | null
  frequency_value: number
  visits_per_period: number | null
  frequency_unit: string
  total_visits: number
  visits_remaining: number
  last_appointment_at: string
  due_date: string
  days_overdue: number
  default_practitioner_id: string | null
}

interface ExerciseAlert {
  patient_id: string
  first_name: string
  last_name: string | null
  preferred_language: string | null
  active_exercises: number
  last_done_on: string | null
  days_without: number
}

const supabase = useSupabaseClient()
const t = useT()
const router = useRouter()
const { context, loading: contextLoading, can, restricted } = usePractitionerContext()
const allowed = computed(() => can('recalls_access'))
const tz = computed(() => context.value?.timeZone ?? DEFAULT_CLINIC_TIMEZONE)

const scope = ref<'mine' | 'all'>('mine')
const rows = ref<Alert[]>([])
const exerciseRows = ref<ExerciseAlert[]>([])
const phones = ref<Record<string, string>>({})
const blocked = ref<Record<string, boolean>>({})
const loading = ref(true)
const loadError = ref('')

let run = 0
async function load(silent = false) {
  if (!context.value || !allowed.value) return
  const mine = ++run
  if (!silent) loading.value = true
  loadError.value = ''
  let q = supabase
    .from('care_plan_continuity_alerts')
    .select('patient_id, first_name, last_name, preferred_language, care_plan_name, frequency_value, frequency_unit, visits_per_period, total_visits, visits_remaining, last_appointment_at, due_date, days_overdue, default_practitioner_id')
    .order('days_overdue', { ascending: false })
  let eq = supabase
    .from('exercise_adherence_alerts')
    .select('patient_id, first_name, last_name, preferred_language, active_exercises, last_done_on, days_without')
    .order('days_without', { ascending: false })
  if (scope.value === 'mine') {
    q = q.eq('default_practitioner_id', context.value.teamMemberId)
    eq = eq.eq('default_practitioner_id', context.value.teamMemberId)
  }
  const [{ data, error }, { data: exercises }] = await Promise.all([q, eq])
  if (mine !== run) return
  exerciseRows.value = (exercises as ExerciseAlert[] | null) ?? []
  if (error) {
    loadError.value = t('Could not load the plans.', 'No se han podido cargar los planes.')
    loading.value = false
    return
  }
  rows.value = (data as Alert[] | null) ?? []
  loading.value = false
  const ids = [...new Set([...rows.value, ...exerciseRows.value].map((r) => r.patient_id))]
  if (!ids.length) return
  const [nums, pats] = await Promise.all([
    supabase.from('patient_contact_numbers').select('patient_id, number, country_code, created_at').in('patient_id', ids).order('created_at'),
    supabase.from('patients').select('id, is_minor, do_not_contact').in('id', ids),
  ])
  if (mine !== run) return
  const p: Record<string, string> = {}
  for (const n of (nums.data as { patient_id: string; number: string; country_code: string }[] | null) ?? []) p[n.patient_id] ??= `tel:${formatPhoneDisplay(n.number, n.country_code).replace(/[^\d+]/g, '')}`
  phones.value = p
  blocked.value = Object.fromEntries(((pats.data as { id: string; is_minor: boolean; do_not_contact: boolean }[] | null) ?? []).map((x) => [x.id, !!(x.is_minor || x.do_not_contact)]))
}
watch([() => context.value?.teamMemberId, scope, allowed], () => load(), { immediate: true })

const nameOf = (r: { first_name: string; last_name: string | null }) => `${r.first_name} ${r.last_name ?? ''}`.trim()
const initialsOf = (r: { first_name: string; last_name: string | null }) => ((r.first_name?.[0] ?? '') + (r.last_name?.[0] ?? '')).toUpperCase() || '?'
const shortDate = (iso: string) => new Date(iso.length === 10 ? `${iso}T12:00:00Z` : iso).toLocaleDateString(t('en-GB', 'es-ES'), { day: 'numeric', month: 'short', timeZone: iso.length === 10 ? 'UTC' : tz.value })
const cadence = (r: Alert) => cadenceLabel({ frequency_value: r.frequency_value, frequency_unit: r.frequency_unit, visits_per_period: r.visits_per_period }, t)
const canWhatsApp = (r: { patient_id: string }) => can('communication_config') && !!phones.value[r.patient_id] && !blocked.value[r.patient_id]
const canBook = computed(() => !!context.value && !restricted('calendar_read_only') && (context.value.isOwner || context.value.permissions.calendar_scope !== 'none'))
const sendingTo = ref<{ patient_id: string; first_name: string; preferred_language: string | null } | null>(null)
function onSent() {
  sendingTo.value = null
  load(true)
}
</script>

<template>
  <div class="flex h-full min-h-0 flex-col bg-surface-page" data-cy="plan-alerts">
    <AppPageHeader :title="t('Plans behind schedule', 'Planes con retraso')" back @back="router.back()" />

    <p v-if="!contextLoading && !allowed" class="m-4 rounded-card border border-line bg-surface px-3.5 py-3 text-[13.5px] text-ink-muted">{{ t('Your role does not include recalls.', 'Tu rol no incluye los recordatorios.') }}</p>
    <template v-else>
      <div class="shrink-0 border-b border-line bg-surface px-3 pb-2 pt-2 md:px-5">
        <div class="mx-auto max-w-[760px]">
          <div role="tablist" class="grid grid-cols-2 gap-1 rounded-ctl bg-chip-bg p-[3px] md:max-w-[360px]">
            <button v-for="s in (['mine', 'all'] as const)" :key="s" type="button" role="tab" :aria-selected="scope === s" class="h-8 rounded-ctlSm text-[13px] font-semibold" :class="scope === s ? 'bg-surface text-ink-900 shadow-card' : 'text-ink-muted'" :data-cy="`plan-alerts-scope-${s}`" @click="scope = s">
              {{ s === 'mine' ? t('My patients', 'Mis pacientes') : t('Whole clinic', 'Toda la clínica') }}
            </button>
          </div>
          <p class="mt-1.5 text-[12.5px] leading-snug text-ink-muted">{{ t('On a care plan, overdue by its own cadence, nothing booked.', 'Con plan de tratamiento, con retraso según su frecuencia y sin cita.') }}</p>
        </div>
      </div>

      <div class="min-h-0 flex-1 overflow-y-auto px-3 py-3 md:px-5" style="padding-bottom: max(env(safe-area-inset-bottom), 1rem)">
        <AppSkeletonList v-if="contextLoading || loading" :rows="5" />
        <p v-else-if="loadError" class="rounded-card border border-danger-border bg-danger-bg px-3.5 py-3 text-[13.5px] text-danger-text">
          {{ loadError }} <button type="button" class="ml-1 font-semibold underline" @click="load()">{{ t('Try again', 'Reintentar') }}</button>
        </p>
        <p v-else-if="!rows.length && !exerciseRows.length" class="mt-10 text-center text-[14px] text-ink-muted" data-cy="plan-alerts-empty">{{ t('No care plans behind schedule.', 'Ningún plan de tratamiento con retraso.') }}</p>
        <div v-else class="mx-auto flex max-w-[760px] flex-col gap-2">
          <p v-if="!rows.length" class="py-2 text-center text-[13.5px] text-ink-muted">{{ t('No care plans behind schedule.', 'Ningún plan de tratamiento con retraso.') }}</p>
          <article v-for="r in rows" :key="r.patient_id" class="rounded-card border border-line bg-surface px-3.5 py-3 shadow-card" data-cy="plan-alert-row">
            <div class="flex items-start gap-3">
              <NuxtLink :to="`/patients/${r.patient_id}`" class="flex min-w-0 flex-1 items-start gap-3">
                <span class="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-brand-tint text-[12px] font-bold text-brand-text">{{ initialsOf(r) }}</span>
                <span class="min-w-0">
                  <span class="block truncate text-[15px] font-semibold text-ink-900">{{ nameOf(r) }}</span>
                  <span class="block truncate text-[12.5px] text-ink-muted">{{ r.care_plan_name ?? t('Care plan', 'Plan') }} · {{ cadence(r) }} · {{ r.total_visits - r.visits_remaining }}/{{ r.total_visits }}</span>
                  <span class="block truncate text-[12.5px] text-ink-muted">{{ t('Last visit', 'Última visita') }} {{ shortDate(r.last_appointment_at) }} · {{ t('due', 'tocaba el') }} {{ shortDate(r.due_date) }}</span>
                </span>
              </NuxtLink>
              <span class="shrink-0 rounded-full border border-danger-border bg-danger-bg px-2 py-0.5 text-[11.5px] font-semibold text-danger-text">{{ r.days_overdue === 1 ? t('1 day', '1 día') : t(`${r.days_overdue} days`, `${r.days_overdue} días`) }}</span>
            </div>
            <div class="mt-2.5 flex gap-2">
              <button v-if="canWhatsApp(r)" type="button" class="flex h-10 flex-1 items-center justify-center gap-1.5 rounded-ctl bg-brand text-[13.5px] font-semibold text-white" data-cy="plan-alert-whatsapp" @click="sendingTo = r">WhatsApp</button>
              <a v-if="phones[r.patient_id]" :href="phones[r.patient_id]" class="flex h-10 flex-1 items-center justify-center rounded-ctl border border-line-control bg-surface text-[13.5px] font-medium text-ink-700" data-cy="plan-alert-call">{{ t('Call', 'Llamar') }}</a>
              <NuxtLink v-if="canBook" :to="`/patients/${r.patient_id}?book=1`" class="flex h-10 flex-1 items-center justify-center rounded-ctl border border-line-control bg-surface text-[13.5px] font-medium text-ink-700" data-cy="plan-alert-book">{{ t('Book', 'Reservar') }}</NuxtLink>
            </div>
          </article>

          <template v-if="exerciseRows.length">
            <h2 class="mt-4 px-1 text-[11px] font-semibold uppercase tracking-[.05em] text-ink-muted">{{ t('Home exercises not being done', 'Ejercicios en casa sin hacer') }}</h2>
            <article v-for="r in exerciseRows" :key="`ex-${r.patient_id}`" class="rounded-card border border-line bg-surface px-3.5 py-3 shadow-card" data-cy="exercise-alert-row">
              <div class="flex items-start gap-3">
                <NuxtLink :to="`/patients/${r.patient_id}`" class="flex min-w-0 flex-1 items-start gap-3">
                  <span class="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-brand-tint text-[12px] font-bold text-brand-text">{{ initialsOf(r) }}</span>
                  <span class="min-w-0">
                    <span class="block truncate text-[15px] font-semibold text-ink-900">{{ nameOf(r) }}</span>
                    <span class="block truncate text-[12.5px] text-ink-muted">
                      {{ r.active_exercises === 1 ? t('1 exercise', '1 ejercicio') : t(`${r.active_exercises} exercises`, `${r.active_exercises} ejercicios`) }} ·
                      {{ r.last_done_on ? `${t('last ticked', 'último marcado')} ${shortDate(r.last_done_on)}` : t('never ticked', 'nunca marcado') }}
                    </span>
                  </span>
                </NuxtLink>
                <span class="shrink-0 rounded-full border border-warning-border bg-warning-bg px-2 py-0.5 text-[11.5px] font-semibold text-warning-text">{{ t(`${r.days_without} days`, `${r.days_without} días`) }}</span>
              </div>
              <div v-if="canWhatsApp(r) || phones[r.patient_id]" class="mt-2.5 flex gap-2">
                <button v-if="canWhatsApp(r)" type="button" class="flex h-10 flex-1 items-center justify-center gap-1.5 rounded-ctl bg-brand text-[13.5px] font-semibold text-white" data-cy="exercise-alert-whatsapp" @click="sendingTo = r">WhatsApp</button>
                <a v-if="phones[r.patient_id]" :href="phones[r.patient_id]" class="flex h-10 flex-1 items-center justify-center rounded-ctl border border-line-control bg-surface text-[13.5px] font-medium text-ink-700">{{ t('Call', 'Llamar') }}</a>
              </div>
            </article>
          </template>
        </div>
      </div>
    </template>

    <WhatsAppTemplateSheet
      v-if="sendingTo"
      :patient-id="sendingTo.patient_id"
      :patient-first-name="sendingTo.first_name"
      :patient-preferred-language="sendingTo.preferred_language"
      @close="sendingTo = null"
      @sent="onSent"
    />
  </div>
</template>
