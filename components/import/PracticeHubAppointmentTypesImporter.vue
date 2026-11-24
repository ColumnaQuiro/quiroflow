<script setup lang="ts">
import { practiceHubPriceToWrite, practiceHubTypePrice, practiceHubUnpricedTypesWarning, type PracticeHubBillableItem } from '~/utils/practicehubTypePrices'
import { formatEur } from '~/utils/billing'
import { hexColor, isWorthBringing, STAGE_BY_NAME } from '~/utils/practicehubImport/appointmentTypes'
import { practiceHubTypeMatches } from '~/utils/practicehubImport/appointments'

const supabase = useSupabaseClient()
const store = useAccountStore()
const t = useT()
const { showToast } = useToast()

interface PHAppointmentType { id: number; name: string; active?: number | boolean | null; duration?: number | null; color?: string | null }
interface PHAppointment { id: number; appointment_type_id: number | null }

// STAGE_BY_NAME (which type names get a funnel stage), isWorthBringing (which
// retired types are left behind) and hexColor live in
// utils/practicehubImport/appointmentTypes.ts, and practiceHubTypeMatches
// (which type here each PracticeHub type is) in appointments.ts, shared with
// the server-side sync.

interface TypeCandidate {
  phTypeId: number
  name: string
  /** Set when the type is already here (practiceHubTypeMatches); null means it gets created. */
  ourTypeId: string | null
  /** That type's name here, which a rename here can have made different from PracticeHub's. */
  ourName: string | null
  /** The type's price here; null when it gets created. */
  ourPriceCents: number | null
  /** What the import writes as the type's price: PracticeHub's, and only over a 0. */
  priceToWrite: number | null
  /** Left at 0 with nothing to fill it from (see utils/practicehubImport/appointmentTypes.ts). */
  unpriced: boolean
  funnelStage: string | null
  /** PracticeHub's appointments of this type that are already here, by reference. */
  appointmentRefs: string[]
  /** All of PracticeHub's appointments of this type, here or not. */
  inPracticeHub: number
  durationMinutes: number | null
  color: string | null
  /** Retired in PracticeHub but still on old visits: created archived, never offered. */
  archived: boolean
}

const stage = ref<'connect' | 'scanning' | 'preview' | 'importing' | 'done' | 'error'>('connect')
useImportWriting(() => stage.value === 'importing')
const phase = ref('')
const progress = ref({ done: 0, total: 0 })
const runError = ref('')
const lastConn = ref<{ baseUrl: string; apiKey: string; appDetails: string } | null>(null)

const candidates = ref<TypeCandidate[]>([])
const skippedNoMatch = ref(0)
// Prices come from PracticeHub 2.0's API, the only one that has them
// (utils/practicehubTypePrices.ts). Set when they could not be read, so the
// preview can say why the types come across without one.
const pricesUnavailable = ref<'no_v3_key' | 'read_failed' | null>(null)

const typesCreated = ref(0)
const pricesSet = ref(0)
const appointmentsUpdated = ref(0)
const importErrors = ref<string[]>([])

const newTypeCount = computed(() => new Set(candidates.value.filter((c) => !c.ourTypeId).map((c) => c.name.trim().toLowerCase())).size)
// Types already here that take PracticeHub's price. Two PracticeHub types of
// one name are one type here, so it is counted once.
const pricesToFill = computed(() => new Set(candidates.value.filter((c) => c.ourTypeId && c.priceToWrite !== null).map((c) => c.ourTypeId)).size)
const unpricedWarning = computed(() => practiceHubUnpricedTypesWarning(candidates.value.filter((c) => c.unpriced).map((c) => c.name), t))
const appointmentsToRelink = computed(() => candidates.value.reduce((sum, c) => sum + c.appointmentRefs.length, 0))

const previewColumns = computed(() => [
  { key: 'name', label: t('Appointment type', 'Tipo de cita') },
  { key: 'status', label: t('Status', 'Estado') },
  { key: 'price', label: t('Price', 'Precio') },
  { key: 'funnelStage', label: t('Stage', 'Etapa') },
  { key: 'appointments', label: t('Appointments', 'Citas') },
])

function priceLabel(c: TypeCandidate): string {
  if (c.priceToWrite !== null) return formatEur(c.priceToWrite)
  if (c.ourPriceCents) return t(`${formatEur(c.ourPriceCents)} (kept)`, `${formatEur(c.ourPriceCents)} (se mantiene)`)
  return '—'
}

function stageLabel(stage: string | null): string {
  const known = TYPE_STAGES.find((s) => s.value === stage)
  return known ? t(known.en, known.es) : '—'
}

