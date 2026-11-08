<script setup lang="ts">
// Recomendaciones, on the phone: the web's pages/reports/referrals.vue, with
// the same reads and the same counts, so a figure here is the figure there.
// Reshaped for a phone: the five-column table is one card per friend -- who
// they are and who brought them, since when and their first visit, and the
// reward control on its own line so it is not inside the link -- the first
// 50 with "Ver más" for the rest. The top referrers are a short list rather
// than a sentence, each opening the referrer. Left out: the "Programme
// settings" link, since Settings is web-only on the app.
import { fetchAllRows } from '../../../composables/useFetchAllRows'

definePageMeta({ layout: 'practitioner' })

// Referrals: who brought whom (patients.referred_by_patient_id -- set by a
// referral link at online booking, or by hand on the record), whether the
// friend has come to their first visit, and whether the clinic has given the
// referrer what it promised (referral_rewarded_at, on the friend's row).
//
// What patients a role may see is what RLS gives it, as on every report.
const PATH = '/reports/referrals'
const t = useT()
const supabase = useSupabaseClient()
const { canOpen, context } = useReportAccess()
const { shown } = usePrivacyMode()

interface Referred {
  id: string
  first_name: string | null
  last_name: string | null
  created_at: string
  referred_by_patient_id: string
  referral_rewarded_at: string | null
  referrer: { id: string; first_name: string | null; last_name: string | null } | null
}

const rows = ref<Referred[]>([])
const firstVisit = ref<Map<string, string>>(new Map())
const loading = ref(true)
const failed = ref(false)
const savingId = ref<string | null>(null)
const error = ref('')

async function load() {
  loading.value = true
  failed.value = false
  error.value = ''
  try {
    await read()
  } catch (e) {
    console.error('[referrals report]', e)
    failed.value = true
  }
  loading.value = false
}
async function read() {
  const list = await fetchAllRows<Referred>((f, tt) =>
    supabase
      .from('patients')
      .select('id, first_name, last_name, created_at, referred_by_patient_id, referral_rewarded_at, referrer:referred_by_patient_id(id, first_name, last_name)')
      .not('referred_by_patient_id', 'is', null)
      .order('created_at', { ascending: false })
      .range(f, tt) as never,
  )
  // Their first attended visit, if they have had one.
  const seen = new Map<string, string>()
  const ids = list.map((r) => r.id)
  for (let i = 0; i < ids.length; i += 200) {
    const { data, error: readError } = await supabase.from('appointments').select('patient_id, starts_at').eq('status', 'completed').is('deleted_at', null).in('patient_id', ids.slice(i, i + 200)).order('starts_at')
    // A failed read here would show every friend as "not yet" and no reward
    // owed: a failed report, not an empty one.
    if (readError) throw readError
    for (const a of (data as { patient_id: string; starts_at: string }[] | null) ?? []) if (!seen.has(a.patient_id)) seen.set(a.patient_id, a.starts_at)
  }
  rows.value = list
  firstVisit.value = seen
}
// Only once the role is known to include it: a refused read would come back
// empty and read as "no referrals yet".
watch(() => !!context.value && canOpen(PATH), (ok) => { if (ok) load() }, { immediate: true })

const name = (p: { first_name: string | null; last_name: string | null } | null) => (p ? `${p.first_name ?? ''} ${p.last_name ?? ''}`.trim() : '')
const when = (iso: string) => new Date(iso).toLocaleDateString(t('en-GB', 'es-ES'), { day: 'numeric', month: 'short', year: 'numeric' })
const came = computed(() => rows.value.filter((r) => firstVisit.value.has(r.id)).length)
const owed = computed(() => rows.value.filter((r) => firstVisit.value.has(r.id) && !r.referral_rewarded_at).length)
// Who has brought the most people. (The id is kept so the row can open them.)
const top = computed(() => {
  const by = new Map<string, { id: string; name: string; count: number }>()
  for (const r of rows.value) {
    const k = r.referred_by_patient_id
    by.set(k, { id: k, name: name(r.referrer), count: (by.get(k)?.count ?? 0) + 1 })
  }
  return [...by.values()].sort((a, b) => b.count - a.count).slice(0, 5)
})

const limit = ref(50)
const shownRows = computed(() => rows.value.slice(0, limit.value))

async function setRewarded(r: Referred, rewarded: boolean) {
  savingId.value = r.id
  error.value = ''
  const at = rewarded ? new Date().toISOString() : null
  const { data, error: saveFailed } = await supabase.from('patients').update({ referral_rewarded_at: at }).eq('id', r.id).select('id')
  savingId.value = null
  if (saveFailed || !data?.length) {
    error.value = t("Couldn't save. Try again.", 'No se ha podido guardar. Inténtalo de nuevo.')
    return
  }
  r.referral_rewarded_at = at
}
</script>

