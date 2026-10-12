<script setup lang="ts">
import { fetchAllRows } from '~/composables/useFetchAllRows'

// Referrals: who brought whom (patients.referred_by_patient_id -- set by a
// referral link at online booking, or by hand on the record), whether the
// friend has come to their first visit, and whether the clinic has given the
// referrer what it promised (referral_rewarded_at, on the friend's row).
//
// What patients a role may see is what RLS gives it, as on every report.
const t = useT()
const supabase = useSupabaseClient()

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
const savingId = ref<string | null>(null)
const error = ref('')

async function load() {
  loading.value = true
  error.value = ''
  try {
    await read()
  } catch {
    error.value = t("Couldn't load the referrals. Try again.", 'No se han podido cargar las recomendaciones. Inténtalo de nuevo.')
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
    const { data } = await supabase.from('appointments').select('patient_id, starts_at').eq('status', 'completed').is('deleted_at', null).in('patient_id', ids.slice(i, i + 200)).order('starts_at')
    for (const a of (data as { patient_id: string; starts_at: string }[] | null) ?? []) if (!seen.has(a.patient_id)) seen.set(a.patient_id, a.starts_at)
  }
  rows.value = list
  firstVisit.value = seen
}
onMounted(load)

const name = (p: { first_name: string | null; last_name: string | null } | null) => (p ? `${p.first_name ?? ''} ${p.last_name ?? ''}`.trim() : '')
const when = (iso: string) => new Date(iso).toLocaleDateString(t('en-GB', 'es-ES'), { day: 'numeric', month: 'short', year: 'numeric' })
const came = computed(() => rows.value.filter((r) => firstVisit.value.has(r.id)).length)
const owed = computed(() => rows.value.filter((r) => firstVisit.value.has(r.id) && !r.referral_rewarded_at).length)
// Who has brought the most people.
const top = computed(() => {
  const by = new Map<string, { name: string; count: number }>()
  for (const r of rows.value) {
    const k = r.referred_by_patient_id
    by.set(k, { name: name(r.referrer), count: (by.get(k)?.count ?? 0) + 1 })
  }
  return [...by.values()].sort((a, b) => b.count - a.count).slice(0, 5)
})

async function setRewarded(r: Referred, rewarded: boolean) {
  savingId.value = r.id
  error.value = ''
  const at = rewarded ? new Date().toISOString() : null
  const { data, error: failed } = await supabase.from('patients').update({ referral_rewarded_at: at }).eq('id', r.id).select('id')
  savingId.value = null
  if (failed || !data?.length) {
    error.value = t("Couldn't save. Try again.", 'No se ha podido guardar. Inténtalo de nuevo.')
    return
  }
  r.referral_rewarded_at = at
}
const th = 'px-3 py-2 text-left text-[11px] font-medium uppercase tracking-wide text-ink-muted2'
</script>

