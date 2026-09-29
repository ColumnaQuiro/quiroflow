<script setup lang="ts">
import { formatEur } from '~/utils/billing'
import { parseEurosToCents } from '~/utils/appointmentTypes'
import { PERIOD_OPTIONS, monthlyCents, periodLabel } from '~/utils/membershipPeriod'

// Membership plan templates. Starting a patient on a plan copies its name and
// price into patient_memberships, so editing or removing a plan here changes
// what is offered from now on and leaves everyone already on it as they were.
// patient_memberships.membership_id is `on delete set null` for the same
// reason.

interface PlanRow {
  id: string
  name: string
  price_cents: number
  billing_interval: string
  billing_interval_count: number
}
interface Members {
  count: number
  cents: number
}

const supabase = useSupabaseClient()
const store = useAccountStore()
const t = useT()
const { showToast } = useToast()

const plans = ref<PlanRow[]>([])
const members = ref<Record<string, Members>>({})
const loading = ref(true)

async function load() {
  const [plansRes, activeRes] = await Promise.all([
    supabase.from('memberships').select('id, name, price_cents, billing_interval, billing_interval_count').order('name'),
    // Active memberships are few per clinic; each carries the price the
    // patient is actually paying, which can differ from the plan's today.
    supabase.from('patient_memberships').select('membership_id, price_cents').eq('status', 'active').not('membership_id', 'is', null),
  ])
  plans.value = plansRes.data ?? []
  const byPlan: Record<string, Members> = {}
  for (const row of activeRes.data ?? []) {
    const m = (byPlan[row.membership_id!] ??= { count: 0, cents: 0 })
    m.count += 1
    m.cents += row.price_cents
  }
  members.value = byPlan
  loading.value = false
}
onMounted(load)

function planMembers(id: string): Members {
  return members.value[id] ?? { count: 0, cents: 0 }
}
function membersLabel(id: string) {
  const n = planMembers(id).count
  if (n === 0) return t('No members yet', 'Aún sin miembros')
  return n === 1 ? t('1 active member', '1 miembro activo') : t(`${n} active members`, `${n} miembros activos`)
}
// What this plan's members bring in each month, whatever the plan's period.
function planMonthlyCents(p: PlanRow) {
  return Math.round(monthlyCents(planMembers(p.id).cents, p))
}

const totalMembers = computed(() => plans.value.reduce((sum, p) => sum + planMembers(p.id).count, 0))
const totalMonthly = computed(() => plans.value.reduce((sum, p) => sum + planMonthlyCents(p), 0))

// --- the form, for a new plan or an existing one ---

const editing = ref<PlanRow | 'new' | null>(null)
const formName = ref('')
const formPrice = ref('')
const formPeriod = ref('month-1')
const saving = ref(false)
const formError = ref('')

function periodKey(p: { billing_interval: string; billing_interval_count: number }) {
  return `${p.billing_interval}-${p.billing_interval_count}`
}

// A plan stored with a period the list does not offer still shows, and saves, as itself.
const periodOptions = computed(() => {
  const opts = PERIOD_OPTIONS.map((o) => ({ key: o.key, interval: o.interval as string, count: o.count }))
  if (editing.value && editing.value !== 'new' && !opts.some((o) => o.key === periodKey(editing.value as PlanRow))) {
    const p = editing.value
    opts.push({ key: periodKey(p), interval: p.billing_interval, count: p.billing_interval_count })
  }
  return opts
})
function optionLabel(o: { interval: string; count: number }) {
  const label = periodLabel({ billing_interval: o.interval, billing_interval_count: o.count }, t)
  return o.count === 1 ? label.charAt(0).toUpperCase() + label.slice(1) : label
}

function openNew() {
  editing.value = 'new'
  formName.value = ''
  formPrice.value = ''
  formPeriod.value = 'month-1'
  formError.value = ''
}
function openEdit(p: PlanRow) {
  editing.value = p
  formName.value = p.name
  formPrice.value = (p.price_cents / 100).toFixed(2).replace('.', ',')
  formPeriod.value = periodKey(p)
  formError.value = ''
}

// Empty is not zero: a blank price is refused, a typed 0 is a free plan.
const formPriceCents = computed(() => parseEurosToCents(formPrice.value) ?? Number.NaN)

