<script setup lang="ts">
interface CarePlan {
  id: string
  name: string
  frequency_value: number
  frequency_unit: 'week' | 'month'
  visits_per_period?: number | null
  total_visits: number
  started_at: string
  payment_kind?: string | null
  package_purchase_id?: string | null
  patient_membership_id?: string | null
}

const props = defineProps<{ patientId: string; plan?: CarePlan | null }>()
const emit = defineEmits<{ close: []; saved: [] }>()

const supabase = useSupabaseClient()
const store = useAccountStore()
const t = useT()

const name = ref(props.plan?.name ?? t('Care Plan', 'Plan de tratamiento'))
// "N visits every M weeks": frequency_value is the interval M (what the
// calendar series and Care Plan Alerts read), visits_per_period is N.
const visitsPerPeriod = ref(props.plan?.visits_per_period ?? 1)
const frequencyValue = ref(props.plan?.frequency_value ?? 1)
const frequencyUnit = ref<'week' | 'month'>(props.plan?.frequency_unit ?? 'week')
const totalVisits = ref(props.plan?.total_visits ?? 10)
const startedAt = ref(props.plan?.started_at ?? new Date().toISOString().slice(0, 10))
const saving = ref(false)
const error = ref('')

// How it is paid: at the normal prices visit by visit, from one of the
// patient's bonos, or under one of their memberships -- what the clinic
// already sells, linked (care_plan_payment migration). Nothing is charged
// from here.
type PaymentKind = 'per_visit' | 'bono' | 'membership'
const paymentKind = ref<PaymentKind>((props.plan?.payment_kind as PaymentKind) ?? 'per_visit')
const bonoId = ref(props.plan?.package_purchase_id ?? '')
const membershipId = ref(props.plan?.patient_membership_id ?? '')
const bonos = ref<{ id: string; label: string }[]>([])
const memberships = ref<{ id: string; label: string }[]>([])
onMounted(async () => {
  const [{ data: own }, { data: shared }, { data: mems }] = await Promise.all([
    supabase.from('package_purchases').select('id, package_name, sessions_total, sessions_used, is_closed').eq('patient_id', props.patientId).eq('is_closed', false),
    supabase.from('package_purchase_shares').select('package_purchases(id, package_name, sessions_total, sessions_used, is_closed)').eq('patient_id', props.patientId),
    supabase.from('patient_memberships').select('id, membership_name, price_cents, status').eq('patient_id', props.patientId).eq('status', 'active'),
  ])
  type P = { id: string; package_name: string; sessions_total: number; sessions_used: number; is_closed: boolean }
  const open = [...((own ?? []) as P[]), ...(((shared ?? []) as { package_purchases: P | null }[]).map((r) => r.package_purchases).filter((p): p is P => !!p && !p.is_closed))]
    .filter((p) => p.sessions_total - p.sessions_used > 0)
  bonos.value = open.map((p) => ({ id: p.id, label: t(`${p.package_name} · ${p.sessions_total - p.sessions_used} left`, `${p.package_name} · quedan ${p.sessions_total - p.sessions_used}`) }))
  memberships.value = ((mems ?? []) as { id: string; membership_name: string; price_cents: number }[]).map((m) => ({ id: m.id, label: `${m.membership_name} · ${formatEur(m.price_cents)}` }))
})

async function save() {
  error.value = ''
  if (paymentKind.value === 'bono' && !bonoId.value) {
    error.value = t('Choose the bono that pays for it.', 'Elige el bono con el que se paga.')
    return
  }
  if (paymentKind.value === 'membership' && !membershipId.value) {
    error.value = t('Choose the membership that pays for it.', 'Elige la membresía con la que se paga.')
    return
  }
  saving.value = true
  // Inserts a new plan rather than updating the existing one in place, so
  // progress already made under the old cadence isn't silently reattributed
  // to the changed one -- "Edit Plan" starts a fresh phase.
  const { error: insertError } = await supabase.from('care_plans').insert({
    account_id: store.accountId!,
    patient_id: props.patientId,
    name: name.value.trim() || t('Care Plan', 'Plan de tratamiento'),
    frequency_value: Math.max(1, Math.round(frequencyValue.value || 1)),
    frequency_unit: frequencyUnit.value,
    visits_per_period: Math.min(7, Math.max(1, Math.round(visitsPerPeriod.value || 1))),
    total_visits: totalVisits.value,
    started_at: startedAt.value,
    payment_kind: paymentKind.value,
    package_purchase_id: paymentKind.value === 'bono' ? bonoId.value : null,
    patient_membership_id: paymentKind.value === 'membership' ? membershipId.value : null,
    created_by: store.teamMember?.id ?? null,
  })
  saving.value = false
  if (insertError) {
    error.value = insertError.message
    return
  }
  emit('saved')
}
</script>

