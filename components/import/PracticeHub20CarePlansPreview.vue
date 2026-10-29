<script setup lang="ts">
import { carePlanOutcome, type CarePlanOutcome, type V3CarePlan } from '~/utils/practicehubCarePlans'
import { formatEur } from '~/utils/billing'

// PracticeHub 2.0 care plans, and what each becomes here: a bono, a
// membership, or nothing to carry over (utils/practicehubCarePlans.ts).
//
// A clinic that has switched to 2.0 has its bonos and memberships there as
// care plans; the Classic "Packages / Bonos" step reads the old packages,
// which stop changing at the switch. READ-ONLY for now: it reads and shows,
// it writes nothing. The write waits for the first switched clinic to check
// the figures against, because a bono's sessions and money are what a
// patient is owed.
const t = useT()
const supabase = useSupabaseClient()
const { get, fetchAll } = usePracticeHubV3()

interface Row {
  planId: number
  patientNumber: string | null
  ourPatient: { id: string; name: string } | null
  phName: string
  outcome: CarePlanOutcome
  status: string
}

const running = ref(false)
const progress = ref('')
const error = ref('')
const rows = ref<Row[] | null>(null)
const includeFinished = ref(false)
// Server-rendered: a click before hydration would do nothing at all.
const hydrated = ref(false)
onMounted(() => (hydrated.value = true))

async function run() {
  running.value = true
  error.value = ''
  rows.value = null
  try {
    progress.value = t('Listing care plans…', 'Listando planes…')
    const filters: Record<string, string> = includeFinished.value ? {} : { status: 'in:active,paused' }
    const list = await fetchAll<{ id: number }>('/care_plans', filters, (n) => (progress.value = t(`Listing care plans… ${n}`, `Listando planes… ${n}`)))

    // The visits and the money are only on the single-plan response.
    const plans: V3CarePlan[] = []
    for (const [i, p] of list.entries()) {
      progress.value = t(`Reading plan ${i + 1} of ${list.length}…`, `Leyendo plan ${i + 1} de ${list.length}…`)
      plans.push((await get<{ data: V3CarePlan }>(`/care_plans/${p.id}`)).data)
    }

    // PracticeHub ids -> patient numbers, which is what our patients keep
    // (patients.external_reference), 100 at a time.
    progress.value = t('Matching patients…', 'Emparejando pacientes…')
    const phIds = [...new Set(plans.map((p) => p.patient_id))]
    const numberByPhId = new Map<number, string>()
    for (let i = 0; i < phIds.length; i += 100) {
      const chunk = phIds.slice(i, i + 100)
      const page = await fetchAll<{ id: number; patient_number: string | null }>('/patients', { id: `in:${chunk.join(',')}` })
      for (const p of page) if (p.patient_number) numberByPhId.set(p.id, p.patient_number)
    }
    const numbers = [...new Set(numberByPhId.values())]
    const ourByNumber = new Map<string, { id: string; name: string }>()
    for (let i = 0; i < numbers.length; i += 200) {
      const { data } = await supabase.from('patients').select('id, first_name, last_name, external_reference').in('external_reference', numbers.slice(i, i + 200))
      for (const p of data ?? []) if (p.external_reference) ourByNumber.set(p.external_reference, { id: p.id, name: [p.first_name, p.last_name].filter(Boolean).join(' ') })
    }

    rows.value = plans.map((p) => {
      const number = numberByPhId.get(p.patient_id) ?? null
      return { planId: p.id, patientNumber: number, ourPatient: number ? ourByNumber.get(number) ?? null : null, phName: p.name, outcome: carePlanOutcome(p), status: p.status }
    })
  } catch (e: any) {
    error.value = e?.data?.statusMessage ?? e?.message ?? t('Could not read PracticeHub 2.0.', 'No se pudo leer PracticeHub 2.0.')
  } finally {
    running.value = false
    progress.value = ''
  }
}

const counts = computed(() => {
  const r = rows.value ?? []
  return {
    bonos: r.filter((x) => x.outcome.kind === 'bono').length,
    memberships: r.filter((x) => x.outcome.kind === 'membership').length,
    skipped: r.filter((x) => x.outcome.kind === 'skip').length,
    unmatched: r.filter((x) => !x.ourPatient).length,
  }
})