const previewRows = computed(() =>
  [...candidates.value]
    .sort((a, b) => b.inPracticeHub - a.inPracticeHub)
    .map((c) => ({
      name: c.name,
      status: !c.ourTypeId
        ? t('Will be created', 'Se creará')
        : c.ourName && c.ourName.trim().toLowerCase() !== c.name.trim().toLowerCase()
          ? t(`Already here as "${c.ourName}"`, `Ya existe como «${c.ourName}»`)
          : t('Already here', 'Ya existe'),
      price: priceLabel(c),
      // The stage's name as Settings › Appointment types shows it, not its key.
      funnelStage: stageLabel(c.funnelStage),
      appointments: String(c.inPracticeHub),
    })),
)

const previewStats = computed(() => [
  { label: t('New types', 'Tipos nuevos'), value: newTypeCount.value, tone: 'good' as const },
  { label: t('Prices to fill in', 'Precios a completar'), value: pricesToFill.value, tone: 'good' as const },
  { label: t('Appointments to relink', 'Citas a revincular'), value: appointmentsToRelink.value, tone: 'good' as const },
  { label: t('Types already here', 'Tipos ya existentes'), value: candidates.value.length - newTypeCount.value },
  { label: t('No type in PracticeHub', 'Sin tipo en PracticeHub'), value: skippedNoMatch.value },
])

async function run(conn: { baseUrl: string; apiKey: string; appDetails: string }) {
  lastConn.value = conn
  stage.value = 'scanning'
  runError.value = ''
  candidates.value = []
  skippedNoMatch.value = 0
  pricesUnavailable.value = null
  typesCreated.value = 0
  pricesSet.value = 0
  appointmentsUpdated.value = 0
  importErrors.value = []
  const api = usePracticeHubApi(conn)

  try {
    phase.value = t('Fetching appointment types…', 'Obteniendo tipos de cita…')
    const phTypes = await api.fetchAll<PHAppointmentType>('/appointment_types')

    phase.value = t('Reading prices…', 'Leyendo precios…')
    const services = await loadPracticeHubServices()

    phase.value = t('Matching to existing types…', 'Emparejando con los tipos existentes…')
    // Oldest id first, as the server reads them, so a twin name resolves to the same one.
    const { data: existing, error: existingError } = await supabase.from('appointment_types').select('id, name, default_price_cents').order('id')
    // Read wrong, every type here would look new and be created a second time.
    if (existingError) throw existingError

    // Only the visits already here can be re-pointed. Counting PracticeHub's
    // own told a clinic with no appointments yet that 8,695 would be relinked.
    // Their types say which type here each PracticeHub type has become.
    const refsHere = new Set<string>()
    const visitsHere: { external_reference: string | null; appointment_type_id: string | null }[] = []
    const PAGE_SIZE = 1000
    for (let page = 0; ; page++) {
      const { data, error } = await supabase
        .from('appointments')
        .select('external_reference, appointment_type_id')
        .not('external_reference', 'is', null)
        .order('id')
        .range(page * PAGE_SIZE, page * PAGE_SIZE + PAGE_SIZE - 1)
      // Read short, a renamed type would look missing and be created again.
      if (error) throw error
      for (const a of data ?? []) {
        refsHere.add(a.external_reference!)
        visitsHere.push(a)
      }
      if (!data || data.length < PAGE_SIZE) break
    }

    phase.value = t('Fetching appointments…', 'Obteniendo citas…')
    progress.value = { done: 0, total: 0 }
    const phAppointments = await api.fetchAll<PHAppointment>('/appointments', (done, total) => (progress.value = { done, total }))

    const refsByPhTypeId = new Map<number, string[]>()
    const knownPhTypeIds = new Set(phTypes.map((phType) => phType.id))
    for (const appt of phAppointments) {
      if (!appt.appointment_type_id || !knownPhTypeIds.has(appt.appointment_type_id)) {
        skippedNoMatch.value++
        continue
      }
      const list = refsByPhTypeId.get(appt.appointment_type_id) ?? []
      list.push(String(appt.id))
      refsByPhTypeId.set(appt.appointment_type_id, list)
    }

    const matches = practiceHubTypeMatches({ phTypes, phAppointments, typesHere: existing ?? [], visitsHere })
    candidates.value = phTypes
      .filter((phType) => isWorthBringing(phType, refsByPhTypeId.get(phType.id)?.length ?? 0))
      .map((phType) => {
        const key = phType.name.trim().toLowerCase()
        const refs = refsByPhTypeId.get(phType.id) ?? []
        const ours = matches.get(String(phType.id))
        const ourPriceCents = ours ? ours.default_price_cents : null
        const phPrice = services ? practiceHubTypePrice(phType.name, services) : null
        return {
          phTypeId: phType.id,
          name: phType.name,
          ourTypeId: ours?.id ?? null,
          ourName: ours?.name ?? null,
          ourPriceCents,
          priceToWrite: practiceHubPriceToWrite(ourPriceCents, phPrice?.priceCents),
          unpriced: services !== null && !ourPriceCents && phPrice === null && !(phType.active === 0 || phType.active === false),
          funnelStage: STAGE_BY_NAME[key] ?? null,
          appointmentRefs: refs.filter((ref) => refsHere.has(ref)),
          inPracticeHub: refs.length,
          durationMinutes: phType.duration && phType.duration > 0 ? phType.duration : null,
          color: hexColor(phType.color),
          archived: phType.active === 0 || phType.active === false,
        }
      })
    stage.value = 'preview'
  } catch (err) {
    runError.value = importErrorText(err, t, { en: 'Could not read PracticeHub. Nothing was written; try again.', es: 'No se pudo leer PracticeHub. No se escribió nada; vuelve a intentarlo.' })
    stage.value = 'error'
  }
}

