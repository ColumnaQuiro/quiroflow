<script setup lang="ts">
// Read-only check of what actually landed. Writes nothing.
//
// Every importer here is a one-way copy with no verification step, so the
// only way anyone found out a migration had gone wrong was a patient's
// balance reading -43 EUR months later. This compares what PracticeHub
// holds now against what QuiroFlow holds, per data type, and names the
// records that don't line up.
//
// Matching is by the external reference each importer writes, so this
// reports facts rather than guesses:
//   patients          patients.external_reference        = PH patient_number
//   payments          payments.external_reference        = phpay-{payment id}
//   invoices          invoices.external_reference        = phinv-{invoice id}
//                     (PH-package-{id} invoices were receivables raised by
//                      the bonos importer, not payments -- excluded below)
//   packages/bonos    package_purchases.external_reference = PH-package-{id}
//
// Two failure directions, both worth knowing about:
//   MISSING  in PracticeHub, never arrived here -- the import dropped it
//   EXTRA    here carrying a PracticeHub reference PracticeHub no longer
//            has -- imported from something since deleted, or invented
const supabase = useSupabaseClient()
const t = useT()

interface PHPatient { id: number; patient_number: string | null }
interface PHPayment { id: number; amount: string | number | null; patient_id: string | number | null }
interface PHPackage { id: number; name: string | null; package_type: string | null }

interface Row {
  key: string
  label: string
  phCount: number
  hereCount: number
  missing: string[]
  extra: string[]
  // Money only reconciles for payments; null hides the column for the rest.
  phTotalCents: number | null
  hereTotalCents: number | null
}

const stage = ref<'connect' | 'loading' | 'report' | 'error'>('connect')
const phase = ref('')
const progress = ref({ done: 0, total: 0 })
const runError = ref('')
const rows = ref<Row[]>([])
const expanded = ref<string | null>(null)
const lastConn = ref<{ baseUrl: string; apiKey: string; appDetails: string } | null>(null)

const PAGE_SIZE = 1000
const MAX_LISTED = 200

function eur(cents: number): string {
  return `€${(cents / 100).toFixed(2)}`
}

// Every row of a table, paged -- the importers all hand-roll this loop.
// Narrowed to the tables this reads: supabase.from() types its relation
// argument as a union of real table names, not string.
type ReadableTable = 'patients' | 'invoices' | 'payments' | 'package_purchases'
async function readAll<T>(table: ReadableTable, columns: string, filter?: (q: any) => any): Promise<T[]> {
  const out: T[] = []
  for (let page = 0; ; page++) {
    let query = supabase.from(table).select(columns).range(page * PAGE_SIZE, page * PAGE_SIZE + PAGE_SIZE - 1)
    if (filter) query = filter(query)
    const { data, error } = await query
    if (error) throw new Error(`${table}: ${error.message}`)
    const batch = (data ?? []) as unknown as T[]
    out.push(...batch)
    if (batch.length < PAGE_SIZE) break
  }
  return out
}

function diff(phRefs: Set<string>, hereRefs: Set<string>) {
  const missing: string[] = []
  const extra: string[] = []
  for (const ref of phRefs) if (!hereRefs.has(ref)) missing.push(ref)
  for (const ref of hereRefs) if (!phRefs.has(ref)) extra.push(ref)
  return { missing, extra }
}