<template>
  <div class="fixed inset-0 z-20 flex items-center justify-center bg-ink-900/40 p-4" @click.self="emit('close')">
    <div class="max-h-full w-full overflow-y-auto max-w-sm rounded-lg bg-white p-6 shadow-xl">
      <div class="flex items-center justify-between">
        <h2 class="text-lg font-semibold text-gray-900">{{ plan ? t('Edit Plan', 'Editar plan') : t('New Care Plan', 'Nuevo plan de tratamiento') }}</h2>
        <button type="button" :aria-label="t('Close', 'Cerrar')" class="text-gray-400 hover:text-gray-600 -m-2 p-2 touch:-m-3 touch:p-3" @click="emit('close')">✕</button>
      </div>

      <form class="mt-4 space-y-4" @submit.prevent="save">
        <div>
          <label class="block text-sm font-medium text-gray-700">{{ t('Name', 'Nombre') }}</label>
          <input v-model="name" type="text" class="mt-1 w-full rounded-md border border-gray-300 px-3 py-2 text-sm focus:border-indigo-500 focus:outline-none focus:ring-1 focus:ring-indigo-500" />
        </div>
        <div class="flex flex-wrap items-end gap-2">
          <div>
            <label class="block text-sm font-medium text-gray-700">{{ t('Visits', 'Visitas') }}</label>
            <input v-model.number="visitsPerPeriod" type="number" min="1" max="7" class="mt-1 w-16 rounded-md border border-gray-300 px-3 py-2 text-sm focus:border-indigo-500 focus:outline-none focus:ring-1 focus:ring-indigo-500" data-cy="plan-visits-per-period" />
          </div>
          <span class="pb-2 text-sm text-gray-500">{{ t('every', 'cada') }}</span>
          <input v-model.number="frequencyValue" type="number" min="1" :aria-label="t('Every how many', 'Cada cuántas')" class="w-16 rounded-md border border-gray-300 px-3 py-2 text-sm focus:border-indigo-500 focus:outline-none focus:ring-1 focus:ring-indigo-500" data-cy="plan-every" />
          <div class="min-w-[7rem] flex-1">
            <select v-model="frequencyUnit" :aria-label="t('Period', 'Periodo')" class="w-full rounded-md border border-gray-300 px-3 py-2 text-sm focus:border-indigo-500 focus:outline-none focus:ring-1 focus:ring-indigo-500" data-cy="plan-unit">
              <option value="week">{{ frequencyValue > 1 ? t('weeks', 'semanas') : t('week', 'semana') }}</option>
              <option value="month">{{ frequencyValue > 1 ? t('months', 'meses') : t('month', 'mes') }}</option>
            </select>
          </div>
          <p class="w-full text-[12px] text-gray-500" data-cy="plan-cadence-preview">{{ carePlanCadenceLabel({ frequency_value: frequencyValue || 1, frequency_unit: frequencyUnit, visits_per_period: visitsPerPeriod || 1 }, t) }}</p>
        </div>
        <div>
          <label class="block text-sm font-medium text-gray-700">{{ t('Total visits in plan', 'Visitas totales en el plan') }}</label>
          <input v-model.number="totalVisits" type="number" min="1" class="mt-1 w-full rounded-md border border-gray-300 px-3 py-2 text-sm focus:border-indigo-500 focus:outline-none focus:ring-1 focus:ring-indigo-500" />
        </div>
        <div>
          <label class="block text-sm font-medium text-gray-700">{{ t('Start date', 'Fecha de inicio') }}</label>
          <input v-model="startedAt" type="date" class="mt-1 w-full rounded-md border border-gray-300 px-3 py-2 text-sm focus:border-indigo-500 focus:outline-none focus:ring-1 focus:ring-indigo-500" />
        </div>

        <fieldset data-cy="plan-payment">
          <legend class="block text-sm font-medium text-gray-700">{{ t('How it is paid', 'Cómo se paga') }}</legend>
          <div class="mt-1 grid grid-cols-3 gap-1.5">
            <button
              v-for="k in (['per_visit', 'bono', 'membership'] as const)"
              :key="k"
              type="button"
              class="rounded-md border px-2 py-2 text-[12.5px] font-medium"
              :class="paymentKind === k ? 'border-indigo-500 bg-indigo-50 text-indigo-700' : 'border-gray-300 text-gray-700'"
              :aria-pressed="paymentKind === k"
              :data-cy="`plan-pay-${k}`"
              @click="paymentKind = k"
            >
              {{ k === 'per_visit' ? t('Per visit', 'Por visita') : k === 'bono' ? t('Bono', 'Bono') : t('Membership', 'Membresía') }}
            </button>
          </div>
          <select v-if="paymentKind === 'bono'" v-model="bonoId" class="mt-2 w-full rounded-md border border-gray-300 px-3 py-2 text-sm" data-cy="plan-pay-bono-select">
            <option value="" disabled>{{ bonos.length ? t('Choose a bono…', 'Elige un bono…') : t('No open bono — sell one in Money', 'Sin bono abierto — véndelo en Dinero') }}</option>
            <option v-for="b in bonos" :key="b.id" :value="b.id">{{ b.label }}</option>
          </select>
          <select v-if="paymentKind === 'membership'" v-model="membershipId" class="mt-2 w-full rounded-md border border-gray-300 px-3 py-2 text-sm" data-cy="plan-pay-membership-select">
            <option value="" disabled>{{ memberships.length ? t('Choose a membership…', 'Elige una membresía…') : t('No active membership — start one in Money', 'Sin membresía activa — empiézala en Dinero') }}</option>
            <option v-for="m in memberships" :key="m.id" :value="m.id">{{ m.label }}</option>
          </select>
          <p v-if="paymentKind === 'per_visit'" class="mt-1.5 text-[12px] text-gray-500">{{ t('Each visit is charged at its normal price.', 'Cada visita se cobra a su precio habitual.') }}</p>
        </fieldset>

        <p v-if="error" class="text-sm text-red-600">{{ error }}</p>

        <div class="flex justify-end gap-2 pt-2">
          <button type="button" class="rounded-md border border-gray-300 px-4 py-2 text-sm text-gray-700 hover:bg-gray-50" @click="emit('close')">{{ t('Cancel', 'Cancelar') }}</button>
          <button type="submit" :disabled="saving" class="rounded-md bg-indigo-600 px-4 py-2 text-sm font-medium text-white hover:bg-indigo-700 disabled:opacity-50">
            {{ saving ? t('Saving…', 'Guardando…') : t('Save', 'Guardar') }}
          </button>
        </div>
      </form>
    </div>
  </div>
</template>
