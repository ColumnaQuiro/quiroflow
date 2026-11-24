<script setup lang="ts">
// Settings > Import > Stripe > Stripe subscriptions: the subscriptions in the
// clinic's own Stripe account, made there or by another app, brought in as
// patient memberships (server/api/stripe/subscriptions/*,
// server/utils/stripeMembershipSync.ts).
//
// Two steps on one screen. First, which QuiroFlow plan each Stripe price is.
// Then each subscription with the patient it is paired with, or the one
// suggested (by email, phone or name, utils/gocardlessMatch.ts), or a new
// patient made from the Stripe customer when nobody here is them. Nothing is
// written until Import. From then on the webhook keeps each one in step and
// pairs new subscriptions by itself when the match is certain.

const supabase = useSupabaseClient()
const store = useAccountStore()
const t = useT()
const { showToast } = useToast()

interface Plan { id: string; name: string; price_cents: number; billing_interval: string; billing_interval_count: number }
interface PriceRow { id: string; productId: string | null; productName: string; amountCents: number; currency: string; interval: string | null; intervalCount: number; subscriptions: number; membershipId: string | null }
interface SubscriptionRow {
  id: string
  status: string
  membershipStatus: 'active' | 'paused' | 'cancelled' | null
  cancelAtPeriodEnd: boolean
  startedAt: string
  priceId: string | null
  amountCents: number
  mapped: boolean
  customer: { id: string; name: string; email: string | null; phone: string | null } | null
  linked: boolean
  patient: { id: string; name: string } | null
  suggestedBy: 'linked' | 'customer' | 'metadata' | 'email' | 'phone' | 'name' | null
  suggestedLoosely: boolean
  ambiguous: boolean
  wouldCreate: boolean
  /** What Import will do with it, when someone changed the suggestion. */
  choice?: { id: string; name: string } | 'new' | null
}

const loading = ref(true)
const notConnected = ref(false)
const loadError = ref('')
const plans = ref<Plan[]>([])
const prices = ref<PriceRow[]>([])
const subscriptions = ref<SubscriptionRow[]>([])
const filter = ref<'all' | 'pending' | 'linked'>('pending')

async function load() {
  loading.value = true
  loadError.value = ''
  try {
    const res = await useStaffFetch<{ plans: Plan[]; prices: PriceRow[]; subscriptions: SubscriptionRow[] }>('/api/stripe/subscriptions')
    plans.value = res.plans
    prices.value = res.prices
    subscriptions.value = res.subscriptions.map((s) => ({ ...s, choice: undefined }))
    notConnected.value = false
  } catch (e: any) {
    const status = e?.statusCode ?? e?.response?.status
    if (status === 400) notConnected.value = true
    else loadError.value = e?.data?.statusMessage ?? t('Could not read Stripe.', 'No se pudo leer Stripe.')
  } finally {
    loading.value = false
  }
}
onMounted(load)

// --- step 1: prices ---------------------------------------------------------------

const everyLabel = (interval: string | null, n: number) => {
  if (interval === 'week') return n === 1 ? t('every week', 'cada semana') : t(`every ${n} weeks`, `cada ${n} semanas`)
  if (interval === 'year') return n === 1 ? t('every year', 'cada año') : t(`every ${n} years`, `cada ${n} años`)
  if (interval === 'day') return n === 1 ? t('every day', 'cada día') : t(`every ${n} days`, `cada ${n} días`)
  return n === 1 ? t('every month', 'cada mes') : t(`every ${n} months`, `cada ${n} meses`)
}

const savingPrice = ref<string | null>(null)
async function mapPrice(price: PriceRow, value: string) {
  savingPrice.value = price.id
  try {
    const body = value === '__new' ? { priceId: price.id, createPlan: true } : { priceId: price.id, membershipId: value || null }
    const res = await useStaffFetch<{ membershipId: string | null }>('/api/stripe/subscriptions/price-map', { method: 'POST', body })
    if (value === '__new') {
      // The plan list and the suggestions both change; read them again.
      await load()
      showToast(t(`Plan "${price.productName}" created.`, `Plan "${price.productName}" creado.`))
      return
    }
    price.membershipId = res.membershipId
    for (const s of subscriptions.value) if (s.priceId === price.id) s.mapped = Boolean(res.membershipId)
  } catch (e: any) {
    showToast(e?.data?.statusMessage ?? t('Could not save the plan for this price.', 'No se pudo guardar el plan de este precio.'), 'error')
  } finally {
    savingPrice.value = null
  }
}