async function run(conn: { baseUrl: string; apiKey: string; appDetails: string }) {
  lastConn.value = conn
  stage.value = 'loading'
  runError.value = ''
  rows.value = []
  const api = usePracticeHubApi(conn)

  try {
    const built: Row[] = []

    // --- Patients -------------------------------------------------------
    phase.value = t('Reconciling patients…', 'Cotejando pacientes…')
    progress.value = { done: 0, total: 0 }
    const phPatients = await api.fetchAll<PHPatient>('/patients', (done, total) => (progress.value = { done, total }))
    const phPatientRefs = new Set(phPatients.map((p) => String(p.patient_number ?? '')).filter(Boolean))
    const herePatients = await readAll<{ external_reference: string | null }>('patients', 'external_reference', (q) => q.not('external_reference', 'is', null))
    const herePatientRefs = new Set(herePatients.map((p) => String(p.external_reference)).filter(Boolean))
    const patientDiff = diff(phPatientRefs, herePatientRefs)
    built.push({
      key: 'patients',
      label: t('Patients', 'Pacientes'),
      phCount: phPatientRefs.size,
      hereCount: herePatientRefs.size,
      ...patientDiff,
      phTotalCents: null,
      hereTotalCents: null,
    })

    // --- Payments -------------------------------------------------------
    // A payment is a payment now, keyed by the PracticeHub id it came from.
    //
    // This used to look for invoices numbered PH-{payment id}, because the old
    // importer raised one invoice per payment. The Ledger importer does not:
    // payments arrive as payments, carrying external_reference = phpay-{id}.
    // Left as it was, this check reported every payment as missing on any
    // clinic imported the new way -- the verification step failing loudest
    // exactly when the import had gone right.
    phase.value = t('Reconciling payments…', 'Cotejando pagos…')
    progress.value = { done: 0, total: 0 }
    const phPayments = await api.fetchAll<PHPayment>('/payments', (done, total) => (progress.value = { done, total }))
    const phPaymentRefs = new Set(phPayments.map((p) => `phpay-${p.id}`))
    const phPaymentCents = phPayments.reduce((sum, p) => sum + Math.round(Number(p.amount ?? 0) * 100), 0)

    const herePaymentRows = await readAll<{ external_reference: string | null; amount_cents: number }>(
      'payments',
      'external_reference, amount_cents',
      (q) => q.like('external_reference', 'phpay-%'),
    )
    const herePaymentRefs = new Set(herePaymentRows.map((p) => String(p.external_reference)))
    const herePaymentCents = herePaymentRows.reduce((sum, p) => sum + p.amount_cents, 0)

    built.push({
      key: 'payments',
      label: t('Payments', 'Pagos'),
      phCount: phPaymentRefs.size,
      hereCount: herePaymentRefs.size,
      ...diff(phPaymentRefs, herePaymentRefs),
      phTotalCents: phPaymentCents,
      hereTotalCents: herePaymentCents,
    })

    // --- Invoices ---------------------------------------------------------
    // PracticeHub's own invoices, one per visit. Nothing checked these before,
    // because nothing imported them -- the old importer reconstructed invoices
    // from payments instead, so there was no per-visit record to compare.
    phase.value = t('Reconciling invoices…', 'Cotejando facturas…')
    progress.value = { done: 0, total: 0 }
    const phInvoices = await api.fetchAll<{ id: number; total: string }>('/invoices', (done, total) => (progress.value = { done, total }))
    const phInvoiceRefs = new Set(phInvoices.map((i) => `phinv-${i.id}`))
    const phInvoiceCents = phInvoices.reduce((sum, i) => sum + Math.round(Number(i.total ?? 0) * 100), 0)

    const hereInvoiceRows = await readAll<{ external_reference: string | null; total_cents: number }>(
      'invoices',
      'external_reference, total_cents',
      (q) => q.like('external_reference', 'phinv-%'),
    )
    const hereInvoiceRefs = new Set(hereInvoiceRows.map((i) => String(i.external_reference)))
    const hereInvoiceCents = hereInvoiceRows.reduce((sum, i) => sum + i.total_cents, 0)

    built.push({
      key: 'invoices',
      label: t('Invoices (one per visit)', 'Facturas (una por visita)'),
      phCount: phInvoiceRefs.size,
      hereCount: hereInvoiceRefs.size,
      ...diff(phInvoiceRefs, hereInvoiceRefs),
      phTotalCents: phInvoiceCents,
      hereTotalCents: hereInvoiceCents,
    })

    // --- Packages / bonos ------------------------------------------------
    phase.value = t('Reconciling bonos…', 'Cotejando bonos…')
    progress.value = { done: 0, total: 0 }
    const phPackages = await api.fetchAll<PHPackage>('/patient_packages', (done, total) => (progress.value = { done, total }))
    const phPackageRefs = new Set(phPackages.map((p) => `PH-package-${p.id}`))
    const herePackages = await readAll<{ external_reference: string | null }>('package_purchases', 'external_reference', (q) => q.like('external_reference', 'PH-package-%'))
    const herePackageRefs = new Set(herePackages.map((p) => String(p.external_reference)))
    built.push({
      key: 'packages',
      label: t('Packages / bonos', 'Bonos'),
      phCount: phPackageRefs.size,
      hereCount: herePackageRefs.size,
      ...diff(phPackageRefs, herePackageRefs),
      phTotalCents: null,
      hereTotalCents: null,
    })

    rows.value = built
    stage.value = 'report'
  } catch (err) {
    runError.value = err instanceof Error ? err.message : String(err)
    stage.value = 'error'
  }
}

