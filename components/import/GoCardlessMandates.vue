<script setup lang="ts">
// Settings > Import > Direct debits (GoCardless): the mandates already in the
// clinic's GoCardless account -- signed through PracticeHub, usually -- paired
// with their patients here, so QuiroFlow can collect on them and nobody signs
// again (server/api/gocardless/mandates/*).
//
// Nothing is paired without someone confirming it: a wrong pair would charge
// one patient's membership to another's bank. The suggestion (by email, phone
// or name, utils/gocardlessMatch.ts) is only a starting point.
//
// It also shows what is already collecting on each mandate. On a clinic in
// the middle of leaving PracticeHub, that is PracticeHub's subscription, and
// it has to be cancelled -- the subscription, never the mandate -- before
// QuiroFlow starts its own, or the patient pays twice.

const supabase = useSupabaseClient()
const store = useAccountStore()
const t = useT()
const { showToast } = useToast()

interface MandateRow {
  id: string
  status: string
  scheme: string | null
  reference: string | null
  createdAt: string
  customer: { name: string; email: string | null } | null
  bank: { name: string | null; ending: string | null } | null
  matched: boolean
  patient: { id: string; name: string } | null
  suggestedBy: 'email' | 'phone' | 'name' | 'manual' | null
  ambiguous: boolean
  subscriptions: { id: string; name: string | null; status: string; amountCents: number; intervalUnit: string; interval: number; nextChargeDate: string | null; ours: boolean }[]
}

const loading = ref(true)
const notConnected = ref(false)
const loadError = ref('')
const mandates = ref<MandateRow[]>([])
const otherSubscriptionsKnown = ref(true)
const filter = ref<'all' | 'unmatched' | 'matched'>('all')

async function load() {
  loading.value = true
  loadError.value = ''
  try {
    const res = await useStaffFetch<{ mandates: MandateRow[]; otherSubscriptionsKnown: boolean }>('/api/gocardless/mandates')
    mandates.value = res.mandates
    otherSubscriptionsKnown.value = res.otherSubscriptionsKnown
    notConnected.value = false
  } catch (e: any) {
    if (e?.statusCode === 409 || e?.response?.status === 409) notConnected.value = true
    else loadError.value = e?.data?.statusMessage ?? t('Could not read GoCardless.', 'No se pudo leer GoCardless.')
  } finally {
    loading.value = false
  }
}
onMounted(load)

const counts = computed(() => ({
  all: mandates.value.length,
  matched: mandates.value.filter((m) => m.matched).length,
  unmatched: mandates.value.filter((m) => !m.matched).length,
}))
const shown = computed(() => mandates.value.filter((m) => filter.value === 'all' || (filter.value === 'matched' ? m.matched : !m.matched)))
const confirmable = computed(() => mandates.value.filter((m) => !m.matched && m.patient && !m.ambiguous))

const busy = ref<string | null>(null)
async function confirm(m: MandateRow, patientId = m.patient?.id, by = m.suggestedBy ?? 'manual') {
  if (!patientId) return
  busy.value = m.id
  try {
    await useStaffFetch('/api/gocardless/mandates/match', { method: 'POST', body: { mandateId: m.id, patientId, matchedBy: by } })
    m.matched = true
    if (picking.value === m.id) picking.value = null
  } catch (e: any) {
    showToast(e?.data?.statusMessage ?? t('Could not save the match.', 'No se pudo guardar el emparejamiento.'), 'error')
  } finally {
    busy.value = null
  }
}

async function confirmAll() {
  for (const m of confirmable.value) await confirm(m)
  showToast(t('Suggested matches confirmed.', 'Emparejamientos sugeridos confirmados.'))
}

async function unmatch(m: MandateRow) {
  busy.value = m.id
  try {
    await useStaffFetch('/api/gocardless/mandates/unmatch', { method: 'POST', body: { mandateId: m.id } })
    m.matched = false
    m.patient = null
    m.suggestedBy = null
  } catch (e: any) {
    showToast(e?.data?.statusMessage ?? t('Could not undo the match.', 'No se pudo deshacer el emparejamiento.'), 'error')
  } finally {
    busy.value = null
  }
}

// Choosing a different patient: the same search the merge dialog uses.
const picking = ref<string | null>(null)
const search = ref('')
const results = ref<{ id: string; first_name: string; last_name: string | null; email: string | null }[]>([])
let searchToken = 0
watch(search, async (value) => {
  const term = value.trim().replace(/[,()]/g, ' ')
  if (term.length < 2) {
    results.value = []
    return
  }
  const token = ++searchToken
  const { data } = await supabase
    .from('patients')
    .select('id, first_name, last_name, email')
    .eq('account_id', store.accountId!)
    .or(`first_name.ilike.%${term}%,last_name.ilike.%${term}%,email.ilike.%${term}%`)
    .order('first_name')
    .limit(8)
  if (token === searchToken) results.value = data ?? []
})
function startPicking(m: MandateRow) {
  picking.value = m.id
  search.value = m.customer?.name ?? ''
}

