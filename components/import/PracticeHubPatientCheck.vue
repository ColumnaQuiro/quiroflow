<script setup lang="ts">
// Side-by-side view of one patient in PracticeHub and in QuiroFlow.
//
// Every real bug in this migration was found by someone opening a patient in
// PracticeHub and comparing it by eye -- Joha Chacon's bono that existed
// twice here and once there, Pablo Girelli's two 528 EUR bonos against a
// billing screen showing a single 70 EUR first visit, Ruth Sobrino's five
// "bono visits" drawn on a bono she has never had. Each of those took a
// round trip through a screenshot. This makes it one click, and it works for
// any clinic, not just the one that hit these.
//
// Read-only: nothing here writes.
const supabase = useSupabaseClient()
const t = useT()

interface PHPatient { id: number; patient_number: string; first_name?: string | null; last_name?: string | null; email?: string | null }
interface PHPackage {
  id: number
  patient_id: number | null
  subscribed_patients: { patient_id: number }[] | null
  name: string | null
  package_type: string | null
  active: number | null
  visits: number | null
  visits_left: number | null
  price: number | null
  balance: number | null
  package_balance: number | null
  created: string
}
interface PHInvoice { id: number; patient_id: number | null; total: string | number | null; amount: string | number | null; created: string }
interface PHPayment { id: number; patient_id: number | null; amount: string | number | null; created: string }

const stage = ref<'connect' | 'loading' | 'ready' | 'error'>('connect')
const phase = ref('')
const progress = ref({ done: 0, total: 0 })
const runError = ref('')

const phPatients = ref<PHPatient[]>([])
const phPackages = ref<PHPackage[]>([])
const phInvoices = ref<PHInvoice[]>([])
const phPayments = ref<PHPayment[]>([])

const search = ref('')
const selectedPhId = ref<number | null>(null)

// Our side, loaded per selection.
const ours = ref<{
  patientId: string
  name: string
  reference: string | null
  bonos: { ref: string | null; name: string; total: number; used: number; priceCents: number; purchasedAt: string; visits: number }[]
  creditCents: number
  creditRows: { ref: string | null; amountCents: number; reason: string | null }[]
  visitCount: number
} | null>(null)
const ourLookupError = ref('')

function eur(n: number | null | undefined): string {
  return `€${(Number(n ?? 0)).toFixed(2)}`
}
function eurCents(cents: number): string {
  return `€${(cents / 100).toFixed(2)}`
}
function nameOf(p: PHPatient): string {
  return `${p.first_name ?? ''} ${p.last_name ?? ''}`.trim() || p.patient_number
}
function ownerAndSharers(pkg: PHPackage): number[] {
  const ids = new Set<number>()
  if (pkg.patient_id !== null && pkg.patient_id !== undefined) ids.add(Number(pkg.patient_id))
  for (const s of pkg.subscribed_patients ?? []) if (s?.patient_id !== undefined) ids.add(Number(s.patient_id))
  return [...ids]
}

async function run(conn: { baseUrl: string; apiKey: string; appDetails: string }) {
  stage.value = 'loading'
  runError.value = ''
  const api = usePracticeHubApi(conn)
  try {
    phase.value = t('Loading patients…', 'Cargando pacientes…')
    phPatients.value = await api.fetchAll<PHPatient>('/patients', (done, total) => (progress.value = { done, total }))
    phase.value = t('Loading bonos…', 'Cargando bonos…')
    progress.value = { done: 0, total: 0 }
    phPackages.value = await api.fetchAll<PHPackage>('/patient_packages', (done, total) => (progress.value = { done, total }))
    phase.value = t('Loading invoices…', 'Cargando facturas…')
    progress.value = { done: 0, total: 0 }
    phInvoices.value = await api.fetchAll<PHInvoice>('/invoices', (done, total) => (progress.value = { done, total }))
    phase.value = t('Loading payments…', 'Cargando pagos…')
    progress.value = { done: 0, total: 0 }
    phPayments.value = await api.fetchAll<PHPayment>('/payments', (done, total) => (progress.value = { done, total }))
    stage.value = 'ready'
  } catch (err) {
    runError.value = err instanceof Error ? err.message : String(err)
    stage.value = 'error'
  }
}

const matches = computed(() => {
  const q = search.value.trim().toLowerCase()
  if (q.length < 2) return []
  return phPatients.value
    .filter((p) => nameOf(p).toLowerCase().includes(q) || p.patient_number?.toLowerCase().includes(q))
    .slice(0, 12)
})

