<script setup lang="ts">
// How a care plan is paid, on its card (care_plans.payment_kind and the bono
// or membership it names): at the normal prices visit by visit, from a bono
// -- and whether its sessions cover the visits the plan still has -- or under
// a membership. Read straight off the bono's counter and the membership row;
// what is owed on them stays on the Money tab, the one place it is worked out.
const props = defineProps<{ plan: { payment_kind?: string | null; package_purchase_id?: string | null; patient_membership_id?: string | null }; visitsLeft: number }>()

const t = useT()
const supabase = useSupabaseClient()
const bono = ref<{ package_name: string; sessions_total: number; sessions_used: number; is_closed: boolean } | null>(null)
const membership = ref<{ membership_name: string; price_cents: number; status: string; billing_interval: string | null; billing_interval_count: number | null } | null>(null)

async function load() {
  bono.value = null
  membership.value = null
  if (props.plan.payment_kind === 'bono' && props.plan.package_purchase_id) {
    const { data } = await supabase.from('package_purchases').select('package_name, sessions_total, sessions_used, is_closed').eq('id', props.plan.package_purchase_id).maybeSingle()
    bono.value = data as typeof bono.value
  } else if (props.plan.payment_kind === 'membership' && props.plan.patient_membership_id) {
    const { data } = await supabase.from('patient_memberships').select('membership_name, price_cents, status, billing_interval, billing_interval_count').eq('id', props.plan.patient_membership_id).maybeSingle()
    membership.value = data as typeof membership.value
  }
}
watch(() => [props.plan.payment_kind, props.plan.package_purchase_id, props.plan.patient_membership_id], load, { immediate: true })

const bonoLeft = computed(() => (bono.value && !bono.value.is_closed ? Math.max(0, bono.value.sessions_total - bono.value.sessions_used) : 0))
const covers = computed(() => bonoLeft.value >= props.visitsLeft)
const interval = computed(() => {
  const m = membership.value
  if (!m?.billing_interval) return ''
  const n = m.billing_interval_count ?? 1
  const unit = m.billing_interval === 'week' ? (n === 1 ? t('week', 'semana') : t('weeks', 'semanas')) : m.billing_interval === 'year' ? (n === 1 ? t('year', 'año') : t('years', 'años')) : n === 1 ? t('month', 'mes') : t('months', 'meses')
  return n === 1 ? ` / ${unit}` : ` / ${n} ${unit}`
})
</script>

<template>
  <p class="mt-1.5 text-[12.5px] text-ink-muted2" data-cy="plan-payment-line">
    <span class="font-medium text-ink-600">{{ t('Paid', 'Pago') }}:</span>{{ ' ' }}
    <template v-if="plan.payment_kind === 'bono'">
      <template v-if="bono">
        {{ t('bono', 'bono') }} «{{ bono.package_name }}» · {{ t(`${bonoLeft} left`, `quedan ${bonoLeft}`) }}
        <span v-if="visitsLeft > 0" :class="covers ? 'text-success-text' : 'text-warning-text'" data-cy="plan-payment-coverage">
          · {{ covers ? t(`covers the ${visitsLeft} visits left`, `cubre las ${visitsLeft} visitas que faltan`) : t(`covers ${bonoLeft} of the ${visitsLeft} visits left`, `cubre ${bonoLeft} de las ${visitsLeft} visitas que faltan`) }}
        </span>
      </template>
      <template v-else>{{ t('a bono that no longer exists', 'un bono que ya no existe') }}</template>
    </template>
    <template v-else-if="plan.payment_kind === 'membership'">
      <template v-if="membership">
        {{ t('membership', 'membresía') }} «{{ membership.membership_name }}» · {{ formatEur(membership.price_cents) }}{{ interval }}
        <span v-if="membership.status !== 'active'" class="text-warning-text">· {{ t('not active', 'no activa') }}</span>
      </template>
      <template v-else>{{ t('a membership that no longer exists', 'una membresía que ya no existe') }}</template>
    </template>
    <template v-else>{{ t('per visit, at the normal prices', 'por visita, a precio habitual') }}</template>
  </p>
</template>
