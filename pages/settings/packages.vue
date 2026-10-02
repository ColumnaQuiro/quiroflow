<script setup lang="ts">
import { formatEur } from '~/utils/billing'
import { parseEurosToCents } from '~/utils/appointmentTypes'

// Bono templates. A sale copies the name, session count and price into
// package_purchases, so editing or removing a template here changes what is
// sold from now on and nothing already sold -- which is why editing is safe
// to offer at all.

interface PackageRow {
  id: string
  name: string
  session_count: number
  price_cents: number
}
interface Sales {
  sold: number
  open: number
}

const supabase = useSupabaseClient()
const store = useAccountStore()
const t = useT()
const { showToast } = useToast()

const packages = ref<PackageRow[]>([])
const sales = ref<Record<string, Sales>>({})
const loading = ref(true)

async function load() {
  const { data } = await supabase.from('packages').select('id, name, session_count, price_cents').order('name')
  packages.value = data ?? []
  loading.value = false
  // Sold is a head count; open reads only the not-closed purchases, since
  // "sessions left" compares two columns, which PostgREST cannot filter on.
  // Same rule as usePatientFinancialSummary: open means not closed and not
  // used up.
  const results = await Promise.all(
    packages.value.map((p) =>
      Promise.all([
        supabase.from('package_purchases').select('id', { count: 'exact', head: true }).eq('package_id', p.id),
        supabase.from('package_purchases').select('sessions_total, sessions_used').eq('package_id', p.id).eq('is_closed', false),
      ]),
    ),
  )
  sales.value = Object.fromEntries(
    packages.value.map((p, i) => {
      const [sold, open] = results[i]
      return [p.id, { sold: sold.count ?? 0, open: (open.data ?? []).filter((x) => x.sessions_used < x.sessions_total).length }]
    }),
  )
}
onMounted(load)

function perSession(p: { session_count: number; price_cents: number }) {
  return p.session_count > 0 ? formatEur(Math.round(p.price_cents / p.session_count)) : ''
}
function soldLabel(id: string) {
  const s = sales.value[id]
  if (!s) return ''
  if (s.sold === 0) return t('Not sold yet', 'Aún sin vender')
  return s.sold === 1 ? t('1 sold', '1 vendido') : t(`${s.sold} sold`, `${s.sold} vendidos`)
}
function openLabel(id: string) {
  const s = sales.value[id]
  if (!s) return ''
  if (s.open === 0) return t('None open', 'Ninguno abierto')
  return t(`${s.open} with sessions left`, `${s.open} con sesiones pendientes`)
}

// --- the form, for a new bono or an existing one ---

const editing = ref<PackageRow | 'new' | null>(null)
const formName = ref('')
const formSessions = ref('10')
const formPrice = ref('')
const saving = ref(false)
const formError = ref('')

function openNew() {
  editing.value = 'new'
  formName.value = ''
  formSessions.value = '10'
  formPrice.value = ''
  formError.value = ''
}
function openEdit(p: PackageRow) {
  editing.value = p
  formName.value = p.name
  formSessions.value = String(p.session_count)
  formPrice.value = (p.price_cents / 100).toFixed(2).replace('.', ',')
  formError.value = ''
}

const formSessionsNum = computed(() => Number.parseInt(formSessions.value, 10))
// Empty is not zero: a blank price is refused, a typed 0 is a free plan.
const formPriceCents = computed(() => parseEurosToCents(formPrice.value) ?? Number.NaN)
const formValid = computed(() => formName.value.trim() !== '' && formSessionsNum.value > 0 && Number.isFinite(formPriceCents.value) && formPriceCents.value >= 0)
const formPerSession = computed(() => (formValid.value ? perSession({ session_count: formSessionsNum.value, price_cents: formPriceCents.value }) : ''))