const selected = computed(() => phPatients.value.find((p) => p.id === selectedPhId.value) ?? null)

const phBonos = computed(() => {
  const id = selectedPhId.value
  if (id === null) return []
  return phPackages.value
    .filter((pkg) => ownerAndSharers(pkg).includes(id))
    .sort((a, b) => String(a.created).localeCompare(String(b.created)))
})

const phLedger = computed(() => {
  const id = selectedPhId.value
  if (id === null) return { invoices: 0, invoiceTotal: 0, payments: 0, paymentTotal: 0 }
  const inv = phInvoices.value.filter((i) => Number(i.patient_id) === id)
  const pay = phPayments.value.filter((p) => Number(p.patient_id) === id)
  return {
    invoices: inv.length,
    invoiceTotal: inv.reduce((s, i) => s + Number(i.total ?? i.amount ?? 0), 0),
    payments: pay.length,
    paymentTotal: pay.reduce((s, p) => s + Number(p.amount ?? 0), 0),
  }
})

async function loadOurs() {
  ours.value = null
  ourLookupError.value = ''
  const p = selected.value
  if (!p) return

  const { data: patients } = await supabase
    .from('patients')
    .select('id, first_name, last_name, external_reference, email')
    .or(`external_reference.eq.${p.patient_number},email.eq.${(p.email ?? '').trim()}`)
    .limit(2)

  const row = (patients ?? [])[0]
  if (!row) {
    ourLookupError.value = t(
      'No patient here matches this PracticeHub number or email.',
      'Ningún paciente de aquí coincide con este número o email de PracticeHub.',
    )
    return
  }

  const [{ data: bonos }, { data: credits }, { count: visitCount }] = await Promise.all([
    supabase
      .from('package_purchases')
      .select('id, external_reference, package_name, sessions_total, sessions_used, price_cents, purchased_at')
      .eq('patient_id', row.id)
      .order('purchased_at'),
    supabase.from('account_credits').select('external_reference, amount_cents, reason').eq('patient_id', row.id).order('created_at'),
    supabase.from('package_sessions').select('id', { count: 'exact', head: true }).eq('patient_id', row.id),
  ])

  const visitsByBono = new Map<string, number>()
  for (const b of bonos ?? []) {
    const { count } = await supabase
      .from('package_sessions')
      .select('id', { count: 'exact', head: true })
      .eq('package_purchase_id', b.id)
    visitsByBono.set(b.id, count ?? 0)
  }

  ours.value = {
    patientId: row.id,
    name: `${row.first_name} ${row.last_name ?? ''}`.trim(),
    reference: row.external_reference,
    bonos: (bonos ?? []).map((b) => ({
      ref: b.external_reference,
      name: b.package_name,
      total: b.sessions_total,
      used: b.sessions_used,
      priceCents: b.price_cents,
      purchasedAt: String(b.purchased_at),
      visits: visitsByBono.get(b.id) ?? 0,
    })),
    creditCents: (credits ?? []).reduce((s, c) => s + c.amount_cents, 0),
    creditRows: (credits ?? []).map((c) => ({ ref: c.external_reference, amountCents: c.amount_cents, reason: c.reason })),
    visitCount: visitCount ?? 0,
  }
}

function select(p: PHPatient) {
  selectedPhId.value = p.id
  search.value = ''
  loadOurs()
}

// The headline: PracticeHub and QuiroFlow disagreeing on how many bonos this
// patient has is the shape every problem in this migration took.
const bonoCountsDiffer = computed(() => ours.value !== null && phBonos.value.length !== ours.value.bonos.length)
</script>