const suggestedLabel = (by: MandateRow['suggestedBy']) =>
  by === 'email' ? t('same email', 'mismo email') : by === 'phone' ? t('same phone', 'mismo teléfono') : by === 'name' ? t('same name', 'mismo nombre') : t('chosen by hand', 'elegido a mano')

const everyLabel = (unit: string, n: number) => {
  if (unit === 'weekly') return n === 1 ? t('every week', 'cada semana') : t(`every ${n} weeks`, `cada ${n} semanas`)
  if (unit === 'yearly') return n === 1 ? t('every year', 'cada año') : t(`every ${n} years`, `cada ${n} años`)
  return n === 1 ? t('every month', 'cada mes') : t(`every ${n} months`, `cada ${n} meses`)
}
</script>

<template>
  <div class="flex flex-col gap-4" data-cy="gocardless-mandates">
    <p class="text-[13.5px] leading-snug text-ink-600">
      {{ t('Your patients’ direct debit mandates in GoCardless, including the ones signed through PracticeHub. Pair each one with its patient and QuiroFlow can collect their membership on it, without the patient signing anything again.', 'Las domiciliaciones de tus pacientes en GoCardless, también las firmadas a través de PracticeHub. Empareja cada una con su paciente y QuiroFlow podrá cobrar su membresía con ella, sin que el paciente vuelva a firmar nada.') }}
    </p>

    <div class="rounded-ctl border border-warning-border bg-warning-bg px-3 py-2.5 text-[13px] leading-snug text-warning-text">
      {{ t('Moving a membership from PracticeHub: cancel PracticeHub’s subscription for that patient — the subscription, never the mandate — and then start the direct debit in QuiroFlow from the patient’s Billing tab. A cancelled mandate is the one thing that would make the patient sign again.', 'Para pasar una membresía desde PracticeHub: cancela en PracticeHub la suscripción de ese paciente —la suscripción, nunca la domiciliación— y luego activa el cobro domiciliado en QuiroFlow desde la pestaña Facturación del paciente. Cancelar la domiciliación es lo único que obligaría al paciente a volver a firmar.') }}
    </div>

    <div v-if="loading" class="flex flex-col gap-2">
      <UiSkeleton v-for="i in 4" :key="i" class="h-12 w-full" />
    </div>

    <div v-else-if="notConnected" class="rounded-ctl border border-line bg-surface-subtle px-4 py-3 text-[13.5px] text-ink-700" data-cy="gocardless-not-connected">
      {{ t('GoCardless is not connected yet.', 'GoCardless aún no está conectado.') }}
      <NuxtLink to="/settings/payments" class="font-semibold text-brand-text hover:underline">{{ t('Connect it in Settings › Payments', 'Conéctalo en Ajustes › Pagos') }}</NuxtLink>
    </div>

    <p v-else-if="loadError" class="text-[13px] font-semibold text-danger-text">{{ loadError }}</p>

    <template v-else>
      <div v-if="!otherSubscriptionsKnown" class="rounded-ctl border border-line bg-surface-subtle px-3 py-2.5 text-[13px] text-ink-700">
        {{ t('GoCardless does not show QuiroFlow the subscriptions other apps created, so whether PracticeHub is still collecting on a mandate is not shown here. Check it in PracticeHub or in your GoCardless dashboard.', 'GoCardless no le muestra a QuiroFlow las suscripciones creadas por otras apps, así que aquí no se ve si PracticeHub sigue cobrando con una domiciliación. Compruébalo en PracticeHub o en tu panel de GoCardless.') }}
      </div>

      <div class="flex flex-wrap items-center gap-2">
        <button
          v-for="f in (['all', 'unmatched', 'matched'] as const)"
          :key="f"
          type="button"
          class="rounded-pill border px-3 py-1 text-[12.5px] font-semibold"
          :class="filter === f ? 'border-brand bg-brand-tint text-brand-text' : 'border-line text-ink-600 hover:bg-surface-subtle'"
          :data-cy="`gocardless-filter-${f}`"
          @click="filter = f"
        >
          {{ f === 'all' ? t('All', 'Todas') : f === 'matched' ? t('Paired', 'Emparejadas') : t('To pair', 'Por emparejar') }} · {{ counts[f] }}
        </button>
        <span class="flex-1" />
        <UiBtn v-if="confirmable.length" variant="primary" :disabled="Boolean(busy)" data-cy="gocardless-confirm-all" @click="confirmAll">
          {{ t(`Confirm ${confirmable.length} suggested`, `Confirmar ${confirmable.length} sugeridas`) }}
        </UiBtn>
      </div>

      <UiEmptyState v-if="!mandates.length" :title="t('No active mandates in this GoCardless account.', 'No hay domiciliaciones activas en esta cuenta de GoCardless.')" />

      <ul v-else class="flex flex-col divide-y divide-line-row rounded-card border border-line">
        <li v-for="m in shown" :key="m.id" class="flex flex-col gap-2 px-4 py-3" data-cy="gocardless-mandate" :data-mandate="m.id">
          <div class="flex flex-wrap items-start gap-x-4 gap-y-2">
            <div class="flex min-w-[200px] flex-1 flex-col">
              <strong class="text-[14px] text-ink-900">{{ m.customer?.name || t('No name in GoCardless', 'Sin nombre en GoCardless') }}</strong>
              <span class="text-[12.5px] text-ink-muted">
                {{ m.customer?.email ?? '' }}<template v-if="m.bank?.ending"> · {{ m.bank.name ?? t('Bank', 'Banco') }} ••{{ m.bank.ending }}</template> · {{ m.id }}
              </span>
            </div>

            <div class="flex min-w-[220px] flex-1 flex-col gap-1">
              <template v-if="m.patient && picking !== m.id">
                <span class="text-[13.5px] text-ink-900">
                  → <NuxtLink :to="`/patients/${m.patient.id}`" class="font-semibold hover:underline">{{ m.patient.name }}</NuxtLink>
                </span>
                <span class="flex flex-wrap items-center gap-1.5 text-[12px]">
                  <UiPill v-if="m.matched" tone="success" dot data-cy="gocardless-paired">{{ t('Paired', 'Emparejada') }}</UiPill>
                  <UiPill v-else tone="neutral">{{ t('Suggested', 'Sugerida') }}: {{ suggestedLabel(m.suggestedBy) }}</UiPill>
                </span>
              </template>
              <span v-else-if="picking !== m.id" class="text-[13px] text-ink-muted">
                {{ m.ambiguous ? t('Several patients could be this one: choose.', 'Varios pacientes podrían ser este: elige.') : t('No patient found: choose one.', 'No se ha encontrado paciente: elige uno.') }}
              </span>
              <div v-if="picking === m.id" class="flex flex-col gap-1">
                <input
                  v-model="search"
                  type="search"
                  class="h-9 rounded-ctl border border-line-control bg-surface px-3 text-[13.5px]"
                  :placeholder="t('Search a patient', 'Buscar un paciente')"
                  data-cy="gocardless-patient-search"
                >
                <button
                  v-for="p in results"
                  :key="p.id"
                  type="button"
                  class="rounded-ctlSm px-2 py-1.5 text-left text-[13px] hover:bg-surface-subtle"
                  data-cy="gocardless-patient-option"
                  @click="confirm(m, p.id, 'manual').then(() => { m.patient = { id: p.id, name: `${p.first_name} ${p.last_name ?? ''}`.trim() }; m.suggestedBy = 'manual' })"
                >
                  {{ p.first_name }} {{ p.last_name }} <span class="text-ink-muted">{{ p.email }}</span>
                </button>
                <button type="button" class="self-start text-[12.5px] text-ink-600 hover:underline" @click="picking = null">{{ t('Cancel', 'Cancelar') }}</button>
              </div>
            </div>

            <div class="flex shrink-0 flex-wrap items-center gap-2">
              <UiBtn v-if="!m.matched && m.patient && picking !== m.id" variant="primary" :disabled="busy === m.id" data-cy="gocardless-confirm" @click="confirm(m)">{{ t('Confirm', 'Confirmar') }}</UiBtn>
              <UiBtn v-if="!m.matched && picking !== m.id" :disabled="busy === m.id" data-cy="gocardless-choose" @click="startPicking(m)">{{ m.patient ? t('Change', 'Cambiar') : t('Choose patient', 'Elegir paciente') }}</UiBtn>
              <UiBtn v-if="m.matched" :disabled="busy === m.id" data-cy="gocardless-unmatch" @click="unmatch(m)">{{ t('Unpair', 'Desemparejar') }}</UiBtn>
            </div>
          </div>

          <ul v-if="m.subscriptions.length" class="flex flex-col gap-1 pl-1">
            <li v-for="s in m.subscriptions" :key="s.id" class="flex flex-wrap items-center gap-2 text-[12.5px]" data-cy="gocardless-subscription">
              <UiPill :tone="s.ours ? 'success' : 'warning'">{{ s.ours ? 'QuiroFlow' : t('Another app (e.g. PracticeHub)', 'Otra app (p. ej. PracticeHub)') }}</UiPill>
              <span class="text-ink-700">{{ s.name ?? s.id }} · {{ formatEur(s.amountCents) }} {{ everyLabel(s.intervalUnit, s.interval) }}</span>
              <span v-if="s.nextChargeDate" class="text-ink-muted">· {{ t('next charge', 'próximo cobro') }} {{ s.nextChargeDate }}</span>
            </li>
          </ul>
        </li>
      </ul>
    </template>
  </div>
</template>