async function save() {
  formError.value = ''
  if (!formValid.value) {
    formError.value = t('A bono needs a name, at least one session and a price.', 'Un bono necesita nombre, al menos una sesión y un precio.')
    return
  }
  saving.value = true
  const values = { name: formName.value.trim(), session_count: formSessionsNum.value, price_cents: formPriceCents.value }
  const { error } =
    editing.value === 'new'
      ? await supabase.from('packages').insert({ account_id: store.accountId!, ...values })
      : await supabase.from('packages').update(values).eq('id', editing.value!.id)
  saving.value = false
  if (error) {
    formError.value = error.message
    return
  }
  editing.value = null
  useBillingTemplates().invalidate()
  await load()
}

const removing = ref(false)
async function remove() {
  if (!editing.value || editing.value === 'new') return
  removing.value = true
  const { error } = await supabase.from('packages').delete().eq('id', editing.value.id)
  removing.value = false
  if (error) {
    showToast(error.message, 'error')
    return
  }
  editing.value = null
  useBillingTemplates().invalidate()
  await load()
}

const inputClass = 'h-9 touch:h-11 w-full rounded-ctl border border-line-control bg-surface px-3 text-[14px] font-normal text-ink-900 focus:border-brand focus:outline-none focus:ring-1 focus:ring-brand'
</script>