<template>
  <div>
    <p class="text-sm text-ink-muted2">
      {{
        t(
          "Opens one patient side by side: what PracticeHub holds for them against what QuiroFlow holds. Bonos, credit, visits and the ledger totals. Read-only — nothing here changes any record. Use it whenever a number looks wrong: it answers in one click what otherwise means logging into PracticeHub and comparing by eye.",
          'Abre un paciente en paralelo: lo que tiene PracticeHub frente a lo que tiene QuiroFlow. Bonos, saldo, visitas y totales del libro mayor. Solo lectura: aquí no se modifica ningún registro. Úsalo cuando un número parezca incorrecto: responde en un clic lo que si no obliga a entrar en PracticeHub y comparar a ojo.',
        )
      }}
    </p>

    <div v-if="stage === 'connect'" class="mt-4 max-w-md">
      <ImportPracticeHubConnectForm @connect="run" />
    </div>

    <div v-else-if="stage === 'loading'" class="mt-4 rounded-lg border border-line bg-surface p-8 text-center">
      <p class="text-sm text-ink-600">{{ phase }}</p>
      <p v-if="progress.total > 0" class="mt-1 text-xs text-ink-faint">{{ progress.done }} / {{ progress.total }}</p>
    </div>

    <div v-else-if="stage === 'error'" class="mt-4 rounded-lg border border-danger-border bg-danger-bg p-4 text-sm text-danger-text">
      <p class="font-medium">{{ t('Could not load from PracticeHub:', 'No se pudo cargar desde PracticeHub:') }}</p>
      <p class="mt-1">{{ runError }}</p>
    </div>

    <div v-else class="mt-4 space-y-4">
      <div>
        <label class="block text-sm font-medium text-ink-700">{{ t('Find a patient', 'Buscar un paciente') }}</label>
        <input
          v-model="search"
          type="text"
          class="mt-1 w-full max-w-md rounded-md border border-line px-3 py-2 text-sm"
          :placeholder="t('Name or PracticeHub number…', 'Nombre o número de PracticeHub…')"
        />
        <ul v-if="matches.length > 0" class="mt-1 max-w-md overflow-hidden rounded-md border border-line bg-surface">
          <li v-for="m in matches" :key="m.id">
            <button type="button" class="flex w-full justify-between px-3 py-2 text-left text-sm hover:bg-surface-subtle" @click="select(m)">
              <span>{{ nameOf(m) }}</span>
              <span class="font-mono text-xs text-ink-muted2">{{ m.patient_number }}</span>
            </button>
          </li>
        </ul>
      </div>

      <div v-if="selected" class="space-y-4">
        <div
          v-if="bonoCountsDiffer"
          class="rounded-ctl border border-warning-border bg-warning-bg p-3 text-[12.5px] font-medium text-warning-text"
        >
          {{
            t(
              `PracticeHub has ${phBonos.length} bono(s) for this patient, QuiroFlow has ${ours?.bonos.length}.`,
              `PracticeHub tiene ${phBonos.length} bono(s) para este paciente, QuiroFlow tiene ${ours?.bonos.length}.`,
            )
          }}
        </div>

        <div class="grid gap-4 lg:grid-cols-2">
          <div class="overflow-hidden rounded-lg border border-line bg-surface">
            <div class="border-b border-line-divider px-3 py-2 text-xs font-medium uppercase tracking-wide text-ink-muted2">
              {{ t('PracticeHub', 'PracticeHub') }} &middot; {{ nameOf(selected) }} &middot;
              <span class="font-mono">{{ selected.patient_number }}</span>
            </div>
            <table v-if="phBonos.length > 0" class="w-full text-sm">
              <thead class="border-b border-line bg-surface-subtle text-left text-xs uppercase tracking-wide text-ink-muted2">
                <tr>
                  <th class="px-3 py-2">{{ t('Bono', 'Bono') }}</th>
                  <th class="px-3 py-2">{{ t('Left', 'Quedan') }}</th>
                  <th class="px-3 py-2">{{ t('Price', 'Precio') }}</th>
                  <th class="px-3 py-2">{{ t('Balance', 'Saldo') }}</th>
                  <th class="px-3 py-2">{{ t('Owed', 'Debe') }}</th>
                  <th class="px-3 py-2">{{ t('Active', 'Activo') }}</th>
                  <th class="px-3 py-2">id</th>
                </tr>
              </thead>
              <tbody class="divide-y divide-line-divider">
                <tr v-for="b in phBonos" :key="b.id">
                  <td class="px-3 py-2">{{ b.name || b.package_type }}</td>
                  <td class="px-3 py-2">{{ b.visits_left }}/{{ b.visits }}</td>
                  <td class="px-3 py-2">{{ eur(b.price) }}</td>
                  <td class="px-3 py-2">{{ eur(b.balance) }}</td>
                  <td class="px-3 py-2">{{ eur(-(b.package_balance ?? 0)) }}</td>
                  <td class="px-3 py-2" :class="b.active === 1 ? 'text-ink-900' : 'text-warning-text'">
                    {{ b.active === 1 ? t('yes', 'sí') : t('deactivated', 'desactivado') }}
                  </td>
                  <td class="px-3 py-2 font-mono text-xs text-ink-muted2">{{ b.id }}</td>
                </tr>
              </tbody>
            </table>
            <p v-else class="px-3 py-4 text-sm text-ink-muted2">{{ t('No bonos in PracticeHub.', 'Sin bonos en PracticeHub.') }}</p>
            <p class="border-t border-line-divider px-3 py-2 text-xs text-ink-faint">
              {{ phLedger.invoices }} {{ t('invoices', 'facturas') }} {{ eur(phLedger.invoiceTotal) }} &middot;
              {{ phLedger.payments }} {{ t('payments', 'pagos') }} {{ eur(phLedger.paymentTotal) }}
            </p>
          </div>

          <div class="overflow-hidden rounded-lg border border-line bg-surface">
            <div class="border-b border-line-divider px-3 py-2 text-xs font-medium uppercase tracking-wide text-ink-muted2">
              {{ t('QuiroFlow', 'QuiroFlow') }}
              <template v-if="ours">
                &middot; {{ ours.name }} &middot; <span class="font-mono">{{ ours.reference ?? '—' }}</span>
              </template>
            </div>
            <p v-if="ourLookupError" class="px-3 py-4 text-sm text-warning-text">{{ ourLookupError }}</p>
            <template v-else-if="ours">
              <table v-if="ours.bonos.length > 0" class="w-full text-sm">
                <thead class="border-b border-line bg-surface-subtle text-left text-xs uppercase tracking-wide text-ink-muted2">
                  <tr>
                    <th class="px-3 py-2">{{ t('Bono', 'Bono') }}</th>
                    <th class="px-3 py-2">{{ t('Used', 'Usadas') }}</th>
                    <th class="px-3 py-2">{{ t('Price', 'Precio') }}</th>
                    <th class="px-3 py-2">{{ t('Visits', 'Visitas') }}</th>
                    <th class="px-3 py-2">{{ t('Reference', 'Referencia') }}</th>
                  </tr>
                </thead>
                <tbody class="divide-y divide-line-divider">
                  <tr v-for="b in ours.bonos" :key="(b.ref ?? '') + b.purchasedAt">
                    <td class="px-3 py-2">{{ b.name }}</td>
                    <td class="px-3 py-2">{{ b.used }}/{{ b.total }}</td>
                    <td class="px-3 py-2">{{ eurCents(b.priceCents) }}</td>
                    <td class="px-3 py-2">{{ b.visits }}</td>
                    <td class="px-3 py-2 font-mono text-xs text-ink-muted2">{{ b.ref ?? t('(none)', '(ninguna)') }}</td>
                  </tr>
                </tbody>
              </table>
              <p v-else class="px-3 py-4 text-sm text-ink-muted2">{{ t('No bonos here.', 'Sin bonos aquí.') }}</p>
              <p class="border-t border-line-divider px-3 py-2 text-xs text-ink-faint">
                {{ t('Credit on account', 'Saldo a favor') }} {{ eurCents(ours.creditCents) }} &middot;
                {{ ours.visitCount }} {{ t('bono visit(s) recorded', 'visita(s) de bono registradas') }}
              </p>
            </template>
          </div>
        </div>

        <div v-if="ours && ours.creditRows.length > 0" class="overflow-hidden rounded-lg border border-line bg-surface">
          <div class="border-b border-line-divider px-3 py-2 text-xs font-medium uppercase tracking-wide text-ink-muted2">
            {{ t('Credit ledger here', 'Movimientos de saldo aquí') }}
          </div>
          <table class="w-full text-sm">
            <tbody class="divide-y divide-line-divider">
              <tr v-for="(c, i) in ours.creditRows" :key="i">
                <td class="px-3 py-2 font-mono text-xs text-ink-muted2">{{ c.ref ?? t('(no reference)', '(sin referencia)') }}</td>
                <td class="px-3 py-2" :class="c.amountCents < 0 ? 'text-warning-text' : 'text-ink-900'">{{ eurCents(c.amountCents) }}</td>
                <td class="px-3 py-2 text-ink-muted2">{{ c.reason }}</td>
              </tr>
            </tbody>
          </table>
        </div>
      </div>
    </div>
  </div>
</template>
