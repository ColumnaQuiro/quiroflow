<script setup lang="ts">
import { formatEur, formatEurFromAmount } from '~/utils/billing'
import {
  planPracticeHubBonos,
  type BonoCandidate,
  type DuplicateBonoMerge,
  type LocalBono,
  type MispricedBono,
  type PHPatient,
  type PHPatientPackage,
  type PhDuplicateBono,
  type PracticeHubBonosInput,
  type UnmatchedPracticeHubPatient,
  type VoidBono,
} from '~/utils/practicehubImport/bonos'
const supabase = useSupabaseClient()
const store = useAccountStore()
const t = useT()
const { showToast } = useToast()

// The rules -- which PracticeHub bono is which row here, what changes, what
// is skipped and why -- live in utils/practicehubImport/bonos.ts, the one copy
// the server's import job plans with too. This screen reads the rows,
// hands them to planPracticeHubBonos, and applies what comes back.
interface Candidate extends BonoCandidate {
  status: 'pending' | 'applied' | 'error'
  errorMessage?: string
}

const stage = ref<'connect' | 'loading' | 'preview' | 'applying' | 'done' | 'error'>('connect')
useImportWriting(() => stage.value === 'applying')
const phase = ref('')
const progress = ref({ done: 0, total: 0 })
const runError = ref('')
const lastConn = ref<{ baseUrl: string; apiKey: string; appDetails: string } | null>(null)

const candidates = ref<Candidate[]>([])
// Who was skipped, not just how many. This used to be a bare counter, and it
// counted per bono rather than per person: someone on three bonos was three
// "unmatched patients". Worse, the count named nobody, so a real gap -- a
// patient PracticeHub knows and we do not, whose bonos and shares are silently
// dropped by every importer -- was a number on a screen with no way to act on
// it. Keyed by PracticeHub patient id, so each person appears once, with the
// bonos they were skipped on.
const unmatchedPatients = ref(new Map<string, UnmatchedPracticeHubPatient>())
const skippedUnmatched = computed(() => unmatchedPatients.value.size)
const skippedNoValue = ref(0)
// Bonos that exist here but that no PracticeHub bono claimed. Before this
// existed the importer could hand one local row to the first bono of a
// same-day pair and insert a fresh row for the second, leaving a duplicate
// nothing ever mentioned -- six patients ended up with two rows for one
// bono, and only a hand-written SQL query found them. Anything left over
// after matching is now reported instead of ignored.
const unmatchedLocalBonos = ref<{ patientName: string; bono: LocalBono }[]>([])
// Bono rows here that stand for the same PracticeHub bono as another row.
// Decided by counting: when this patient has more rows of a given bono on a
// given day than PracticeHub has bonos, the surplus is ours, not theirs.
// Bonos PracticeHub itself holds twice. Nine patients here already carry the
// result: two rows of the same name, price and day, the earlier id completely
// untouched and the later one holding all the usage. That is PracticeHub's
// shape, not ours -- consecutive ids, the first never used. Importing the
// empty one gives the patient a whole extra bono of sessions they never
// bought, and where PracticeHub also reports it as unpaid it would raise an
// invoice for money nobody owes.
const phDuplicateBonos = ref<PhDuplicateBono[]>([])
// Bonos PracticeHub still lists but on which nothing ever happened: no
// session used, no balance, nothing owed, nobody sharing them.
const voidBonos = ref<VoidBono[]>([])
// Bonos whose PracticeHub figures contradict each other -- see
// balanceDisagreesWithPrice. Imported as-is and listed for a human to check,
// because a wrong price here mis-charges every session drawn from the bono.
const mispricedBonos = ref<MispricedBono[]>([])
const mergesApplied = ref(0)
const mergeError = ref('')
const duplicateMerges = ref<DuplicateBonoMerge[]>([])

// Raw, untouched sample of what PracticeHub actually returns -- the field
// mapping above is a guess reverse-engineered from the docs' example
// response, which has already been wrong twice. Showing this directly
// avoids another guess-and-redeploy round trip.
const rawSample = ref<unknown[]>([])
const showRawSample = ref(false)