function retryRun() {
  if (lastConn.value) run(lastConn.value)
}

function reset() {
  stage.value = 'connect'
  rows.value = []
  expanded.value = null
}

const allClear = computed(() => rows.value.length > 0 && rows.value.every((r) => r.missing.length === 0 && r.extra.length === 0 && (r.phTotalCents === null || r.phTotalCents === r.hereTotalCents)))
const introLead = computed(() => t('Compares what PracticeHub holds right now against what was imported here, and names anything that does not line up.', 'Compara lo que PracticeHub tiene ahora mismo con lo que se importó aquí, y señala todo lo que no cuadra.'))
const introNotes = computed(() => [
  { title: t('Read-only.', 'Solo lectura.'), body: t('It writes nothing and changes nothing.', 'No escribe ni cambia nada.') },
  { title: t('Run it after every import.', 'Ejecútalo después de cada importación.'), body: t('It is the only place that tells you whether the copy is actually complete, in both directions -- missing here, or here but gone from PracticeHub.', 'Es el único sitio que dice si la copia está realmente completa, en los dos sentidos: lo que falta aquí, o lo que está aquí pero ya no en PracticeHub.') },
])
</script>

<template>
  <div>
    <ImportIntro :lead="introLead" :notes="introNotes" />

    <div v-if="stage === 'connect'" class="mt-4 max-w-md">
      <ImportPracticeHubConnectForm @connect="run" />
    </div>

    <div v-else-if="stage === 'loading'" class="mt-4 rounded-lg border border-line bg-surface p-8 text-center">
      <p class="text-sm text-ink-600">{{ phase }}</p>
      <p v-if="progress.total > 0" class="mt-1 text-xs text-ink-faint">{{ progress.done }} / {{ progress.total }}</p>
    </div>

    <div v-else-if="stage === 'error'" class="mt-4 space-y-4">
      <div class="rounded-lg border border-danger-border bg-danger-bg p-4 text-sm text-danger-text">
        <p class="font-medium">{{ t('Reconciliation failed:', 'Falló la comprobación:') }}</p>
        <p class="mt-1">{{ runError }}</p>
      </div>
      <button type="button" class="rounded-md bg-brand px-4 py-2 text-sm font-medium text-white hover:bg-brand-hover" @click="retryRun">
        {{ t('Retry', 'Reintentar') }}
      </button>
    </div>

    <div v-else-if="stage === 'report'" class="mt-4 space-y-4">
      <div v-if="allClear" class="rounded-lg border border-success-border bg-success-bg p-3 text-sm text-success-text">
        {{ t('Everything matches. Every PracticeHub record is here, and nothing here references a record PracticeHub no longer has.', 'Todo cuadra. Todos los registros de PracticeHub están aquí, y nada de aquí hace referencia a un registro que PracticeHub ya no tiene.') }}
      </div>

      <div class="overflow-x-auto rounded-lg border border-line">
        <table class="w-full text-left text-xs">
          <thead class="bg-surface-subtle text-ink-muted2">
            <tr>
              <th class="px-3 py-2">{{ t('Data', 'Datos') }}</th>
              <th class="px-3 py-2">{{ t('In PracticeHub', 'En PracticeHub') }}</th>
              <th class="px-3 py-2">{{ t('Here', 'Aquí') }}</th>
              <th class="px-3 py-2">{{ t('Missing', 'Faltan') }}</th>
              <th class="px-3 py-2">{{ t('Extra here', 'Sobran aquí') }}</th>
              <th class="px-3 py-2">{{ t('Money', 'Dinero') }}</th>
            </tr>
          </thead>
          <tbody>
            <template v-for="r in rows" :key="r.key">
              <tr class="border-t border-line">
                <td class="px-3 py-2 font-medium text-ink-700">{{ r.label }}</td>
                <td class="px-3 py-2">{{ r.phCount }}</td>
                <td class="px-3 py-2">{{ r.hereCount }}</td>
                <td class="px-3 py-2">
                  <button
                    v-if="r.missing.length > 0"
                    type="button"
                    class="font-medium text-danger-text hover:underline"
                    @click="expanded = expanded === `${r.key}-missing` ? null : `${r.key}-missing`"
                  >
                    {{ r.missing.length }}
                  </button>
                  <span v-else class="text-ink-faint">0</span>
                </td>
                <td class="px-3 py-2">
                  <button
                    v-if="r.extra.length > 0"
                    type="button"
                    class="font-medium text-warning-text hover:underline"
                    @click="expanded = expanded === `${r.key}-extra` ? null : `${r.key}-extra`"
                  >
                    {{ r.extra.length }}
                  </button>
                  <span v-else class="text-ink-faint">0</span>
                </td>
                <td class="px-3 py-2">
                  <span v-if="r.phTotalCents === null" class="text-ink-faint">—</span>
                  <span v-else-if="r.phTotalCents === r.hereTotalCents" class="text-ink-muted2">{{ eur(r.phTotalCents) }}</span>
                  <span v-else class="font-medium text-danger-text">
                    {{ eur(r.phTotalCents) }} → {{ eur(r.hereTotalCents ?? 0) }} ({{ eur((r.hereTotalCents ?? 0) - r.phTotalCents) }})
                  </span>
                </td>
              </tr>
              <tr v-if="expanded === `${r.key}-missing`" class="border-t border-line bg-surface-subtle">
                <td colspan="6" class="px-3 py-2">
                  <p class="mb-1 font-medium text-ink-700">{{ t('In PracticeHub, not here', 'En PracticeHub, no aquí') }}</p>
                  <p class="break-all font-mono text-[11px] leading-relaxed text-ink-muted2">{{ r.missing.slice(0, MAX_LISTED).join(', ') }}</p>
                  <p v-if="r.missing.length > MAX_LISTED" class="mt-1 text-ink-faint">
                    {{ t(`+${r.missing.length - MAX_LISTED} more`, `+${r.missing.length - MAX_LISTED} más`) }}
                  </p>
                </td>
              </tr>
              <tr v-if="expanded === `${r.key}-extra`" class="border-t border-line bg-surface-subtle">
                <td colspan="6" class="px-3 py-2">
                  <p class="mb-1 font-medium text-ink-700">{{ t('Here, but PracticeHub has no such record', 'Aquí, pero PracticeHub no tiene ese registro') }}</p>
                  <p class="break-all font-mono text-[11px] leading-relaxed text-ink-muted2">{{ r.extra.slice(0, MAX_LISTED).join(', ') }}</p>
                  <p v-if="r.extra.length > MAX_LISTED" class="mt-1 text-ink-faint">
                    {{ t(`+${r.extra.length - MAX_LISTED} more`, `+${r.extra.length - MAX_LISTED} más`) }}
                  </p>
                </td>
              </tr>
            </template>
          </tbody>
        </table>
      </div>

      <p class="text-xs text-ink-faint">
        {{
          t(
            'Package visits and other data types are not reconciled here yet: only some PracticeHub invoices become visits, so a straight count comparison would report differences that are correct behaviour.',
            'Las visitas de bono y otros tipos de datos aún no se cotejan aquí: solo algunas facturas de PracticeHub se convierten en visitas, así que comparar recuentos daría diferencias que en realidad son correctas.',
          )
        }}
      </p>

      <button type="button" class="rounded-md px-4 py-2 text-sm font-medium text-ink-600 hover:bg-surface-subtle" @click="reset">
        {{ t('Run again', 'Ejecutar de nuevo') }}
      </button>
    </div>
  </div>
</template>