// PracticeHub's services with their prices. Null when there is no 2.0 key or
// the read failed: the types still come across, without a price, and a later
// run with the key fills in the ones still at 0.
async function loadPracticeHubServices(): Promise<PracticeHubBillableItem[] | null> {
  const saved = await useStaffFetch<{ hasV3Key?: boolean }>('/api/import/practicehub-connection').catch(() => null)
  if (!saved?.hasV3Key) {
    pricesUnavailable.value = 'no_v3_key'
    return null
  }
  try {
    return await usePracticeHubV3().fetchAll<PracticeHubBillableItem>('/billable_items')
  } catch {
    pricesUnavailable.value = 'read_failed'
    return null
  }
}

async function apply() {
  stage.value = 'importing'
  typesCreated.value = 0
  pricesSet.value = 0
  appointmentsUpdated.value = 0
  importErrors.value = []
  progress.value = { done: 0, total: appointmentsToRelink.value }

  try {
    phase.value = t('Creating appointment types…', 'Creando tipos de cita…')
    const ourTypeIdByPhTypeId = new Map<number, string>()
    // Two PracticeHub types can share a name; the second reuses the first
    // rather than creating a twin.
    const createdByName = new Map<string, string>()
    for (const c of candidates.value) {
      const key = c.name.trim().toLowerCase()
      const known = c.ourTypeId ?? createdByName.get(key)
      if (known) {
        ourTypeIdByPhTypeId.set(c.phTypeId, known)
        if (c.ourTypeId && c.priceToWrite !== null) {
          // Only over a 0, checked again as it is written: a price the clinic
          // set between the preview and now is theirs, and stays.
          const { data: priced, error } = await supabase
            .from('appointment_types')
            .update({ default_price_cents: c.priceToWrite })
            .eq('id', c.ourTypeId)
            .eq('default_price_cents', 0)
            .select('id')
          if (error) importErrors.value.push(t(`The price of "${c.name}" was not saved: ${error.message}`, `No se guardó el precio de "${c.name}": ${error.message}`))
          else if (priced?.length) pricesSet.value++
        }
        continue
      }
      const { data: created, error } = await supabase
        .from('appointment_types')
        // Not bookable online: an imported type is the history's, and the
        // clinic decides which ones patients may book on the type's own page.
        // Its length and colour are PracticeHub's, so the calendar looks the
        // way the clinic is used to.
        .insert({
          account_id: store.accountId!,
          name: c.name,
          stage: c.funnelStage,
          online_booking_enabled: false,
          ...(c.priceToWrite !== null ? { default_price_cents: c.priceToWrite } : {}),
          ...(c.durationMinutes ? { duration_minutes: c.durationMinutes } : {}),
          ...(c.color ? { color: c.color } : {}),
          ...(c.archived ? { archived_at: new Date().toISOString() } : {}),
        })
        .select('id')
        .single()
      if (error || !created) {
        importErrors.value.push(t(`The type "${c.name}" was not created: ${error?.message}`, `No se creó el tipo "${c.name}": ${error?.message}`))
        continue
      }
      ourTypeIdByPhTypeId.set(c.phTypeId, created.id)
      createdByName.set(key, created.id)
      typesCreated.value++
    }

    // Group by target type so each chunk is one bulk update instead of one
    // request per appointment -- 8000+ individual updates would be far too slow.
    phase.value = t('Relinking appointments…', 'Revinculando citas…')
    const CHUNK_SIZE = 200
    let done = 0
    for (const c of candidates.value) {
      const ourTypeId = ourTypeIdByPhTypeId.get(c.phTypeId)
      if (!ourTypeId) continue
      for (let i = 0; i < c.appointmentRefs.length; i += CHUNK_SIZE) {
        const chunk = c.appointmentRefs.slice(i, i + CHUNK_SIZE)
        const { error, count } = await supabase.from('appointments').update({ appointment_type_id: ourTypeId }, { count: 'exact' }).in('external_reference', chunk)
        if (error)
          importErrors.value.push(
            t(`Some visits from PracticeHub reference ${chunk[0]} on were not relinked: ${error.message}`, `Algunas visitas desde la referencia de PracticeHub ${chunk[0]} no se revincularon: ${error.message}`),
          )
        else appointmentsUpdated.value += count ?? 0
        done += chunk.length
        progress.value = { done, total: appointmentsToRelink.value }
      }
    }
  } catch (err) {
    // Re-running is safe -- types match by name and the appointment updates
    // are idempotent -- so surfacing the error beats a stuck "Importing…".
    runError.value = err instanceof Error ? err.message : String(err)
    stage.value = 'error'
    return
  }

  stage.value = 'done'
  showToast(
    t(
      `Created ${typesCreated.value} new appointment ${typesCreated.value === 1 ? 'type' : 'types'}, filled in ${pricesSet.value} ${pricesSet.value === 1 ? 'price' : 'prices'}, updated ${appointmentsUpdated.value} appointments. Skipped ${skippedNoMatch.value} with no type in PracticeHub.`,
      `Se crearon ${typesCreated.value} ${typesCreated.value === 1 ? 'tipo de cita nuevo' : 'tipos de cita nuevos'}, se ${pricesSet.value === 1 ? 'completó 1 precio' : `completaron ${pricesSet.value} precios`}, se actualizaron ${appointmentsUpdated.value} citas. Se omitieron ${skippedNoMatch.value} sin tipo en PracticeHub.`,
    ),
    importErrors.value.length > 0 ? 'error' : 'success',
  )
}

