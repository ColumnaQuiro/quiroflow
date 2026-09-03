<script setup lang="ts">
const supabase = useSupabaseClient()
const store = useAccountStore()
const t = useT()
const { showToast } = useToast()

interface PHPatient { id: number; patient_number: string }
interface PHPatientPackage {
  id: number
  // PracticeHub's docs example shows a top-level patient_id, but real
  // patient_packages records leave it null and only populate
  // subscribed_patients -- checking both is what actually finds a match.
  patient_id: number | null
  subscribed_patients: { patient_id: number }[] | null
  name: string | null
  package_type: string | null
  active: number | null
  visits: number | null
  visits_left: number | null
  price: number | null
  balance: number | null
  owing: number | null
  package_balance: number | null
  created: string
}

function patientIdOf(pkg: PHPatientPackage): number | null {
  return pkg.patient_id ?? pkg.subscribed_patients?.[0]?.patient_id ?? null
}

interface Candidate {
  phPackageId: number
  patientId: string
  patientName: string
  packageName: string
  visits: number | null
  visitsLeft: number | null
  price: number | null
  balance: number | null
  owing: number | null
  packageBalance: number | null
  created: string
  sessionsTotal: number
  sessionsUsed: number
  priceCents: number
  creditCents: number
  status: 'pending' | 'applied' | 'skipped-existing' | 'error'
  errorMessage?: string
}

const stage = ref<'connect' | 'loading' | 'preview' | 'applying' | 'done' | 'error'>('connect')
const phase = ref('')
const progress = ref({ done: 0, total: 0 })
const runError = ref('')
const lastConn = ref<{ baseUrl: string; apiKey: string; appDetails: string } | null>(null)

const candidates = ref<Candidate[]>([])
const skippedUnmatched = ref(0)
const skippedNoValue = ref(0)
// Raw, untouched sample of what PracticeHub actually returns -- the field
// mapping above is a guess reverse-engineered from the docs' example
// response, which has already been wrong twice. Showing this directly
// avoids another guess-and-redeploy round trip.
const rawSample = ref<unknown[]>([])
const showRawSample = ref(false)

// PracticeHub's own field naming is not documented beyond "apply filter
// parms to the X column", so this mapping is a best guess until the first
// real run: `package_balance` reads as the most literal match for "money
// still sitting on this specific package," `price` as the package's total
// list price. Cross-check the preview table's raw columns against a patient
// already fixed by hand (e.g. David Poveda: price ~559, credit ~361, 1
// session left of 14) before trusting "Apply" on the rest.
function creditCentsFor(pkg: PHPatientPackage): number {
  const raw = pkg.package_balance ?? pkg.balance ?? pkg.owing ?? 0
  return Math.round(raw * 100)
}