<template>
  <ReportScreen :title="t('Referrals', 'Recomendaciones')" :path="PATH" :description="t('Who brought whom, and who is owed a thank-you', 'Quién trajo a quién, y a quién le debemos un detalle')">
    <div class="flex flex-col gap-3" data-cy="referrals" :data-ready="loading ? undefined : 'true'">
      <p v-if="failed" class="rounded-card border border-danger-border bg-danger-bg px-3.5 py-3 text-[13.5px] text-danger-text" role="alert" data-cy="referrals-failed">
        {{ t('Could not load the report.', 'No se ha podido cargar el informe.') }}
        <button type="button" class="ml-1 min-h-[44px] font-semibold underline" @click="load">{{ t('Try again', 'Reintentar') }}</button>
      </p>

      <div class="grid grid-cols-2 gap-3 md:grid-cols-3">
        <ReportsStat :label="t('Referred', 'Recomendados')" :loading="loading">
          <p class="mt-1.5 font-mono text-[23px] font-semibold text-ink-900" data-cy="referrals-count">{{ rows.length }}</p>
        </ReportsStat>
        <ReportsStat :label="t('Came to a visit', 'Vinieron a consulta')" :loading="loading">
          <p class="mt-1.5 font-mono text-[23px] font-semibold text-ink-900" data-cy="referrals-came">{{ came }}</p>
        </ReportsStat>
        <ReportsStat class="col-span-2 md:col-span-1" :label="t('Reward to give', 'Detalle pendiente')" :loading="loading">
          <p class="mt-1.5 font-mono text-[23px] font-semibold" :class="owed ? 'text-warning-text' : 'text-ink-900'" data-cy="referrals-owed">{{ owed }}</p>
        </ReportsStat>
      </div>

      <ReportsModule v-if="loading || top.length" :title="t('Top referrers', 'Quién más recomienda')" :loading="loading" skeleton="list" :rows="3">
        <ul class="mt-1" data-cy="referrals-top">
          <ReportRow v-for="x in top" :key="x.id" :to="`/patients/${x.id}`" :title="shown(x.name || '—')" :value="String(x.count)" :value-note="t('brought', 'trajo')" />
        </ul>
      </ReportsModule>

      <p v-if="error" role="alert" class="px-1 text-[12.5px] text-danger-text">{{ error }}</p>

      <ReportsModule :title="t('Referred friends', 'Amigos recomendados')" :loading="loading" skeleton="list" :rows="5">
        <p v-if="!rows.length" class="py-4 text-center text-[13.5px] text-ink-faint" data-cy="referrals-empty">{{ t('No referrals yet. Switch the programme on in Settings › Online Booking, or set "Referred by" on a patient.', 'Aún no hay recomendaciones. Activa el programa en Ajustes › Reserva online, o indica «Recomendado por» en un paciente.') }}</p>
        <ul v-else class="mt-1" data-cy="referrals-list">
          <li v-for="r in shownRows" :key="r.id" class="border-b border-line-divider py-1 last:border-b-0" data-cy="referrals-row">
            <NuxtLink :to="`/patients/${r.id}`" class="flex min-h-[48px] items-center gap-3 py-1.5 active:bg-surface-subtle">
              <span class="flex min-w-0 flex-1 flex-col gap-0.5">
                <span class="truncate text-[14.5px] font-medium text-ink-900">{{ shown(name(r) || '—') }}</span>
                <span class="text-[12.5px] leading-snug text-ink-muted">
                  {{ t(`Since ${when(r.created_at)}`, `Desde el ${when(r.created_at)}`) }} ·
                  <span :class="firstVisit.get(r.id) ? 'text-success-text' : 'text-ink-faint'">{{ firstVisit.get(r.id) ? t(`first visit ${when(firstVisit.get(r.id)!)}`, `primera visita ${when(firstVisit.get(r.id)!)}`) : t('no visit yet', 'aún sin visita') }}</span>
                </span>
              </span>
              <AppChevron dir="right" :size="16" class="shrink-0 text-ink-faint" />
            </NuxtLink>
            <div class="flex flex-wrap items-center justify-between gap-x-3 gap-y-1 pb-1.5">
              <NuxtLink :to="`/patients/${r.referred_by_patient_id}`" class="flex min-h-[44px] min-w-0 items-center text-[12.5px] text-ink-muted">
                <span class="truncate">{{ t('Referred by', 'Recomendado por') }} <span class="font-semibold text-ink-700">{{ shown(name(r.referrer) || '—') }}</span></span>
              </NuxtLink>
              <span v-if="r.referral_rewarded_at" class="flex items-center gap-1 text-[12.5px] text-ink-700">
                {{ t(`Given ${when(r.referral_rewarded_at)}`, `Dado el ${when(r.referral_rewarded_at)}`) }}
                <button type="button" class="h-11 px-2 text-[12.5px] text-ink-muted" :disabled="savingId === r.id" data-cy="referrals-undo" @click="setRewarded(r, false)">{{ t('Undo', 'Deshacer') }}</button>
              </span>
              <button v-else-if="firstVisit.get(r.id)" type="button" class="h-11 shrink-0 rounded-ctl border border-line-control px-3 text-[13px] font-semibold text-ink-700 disabled:opacity-50" :disabled="savingId === r.id" data-cy="referrals-mark" @click="setRewarded(r, true)">{{ t('Mark given', 'Marcar como dado') }}</button>
              <span v-else class="text-[12.5px] text-ink-faint">{{ t('Reward after their first visit', 'Detalle tras su primera visita') }}</span>
            </div>
          </li>
        </ul>
        <button v-if="rows.length > limit" type="button" class="mt-1 h-11 w-full rounded-ctl border border-line-control text-[13.5px] font-semibold text-ink-700" data-cy="referrals-more" @click="limit += 50">
          {{ t(`Show more (${rows.length - limit})`, `Ver más (${rows.length - limit})`) }}
        </button>
      </ReportsModule>
    </div>
  </ReportScreen>
</template>