function retryRun() {
  if (lastConn.value) run(lastConn.value)
}

function reset() {
  stage.value = 'connect'
  candidates.value = []
  typesCreated.value = 0
  pricesSet.value = 0
  appointmentsUpdated.value = 0
  skippedNoMatch.value = 0
  pricesUnavailable.value = null
  importErrors.value = []
  progress.value = { done: 0, total: 0 }
}
const introLead = computed(() => t('Brings PracticeHub’s appointment types across, with their length, colour and price, and points every visit already here at the type PracticeHub says it was. Run it before Appointments, so their types match by name.', 'Trae los tipos de cita de PracticeHub, con su duración, color y precio, y asocia cada visita que ya esté aquí al tipo que dice PracticeHub. Ejecútalo antes de Citas, para que sus tipos coincidan por nombre.'))
const introNotes = computed(() => [
        { title: t('Nothing is written until you confirm.', 'No se escribe nada hasta que lo confirmes.'), body: t('The preview lists every type it will create and how many visits it will relink, so you can check them first.', 'La vista previa muestra cada tipo que creará y cuántas visitas revinculará, para que lo compruebes antes.') },
        { title: t('Safe to run again.', 'Se puede volver a ejecutar.'), body: t('Types are matched by name, so none is created twice. Every visit is set to PracticeHub’s type again, which changes nothing for one already on it.', 'Los tipos se emparejan por nombre, así que ninguno se crea dos veces. Cada visita vuelve a tomar el tipo de PracticeHub, lo que no cambia nada si ya lo tenía.') },
        { title: t('A price set here is never replaced.', 'Un precio puesto aquí nunca se sustituye.'), body: t('PracticeHub keeps prices on its services, so each type takes the price of the service with the same name, and only where its price here is still 0. A type with no service of its name keeps its price.', 'PracticeHub guarda los precios en sus servicios, así que cada tipo toma el precio del servicio con el mismo nombre, y solo si aquí sigue a 0. Un tipo sin servicio con su nombre conserva su precio.') },
])
</script>