const SKIP: Record<string, [string, string]> = {
  no_billing: ['No billing set up', 'Sin cobro configurado'],
  pay_as_you_go: ['Pay as you go: nothing prepaid', 'Pago por visita: nada prepagado'],
  third_party: ['Paid by a third party', 'Pagado por un tercero'],
  postpay: ['Billed after the visits', 'Se cobra después de las visitas'],
}
function becomes(o: CarePlanOutcome): string {
  if (o.kind === 'bono') return t(`Bono · ${o.sessionsTotal - o.sessionsUsed} of ${o.sessionsTotal} left · ${formatEur(o.paidCents)} paid${o.owedCents ? ` · owes ${formatEur(o.owedCents)}` : ''}`, `Bono · quedan ${o.sessionsTotal - o.sessionsUsed} de ${o.sessionsTotal} · ${formatEur(o.paidCents)} pagado${o.owedCents ? ` · debe ${formatEur(o.owedCents)}` : ''}`)
  if (o.kind === 'membership') {
    const every = o.intervalLength === 1 ? t(`per ${o.intervalUnit}`, o.intervalUnit === 'week' ? 'por semana' : o.intervalUnit === 'year' ? 'por año' : 'al mes') : t(`every ${o.intervalLength} ${o.intervalUnit}s`, `cada ${o.intervalLength} ${o.intervalUnit === 'week' ? 'semanas' : o.intervalUnit === 'year' ? 'años' : 'meses'}`)
    return t(`Membership · ${formatEur(o.priceCents)} ${every}`, `Membresía · ${formatEur(o.priceCents)} ${every}`)
  }
  const [en, es] = SKIP[o.reason] ?? ['Not carried over', 'No se traspasa']
  return t(`Skipped · ${en}`, `Se omite · ${es}`)
}
</script>

<template>
  <div class="flex flex-col gap-4">
    <p class="text-sm text-ink-muted2">
      {{ t('For a clinic on PracticeHub 2.0, its bonos and memberships are care plans there. This reads them through the 2.0 API and shows what each would become in QuiroFlow. It is read-only: nothing is written yet.', 'En una clínica que ya está en PracticeHub 2.0, sus bonos y membresías son planes de cuidados. Esto los lee con la API 2.0 y muestra en qué se convertiría cada uno en QuiroFlow. Solo lectura: todavía no escribe nada.') }}
    </p>
    <div class="flex flex-wrap items-center gap-3">
      <button type="button" class="rounded-md bg-brand px-4 py-2 text-sm font-medium text-brand-on hover:bg-brand-hover disabled:opacity-50" :disabled="running || !hydrated" data-cy="ph20-read" @click="run">
        {{ running ? progress || t('Reading…', 'Leyendo…') : t('Read 2.0 care plans', 'Leer planes 2.0') }}
      </button>
      <label class="flex items-center gap-2 text-sm text-ink-700">
        <input v-model="includeFinished" type="checkbox" :disabled="running" />
        {{ t('Include finished and cancelled', 'Incluir terminados y cancelados') }}
      </label>
    </div>
    <p v-if="error" class="text-sm text-danger-text" role="alert" data-cy="ph20-error">{{ error }}</p>

    <template v-if="rows">
      <p v-if="rows.length === 0" class="text-sm text-ink-muted" data-cy="ph20-none">
        {{ t('No 2.0 care plans yet. A clinic still on Classic has its bonos as packages: use the Packages / Bonos step.', 'Todavía no hay planes 2.0. Una clínica que sigue en Classic tiene sus bonos como paquetes: usa el paso Bonos.') }}
      </p>
      <template v-else>
        <p class="text-sm text-ink-700" data-cy="ph20-summary">
          {{ t(`${counts.bonos} bonos · ${counts.memberships} memberships · ${counts.skipped} skipped`, `${counts.bonos} bonos · ${counts.memberships} membresías · ${counts.skipped} se omiten`) }}<template v-if="counts.unmatched"> · <span class="text-warning-text">{{ t(`${counts.unmatched} patients not in QuiroFlow yet (run Patients first)`, `${counts.unmatched} pacientes aún no están en QuiroFlow (importa Pacientes primero)`) }}</span></template>
        </p>
        <div class="overflow-x-auto rounded-card border border-line">
          <table class="w-full text-left text-sm">
            <thead class="bg-surface-subtle text-[12px] text-ink-muted">
              <tr>
                <th class="px-3 py-2 font-medium">{{ t('Patient', 'Paciente') }}</th>
                <th class="px-3 py-2 font-medium">{{ t('Plan in PracticeHub', 'Plan en PracticeHub') }}</th>
                <th class="px-3 py-2 font-medium">{{ t('Becomes', 'Se convierte en') }}</th>
              </tr>
            </thead>
            <tbody>
              <tr v-for="r in rows" :key="r.planId" class="border-t border-line-divider" data-cy="ph20-row" :data-kind="r.outcome.kind">
                <td class="px-3 py-2">
                  <span v-if="r.ourPatient" class="text-ink-900">{{ r.ourPatient.name }}</span>
                  <span v-else class="text-warning-text">{{ t('Not in QuiroFlow', 'No está en QuiroFlow') }} · #{{ r.patientNumber ?? '?' }}</span>
                </td>
                <td class="px-3 py-2 text-ink-700">{{ r.phName }} <span class="text-ink-muted">· {{ r.status }}</span></td>
                <td class="px-3 py-2" :class="r.outcome.kind === 'skip' ? 'text-ink-muted' : 'text-ink-900'">{{ becomes(r.outcome) }}</td>
              </tr>
            </tbody>
          </table>
        </div>
      </template>
    </template>
  </div>
</template>