async function save() {
  formError.value = ''
  const name = formName.value.trim()
  if (!name || !Number.isFinite(formPriceCents.value) || formPriceCents.value < 0) {
    formError.value = t('A plan needs a name and a price.', 'Un plan necesita nombre y precio.')
    return
  }
  const period = periodOptions.value.find((o) => o.key === formPeriod.value) ?? periodOptions.value[1]
  const values = { name, price_cents: formPriceCents.value, billing_interval: period.interval, billing_interval_count: period.count }
  saving.value = true
  const { error } =
    editing.value === 'new'
      ? await supabase.from('memberships').insert({ account_id: store.accountId!, ...values })
      : await supabase.from('memberships').update(values).eq('id', editing.value!.id)
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
  const { error } = await supabase.from('memberships').delete().eq('id', editing.value.id)
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
    <PageHeader :title="t('Memberships', 'Membresías')">
      <UiBtn variant="primary" data-cy="membership-add" @click="openNew">{{ t('New plan', 'Nuevo plan') }}</UiBtn>
    </PageHeader>
    <div class="flex-1 overflow-y-auto">
      <div class="flex gap-8 p-6">
        <SettingsNav />
        <div class="flex min-w-0 max-w-[820px] flex-1 flex-col gap-4" data-cy="settings-list" :data-ready="loading ? undefined : 'true'">
          <p class="text-[13.5px] text-ink-muted">
            {{ t('Recurring plans patients sign up to, such as a monthly maintenance membership.', 'Planes recurrentes a los que se apuntan los pacientes, como una membresía mensual de mantenimiento.') }}
          </p>

          <div class="grid grid-cols-2 gap-3">
            <div class="flex flex-col gap-1 rounded-card border border-line bg-surface px-[18px] py-4">
              <span class="text-[12.5px] font-semibold text-ink-muted">{{ t('Active members', 'Miembros activos') }}</span>
              <UiSkeleton v-if="loading" class="mt-1 h-7 w-12 rounded-ctlSm" />
              <strong v-else class="text-[28px] font-[640] tracking-tightTitle text-ink-900" data-cy="membership-total-members">{{ totalMembers }}</strong>
            </div>
            <div class="flex flex-col gap-1 rounded-card border border-line bg-surface px-[18px] py-4">
              <span class="text-[12.5px] font-semibold text-ink-muted">{{ t('Recurring each month', 'Ingresos recurrentes al mes') }}</span>
              <UiSkeleton v-if="loading" class="mt-1 h-7 w-24 rounded-ctlSm" />
              <strong v-else class="text-[28px] font-[640] tracking-tightTitle text-ink-900" data-cy="membership-total-monthly">{{ formatEur(totalMonthly) }}</strong>
            </div>
          </div>

          <section aria-labelledby="h-plans" class="overflow-hidden rounded-card border border-line bg-surface">
            <div class="px-[18px] pb-3 pt-4">
              <h2 id="h-plans" class="text-[16px] font-bold text-ink-900">{{ t(`Plans · ${plans.length}`, `Planes · ${plans.length}`) }}</h2>
            </div>

            <template v-if="loading">
              <div v-for="i in 3" :key="i" class="flex items-center gap-3.5 border-t border-line-row px-[18px] py-4">
                <UiSkeleton class="h-9 w-9 rounded-ctl" />
                <UiSkeleton class="h-4 w-40 rounded-ctlSm" />
              </div>
            </template>
            <p v-else-if="plans.length === 0 && editing !== 'new'" class="border-t border-line-row px-[18px] py-6 text-center text-[14px] text-ink-muted">
              {{ t('No membership plans yet.', 'Todavía no hay planes de membresía.') }}
            </p>

            <template v-for="p in plans" :key="p.id">
              <div data-cy="membership-row" class="flex min-h-[72px] items-center gap-3.5 border-t border-line-row py-2.5 pl-[18px] pr-3" :class="editing !== 'new' && editing?.id === p.id ? 'bg-brand-tint' : ''">
                <span class="flex h-9 w-9 shrink-0 items-center justify-center rounded-ctl bg-brand-tint text-brand-text" aria-hidden="true">
                  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M20 12a8 8 0 1 1-2.3-5.7M20 4v4h-4" /></svg>
                </span>
                <div class="flex min-w-0 flex-1 flex-col gap-0.5">
                  <strong class="text-[15.5px] text-ink-900" data-cy="membership-name">{{ p.name }}</strong>
                  <span class="text-[13.5px] text-ink-500" data-cy="membership-price">{{ formatEur(p.price_cents) }} / {{ periodLabel(p, t) }}</span>
                </div>
                <div class="flex shrink-0 flex-col items-end gap-0.5 text-right">
                  <span class="text-[13.5px] font-semibold text-ink-700">{{ membersLabel(p.id) }}</span>
                  <span v-if="planMembers(p.id).count > 0" class="text-[12.5px] text-ink-muted">{{ t(`${formatEur(planMonthlyCents(p))} a month`, `${formatEur(planMonthlyCents(p))} al mes`) }}</span>
                </div>
                <button
                  type="button"
                  data-cy="membership-edit"
                  class="flex h-9 w-9 touch:h-11 touch:w-11 shrink-0 items-center justify-center rounded-ctl text-ink-muted hover:bg-surface-subtle hover:text-ink-700"
                  :aria-label="t(`Edit ${p.name}`, `Editar ${p.name}`)"
                  @click="openEdit(p)"
                >
                  <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M4 20h4L19 9l-4-4L4 16v4zM13.5 6.5l4 4" /></svg>
                </button>
              </div>
            </template>

            <form v-if="editing" data-cy="membership-form" class="flex flex-col gap-3.5 border-t-[1.5px] border-brand bg-surface p-[18px]" @submit.prevent="save">
              <strong class="text-[15px] text-ink-900">{{ editing === 'new' ? t('New plan', 'Nuevo plan') : t(`Editing "${editing.name}"`, `Editando "${editing.name}"`) }}</strong>
              <div class="grid grid-cols-2 gap-3 sm:grid-cols-[2fr_1fr_1fr]">
                <label class="col-span-2 flex flex-col gap-1.5 text-[13px] font-semibold text-ink-700 sm:col-span-1">
                  {{ t('Name', 'Nombre') }}
                  <input v-model="formName" data-cy="membership-name-input" type="text" :placeholder="t('E.g. Monthly maintenance', 'Ej. Mantenimiento mensual')" :class="inputClass" />
                </label>
                <label class="flex flex-col gap-1.5 text-[13px] font-semibold text-ink-700">
                  {{ t('Price (€)', 'Precio (€)') }}
                  <input v-model="formPrice" data-cy="membership-price-input" type="text" inputmode="decimal" placeholder="49,00" :class="[inputClass, 'text-right']" />
                </label>
                <label class="flex flex-col gap-1.5 text-[13px] font-semibold text-ink-700">
                  {{ t('Every', 'Cada') }}
                  <select v-model="formPeriod" data-cy="membership-period-input" :class="inputClass">
                    <option v-for="o in periodOptions" :key="o.key" :value="o.key">{{ optionLabel(o) }}</option>
                  </select>
                </label>
              </div>
              <div class="flex flex-wrap items-center gap-2.5">
                <UiBtn v-if="editing !== 'new'" data-cy="membership-remove" class="!border-danger-border !text-danger-text" :disabled="removing" @click="remove">
                  {{ t('Stop offering', 'Dejar de ofrecer') }}
                </UiBtn>
                <span class="flex-1 text-[13px] text-ink-muted">
                  <template v-if="editing !== 'new' && planMembers(editing.id).count > 0">
                    {{ t(`The ${planMembers(editing.id).count} patient(s) on it keep their current price.`, `Los ${planMembers(editing.id).count} paciente(s) que lo tienen conservan su precio actual.`) }}
                  </template>
                </span>
                <UiBtn variant="ghost" @click="editing = null">{{ t('Cancel', 'Cancelar') }}</UiBtn>
                <UiBtn variant="primary" type="submit" data-cy="membership-save" :disabled="saving">
                  {{ saving ? t('Saving…', 'Guardando…') : editing === 'new' ? t('Create plan', 'Crear plan') : t('Save', 'Guardar') }}
                </UiBtn>
              </div>
              <p v-if="formError" class="text-[12.5px] font-semibold text-danger-text">{{ formError }}</p>
            </form>
          </section>

          <p class="rounded-ctl border border-line bg-surface-subtle px-3.5 py-3 text-[13.5px] leading-snug text-ink-700">
            {{ t('Changing or removing a plan only affects patients who join from now on. Patients already on it keep their price until you end it on their record.', 'Cambiar o eliminar un plan solo afecta a los pacientes que se apunten a partir de ahora. Quienes ya lo tienen conservan su precio hasta que lo finalices en su ficha.') }}
          </p>
        </div>
      </div>
    </div>
  </div>
</template>