async function run(conn: { baseUrl: string; apiKey: string; appDetails: string }) {
  lastConn.value = conn
  stage.value = 'loading'
  runError.value = ''
  candidates.value = []
  unmatchedPatients.value = new Map()
  unmatchedLocalBonos.value = []
  duplicateMerges.value = []
  phDuplicateBonos.value = []
  voidBonos.value = []
  mispricedBonos.value = []
  mergesApplied.value = 0
  mergeError.value = ''
  skippedNoValue.value = 0
  const api = usePracticeHubApi(conn)

  try {
    phase.value = t('Matching patients…', 'Emparejando pacientes…')
    const phPatients = await api.fetchAll<PHPatient>('/patients', (done, total) => (progress.value = { done, total }))

    const PAGE_SIZE = 1000
    const ourPatients: PracticeHubBonosInput['ourPatients'] = []
    for (let page = 0; ; page++) {
      const { data } = await supabase.from('patients').select('id, external_reference, email, first_name, last_name').order('id').range(page * PAGE_SIZE, page * PAGE_SIZE + PAGE_SIZE - 1)
      ourPatients.push(...(data ?? []))
      if (!data || data.length < PAGE_SIZE) break
    }

    phase.value = t('Checking for already-imported packages…', 'Comprobando bonos ya importados…')
    const purchases: PracticeHubBonosInput['purchases'] = []
    for (let page = 0; ; page++) {
      const { data } = await supabase
        .from('package_purchases')
        .select('id, patient_id, purchased_at, external_reference, invoice_id, package_name, price_cents, sessions_used, sessions_total, owed_cents, is_closed, charged_at_purchase')
        .order('id').range(page * PAGE_SIZE, page * PAGE_SIZE + PAGE_SIZE - 1)
      purchases.push(...(data ?? []))
      if (!data || data.length < PAGE_SIZE) break
    }

    const sessionPurchaseIds: (string | null)[] = []
    for (let page = 0; ; page++) {
      const { data } = await supabase.from('package_sessions').select('package_purchase_id').order('id').range(page * PAGE_SIZE, page * PAGE_SIZE + PAGE_SIZE - 1)
      for (const row of data ?? []) sessionPurchaseIds.push(row.package_purchase_id)
      if (!data || data.length < PAGE_SIZE) break
    }

    const shares: PracticeHubBonosInput['shares'] = []
    for (let page = 0; ; page++) {
      const { data } = await supabase.from('package_purchase_shares').select('package_purchase_id, patient_id').order('id').range(page * PAGE_SIZE, page * PAGE_SIZE + PAGE_SIZE - 1)
      shares.push(...(data ?? []))
      if (!data || data.length < PAGE_SIZE) break
    }

    const scheduledPurchaseIds: (string | null)[] = []
    for (let page = 0; ; page++) {
      const { data } = await supabase.from('payment_schedules').select('package_purchase_id').not('package_purchase_id', 'is', null).order('id').range(page * PAGE_SIZE, page * PAGE_SIZE + PAGE_SIZE - 1)
      for (const row of data ?? []) scheduledPurchaseIds.push(row.package_purchase_id)
      if (!data || data.length < PAGE_SIZE) break
    }

    phase.value = t('Checking existing credit…', 'Comprobando el crédito existente…')
    const credits: PracticeHubBonosInput['credits'] = []
    for (let page = 0; ; page++) {
      const { data } = await supabase
        .from('account_credits')
        .select('amount_cents, external_reference')
        .not('external_reference', 'is', null)
        .order('id').range(page * PAGE_SIZE, page * PAGE_SIZE + PAGE_SIZE - 1)
      credits.push(...(data ?? []))
      if (!data || data.length < PAGE_SIZE) break
    }

    phase.value = t('Fetching patient packages…', 'Obteniendo bonos de pacientes…')
    progress.value = { done: 0, total: 0 }
    const phPackages = await api.fetchAll<PHPatientPackage>('/patient_packages', (done, total) => (progress.value = { done, total }))
    rawSample.value = phPackages.slice(0, 3)

    const plan = planPracticeHubBonos({ phPatients, phPackages, ourPatients, purchases, sessionPurchaseIds, shares, scheduledPurchaseIds, credits })
    unmatchedPatients.value = plan.unmatchedPatients
    skippedNoValue.value = plan.skippedNoValue
    phDuplicateBonos.value = plan.phDuplicateBonos
    voidBonos.value = plan.voidBonos
    mispricedBonos.value = plan.mispricedBonos
    duplicateMerges.value = plan.duplicateMerges
    unmatchedLocalBonos.value = plan.unmatchedLocalBonos
    candidates.value = plan.candidates.map((c) => ({ ...c, status: 'pending' as const }))
    stage.value = 'preview'
  } catch (err) {
    runError.value = importErrorText(err, t, { en: 'Could not read PracticeHub. Nothing was written; try again.', es: 'No se pudo leer PracticeHub. No se escribió nada; vuelve a intentarlo.' })
    stage.value = 'error'
  }
}