async function run(conn: { baseUrl: string; apiKey: string; appDetails: string }) {
  lastConn.value = conn
  stage.value = 'loading'
  runError.value = ''
  candidates.value = []
  skippedUnmatched.value = 0
  skippedNoValue.value = 0
  const api = usePracticeHubApi(conn)

  try {
    phase.value = t('Matching patients…', 'Emparejando pacientes…')
    const phPatients = await api.fetchAll<PHPatient>('/patients', (done, total) => (progress.value = { done, total }))
    const patientNumberById = new Map(phPatients.map((p) => [String(p.id), p.patient_number]))

    const PAGE_SIZE = 1000
    const ourPatientByRef = new Map<string, { id: string; name: string }>()
    for (let page = 0; ; page++) {
      const { data } = await supabase.from('patients').select('id, external_reference, first_name, last_name').range(page * PAGE_SIZE, page * PAGE_SIZE + PAGE_SIZE - 1)
      for (const p of data ?? []) if (p.external_reference) ourPatientByRef.set(p.external_reference, { id: p.id, name: `${p.first_name} ${p.last_name}` })
      if (!data || data.length < PAGE_SIZE) break
    }

    phase.value = t('Checking for already-imported packages…', 'Comprobando bonos ya importados…')
    const existingExternalRefs = new Set<string>()
    for (let page = 0; ; page++) {
      const { data } = await supabase
        .from('package_purchases')
        .select('external_reference')
        .not('external_reference', 'is', null)
        .range(page * PAGE_SIZE, page * PAGE_SIZE + PAGE_SIZE - 1)
      for (const row of data ?? []) if (row.external_reference) existingExternalRefs.add(row.external_reference)
      if (!data || data.length < PAGE_SIZE) break
    }

    // Package fixes made by hand before this importer existed (Melanie,
    // David Poveda, Kenneth Davis, ...) have no external_reference to dedupe
    // against -- fall back to same-patient-same-day as a second guard so a
    // re-run doesn't double-credit someone already fixed manually.
    const existingByPatientDay = new Set<string>()
    for (let page = 0; ; page++) {
      const { data } = await supabase.from('package_purchases').select('patient_id, purchased_at').range(page * PAGE_SIZE, page * PAGE_SIZE + PAGE_SIZE - 1)
      for (const row of data ?? []) existingByPatientDay.add(`${row.patient_id}|${String(row.purchased_at).slice(0, 10)}`)
      if (!data || data.length < PAGE_SIZE) break
    }

    phase.value = t('Fetching patient packages…', 'Obteniendo bonos de pacientes…')
    progress.value = { done: 0, total: 0 }
    const phPackages = await api.fetchAll<PHPatientPackage>('/patient_packages', (done, total) => (progress.value = { done, total }))
    rawSample.value = phPackages.slice(0, 3)

    const built: Candidate[] = []
    for (const pkg of phPackages) {
      const externalRef = `PH-package-${pkg.id}`
      if (existingExternalRefs.has(externalRef)) continue
      if (pkg.active !== 1) continue

      const hasRemainingValue = (pkg.visits_left ?? 0) > 0 || (pkg.package_balance ?? 0) > 0 || (pkg.balance ?? 0) > 0
      if (!hasRemainingValue) {
        skippedNoValue.value++
        continue
      }

      const phPatientId = patientIdOf(pkg)
      const patientNumber = phPatientId !== null ? patientNumberById.get(String(phPatientId)) : undefined
      const ourPatient = patientNumber ? ourPatientByRef.get(patientNumber) : undefined
      if (!ourPatient) {
        skippedUnmatched.value++
        continue
      }

      const dayKey = `${ourPatient.id}|${pkg.created.slice(0, 10)}`
      const alreadyHasSameDayPurchase = existingByPatientDay.has(dayKey)

      const visitsTotal = pkg.visits ?? pkg.visits_left ?? 0
      const visitsLeft = pkg.visits_left ?? visitsTotal
      const sessionsUsed = Math.max(0, visitsTotal - visitsLeft)

      built.push({
        phPackageId: pkg.id,
        patientId: ourPatient.id,
        patientName: ourPatient.name,
        packageName: pkg.name || pkg.package_type || 'Package',
        visits: pkg.visits,
        visitsLeft: pkg.visits_left,
        price: pkg.price,
        balance: pkg.balance,
        owing: pkg.owing,
        packageBalance: pkg.package_balance,
        created: pkg.created,
        sessionsTotal: Math.max(visitsTotal, 1),
        sessionsUsed,
        priceCents: Math.round((pkg.price ?? 0) * 100),
        creditCents: creditCentsFor(pkg),
        status: alreadyHasSameDayPurchase ? 'skipped-existing' : 'pending',
      })
    }

    candidates.value = built
    stage.value = 'preview'
  } catch (err) {
    runError.value = err instanceof Error ? err.message : String(err)
    stage.value = 'error'
  }
}