<template>
  <div class="flex h-full flex-col">
    <PageHeader :title="t('Referrals', 'Recomendaciones')" :meta="t('Who brought whom, and who is owed a thank-you', 'Quién trajo a quién, y a quién le debemos un detalle')">
      <div class="flex items-center gap-3">
        <NuxtLink to="/reports" class="text-[13px] text-ink-muted2 hover:text-ink-600">&larr; {{ t('Reports', 'Informes') }}</NuxtLink>
        <NuxtLink to="/settings/online-booking#referrals" class="text-[13px] font-medium text-brand-text">{{ t('Programme settings', 'Ajustes del programa') }}</NuxtLink>
      </div>
    </PageHeader>

    <div class="flex-1 overflow-y-auto bg-surface-page px-4 pb-10 pt-[18px] sm:px-6" data-cy="referrals" :data-ready="loading ? undefined : 'true'">
      <div class="grid grid-cols-1 gap-4 sm:grid-cols-3">
        <ReportsStat :label="t('Referred', 'Recomendados')" :loading="loading">
          <p class="mt-1.5 font-mono text-[23px] font-semibold text-ink-900" data-cy="referrals-count">{{ rows.length }}</p>
        </ReportsStat>
        <ReportsStat :label="t('Came to a visit', 'Vinieron a consulta')" :loading="loading">
          <p class="mt-1.5 font-mono text-[23px] font-semibold text-ink-900" data-cy="referrals-came">{{ came }}</p>
        </ReportsStat>
        <ReportsStat :label="t('Reward to give', 'Detalle pendiente')" :loading="loading">
          <p class="mt-1.5 font-mono text-[23px] font-semibold" :class="owed ? 'text-warning-text' : 'text-ink-900'" data-cy="referrals-owed">{{ owed }}</p>
        </ReportsStat>
      </div>

      <p v-if="!loading && top.length" class="mt-4 text-[13px] text-ink-700" data-cy="referrals-top">
        <span class="font-semibold">{{ t('Top referrers:', 'Quién más recomienda:') }}</span>
        <template v-for="(x, i) in top" :key="i"> {{ x.name }} ({{ x.count }})<template v-if="i < top.length - 1">,</template></template>
      </p>
      <p v-if="error" role="alert" class="mt-3 text-[12.5px] text-danger-text">{{ error }}</p>

      <div class="mt-4 overflow-x-auto rounded-card border border-line bg-surface shadow-card">
        <div v-if="loading" class="space-y-2 p-4"><UiSkeleton v-for="i in 4" :key="i" class="h-10 w-full rounded-ctl" /></div>
        <p v-else-if="!rows.length" class="p-6 text-center text-[13.5px] text-ink-muted" data-cy="referrals-empty">{{ t('No referrals yet. Switch the programme on in Settings › Online Booking, or set "Referred by" on a patient.', 'Aún no hay recomendaciones. Activa el programa en Ajustes › Reserva online, o indica «Recomendado por» en un paciente.') }}</p>
        <table v-else class="w-full min-w-[640px]">
          <thead class="border-b border-line bg-surface-subtle">
            <tr>
              <th :class="th">{{ t('Referred by', 'Recomendado por') }}</th>
              <th :class="th">{{ t('Friend', 'Amigo') }}</th>
              <th :class="th">{{ t('Since', 'Desde') }}</th>
              <th :class="th">{{ t('First visit', 'Primera visita') }}</th>
              <th :class="th">{{ t('Reward', 'Detalle') }}</th>
            </tr>
          </thead>
          <tbody class="divide-y divide-line-divider">
            <tr v-for="r in rows" :key="r.id" data-cy="referrals-row">
              <td class="px-3 py-2.5 text-[13.5px]"><NuxtLink :to="`/patients/${r.referred_by_patient_id}`" class="font-medium text-ink-900 hover:text-brand-text">{{ name(r.referrer) }}</NuxtLink></td>
              <td class="px-3 py-2.5 text-[13.5px]"><NuxtLink :to="`/patients/${r.id}`" class="text-ink-700 hover:text-brand-text">{{ name(r) }}</NuxtLink></td>
              <td class="px-3 py-2.5 text-[13px] text-ink-muted">{{ when(r.created_at) }}</td>
              <td class="px-3 py-2.5 text-[13px]" :class="firstVisit.get(r.id) ? 'text-success-text' : 'text-ink-faint'">{{ firstVisit.get(r.id) ? when(firstVisit.get(r.id)!) : t('Not yet', 'Aún no') }}</td>
              <td class="px-3 py-2.5 text-[13px]">
                <span v-if="r.referral_rewarded_at" class="text-ink-700">
                  {{ t(`Given ${when(r.referral_rewarded_at)}`, `Dado el ${when(r.referral_rewarded_at)}`) }}
                  <button type="button" class="ml-2 text-[12px] text-ink-muted hover:text-ink-700" :disabled="savingId === r.id" @click="setRewarded(r, false)">{{ t('Undo', 'Deshacer') }}</button>
                </span>
                <button v-else-if="firstVisit.get(r.id)" type="button" class="rounded-ctl border border-line-control px-2.5 py-1 text-[12.5px] font-medium text-ink-700 hover:bg-surface-subtle" :disabled="savingId === r.id" data-cy="referrals-mark" @click="setRewarded(r, true)">{{ t('Mark given', 'Marcar como dado') }}</button>
                <span v-else class="text-ink-faint">{{ t('After their first visit', 'Tras su primera visita') }}</span>
              </td>
            </tr>
          </tbody>
        </table>
      </div>
    </div>
  </div>
</template>