async function applyFixes() {
  stage.value = 'applying'
  const toApply = candidates.value.filter((c) => c.status === 'pending')
  progress.value = { done: 0, total: toApply.length }

  // Duplicates first, so the rest of the pass writes against the row that
  // survives. A candidate pointing at the row being removed is repointed at
  // the survivor rather than resurrecting it.
  mergeError.value = ''
  mergesApplied.value = 0
  for (const m of duplicateMerges.value) {
    // Delete first, then move the reference: (account_id, external_reference)
    // is unique, so the two rows cannot hold it at once. If the move fails
    // after the delete, the next run repairs it rather than leaving a hole --
    // one PracticeHub bono against one unreferenced row here matches on the
    // day and stamps the reference back on.
    const { error: deleteError } = await supabase.from('package_purchases').delete().eq('id', m.discardId)
    if (deleteError) {
      mergeError.value = `${m.patientName}: ${deleteError.message}`
      break
    }
    if (m.referenceToMove) {
      const { error: moveError } = await supabase
        .from('package_purchases')
        .update({ external_reference: m.referenceToMove })
        .eq('id', m.survivorId)
        .is('external_reference', null)
      if (moveError) {
        mergeError.value = `${m.patientName}: ${moveError.message}`
        break
      }
    }
    for (const c of toApply) if (c.existingPurchaseId === m.discardId) c.existingPurchaseId = m.survivorId
    mergesApplied.value++
  }

  for (const c of toApply) {
    const externalRef = `PH-package-${c.phPackageId}`
    let purchaseId = c.existingPurchaseId

    // A repair leaves the existing purchase row untouched and only adds the
    // invoice, reference and shares it never got.
    if (!c.repairOnly) {
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
          owed_cents: c.owedCents,
          // A closed bono is imported as history (see the branches above) and
          // has to arrive saying so, or its leftover sessions read as live.
          is_closed: !c.isActive,
          charged_at_purchase: c.chargedAtPurchase,
        })
        .select('id')
        .single()

      if (purchaseError || !purchase) {
        c.status = 'error'
        c.errorMessage = purchaseError?.message
        progress.value = { done: progress.value.done + 1, total: toApply.length }
        continue
      }
      purchaseId = purchase.id
    }

    // The outstanding figure on its own, for a bono that needs nothing else.
    // counterSync above already carries it when there is other work to do.
    if (c.repairOnly && !c.counterSync && purchaseId) {
      await supabase.from('package_purchases').update({ owed_cents: c.owedCents }).eq('id', purchaseId)
    }

    // PracticeHub has closed (or re-opened) a bono that is already here. Sent
    // on its own rather than folded into counterSync, which is null whenever
    // the counters themselves still agree -- and they do for exactly the case
    // this is for: a bono deactivated with sessions left untouched on it.
    if (c.repairOnly && c.needsClosedStamp && purchaseId) {
      const { error: closedError } = await supabase
        .from('package_purchases')
        .update({ is_closed: !c.isActive })
        .eq('id', purchaseId)
      if (closedError) {
        c.status = 'error'
        c.errorMessage = closedError.message
        progress.value = { done: progress.value.done + 1, total: toApply.length }
        continue
      }
    }

    // Whether its sessions still cost anything. On its own for the same reason
    // as is_closed: the counters can agree while this does not.
    if (c.repairOnly && c.needsChargeStamp && purchaseId) {
      const { error: chargeError } = await supabase
        .from('package_purchases')
        .update({ charged_at_purchase: c.chargedAtPurchase })
        .eq('id', purchaseId)
      if (chargeError) {
        c.status = 'error'
        c.errorMessage = chargeError.message
        progress.value = { done: progress.value.done + 1, total: toApply.length }
        continue
      }
    }

    // Bring an already-imported bono up to what PracticeHub says now. Only the
    // fields that actually differ are sent, so a re-run touches nothing it does
    // not have to. See syncFor() for why sessions_used only ever rises.
    if (c.counterSync && purchaseId) {
      const { error: syncError } = await supabase
        .from('package_purchases')
        .update({
          ...(c.counterSync.sessionsTotal !== undefined ? { sessions_total: c.counterSync.sessionsTotal } : {}),
          ...(c.counterSync.sessionsUsed !== undefined ? { sessions_used: c.counterSync.sessionsUsed } : {}),
          ...(c.counterSync.priceCents !== undefined ? { price_cents: c.counterSync.priceCents } : {}),
          owed_cents: c.owedCents,
        })
        .eq('id', purchaseId)
      if (syncError) {
        c.status = 'error'
        c.errorMessage = syncError.message
        progress.value = { done: progress.value.done + 1, total: toApply.length }
        continue
      }
    }

    // No account_credits row is written here, for a bono or a correction.
    // A bono's remaining value is the sessions counter and nothing else since
    // 0161 retired the parallel credit, so depositing it again would put back
    // exactly what that migration removed -- and re-open the hole it closed,
    // where a patient holds spendable money AND the sessions it stands for.
    //
    // The corrections this used to propose were wrong on their own terms too:
    // measured against credit attributed to the bono rather than the patient's
    // real balance, they double-removed every session already drawn down here.
    // On the live account 27 of 40 proposed fixes were for patients whose
    // balance was already exactly right, and applying them would have taken
    // 658 EUR off people who owed nothing.

    // Label a bono the hand backfill left unlabelled with its PracticeHub
    // reference, so it stops being matched by date. `is('external_reference',
    // null)` so a reference already there is never overwritten, and the unique
    // index on (account_id, external_reference) refuses a second bono claiming
    // the same PracticeHub id if the day matching ever goes wrong.
    if (c.needsReferenceStamp && purchaseId) {
      const { error: stampError } = await supabase
        .from('package_purchases')
        .update({ external_reference: externalRef })
        .eq('id', purchaseId)
        .is('external_reference', null)
      if (stampError) {
        c.status = 'error'
        c.errorMessage = stampError.message
        progress.value = { done: progress.value.done + 1, total: toApply.length }
        continue
      }
    }

    // The household members sharing this bono. Written after the purchase
    // exists so a newly inserted bono gets its members in the same pass.
    if (c.sharedWith.length > 0 && purchaseId) {
      const { error: shareError } = await supabase.from('package_purchase_shares').insert(
        c.sharedWith.map((m) => ({
          account_id: store.accountId!,
          package_purchase_id: purchaseId as string,
          patient_id: m.id,
        })),
      )
      if (shareError) {
        c.status = 'error'
        c.errorMessage = shareError.message
        progress.value = { done: progress.value.done + 1, total: toApply.length }
        continue
      }
    }

    // The outstanding half of a part-paid bono used to be raised here as an
    // unpaid invoice, so that it read as money owed rather than living only in
    // a PracticeHub column.
    //
    // It is not any more. Charges come from the Ledger importer now, one per
    // visit, exactly as PracticeHub records them -- and PracticeHub holds no
    // charge for the unfinished part of a bono. A patient owes for the visits
    // they take; raising an invoice here would invent a debt the source system
    // never asserted, which is the whole class of thing the re-migration
    // removed. What is still owed on a bono remains visible as the difference
    // between its price and what has been paid toward it.

    c.status = 'applied'
    progress.value = { done: progress.value.done + 1, total: toApply.length }
  }

  stage.value = 'done'
  const merged = mergesApplied.value
  const mergeNote = merged > 0 ? ` ${t(`${merged} duplicate ${merged === 1 ? 'bono' : 'bonos'} merged.`, `${merged} ${merged === 1 ? 'bono duplicado fusionado' : 'bonos duplicados fusionados'}.`)}` : ''
  const applied = candidates.value.filter((c) => c.status === 'applied').length
  showToast(
    t(
      `${applied} ${applied === 1 ? 'bono' : 'bonos'} added or updated.${mergeNote}`,
      `${applied} ${applied === 1 ? 'bono añadido o actualizado' : 'bonos añadidos o actualizados'}.${mergeNote}`,
    ),
    candidates.value.some((c) => c.status === 'error') || mergeError.value ? 'error' : 'success',
  )
}

