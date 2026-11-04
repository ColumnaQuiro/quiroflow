<script setup lang="ts">
// The patient's live bonos on their Overview: how many sessions are used and
// how many are left, their own and any shared with them. Read-only -- selling,
// drawing and closing stay on the Money tab, which is billing_history_view's.
// This is here for whoever does not see that tab (a practitioner) and was left
// with no way to tell whether the patient still has sessions to come.
//
// Left out entirely for a patient with no live bono: an empty card on every
// record would be noise.
const props = defineProps<{ patientId: string }>()

const supabase = useSupabaseClient()
const t = useT()

interface Bono {
  id: string
  package_name: string
  sessions_total: number
  sessions_used: number
  owner: string | null
}
const bonos = ref<Bono[]>([])

type Row = { id: string; package_name: string; sessions_total: number; sessions_used: number; is_closed: boolean; patients?: { first_name: string; last_name: string | null } | null }

async function load() {
  const [{ data: own }, { data: shared }] = await Promise.all([
    supabase.from('package_purchases').select('id, package_name, sessions_total, sessions_used, is_closed').eq('patient_id', props.patientId).eq('is_closed', false).order('purchased_at', { ascending: false }),
    supabase.from('package_purchase_shares').select('package_purchases(id, package_name, sessions_total, sessions_used, is_closed, patients(first_name, last_name))').eq('patient_id', props.patientId),
  ])
  const sharedRows = ((shared ?? []) as unknown as { package_purchases: Row | null }[]).map((r) => r.package_purchases).filter((p): p is Row => !!p && !p.is_closed)
  bonos.value = [
    ...((own ?? []) as Row[]).map((p) => ({ ...p, owner: null })),
    ...sharedRows.map((p) => ({ ...p, owner: p.patients ? `${p.patients.first_name} ${p.patients.last_name ?? ''}`.trim() : null })),
  ]
    // The calendar's rule for a live bono: not closed and not used up.
    .filter((p) => p.sessions_used < p.sessions_total)
    .map(({ id, package_name, sessions_total, sessions_used, owner }) => ({ id, package_name, sessions_total, sessions_used, owner }))
}
onMounted(load)
watch(() => props.patientId, load)
</script>

<template>
  <section v-if="bonos.length > 0" aria-labelledby="ov-bonos" class="rounded-card border border-line bg-surface p-4 shadow-card" data-cy="overview-bonos">
    <h2 id="ov-bonos" class="text-[13.5px] font-semibold text-ink-700">{{ bonos.length === 1 ? t('Bono', 'Bono') : t('Bonos', 'Bonos') }}</h2>
    <ul class="mt-2.5 space-y-3">
      <li v-for="b in bonos" :key="b.id" data-cy="overview-bono">
        <p class="text-[14px] text-ink-900">{{ b.package_name }}</p>
        <p class="text-[12.5px] text-ink-muted2">
          <span class="font-semibold text-ink-700" data-cy="overview-bono-left">{{ t(`${b.sessions_total - b.sessions_used} of ${b.sessions_total} left`, `quedan ${b.sessions_total - b.sessions_used} de ${b.sessions_total}`) }}</span>
          · {{ t(`${b.sessions_used} used`, `${b.sessions_used} ${b.sessions_used === 1 ? 'usada' : 'usadas'}`) }}
          <template v-if="b.owner"> · {{ t(`shared by ${b.owner}`, `compartido por ${b.owner}`) }}</template>
        </p>
        <div class="mt-1.5 h-[6px] w-full overflow-hidden rounded-full bg-chip-bg2">
          <div class="h-full rounded-full bg-brand" :style="{ width: `${Math.min(100, Math.round((b.sessions_used / b.sessions_total) * 100))}%` }" />
        </div>
      </li>
    </ul>
  </section>
</template>