<template>
  <div class="flex h-full flex-col">
    <PageHeader :title="t('Packages / Bonos', 'Bonos')">
      <UiBtn variant="primary" data-cy="package-add" @click="openNew">{{ t('New bono', 'Nuevo bono') }}</UiBtn>
    </PageHeader>
    <div class="flex-1 overflow-y-auto">
      <div class="flex gap-8 p-4 pb-24 sm:px-6 sm:pt-6 lg:pb-6">
        <SettingsNav />
        <div class="flex min-w-0 max-w-[820px] flex-1 flex-col gap-4" data-cy="settings-list" :data-ready="loading ? undefined : 'true'">
          <p class="text-[13.5px] text-ink-muted">
            {{ t('Session bundles you sell to patients, such as "Bono 10 sesiones".', 'Paquetes de sesiones que vendes a los pacientes, como "Bono 10 sesiones".') }}
          </p>

          <h2 class="mt-1 text-[16px] font-bold text-ink-900">{{ t(`Bonos · ${packages.length}`, `Bonos · ${packages.length}`) }}</h2>

          <div class="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <template v-if="loading">
              <div v-for="i in 2" :key="i" class="flex flex-col gap-3 rounded-card border border-line bg-surface p-[18px]">
                <UiSkeleton class="h-4 w-32 rounded-ctlSm" />
                <UiSkeleton class="h-7 w-24 rounded-ctlSm" />
              </div>
            </template>
            <p v-else-if="packages.length === 0 && editing !== 'new'" class="col-span-full rounded-card border border-line bg-surface px-[18px] py-6 text-center text-[14px] text-ink-muted">
              {{ t('No bonos yet. Create the first one to sell it from a patient\'s Billing tab.', 'Todavía no hay bonos. Crea el primero para venderlo desde la pestaña Facturación del paciente.') }}
            </p>

            <article v-for="p in packages" :key="p.id" data-cy="package-card" class="flex flex-col overflow-hidden rounded-card border border-line bg-surface" :class="editing !== 'new' && editing?.id === p.id ? 'ring-2 ring-brand' : ''">
              <div class="flex items-start gap-2 pb-3.5 pl-[18px] pr-2.5 pt-4">
                <div class="flex min-w-0 flex-1 flex-col gap-2.5">
                  <strong class="text-[15.5px] text-ink-900" data-cy="package-name">{{ p.name }}</strong>
                  <div class="flex flex-wrap items-baseline gap-x-2.5">
                    <span class="text-[26px] font-[640] tracking-tightTitle text-ink-900">{{ formatEur(p.price_cents) }}</span>
                    <span class="text-[13.5px] text-ink-500">{{ p.session_count === 1 ? t('1 session', '1 sesión') : t(`${p.session_count} sessions`, `${p.session_count} sesiones`) }}</span>
                  </div>
                  <span class="inline-flex h-6 items-center self-start rounded-pill bg-brand-tint px-2.5 text-[12px] font-bold text-brand-text">{{ t(`${perSession(p)} per session`, `${perSession(p)} por sesión`) }}</span>
                </div>
                <button
                  type="button"
                  data-cy="package-edit"
                  class="flex h-9 w-9 touch:h-11 touch:w-11 shrink-0 items-center justify-center rounded-ctl text-ink-muted hover:bg-surface-subtle hover:text-ink-700"
                  :aria-label="t(`Edit ${p.name}`, `Editar ${p.name}`)"
                  @click="openEdit(p)"
                >
                  <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M4 20h4L19 9l-4-4L4 16v4zM13.5 6.5l4 4" /></svg>
                </button>
              </div>
              <div class="mt-auto flex flex-wrap gap-x-3 border-t border-line-row bg-surface-subtle px-[18px] py-2.5 text-[13px] text-ink-500">
                <span data-cy="package-sold">{{ soldLabel(p.id) }}</span>
                <span class="text-ink-muted" aria-hidden="true">·</span>
                <span>{{ openLabel(p.id) }}</span>
              </div>
            </article>

            <form
              v-if="editing"
              data-cy="package-form"
              class="col-span-full flex flex-col gap-3.5 rounded-card border-[1.5px] border-brand bg-surface p-[18px] shadow-focus"
              @submit.prevent="save"
            >
              <strong class="text-[15px] text-ink-900">{{ editing === 'new' ? t('New bono', 'Nuevo bono') : t(`Editing "${editing.name}"`, `Editando "${editing.name}"`) }}</strong>
              <div class="grid grid-cols-2 gap-3 sm:grid-cols-[2fr_1fr_1fr]">
                <label class="col-span-2 flex flex-col gap-1.5 text-[13px] font-semibold text-ink-700 sm:col-span-1">
                  {{ t('Name', 'Nombre') }}
                  <input v-model="formName" data-cy="package-name-input" type="text" placeholder="Bono 10 sesiones" :class="inputClass" />
                </label>
                <label class="flex flex-col gap-1.5 text-[13px] font-semibold text-ink-700">
                  {{ t('Sessions', 'Sesiones') }}
                  <input v-model="formSessions" data-cy="package-sessions-input" type="number" min="1" inputmode="numeric" :class="[inputClass, 'text-right']" />
                </label>
                <label class="flex flex-col gap-1.5 text-[13px] font-semibold text-ink-700">
                  {{ t('Price (€)', 'Precio (€)') }}
                  <input v-model="formPrice" data-cy="package-price-input" type="text" inputmode="decimal" placeholder="300,00" :class="[inputClass, 'text-right']" />
                </label>
              </div>
              <div class="flex flex-wrap items-center gap-2.5">
                <UiBtn v-if="editing !== 'new'" data-cy="package-remove" class="!border-danger-border !text-danger-text" :disabled="removing" @click="remove">
                  {{ t('Remove bono', 'Eliminar bono') }}
                </UiBtn>
                <span class="flex-1 text-[13.5px] text-ink-500">
                  <template v-if="formPerSession">{{ t('That is', 'Son') }} <strong class="text-ink-900">{{ t(`${formPerSession} per session`, `${formPerSession} por sesión`) }}</strong>.</template>
                </span>
                <UiBtn variant="ghost" @click="editing = null">{{ t('Cancel', 'Cancelar') }}</UiBtn>
                <UiBtn variant="primary" type="submit" data-cy="package-save" :disabled="saving">
                  {{ saving ? t('Saving…', 'Guardando…') : editing === 'new' ? t('Create bono', 'Crear bono') : t('Save', 'Guardar') }}
                </UiBtn>
              </div>
              <p v-if="formError" class="text-[12.5px] font-semibold text-danger-text">{{ formError }}</p>
            </form>
          </div>

          <p class="rounded-ctl border border-line bg-surface-subtle px-3.5 py-3 text-[13.5px] leading-snug text-ink-700">
            {{ t('Changing or removing a bono only affects future sales. Bonos already sold keep their sessions and price.', 'Cambiar o eliminar un bono solo afecta a las ventas futuras. Los bonos ya vendidos conservan sus sesiones y su precio.') }}
          </p>
        </div>
      </div>
    </div>
  </div>
</template>