// --- step 2: subscriptions ------------------------------------------------------------

const counts = computed(() => ({
  all: subscriptions.value.length,
  linked: subscriptions.value.filter((s) => s.linked).length,
  pending: subscriptions.value.filter((s) => !s.linked).length,
}))
const shown = computed(() => subscriptions.value.filter((s) => filter.value === 'all' || (filter.value === 'linked' ? s.linked : !s.linked)))

/** Who Import pairs it with: a person's choice, else the suggestion, else a new patient when nobody here could be them. */
function plannedTarget(s: SubscriptionRow): { patientId: string | null } | null {
  if (s.linked || !s.mapped || !s.customer || s.membershipStatus === null) return null
  if (s.choice === 'new') return { patientId: null }
  if (s.choice) return { patientId: s.choice.id }
  if (s.patient && !s.ambiguous && !s.suggestedLoosely) return { patientId: s.patient.id }
  if (s.wouldCreate) return { patientId: null }
  return null
}
const importable = computed(() => subscriptions.value.filter((s) => plannedTarget(s)))
const unmappedCount = computed(() => subscriptions.value.filter((s) => !s.linked && !s.mapped).length)

const importing = ref(false)
const importProgress = ref({ done: 0, total: 0 })
const BATCH = 20
async function importAll() {
  const items = importable.value.map((s) => ({ subscriptionId: s.id, patientId: plannedTarget(s)!.patientId }))
  importing.value = true
  importProgress.value = { done: 0, total: items.length }
  let failed = 0
  try {
    for (let i = 0; i < items.length; i += BATCH) {
      const res = await useStaffFetch<{ results: { subscriptionId: string; outcome: string; message?: string }[] }>('/api/stripe/subscriptions/import', {
        method: 'POST',
        body: { items: items.slice(i, i + BATCH) },
      })
      failed += res.results.filter((r) => r.outcome === 'error' || r.outcome === 'pending').length
      importProgress.value = { ...importProgress.value, done: Math.min(i + BATCH, items.length) }
    }
    if (failed) showToast(t(`Imported, except ${failed} that could not be paired. They are still listed to import.`, `Importado, salvo ${failed} que no se pudieron emparejar. Siguen en la lista por importar.`), 'error')
    else showToast(t('Subscriptions imported as memberships.', 'Suscripciones importadas como membresías.'))
  } catch (e: any) {
    showToast(e?.data?.statusMessage ?? t('The import stopped. What was paired is kept; press Import again for the rest.', 'La importación se detuvo. Lo emparejado se conserva; pulsa Importar otra vez para el resto.'), 'error')
  } finally {
    importing.value = false
    await load()
  }
}

const busy = ref<string | null>(null)
async function unlink(s: SubscriptionRow) {
  busy.value = s.id
  try {
    await useStaffFetch('/api/stripe/subscriptions/unlink', { method: 'POST', body: { subscriptionId: s.id } })
    await load()
  } catch (e: any) {
    showToast(e?.data?.statusMessage ?? t('Could not undo the pairing.', 'No se pudo deshacer el emparejamiento.'), 'error')
  } finally {
    busy.value = null
  }
}

// Choosing a different patient: every word typed has to appear in the first
// name, the surname or the email (as GoCardlessMandates.vue).
type PatientResult = { id: string; first_name: string; last_name: string | null; email: string | null }
const picking = ref<string | null>(null)
const search = ref('')
const results = ref<PatientResult[]>([])
let searchToken = 0
watch(search, async (value) => {
  const token = ++searchToken
  const words = value.replace(/[,()%*.]/g, ' ').trim().split(/\s+/).filter(Boolean)
  if (words.join('').length < 2) {
    results.value = []
    return
  }
  let query = supabase.from('patients').select('id, first_name, last_name, email').eq('account_id', store.accountId!)
  for (const w of words) query = query.or(`first_name.ilike.%${w}%,last_name.ilike.%${w}%,email.ilike.%${w}%`)
  const { data } = await query.order('first_name').limit(8)
  if (token === searchToken) results.value = data ?? []
})
function startPicking(s: SubscriptionRow) {
  picking.value = s.id
  search.value = s.customer?.name ?? ''
}
function choose(s: SubscriptionRow, choice: SubscriptionRow['choice']) {
  s.choice = choice
  picking.value = null
}