async function applyFixes() {
  stage.value = 'applying'
  const toApply = candidates.value.filter((c) => c.status === 'pending')
  progress.value = { done: 0, total: toApply.length }

  for (const c of toApply) {
    const externalRef = `PH-package-${c.phPackageId}`
    const { data: purchase, error: purchaseError } = await supabase
      .from('package_purchases')
      .insert({
        account_id: store.accountId!,
        patient_id: c.patientId,
        package_name: c.packageName,
        price_cents: c.priceCents,
        sessions_total: c.sessionsTotal,
        sessions_used: c.sessionsUsed,
        purchased_at: c.created,
        external_reference: externalRef,
      })
      .select('id')
      .single()

    if (purchaseError || !purchase) {
      c.status = 'error'
      c.errorMessage = purchaseError?.message
      progress.value = { done: progress.value.done + 1, total: toApply.length }
      continue
    }

    if (c.creditCents > 0) {
      const { error: creditError } = await supabase.from('account_credits').insert({
        account_id: store.accountId!,
        patient_id: c.patientId,
        amount_cents: c.creditCents,
        reason: `${c.packageName} (migrated from PracticeHub -- ${c.visitsLeft ?? '?'}/${c.visits ?? '?'} sessions remaining)`,
        external_reference: externalRef,
        created_at: c.created,
      })
      if (creditError) {
        c.status = 'error'
        c.errorMessage = creditError.message
        progress.value = { done: progress.value.done + 1, total: toApply.length }
        continue
      }
    }

    c.status = 'applied'
    progress.value = { done: progress.value.done + 1, total: toApply.length }
  }

  stage.value = 'done'
  showToast(
    t(
      `Applied ${candidates.value.filter((c) => c.status === 'applied').length} fix(es).`,
      `Se aplicaron ${candidates.value.filter((c) => c.status === 'applied').length} corrección(es).`,
    ),
    candidates.value.some((c) => c.status === 'error') ? 'error' : 'success',
  )
}

function retryRun() {
  if (lastConn.value) run(lastConn.value)
}

function reset() {
  stage.value = 'connect'
  candidates.value = []
  skippedUnmatched.value = 0
  skippedNoValue.value = 0
  progress.value = { done: 0, total: 0 }
}

function formatEuros(cents: number): string {
  return (cents / 100).toFixed(2)
}
</script>