<template>
  <div>
    <ImportIntro :lead="introLead" :notes="introNotes" />

    <div v-if="stage === 'connect'" class="mt-4 max-w-md">
      <ImportPracticeHubConnectForm @connect="run" />
    </div>

    <div v-else-if="stage === 'scanning' || stage === 'importing'" class="mt-4 rounded-lg border border-line bg-surface p-8 text-center">
      <p class="text-sm text-ink-600">{{ phase }}</p>
      <p v-if="progress.total > 0" class="mt-1 text-xs text-ink-faint">{{ progress.done }} / {{ progress.total }}</p>
    </div>

    <ImportPreviewPanel
      v-else-if="stage === 'preview'"
      class="mt-4"
      :stats="previewStats"
      :columns="previewColumns"
      :rows="previewRows"
      :sample-limit="20"
      :apply-label="
        t(
          `Create ${newTypeCount} ${newTypeCount === 1 ? 'type' : 'types'}, fill in ${pricesToFill} ${pricesToFill === 1 ? 'price' : 'prices'} and relink ${appointmentsToRelink} ${appointmentsToRelink === 1 ? 'appointment' : 'appointments'}`,
          `Crear ${newTypeCount} ${newTypeCount === 1 ? 'tipo' : 'tipos'}, completar ${pricesToFill} ${pricesToFill === 1 ? 'precio' : 'precios'} y revincular ${appointmentsToRelink} ${appointmentsToRelink === 1 ? 'cita' : 'citas'}`,
        )
      "
      :more-label="t('more types', 'tipos más')"
      @apply="apply"
      @cancel="reset"
    >
      <template #note>
        <p v-if="unpricedWarning" class="mb-2 text-xs text-ink-600">{{ unpricedWarning }}</p>
        <p v-if="pricesUnavailable" class="mb-2 text-xs text-ink-600">
          {{
            pricesUnavailable === 'no_v3_key'
              ? t(
                  'Prices are not brought across: PracticeHub only gives them through the PracticeHub API. Add the PracticeHub API key under Connection and run this step again; it fills in every price still at 0.',
                  'Los precios no se traen: PracticeHub solo los da por la PracticeHub API. Añade la clave de la PracticeHub API en Conexión y vuelve a ejecutar este paso; completará los precios que sigan a 0.',
                )
              : t(
                  'The PracticeHub API did not answer for the prices, so none are brought across this time. Run this step again later; it fills in every price still at 0.',
                  'La PracticeHub API no respondió al pedir los precios, así que esta vez no se traen. Vuelve a ejecutar este paso más tarde; completará los precios que sigan a 0.',
                )
          }}
        </p>
        <p class="text-xs text-ink-faint">
          {{
            t(
              'Types already here are matched by name and reused; only the ones marked "Will be created" are new. Relinking replaces the type a visit has here with the one PracticeHub gives it, even if someone changed it in QuiroFlow.',
              'Los tipos que ya existen aquí se emparejan por nombre y se reutilizan; solo son nuevos los marcados como «Se creará». Al revincular, el tipo que tiene la visita aquí se sustituye por el que le da PracticeHub, aunque alguien lo cambiara en QuiroFlow.',
            )
          }}
        </p>
      </template>
    </ImportPreviewPanel>

    <div v-else-if="stage === 'error'" class="mt-4 space-y-4">
      <div class="rounded-lg border border-danger-border bg-danger-bg p-4 text-sm text-danger-text">
        <p class="font-medium">{{ t('The import stopped before it finished.', 'La importación se detuvo antes de terminar.') }}</p>
        <p class="mt-1">{{ t('Types and visits changed before it stopped are kept. Retry reads PracticeHub again and carries on.', 'Los tipos y visitas cambiados antes de detenerse se conservan. Reintentar vuelve a leer PracticeHub y sigue.') }}</p>
        <p class="mt-1 text-[12.5px] opacity-80">{{ runError }}</p>
      </div>
      <button type="button" class="rounded-md bg-brand px-4 py-2 text-sm font-medium text-brand-on hover:bg-brand-hover" @click="retryRun">
        {{ t('Retry', 'Reintentar') }}
      </button>
    </div>

    <div v-else-if="stage === 'done'" class="mt-4 space-y-4">
      <div v-if="importErrors.length > 0" class="rounded-lg border border-danger-border bg-danger-bg p-4 text-sm text-danger-text">
        <p class="font-medium">{{ t('Some changes were not saved:', 'Algunos cambios no se guardaron:') }}</p>
        <ul class="mt-1 list-disc pl-5">
          <li v-for="(e, i) in importErrors" :key="i">{{ e }}</li>
        </ul>
      </div>
      <div class="flex gap-3">
        <NuxtLink to="/settings/appointment-types" class="rounded-md bg-brand px-4 py-2 text-sm font-medium text-brand-on hover:bg-brand-hover">
          {{ t('Review appointment types', 'Revisar tipos de cita') }}
        </NuxtLink>
        <button type="button" class="rounded-md px-4 py-2 text-sm font-medium text-ink-600 hover:bg-surface-subtle" @click="reset">
          {{ t('Run again', 'Ejecutar de nuevo') }}
        </button>
      </div>
    </div>
  </div>
</template>
