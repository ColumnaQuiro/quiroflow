<script setup lang="ts">
import { formatPhoneDisplay } from '~/utils/phone'

// Satisfacción on Growth > Reputation: what patients answered to "¿qué tal
// te hemos atendido?" (satisfaction_surveys, sent by an automation on the
// appointment.satisfaction trigger). The last 30 days' average, how many
// answered, the spread and each practitioner's average; and every 1-3 not
// yet dealt with, with what the patient wrote, a call and "Marcar resuelto".
// Owners are also told about a low score the same day, as a task on My Day
// (server/utils/satisfactionSurvey.ts). Read and resolved under
// communication_config, like the rest of the page.
const t = useT()
const supabase = useSupabaseClient()
const store = useAccountStore()

interface Survey {
  id: string
  sent_at: string
  score: number | null
  comment: string | null
  answered_at: string | null
  resolved_at: string | null
  appointments: { patient_id: string | null; starts_at: string; patients: { first_name: string | null; last_name: string | null } | null; team_members: { full_name: string } | null } | null
}
interface Phone { patient_id: string; number: string; country_code: string }

const recent = ref<Survey[]>([])
const open = ref<Survey[]>([])
const phones = ref<Map<string, Phone>>(new Map())
const hasRule = ref(true)
const loading = ref(true)
const savingId = ref<string | null>(null)
const error = ref('')

const SELECT = 'id, sent_at, score, comment, answered_at, resolved_at, appointments(patient_id, starts_at, patients(first_name, last_name), team_members(full_name))'

async function load() {
  loading.value = true
  const since = new Date(Date.now() - 30 * 86_400_000).toISOString()
  const [{ data: r }, { data: o }, { count }] = await Promise.all([
    supabase.from('satisfaction_surveys').select(SELECT).gte('sent_at', since).order('sent_at', { ascending: false }),
    supabase.from('satisfaction_surveys').select(SELECT).lte('score', 3).is('resolved_at', null).order('answered_at', { ascending: false }).limit(50),
    supabase.from('automation_rules').select('id', { count: 'exact', head: true }).eq('trigger_event', 'appointment.satisfaction'),
  ])
  recent.value = (r as unknown as Survey[] | null) ?? []
  open.value = (o as unknown as Survey[] | null) ?? []
  hasRule.value = (count ?? 0) > 0
  const ids = [...new Set(open.value.map((s) => s.appointments?.patient_id).filter(Boolean) as string[])]
  if (ids.length) {
    const { data: nums } = await supabase.from('patient_contact_numbers').select('patient_id, number, country_code').in('patient_id', ids).order('created_at')
    const by = new Map<string, Phone>()
    for (const n of (nums as Phone[] | null) ?? []) if (!by.has(n.patient_id)) by.set(n.patient_id, n)
    phones.value = by
  }
  loading.value = false
}
onMounted(load)

const answered = computed(() => recent.value.filter((s) => s.score !== null))
const average = computed(() => (answered.value.length ? answered.value.reduce((a, s) => a + s.score!, 0) / answered.value.length : null))
const responseShare = computed(() => (recent.value.length ? Math.round((answered.value.length / recent.value.length) * 100) : null))
const spread = computed(() => [5, 4, 3, 2, 1].map((n) => ({ n, count: answered.value.filter((s) => s.score === n).length })))
const maxCount = computed(() => Math.max(1, ...spread.value.map((b) => b.count)))
const byPractitioner = computed(() => {
  const m = new Map<string, { sum: number; count: number }>()
  for (const s of answered.value) {
    const k = s.appointments?.team_members?.full_name ?? t('No practitioner', 'Sin profesional')
    const v = m.get(k) ?? { sum: 0, count: 0 }
    m.set(k, { sum: v.sum + s.score!, count: v.count + 1 })
  }
  return [...m.entries()].map(([name, v]) => ({ name, avg: v.sum / v.count, count: v.count })).sort((a, b) => b.count - a.count)
})