<template>
  <div>
    <p class="text-sm text-ink-muted2">
      {{
        t(
          "Pulls every active patient package directly from PracticeHub's API and compares it against QuiroFlow's package_purchases table. Shows a preview before writing anything -- review the raw balance/owing/package_balance columns against a patient you've already checked by hand before applying. Safe to re-run: already-imported packages (and same-day packages added by hand before this tool existed) are skipped.",
          'Obtiene todos los bonos activos directamente de la API de PracticeHub y los compara con la tabla package_purchases de QuiroFlow. Muestra una vista previa antes de escribir nada -- revisa las columnas balance/owing/package_balance frente a un paciente que ya hayas comprobado a mano antes de aplicar. Se puede volver a ejecutar sin riesgo: los bonos ya importados (y los añadidos a mano el mismo día antes de que existiera esta herramienta) se omiten.',
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

    <div v-else-if="stage === 'error'" class="mt-4 space-y-4">
      <div class="rounded-lg border border-danger-border bg-danger-bg p-4 text-sm text-danger-text">
        <p class="font-medium">{{ t('Import failed:', 'Fallo en la importación:') }}</p>
        <p class="mt-1">{{ runError }}</p>
      </div>
      <button type="button" class="rounded-md bg-brand px-4 py-2 text-sm font-medium text-white hover:bg-brand-hover" @click="retryRun">
        {{ t('Retry', 'Reintentar') }}
      </button>
    </div>

    <div v-else-if="stage === 'preview'" class="mt-4 space-y-4">
      <div class="rounded-lg border border-line bg-surface-subtle p-3 text-sm text-ink-muted2">
        {{
          t(
            `Found ${candidates.filter((c) => c.status === 'pending').length} package(s) to add, ${candidates.filter((c) => c.status === 'skipped-existing').length} already covered by a same-day manual entry, ${skippedUnmatched} unmatched patients, ${skippedNoValue} inactive/zero-value packages.`,
            `Se encontraron ${candidates.filter((c) => c.status === 'pending').length} bono(s) para añadir, ${candidates.filter((c) => c.status === 'skipped-existing').length} ya cubiertos por una entrada manual del mismo día, ${skippedUnmatched} pacientes sin emparejar, ${skippedNoValue} bonos inactivos o sin valor.`,
          )
        }}
      </div>

      <div v-if="skippedUnmatched > 0 || candidates.filter((c) => c.status === 'pending').length === 0" class="rounded-lg border border-line">
        <button type="button" class="flex w-full items-center justify-between px-3 py-2 text-left text-sm font-medium text-ink-700" @click="showRawSample = !showRawSample">
          <span>{{ t('Debug: raw PracticeHub response (first 3)', 'Depurar: respuesta cruda de PracticeHub (primeros 3)') }}</span>
          <span class="text-ink-muted2">{{ showRawSample ? '▲' : '▼' }}</span>
        </button>
        <pre v-if="showRawSample" class="overflow-x-auto border-t border-line bg-surface-subtle p-3 text-[11px] leading-relaxed text-ink-700">{{ JSON.stringify(rawSample, null, 2) }}</pre>
      </div>

      <div class="overflow-x-auto rounded-lg border border-line">
        <table class="w-full text-left text-xs">
          <thead class="bg-surface-subtle text-ink-muted2">
            <tr>
              <th class="px-3 py-2">{{ t('Patient', 'Paciente') }}</th>
              <th class="px-3 py-2">{{ t('Package', 'Bono') }}</th>
              <th class="px-3 py-2">{{ t('Visits', 'Visitas') }}</th>
              <th class="px-3 py-2">price</th>
              <th class="px-3 py-2">balance</th>
              <th class="px-3 py-2">owing</th>
              <th class="px-3 py-2">package_balance</th>
              <th class="px-3 py-2">{{ t('Will insert', 'Se insertará') }}</th>
              <th class="px-3 py-2">{{ t('Status', 'Estado') }}</th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="c in candidates" :key="c.phPackageId" class="border-t border-line">
              <td class="px-3 py-2">{{ c.patientName }}</td>
              <td class="px-3 py-2">{{ c.packageName }}</td>
              <td class="px-3 py-2">{{ c.visitsLeft }}/{{ c.visits }}</td>
              <td class="px-3 py-2">{{ c.price }}</td>
              <td class="px-3 py-2">{{ c.balance }}</td>
              <td class="px-3 py-2">{{ c.owing }}</td>
              <td class="px-3 py-2">{{ c.packageBalance }}</td>
              <td class="px-3 py-2">€{{ formatEuros(c.priceCents) }} / €{{ formatEuros(c.creditCents) }} {{ t('credit', 'crédito') }}</td>
              <td class="px-3 py-2">
                <span v-if="c.status === 'pending'" class="text-ink-600">{{ t('Pending', 'Pendiente') }}</span>
                <span v-else class="text-ink-muted2">{{ t('Already covered', 'Ya cubierto') }}</span>
              </td>
            </tr>
          </tbody>
        </table>
      </div>

      <div class="flex gap-3">
        <button
          type="button"
          class="rounded-md bg-brand px-4 py-2 text-sm font-medium text-white hover:bg-brand-hover disabled:opacity-50"
          :disabled="candidates.filter((c) => c.status === 'pending').length === 0"
          @click="applyFixes"
        >
          {{ t(`Apply ${candidates.filter((c) => c.status === 'pending').length} fix(es)`, `Aplicar ${candidates.filter((c) => c.status === 'pending').length} corrección(es)`) }}
        </button>
        <button type="button" class="rounded-md px-4 py-2 text-sm font-medium text-ink-600 hover:bg-surface-subtle" @click="reset">
          {{ t('Cancel', 'Cancelar') }}
        </button>
      </div>
    </div>

    <div v-else-if="stage === 'applying'" class="mt-4 rounded-lg border border-line bg-surface p-8 text-center">
      <p class="text-sm text-ink-600">{{ t('Applying fixes…', 'Aplicando correcciones…') }}</p>
      <p class="mt-1 text-xs text-ink-faint">{{ progress.done }} / {{ progress.total }}</p>
    </div>

    <div v-else-if="stage === 'done'" class="mt-4 space-y-4">
      <div v-if="candidates.some((c) => c.status === 'error')" class="rounded-lg border border-danger-border bg-danger-bg p-4 text-sm text-danger-text">
        <p class="font-medium">{{ t('Some rows failed:', 'Algunas filas fallaron:') }}</p>
        <ul class="mt-1 list-disc pl-5">
          <li v-for="c in candidates.filter((c) => c.status === 'error')" :key="c.phPackageId">{{ c.patientName }} — {{ c.errorMessage }}</li>
        </ul>
      </div>
      <button type="button" class="rounded-md px-4 py-2 text-sm font-medium text-ink-600 hover:bg-surface-subtle" @click="reset">
        {{ t('Run again', 'Ejecutar de nuevo') }}
      </button>
    </div>
  </div>
</template>