const suggestedLabel = (s: SubscriptionRow) => {
  const by = s.suggestedBy
  if (by === 'customer' || by === 'metadata') return t('paired before', 'emparejada antes')
  if (by === 'email') return t('same email', 'mismo email')
  if (by === 'phone') return t('same phone', 'mismo teléfono')
  if (by === 'name') return s.suggestedLoosely ? t('similar name', 'nombre parecido') : t('same name', 'mismo nombre')
  return ''
}

const statusPill = (s: SubscriptionRow): { tone: 'success' | 'warning' | 'neutral' | 'danger'; text: string } | null => {
  if (s.membershipStatus === 'paused') return { tone: 'neutral', text: t('Paused', 'Pausada') }
  if (s.status === 'past_due' || s.status === 'unpaid') return { tone: 'danger', text: t('Payment failed', 'Pago fallido') }
  if (s.status === 'incomplete') return { tone: 'warning', text: t('First payment pending', 'Primer pago pendiente') }
  if (s.cancelAtPeriodEnd) return { tone: 'warning', text: t('Cancels at period end', 'Se cancela al final del periodo') }
  if (s.status === 'trialing') return { tone: 'neutral', text: t('Trial', 'Prueba') }
  return null
}
</script>

<template>
  <div class="flex flex-col gap-5" data-cy="stripe-subscriptions">
    <p class="text-[13.5px] leading-snug text-ink-600">
      {{ t('The subscriptions in your Stripe account, including the ones made in Stripe itself or by another app. Say which membership plan each Stripe price is, then import: each subscription becomes its patient’s membership, and the patient is created if they are not here yet. Nothing changes in Stripe.', 'Las suscripciones de tu cuenta de Stripe, también las creadas en el propio Stripe o por otra app. Indica qué plan de membresía es cada precio de Stripe y luego importa: cada suscripción pasa a ser la membresía de su paciente, y el paciente se crea si aún no está aquí. En Stripe no cambia nada.') }}
    </p>

    <div v-if="loading" class="flex flex-col gap-2">
      <UiSkeleton v-for="i in 4" :key="i" class="h-12 w-full" />
    </div>

    <div v-else-if="notConnected" class="rounded-ctl border border-line bg-surface-subtle px-4 py-3 text-[13.5px] text-ink-700" data-cy="stripe-not-connected">
      {{ t('Stripe is not connected yet.', 'Stripe aún no está conectado.') }}
      <NuxtLink to="/settings/payments" class="font-semibold text-brand-text hover:underline">{{ t('Connect it in Settings › Payments', 'Conéctalo en Ajustes › Pagos') }}</NuxtLink>
    </div>

    <p v-else-if="loadError" class="text-[13px] font-semibold text-danger-text">{{ loadError }}</p>

    <template v-else>
      <div class="rounded-ctl border border-line bg-surface-subtle px-3 py-2.5 text-[13px] leading-snug text-ink-700">
        {{ t('After the import, each charge Stripe takes is recorded on the patient with its invoice. A charge already here, imported from PracticeHub for instance, is recognised (same patient, amount and days) and not counted twice. Past charges are not brought in.', 'Tras la importación, cada cobro que haga Stripe se registra en el paciente con su factura. Un cobro que ya esté aquí, importado de PracticeHub por ejemplo, se reconoce (mismo paciente, importe y días) y no se cuenta dos veces. Los cobros anteriores no se traen.') }}
      </div>

      <!-- Step 1: prices -->
      <section class="flex flex-col gap-2" data-cy="stripe-prices">
        <h3 class="text-[14px] font-semibold text-ink-900">{{ t('1 · Which plan each Stripe price is', '1 · Qué plan es cada precio de Stripe') }}</h3>
        <UiEmptyState v-if="!prices.length" :title="t('No subscriptions in this Stripe account.', 'No hay suscripciones en esta cuenta de Stripe.')" />
        <ul v-else class="flex flex-col divide-y divide-line-row rounded-card border border-line">
          <li v-for="p in prices" :key="p.id" class="flex flex-wrap items-center gap-x-4 gap-y-2 px-4 py-3" data-cy="stripe-price" :data-price="p.id">
            <div class="flex min-w-[200px] flex-1 flex-col">
              <strong class="text-[14px] text-ink-900">{{ p.productName || p.id }}</strong>
              <span class="text-[12.5px] text-ink-muted">
                {{ formatEur(p.amountCents) }} {{ everyLabel(p.interval, p.intervalCount) }} · {{ p.subscriptions === 1 ? t('1 subscription', '1 suscripción') : t(`${p.subscriptions} subscriptions`, `${p.subscriptions} suscripciones`) }}
              </span>
            </div>
            <select
              class="h-9 min-w-[220px] rounded-ctl border border-line-control bg-surface px-2 text-[13.5px]"
              :value="p.membershipId ?? ''"
              :disabled="savingPrice === p.id || p.interval === 'day'"
              data-cy="stripe-price-plan"
              @change="mapPrice(p, ($event.target as HTMLSelectElement).value)"
            >
              <option value="">{{ t('Not a membership', 'No es una membresía') }}</option>
              <option v-for="plan in plans" :key="plan.id" :value="plan.id">{{ plan.name }}</option>
              <option value="__new">{{ t(`+ New plan "${p.productName}"`, `+ Plan nuevo "${p.productName}"`) }}</option>
            </select>
          </li>
        </ul>
      </section>

      <!-- Step 2: subscriptions -->
      <section class="flex flex-col gap-2">
        <h3 class="text-[14px] font-semibold text-ink-900">{{ t('2 · Each subscription and its patient', '2 · Cada suscripción y su paciente') }}</h3>
        <div class="flex flex-wrap items-center gap-2">
          <button
            v-for="f in (['pending', 'linked', 'all'] as const)"
            :key="f"
            type="button"
            class="rounded-pill border px-3 py-1 text-[12.5px] font-semibold"
            :class="filter === f ? 'border-brand bg-brand-tint text-brand-text' : 'border-line text-ink-600 hover:bg-surface-subtle'"
            :data-cy="`stripe-filter-${f}`"
            @click="filter = f"
          >
            {{ f === 'all' ? t('All', 'Todas') : f === 'linked' ? t('Imported', 'Importadas') : t('To import', 'Por importar') }} · {{ counts[f] }}
          </button>
          <span class="flex-1" />
          <UiBtn v-if="importable.length" variant="primary" :disabled="importing" data-cy="stripe-import" @click="importAll">
            {{ importing ? t(`Importing… ${importProgress.done}/${importProgress.total}`, `Importando… ${importProgress.done}/${importProgress.total}`) : t(`Import ${importable.length}`, `Importar ${importable.length}`) }}
          </UiBtn>
        </div>
        <p v-if="unmappedCount" class="text-[12.5px] text-ink-muted">
          {{ t(`${unmappedCount} are on a price with no plan yet; choose its plan above to import them.`, `${unmappedCount} tienen un precio sin plan todavía; elige su plan arriba para importarlas.`) }}
        </p>

        <ul v-if="shown.length" class="flex flex-col divide-y divide-line-row rounded-card border border-line">
          <li v-for="s in shown" :key="s.id" class="flex flex-wrap items-start gap-x-4 gap-y-2 px-4 py-3" data-cy="stripe-subscription" :data-subscription="s.id">
            <div class="flex min-w-[200px] flex-1 flex-col">
              <strong class="text-[14px] text-ink-900">{{ s.customer?.name || s.customer?.email || t('No name in Stripe', 'Sin nombre en Stripe') }}</strong>
              <span class="text-[12.5px] text-ink-muted">
                {{ [s.customer?.email, s.customer?.phone, formatEur(s.amountCents)].filter(Boolean).join(' · ') }}
              </span>
              <span v-if="statusPill(s)" class="mt-1"><UiPill :tone="statusPill(s)!.tone">{{ statusPill(s)!.text }}</UiPill></span>
            </div>

            <div class="flex min-w-[220px] flex-1 flex-col gap-1">
              <template v-if="picking !== s.id">
                <span v-if="s.linked && s.patient" class="text-[13.5px] text-ink-900">
                  → <NuxtLink :to="`/patients/${s.patient.id}`" class="font-semibold hover:underline">{{ s.patient.name }}</NuxtLink>
                  <UiPill tone="success" dot class="ml-1.5" data-cy="stripe-linked">{{ t('Imported', 'Importada') }}</UiPill>
                </span>
                <span v-else-if="!s.mapped" class="text-[13px] text-ink-muted">{{ t('Its price has no plan yet.', 'Su precio aún no tiene plan.') }}</span>
                <span v-else-if="s.choice === 'new' || (!s.choice && !s.patient && s.wouldCreate)" class="text-[13.5px] text-ink-900" data-cy="stripe-will-create">
                  → {{ t('New patient', 'Paciente nuevo') }}: <strong>{{ s.customer?.name || s.customer?.email }}</strong>
                </span>
                <span v-else-if="s.choice" class="text-[13.5px] text-ink-900">
                  → <strong>{{ s.choice.name }}</strong> <UiPill tone="neutral" class="ml-1.5">{{ t('chosen by hand', 'elegido a mano') }}</UiPill>
                </span>
                <span v-else-if="s.patient" class="text-[13.5px] text-ink-900">
                  → <NuxtLink :to="`/patients/${s.patient.id}`" class="font-semibold hover:underline">{{ s.patient.name }}</NuxtLink>
                  <UiPill :tone="s.suggestedLoosely ? 'warning' : 'neutral'" class="ml-1.5">{{ t('Suggested', 'Sugerida') }}: {{ suggestedLabel(s) }}</UiPill>
                </span>
                <span v-else class="text-[13px] text-ink-muted">
                  {{ s.ambiguous ? t('Several patients could be this one: choose.', 'Varios pacientes podrían ser este: elige.') : t('No patient found: choose one or create it.', 'No se ha encontrado paciente: elige uno o créalo.') }}
                </span>
              </template>
              <div v-else class="flex flex-col gap-1">
                <input v-model="search" type="search" class="h-9 rounded-ctl border border-line-control bg-surface px-3 text-[13.5px]" :placeholder="t('Search a patient', 'Buscar un paciente')" data-cy="stripe-patient-search">
                <button
                  v-for="p in results"
                  :key="p.id"
                  type="button"
                  class="rounded-ctlSm px-2 py-1.5 text-left text-[13px] hover:bg-surface-subtle"
                  data-cy="stripe-patient-option"
                  @click="choose(s, { id: p.id, name: `${p.first_name} ${p.last_name ?? ''}`.trim() })"
                >
                  {{ p.first_name }} {{ p.last_name }} <span class="text-ink-muted">{{ p.email }}</span>
                </button>
                <div class="flex gap-3">
                  <button type="button" class="text-[12.5px] font-semibold text-brand-text hover:underline" data-cy="stripe-create-patient" @click="choose(s, 'new')">{{ t('Create a new patient', 'Crear un paciente nuevo') }}</button>
                  <button type="button" class="text-[12.5px] text-ink-600 hover:underline" @click="picking = null">{{ t('Cancel', 'Cancelar') }}</button>
                </div>
              </div>
            </div>

            <div class="flex shrink-0 flex-wrap items-center gap-2">
              <UiBtn v-if="!s.linked && s.mapped && picking !== s.id" :disabled="importing" data-cy="stripe-choose" @click="startPicking(s)">{{ s.patient || s.choice || s.wouldCreate ? t('Change', 'Cambiar') : t('Choose patient', 'Elegir paciente') }}</UiBtn>
              <UiBtn v-if="s.linked" :disabled="busy === s.id" data-cy="stripe-unlink" @click="unlink(s)">{{ t('Unpair', 'Desemparejar') }}</UiBtn>
            </div>
          </li>
        </ul>
        <UiEmptyState v-else-if="subscriptions.length" :title="filter === 'pending' ? t('Everything is imported.', 'Todo está importado.') : t('Nothing here.', 'Nada aquí.')" />
      </section>
    </template>
  </div>
</template>