const fmt = (n: number) => n.toLocaleString(t('en-GB', 'es-ES'), { minimumFractionDigits: 1, maximumFractionDigits: 1 })
const name = (s: Survey) => [s.appointments?.patients?.first_name, s.appointments?.patients?.last_name].filter(Boolean).join(' ')
const when = (iso: string | null) => (iso ? new Date(iso).toLocaleDateString(t('en-GB', 'es-ES'), { day: 'numeric', month: 'short' }) : '')
const telHref = (p: Phone) => `tel:${formatPhoneDisplay(p.number, p.country_code).replace(/[^\d+]/g, '')}`

async function resolve(s: Survey) {
  savingId.value = s.id
  error.value = ''
  const { data, error: failed } = await supabase.from('satisfaction_surveys').update({ resolved_at: new Date().toISOString(), resolved_by: store.teamMember?.id ?? null } as never).eq('id', s.id).select('id')
  savingId.value = null
  if (failed || !data?.length) {
    error.value = t("Couldn't save. Try again.", 'No se ha podido guardar. Inténtalo de nuevo.')
    return
  }
  open.value = open.value.filter((x) => x.id !== s.id)
}
</script>

<template>
  <section class="rounded-card border border-line bg-surface p-4 shadow-card" data-cy="satisfaction-panel" :data-ready="loading ? undefined : 'true'">
    <div class="flex flex-wrap items-center gap-3">
      <h2 class="text-[14px] font-semibold text-ink-900">{{ t('Satisfaction', 'Satisfacción') }}</h2>
      <span class="text-[12px] text-ink-muted">{{ t('"How did we do?" after the visit · last 30 days', '«¿Qué tal te hemos atendido?» tras la visita · últimos 30 días') }}</span>
      <span class="flex-1" />
      <NuxtLink v-if="!loading && !hasRule" to="/automations?templates=1" class="text-[12.5px] font-semibold text-brand-text" data-cy="satisfaction-setup">{{ t('Set it up in Automations', 'Activarla en Automatizaciones') }}</NuxtLink>
    </div>

    <div v-if="loading" class="mt-3 space-y-2"><UiSkeleton class="h-16 w-full rounded-ctl" /><UiSkeleton class="h-24 w-full rounded-ctl" /></div>

    <p v-else-if="!recent.length && !open.length" class="mt-3 text-[13px] text-ink-muted" data-cy="satisfaction-empty">
      {{ hasRule
        ? t('Nothing sent in the last 30 days yet.', 'Aún no se ha enviado nada en los últimos 30 días.')
        : t('Not switched on. The "How did we do?" template asks a 1 to 5 two hours after the first visit and every 10th; low scores come here and to the owners, high ones are offered your Google review page.', 'No está activada. La plantilla «¿Qué tal te hemos atendido?» pregunta del 1 al 5 dos horas después de la primera visita y cada 10; las notas bajas llegan aquí y a los propietarios, las altas se invitan a dejar reseña en Google.') }}
    </p>

    <template v-else>
      <div class="mt-3 grid grid-cols-1 gap-3 sm:grid-cols-3">
        <div class="rounded-ctl border border-line-row p-3">
          <p class="text-[11px] font-[640] uppercase tracking-[.04em] text-ink-muted">{{ t('Average', 'Nota media') }}</p>
          <p class="mt-1 font-mono text-[22px] font-semibold text-ink-900" data-cy="satisfaction-average">{{ average === null ? '—' : fmt(average) }}<span class="text-[12px] font-normal text-ink-muted">/5</span></p>
        </div>
        <div class="rounded-ctl border border-line-row p-3">
          <p class="text-[11px] font-[640] uppercase tracking-[.04em] text-ink-muted">{{ t('Answered', 'Responden') }}</p>
          <p class="mt-1 font-mono text-[22px] font-semibold text-ink-900" data-cy="satisfaction-answered">{{ responseShare === null ? '—' : `${responseShare} %` }}</p>
          <p class="text-[12px] text-ink-muted">{{ t(`${answered.length} of ${recent.length} asked`, `${answered.length} de ${recent.length} preguntas`) }}</p>
        </div>
        <div class="rounded-ctl border border-line-row p-3">
          <p class="text-[11px] font-[640] uppercase tracking-[.04em] text-ink-muted">{{ t('Spread', 'Reparto') }}</p>
          <div class="mt-1.5 space-y-1">
            <div v-for="b in spread" :key="b.n" class="grid grid-cols-[14px_1fr_24px] items-center gap-2 text-[11.5px] text-ink-700">
              <span>{{ b.n }}</span>
              <span class="h-2 overflow-hidden rounded-pill bg-line-divider"><span class="block h-full rounded-pill" :class="b.n >= 4 ? 'bg-brand' : b.n === 3 ? 'bg-warning-accent' : 'bg-danger-text'" :style="{ width: `${(b.count / maxCount) * 100}%` }" /></span>
              <span class="text-right text-ink-muted">{{ b.count }}</span>
            </div>
          </div>
        </div>
      </div>

      <div class="mt-4">
        <h3 class="text-[13px] font-semibold text-ink-900">{{ t('To look at', 'Para revisar') }} <span class="font-normal text-ink-muted">· {{ t('scores of 1 to 3, seen only by owners and managers', 'notas de 1 a 3, solo las ven propietarios y responsables') }}</span></h3>
        <p v-if="!open.length" class="mt-2 text-[12.5px] text-ink-muted" data-cy="satisfaction-no-alerts">{{ t('Nothing to look at.', 'Nada pendiente.') }}</p>
        <ul v-else class="mt-2 divide-y divide-line-divider">
          <li v-for="s in open" :key="s.id" class="flex flex-wrap items-start gap-3 py-2.5" data-cy="satisfaction-alert">
            <span class="flex h-10 w-10 shrink-0 items-center justify-center rounded-ctl font-mono text-[16px] font-semibold" :class="s.score! <= 2 ? 'bg-danger-bg text-danger-text' : 'bg-warning-bg text-warning-text'">{{ s.score }}</span>
            <div class="min-w-0 flex-1">
              <p class="text-[13.5px] font-semibold text-ink-900">
                <NuxtLink v-if="s.appointments?.patient_id" :to="`/patients/${s.appointments.patient_id}`" class="hover:text-brand-text">{{ name(s) }}</NuxtLink>
                <span class="ml-1 text-[12px] font-normal text-ink-muted">· {{ when(s.answered_at) }}{{ s.appointments?.team_members ? ` · ${s.appointments.team_members.full_name}` : '' }}</span>
              </p>
              <p class="mt-0.5 text-[13px] leading-snug" :class="s.comment ? 'text-ink-700' : 'italic text-ink-faint'" data-cy="satisfaction-alert-comment">{{ s.comment ? `«${s.comment}»` : t('No comment', 'Sin comentario') }}</p>
            </div>
            <div class="flex shrink-0 gap-1.5">
              <a v-if="s.appointments?.patient_id && phones.get(s.appointments.patient_id)" :href="telHref(phones.get(s.appointments.patient_id)!)" class="flex h-8 items-center rounded-ctl border border-line-control px-2.5 text-[12.5px] font-medium text-ink-700 hover:bg-surface-subtle">{{ t('Call', 'Llamar') }}</a>
              <UiBtn size="sm" variant="primary" :disabled="savingId === s.id" data-cy="satisfaction-resolve" @click="resolve(s)">{{ t('Mark resolved', 'Marcar resuelto') }}</UiBtn>
            </div>
          </li>
        </ul>
        <p v-if="error" role="alert" class="mt-2 text-[12.5px] text-danger-text">{{ error }}</p>
      </div>

      <div v-if="byPractitioner.length" class="mt-4">
        <h3 class="text-[13px] font-semibold text-ink-900">{{ t('By practitioner', 'Por profesional') }}</h3>
        <div class="mt-1.5 grid grid-cols-[1fr_70px_90px] gap-x-3 gap-y-1 text-[12.5px]">
          <template v-for="p in byPractitioner" :key="p.name">
            <span class="text-ink-700">{{ p.name }}</span><span class="font-semibold text-ink-900">{{ fmt(p.avg) }}</span><span class="text-ink-muted">{{ t(`${p.count} answers`, `${p.count} respuestas`) }}</span>
          </template>
        </div>
      </div>
    </template>
  </section>
</template>