function retryRun() {
  if (lastConn.value) run(lastConn.value)
}

function reset() {
  stage.value = 'connect'
  candidates.value = []
  unmatchedPatients.value = new Map()
  unmatchedLocalBonos.value = []
  duplicateMerges.value = []
  phDuplicateBonos.value = []
  voidBonos.value = []
  mispricedBonos.value = []
  mergesApplied.value = 0
  mergeError.value = ''
  skippedNoValue.value = 0
  progress.value = { done: 0, total: 0 }
}

// In the app's own format ("180,00 €"), not "€180.00".
function formatEuros(cents: number): string {
  return formatEur(cents)
}

const plural = (n: number, one: string, many: string) => (n === 1 ? one : many)
const newBonoCount = computed(() => candidates.value.filter((c) => c.status === 'pending' && !c.repairOnly).length)
const repairCount = computed(() => candidates.value.filter((c) => c.status === 'pending' && c.repairOnly).length)
const pendingCount = computed(() => candidates.value.filter((c) => c.status === 'pending').length)
const changedInPracticeHub = computed(() => candidates.value.filter((c) => c.counterSync).length)
const owedTotalCents = computed(() => candidates.value.reduce((sum, c) => sum + c.owedCents, 0))
const introLead = computed(() =>
  t(
    'Brings bonos across from PracticeHub, and brings ones imported earlier back in line with what PracticeHub says about them now.',
    'Trae los bonos desde PracticeHub y pone al día los que se importaron antes con lo que PracticeHub dice ahora de ellos.',
  ),
)
const introNotes = computed(() => [
  {
    title: t('A bono is sessions, not account credit.', 'Un bono son sesiones, no saldo en la cuenta.'),
    body: t(
      'What is left on a bono is its sessions counter, and this step writes no account credit for one. PracticeHub reads it the same way: its balance is the sessions left × the price of one session.',
      'Lo que queda de un bono es el contador de sesiones, y este importador no escribe saldo por un bono. PracticeHub lo lee igual: su columna balance son las sesiones restantes por el precio de cada sesión.',
    ),
  },
  {
    title: t('It corrects bonos PracticeHub has since changed.', 'Corrige los bonos que PracticeHub ha cambiado desde entonces.'),
    body: t(
      'Sessions used, total sessions and price are brought back in line. Sessions used only ever goes up: lowering it would hand a patient back sessions they already took, so a bono with more sessions used here than in PracticeHub is listed and left as it is.',
      'Sesiones usadas, sesiones totales y precio se ponen al día. Las sesiones usadas solo suben: bajarlas devolvería al paciente sesiones ya consumidas, así que un bono con más sesiones usadas aquí que en PracticeHub se lista y se deja como está.',
    ),
  },
  {
    title: t('What is still owed stays on the bono. No invoice is raised for it.', 'Lo que queda por pagar se queda en el bono. No se crea ninguna factura por ello.'),
    body: t(
      'Each bono keeps the amount PracticeHub says is still owed on it. Charges come from the Ledger step, one per visit, as PracticeHub records them; PracticeHub holds no charge for the unpaid part of a bono, so inventing one here would bill the patient for a debt it never recorded.',
      'Cada bono conserva el importe que PracticeHub indica como pendiente. Los cargos llegan con el paso Libro mayor, uno por visita, tal como los registra PracticeHub; PracticeHub no tiene ningún cargo por la parte sin pagar de un bono, así que crearlo aquí cobraría al paciente una deuda que nunca se registró.',
    ),
  },
  {
    title: t('Nothing is written until you press Apply.', 'No se escribe nada hasta que pulses Aplicar.'),
    body: t(
      "The preview shows PracticeHub's own price, balance, owed and package balance for each bono, so you can check them against a patient you already know. Safe to run again: bonos already correct are skipped.",
      'La vista previa muestra el precio, saldo, pendiente y saldo del bono que da PracticeHub para cada bono, para que los compruebes con un paciente que ya conozcas. Se puede volver a ejecutar: los bonos ya correctos se omiten.',
    ),
  },
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
        <p class="font-medium">{{ t('The bonos could not be read from PracticeHub.', 'No se pudieron leer los bonos de PracticeHub.') }}</p>
        <p class="mt-1">{{ t('Nothing was written. Retry reads them again.', 'No se escribió nada. Reintentar vuelve a leerlos.') }}</p>
        <p class="mt-1 text-[12.5px] opacity-80">{{ runError }}</p>
      </div>
      <button type="button" class="rounded-md bg-brand px-4 py-2 text-sm font-medium text-brand-on hover:bg-brand-hover" @click="retryRun">
        {{ t('Retry', 'Reintentar') }}
      </button>
    </div>

    <div v-else-if="stage === 'preview'" class="mt-4 space-y-4">
      <div class="rounded-lg border border-line bg-surface-subtle p-3 text-sm text-ink-muted2">
        <p>
          {{
            t(
              `${newBonoCount} new ${plural(newBonoCount, 'bono', 'bonos')} to add, and ${repairCount} already here to update (${changedInPracticeHub} of them changed in PracticeHub since).`,
              `${newBonoCount} ${plural(newBonoCount, 'bono nuevo', 'bonos nuevos')} por añadir y ${repairCount} ya aquí por actualizar (${changedInPracticeHub} de ellos cambiados en PracticeHub desde entonces).`,
            )
          }}
        </p>
        <p class="mt-1">
          {{
            t(
              `Still owed on these bonos: ${formatEuros(owedTotalCents)}. Kept on each bono, not invoiced: PracticeHub holds no invoice for it.`,
              `Pendiente en estos bonos: ${formatEuros(owedTotalCents)}. Se guarda en cada bono, sin facturar: PracticeHub no tiene ninguna factura por ello.`,
            )
          }}
        </p>
        <p class="mt-1">
          {{
            t(
              `Skipped: ${skippedUnmatched} with no matching patient here, ${skippedNoValue} active ${plural(skippedNoValue, 'bono', 'bonos')} with nothing left on them.`,
              `Omitidos: ${skippedUnmatched} sin paciente coincidente aquí, ${skippedNoValue} ${plural(skippedNoValue, 'bono activo', 'bonos activos')} sin nada restante.`,
            )
          }}
        </p>
      </div>

      <div v-if="skippedUnmatched > 0" class="rounded-ctl border border-warning-border bg-warning-bg p-3">
        <p class="text-[12.5px] font-medium text-warning-text">
          {{ t(`${skippedUnmatched} PracticeHub ${plural(skippedUnmatched, 'patient has', 'patients have')} no matching record here`, `${skippedUnmatched} ${plural(skippedUnmatched, 'paciente de PracticeHub no tiene', 'pacientes de PracticeHub no tienen')} registro aquí`) }}
        </p>
        <p class="mt-1 text-[12.5px] leading-relaxed text-warning-text">
          {{ t('Their bonos are skipped, and where they share a family bono they cannot draw a session from it. Run the Patients step, then run this one again. A patient number listed here for someone who is in QuiroFlow usually means their PracticeHub reference was never stored, not that the patient is missing.', 'Sus bonos se omiten, y si comparten un bono familiar no pueden usar sesiones de él. Ejecuta el paso Pacientes y vuelve a ejecutar este. Un número de paciente que aparece aquí para alguien que sí está en QuiroFlow suele significar que su referencia de PracticeHub nunca se guardó, no que falte el paciente.') }}
        </p>
        <ul class="mt-2 space-y-0.5 text-[12px] text-warning-text">
          <li v-for="[key, u] in [...unmatchedPatients]" :key="key">
            <span class="font-mono">{{ u.number }}</span>
            <template v-if="u.name"> &middot; {{ u.name }}</template>
            <span class="text-warning-text/70"> &middot; {{ u.bonos.join(', ') }}</span>
          </li>
        </ul>
      </div>

      <div v-if="voidBonos.length > 0" class="rounded-ctl border border-warning-border bg-warning-bg p-3">
        <p class="text-[12.5px] font-medium text-warning-text">
          {{ t(`${voidBonos.length} empty ${plural(voidBonos.length, 'bono', 'bonos')} in PracticeHub: not imported`, `${voidBonos.length} ${plural(voidBonos.length, 'bono vacío', 'bonos vacíos')} en PracticeHub: no se importan`) }}
        </p>
        <p class="mt-1 text-[12.5px] leading-relaxed text-warning-text">
          {{
            t(
              'Nothing ever happened on these: no session used, no balance left, nothing owed, nobody sharing them. Importing one hands the patient a bono of sessions they never bought. A bono that was genuinely used up has sessions against it, and one bought and untouched still carries its balance, so neither is affected.',
              'En estos nunca pasó nada: ninguna sesión usada, sin saldo, sin nada pendiente y sin pacientes compartidos. Importar uno daría al paciente un bono de sesiones que nunca compró. Un bono realmente consumido tiene sesiones usadas, y uno comprado y sin usar conserva su saldo, así que ninguno de los dos se ve afectado.',
            )
          }}
        </p>
        <ul class="mt-2 space-y-0.5 text-[12px] text-warning-text">
          <li v-for="v in voidBonos" :key="v.phPackageId">
            {{ v.patientName }} &middot; {{ v.packageName }} &middot; {{ formatEuros(v.priceCents) }}
            <span class="font-mono text-warning-text/70">#{{ v.phPackageId }}</span>
          </li>
        </ul>
      </div>

      <div v-if="mispricedBonos.length > 0" class="rounded-ctl border border-warning-border bg-warning-bg p-3">
        <p class="text-[12.5px] font-medium text-warning-text">
          {{ t(`${mispricedBonos.length} ${plural(mispricedBonos.length, 'bono', 'bonos')} whose price may be wrong in PracticeHub: imported, please check`, `${mispricedBonos.length} ${plural(mispricedBonos.length, 'bono', 'bonos')} con un precio posiblemente incorrecto en PracticeHub: se importan, revísalos`) }}
        </p>
        <p class="mt-1 text-[12.5px] leading-relaxed text-warning-text">
          {{
            t(
              "PracticeHub's own figures disagree on these: the balance it states is not what its sessions left and price come to. The price is imported as given, so if it is the wrong one, every session drawn from the bono is charged at the wrong rate from now on. Check the bono in PracticeHub and correct it there, then run this importer again.",
              'Las cifras de PracticeHub no cuadran en estos: el saldo que indica no coincide con las sesiones restantes por el precio. El precio se importa tal cual, así que si es incorrecto, cada sesión que se descuente del bono se cobrará mal a partir de ahora. Revisa el bono en PracticeHub, corrígelo allí y vuelve a ejecutar esta importación.',
            )
          }}
        </p>
        <ul class="mt-2 space-y-0.5 text-[12px] text-warning-text">
          <li v-for="m in mispricedBonos" :key="m.phPackageId">
            {{ m.patientName }} &middot; {{ m.packageName }} &middot; {{ formatEuros(m.priceCents) }} / {{ m.visits }}
            &middot;
            {{
              t(
                `${m.visitsLeft} left implies ${formatEurFromAmount(m.impliedBalance)}, PracticeHub says ${formatEurFromAmount(m.statedBalance)}`,
                `${m.visitsLeft} restantes implican ${formatEurFromAmount(m.impliedBalance)}; PracticeHub indica ${formatEurFromAmount(m.statedBalance)}`,
              )
            }}
            <span class="font-mono text-warning-text/70">#{{ m.phPackageId }}</span>
          </li>
        </ul>
      </div>

      <div v-if="phDuplicateBonos.length > 0" class="rounded-ctl border border-warning-border bg-warning-bg p-3">
        <p class="text-[12.5px] font-medium text-warning-text">
          {{ t(`${phDuplicateBonos.length} ${plural(phDuplicateBonos.length, 'bono', 'bonos')} PracticeHub lists twice: not imported`, `${phDuplicateBonos.length} ${plural(phDuplicateBonos.length, 'bono', 'bonos')} que PracticeHub lista dos veces: no se importan`) }}
        </p>
        <p class="mt-1 text-[12.5px] leading-relaxed text-warning-text">
          {{
            t(
              'For each of these, PracticeHub holds a second bono of the same name, price and day that has actually been used, while this one has never been touched. Importing it would give the patient a second bono of sessions they never bought and, where PracticeHub reports it unpaid, show money owed that nobody owes. Nothing is written for them. If one of these is a genuine second purchase, contact QuiroFlow so it can be brought in.',
              'Para cada uno de estos, PracticeHub tiene un segundo bono del mismo nombre, precio y día que sí se ha usado, mientras que este no se ha tocado nunca. Importarlo daría al paciente un segundo bono de sesiones que nunca compró y, si PracticeHub lo marca como impagado, mostraría como pendiente un dinero que nadie debe. No se escribe nada para ellos. Si alguno es una segunda compra real, contacta con QuiroFlow para importarlo.',
            )
          }}
        </p>
        <div class="mt-2 overflow-x-auto">
          <table class="w-full text-[12px] text-warning-text">
            <thead class="text-left text-warning-text/70">
              <tr>
                <th class="py-1 pr-3 font-medium">{{ t('Patient', 'Paciente') }}</th>
                <th class="py-1 pr-3 font-medium">{{ t('Bono', 'Bono') }}</th>
                <th class="py-1 pr-3 font-medium">{{ t('Price', 'Precio') }}</th>
                <th class="py-1 pr-3 font-medium">{{ t('PracticeHub id', 'Id de PracticeHub') }}</th>
                <th class="py-1 font-medium">{{ t('Owed on it in PracticeHub', 'Pendiente en PracticeHub') }}</th>
              </tr>
            </thead>
            <tbody>
              <tr v-for="d in phDuplicateBonos" :key="d.phPackageId">
                <td class="py-1 pr-3">{{ d.patientName }}</td>
                <td class="py-1 pr-3">{{ d.packageName }}</td>
                <td class="py-1 pr-3">{{ formatEuros(d.priceCents) }}</td>
                <td class="py-1 pr-3 font-mono">{{ d.phPackageId }}</td>
                <td class="py-1" :class="d.owedCents > 0 ? 'font-medium' : 'text-warning-text/70'">
                  <template v-if="d.owedCents > 0">{{ formatEuros(d.owedCents) }}</template>
                  <template v-else>&mdash;</template>
                </td>
              </tr>
            </tbody>
          </table>
        </div>
      </div>

      <div v-if="duplicateMerges.length > 0" class="rounded-ctl border border-warning-border bg-warning-bg p-3">
        <p class="text-[12.5px] font-medium text-warning-text">
          {{ t(`${duplicateMerges.length} ${plural(duplicateMerges.length, 'bono', 'bonos')} recorded twice here: one copy of each will be removed`, `${duplicateMerges.length} ${plural(duplicateMerges.length, 'bono registrado', 'bonos registrados')} dos veces aquí: se eliminará una copia de cada uno`) }}
        </p>
        <p class="mt-1 text-[12.5px] leading-relaxed text-warning-text">
          {{
            t(
              'PracticeHub holds one bono of this shape for this patient on this day, and there are two here. The row kept is the one the clinic has been using — the one with visits recorded against it — and the row removed has no visits, no household members, no invoice and no instalment plan, so nothing is lost with it. Where the removed row is the one carrying the PracticeHub reference, that reference moves onto the row that stays and takes its credit history along.',
              'PracticeHub tiene un bono de esta forma para este paciente ese día, y aquí hay dos. Se conserva la fila que la clínica ha estado usando (la que tiene visitas registradas) y la que se elimina no tiene visitas, ni pacientes compartidos, ni factura, ni plan de pago, así que no se pierde nada. Si la fila eliminada es la que lleva la referencia de PracticeHub, esa referencia pasa a la fila que se conserva junto con su historial de crédito.',
            )
          }}
        </p>
        <div class="mt-2 overflow-x-auto">
          <table class="w-full text-[12px] text-warning-text">
            <thead class="text-left text-warning-text/70">
              <tr>
                <th class="py-1 pr-3 font-medium">{{ t('Patient', 'Paciente') }}</th>
                <th class="py-1 pr-3 font-medium">{{ t('Bono', 'Bono') }}</th>
                <th class="py-1 pr-3 font-medium">{{ t('Price', 'Precio') }}</th>
                <th class="py-1 pr-3 font-medium">{{ t('Row kept', 'Fila conservada') }}</th>
                <th class="py-1 font-medium">{{ t('Reference moved', 'Referencia movida') }}</th>
              </tr>
            </thead>
            <tbody>
              <tr v-for="m in duplicateMerges" :key="m.discardId">
                <td class="py-1 pr-3">{{ m.patientName }}</td>
                <td class="py-1 pr-3">{{ m.packageName }}</td>
                <td class="py-1 pr-3">{{ formatEuros(m.priceCents) }}</td>
                <td class="py-1 pr-3">{{ t(`${m.survivorVisits} ${plural(m.survivorVisits, 'visit', 'visits')} recorded`, `${m.survivorVisits} ${plural(m.survivorVisits, 'visita registrada', 'visitas registradas')}`) }}</td>
                <td class="py-1 font-mono">{{ m.referenceToMove ?? t('—', '—') }}</td>
              </tr>
            </tbody>
          </table>
        </div>
      </div>

      <div v-if="unmatchedLocalBonos.length > 0" class="rounded-ctl border border-warning-border bg-warning-bg p-3">
        <p class="text-[12.5px] font-medium text-warning-text">
          {{ t(`${unmatchedLocalBonos.length} ${plural(unmatchedLocalBonos.length, 'bono', 'bonos')} here that no PracticeHub bono matches`, `${unmatchedLocalBonos.length} ${plural(unmatchedLocalBonos.length, 'bono', 'bonos')} aquí sin bono equivalente en PracticeHub`) }}
        </p>
        <p class="mt-1 text-[12.5px] leading-relaxed text-warning-text">
          {{
            t(
              'Nothing is done to these — they are listed so you can see them. A bono sold through QuiroFlow since the migration belongs here and is fine. One bought at exactly 00:00 came from the migration, and if the same patient also has a PracticeHub-referenced bono of the same size on the same day, the two are the same bono recorded twice: the sessions column tells you which one the clinic has actually been using.',
              'No se hace nada con estos: se listan para que puedas verlos. Un bono vendido en QuiroFlow después de la migración aparece aquí y es correcto. Uno comprado exactamente a las 00:00 viene de la migración, y si el mismo paciente tiene además un bono con referencia de PracticeHub del mismo tamaño y el mismo día, son el mismo bono registrado dos veces: la columna de sesiones indica cuál ha estado usando la clínica.',
            )
          }}
        </p>
        <div class="mt-2 overflow-x-auto">
          <table class="w-full text-[12px] text-warning-text">
            <thead class="text-left text-warning-text/70">
              <tr>
                <th class="py-1 pr-3 font-medium">{{ t('Patient', 'Paciente') }}</th>
                <th class="py-1 pr-3 font-medium">{{ t('Bono', 'Bono') }}</th>
                <th class="py-1 pr-3 font-medium">{{ t('Price', 'Precio') }}</th>
                <th class="py-1 pr-3 font-medium">{{ t('Sessions used', 'Sesiones usadas') }}</th>
                <th class="py-1 pr-3 font-medium">{{ t('Visits recorded', 'Visitas registradas') }}</th>
                <th class="py-1 font-medium">{{ t('Bought', 'Comprado') }}</th>
              </tr>
            </thead>
            <tbody>
              <tr v-for="row in unmatchedLocalBonos" :key="row.bono.id">
                <td class="py-1 pr-3">{{ row.patientName }}</td>
                <td class="py-1 pr-3">{{ row.bono.packageName }}</td>
                <td class="py-1 pr-3">{{ formatEuros(row.bono.priceCents) }}</td>
                <td class="py-1 pr-3">{{ row.bono.sessionsUsed }}</td>
                <td class="py-1 pr-3">{{ row.bono.visitRows }}</td>
                <td class="py-1 whitespace-nowrap">{{ row.bono.purchasedAt.slice(0, 16).replace('T', ' ') }}</td>
              </tr>
            </tbody>
          </table>
        </div>
      </div>

      <div v-if="skippedUnmatched > 0 || candidates.filter((c) => c.status === 'pending').length === 0" class="rounded-lg border border-line">
        <button type="button" class="flex w-full items-center justify-between px-3 py-2 text-left text-sm font-medium text-ink-700" @click="showRawSample = !showRawSample">
          <span>{{ t('Technical detail: what PracticeHub sent for the first 3 bonos', 'Detalle técnico: lo que envió PracticeHub para los 3 primeros bonos') }}</span>
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
              <th class="px-3 py-2">{{ t('PracticeHub price', 'Precio en PracticeHub') }}</th>
              <th class="px-3 py-2">{{ t('PracticeHub balance', 'Saldo en PracticeHub') }}</th>
              <th class="px-3 py-2">{{ t('PracticeHub owed', 'Pendiente en PracticeHub') }}</th>
              <th class="px-3 py-2">{{ t('PracticeHub bono balance', 'Saldo del bono en PracticeHub') }}</th>
              <th class="px-3 py-2">{{ t('Still owed', 'Pendiente de pago') }}</th>
              <th class="px-3 py-2">{{ t('Shared with', 'Compartido con') }}</th>
              <th class="px-3 py-2">{{ t('What it writes', 'Qué escribe') }}</th>
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
              <td class="px-3 py-2" :class="c.owedCents > 0 ? 'font-medium text-warning-text' : 'text-ink-muted2'">
                <template v-if="c.owedCents > 0">{{ formatEuros(c.owedCents) }}</template>
                <template v-else>—</template>
              </td>
              <td class="px-3 py-2 text-ink-muted2">
                <template v-if="c.sharedWith.length > 0">{{ c.sharedWith.map((m) => m.name).join(', ') }}</template>
                <template v-else>—</template>
              </td>
              <td class="px-3 py-2">
                <div v-if="!c.repairOnly">{{ t(`New bono, ${formatEuros(c.priceCents)}`, `Bono nuevo, ${formatEuros(c.priceCents)}`) }}</div>
                <div v-if="c.counterSync" class="text-warning-text">
                  <template v-if="c.counterSync.sessionsUsed !== undefined">{{ t(`Sessions used → ${c.counterSync.sessionsUsed}`, `Sesiones usadas → ${c.counterSync.sessionsUsed}`) }}<br /></template>
                  <template v-if="c.counterSync.sessionsTotal !== undefined">{{ t(`Total sessions → ${c.counterSync.sessionsTotal}`, `Sesiones totales → ${c.counterSync.sessionsTotal}`) }}<br /></template>
                  <template v-if="c.counterSync.priceCents !== undefined">{{ t(`Price → ${formatEuros(c.counterSync.priceCents)}`, `Precio → ${formatEuros(c.counterSync.priceCents)}`) }}</template>
                </div>
                <div v-if="c.usedAheadOfPracticeHub" class="text-ink-muted2">{{ t('More sessions used here than in PracticeHub: left as it is', 'Más sesiones usadas aquí que en PracticeHub: se deja como está') }}</div>
                <div v-if="c.owedCents > 0" class="text-ink-muted2">{{ t(`${formatEuros(c.owedCents)} still owed on it`, `${formatEuros(c.owedCents)} pendiente en el bono`) }}</div>
                <div v-if="c.needsReferenceStamp" class="text-ink-muted2">{{ t('+ PracticeHub reference', '+ referencia de PracticeHub') }}</div>
                <div v-if="c.needsChargeStamp || (!c.repairOnly && c.chargedAtPurchase)" class="text-ink-muted2">
                  {{
                    c.chargedAtPurchase
                      ? t('Already invoiced in full: its sessions charge nothing', 'Ya facturado entero: sus sesiones no se cobran')
                      : t('Sessions charged per visit', 'Sesiones cobradas por visita')
                  }}
                </div>
              </td>
              <td class="px-3 py-2">
                <span v-if="c.status === 'pending' && c.repairOnly && c.counterSync" class="text-warning-text">{{ t('Out of date', 'Desactualizado') }}</span>
                <span v-else-if="c.status === 'pending' && c.repairOnly && c.needsChargeStamp" class="text-warning-text">{{ t('Out of date', 'Desactualizado') }}</span>
                <span v-else-if="c.status === 'pending' && c.repairOnly && c.sharedWith.length > 0" class="text-warning-text">{{ t('Missing shared patients', 'Faltan pacientes compartidos') }}</span>
                <span v-else-if="c.status === 'pending' && c.repairOnly" class="text-ink-muted2">{{ t('Missing reference', 'Falta la referencia') }}</span>
                <span v-else-if="c.status === 'pending'" class="text-ink-600">{{ t('To add', 'Por añadir') }}</span>
                <span v-else-if="c.status === 'applied'" class="text-ink-muted2">{{ t('Applied', 'Aplicado') }}</span>
                <span v-else class="text-danger-text">{{ c.errorMessage || t('Error', 'Error') }}</span>
              </td>
            </tr>
          </tbody>
        </table>
      </div>

      <div class="flex gap-3">
        <button
          type="button"
          class="rounded-md bg-brand px-4 py-2 text-sm font-medium text-brand-on hover:bg-brand-hover disabled:opacity-50"
          :disabled="candidates.filter((c) => c.status === 'pending').length === 0 && duplicateMerges.length === 0"
          @click="applyFixes"
        >
          <template v-if="duplicateMerges.length > 0">
            {{
              t(
                `Apply ${pendingCount} ${plural(pendingCount, 'change', 'changes')} and merge ${duplicateMerges.length} ${plural(duplicateMerges.length, 'duplicate', 'duplicates')}`,
                `Aplicar ${pendingCount} ${plural(pendingCount, 'cambio', 'cambios')} y fusionar ${duplicateMerges.length} ${plural(duplicateMerges.length, 'duplicado', 'duplicados')}`,
              )
            }}
          </template>
          <template v-else>
            {{ t(`Apply ${pendingCount} ${plural(pendingCount, 'change', 'changes')}`, `Aplicar ${pendingCount} ${plural(pendingCount, 'cambio', 'cambios')}`) }}
          </template>
        </button>
        <button type="button" class="rounded-md px-4 py-2 text-sm font-medium text-ink-600 hover:bg-surface-subtle" @click="reset">
          {{ t('Cancel', 'Cancelar') }}
        </button>
      </div>
    </div>

    <div v-else-if="stage === 'applying'" class="mt-4 rounded-lg border border-line bg-surface p-8 text-center">
      <p class="text-sm text-ink-600">{{ t('Applying changes…', 'Aplicando cambios…') }}</p>
      <p class="mt-1 text-xs text-ink-faint">{{ progress.done }} / {{ progress.total }}</p>
    </div>

    <div v-else-if="stage === 'done'" class="mt-4 space-y-4">
      <div v-if="mergeError" class="rounded-lg border border-danger-border bg-danger-bg p-4 text-sm text-danger-text">
        <p class="font-medium">{{ t('Merging duplicates stopped before it finished.', 'La fusión de duplicados se detuvo antes de terminar.') }}</p>
        <p class="mt-1">{{ mergeError }}</p>
        <p class="mt-1">
          {{ t('The remaining duplicates were left alone. Run this again to retry them.', 'Los duplicados restantes no se tocaron. Vuelve a ejecutar esto para reintentarlos.') }}
        </p>
      </div>
      <div v-if="candidates.some((c) => c.status === 'error')" class="rounded-lg border border-danger-border bg-danger-bg p-4 text-sm text-danger-text">
        <p class="font-medium">{{ t('Some bonos were not saved:', 'Algunos bonos no se guardaron:') }}</p>
        <ul class="mt-1 list-disc pl-5">
          <li v-for="c in candidates.filter((c) => c.status === 'error')" :key="c.phPackageId">{{ c.patientName }}: {{ c.errorMessage }}</li>
        </ul>
      </div>
      <button type="button" class="rounded-md px-4 py-2 text-sm font-medium text-ink-600 hover:bg-surface-subtle" @click="reset">
        {{ t('Run again', 'Ejecutar de nuevo') }}
      </button>
    </div>
  </div>
</template>
