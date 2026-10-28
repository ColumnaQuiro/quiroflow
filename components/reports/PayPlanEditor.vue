<script setup lang="ts">
import { parseEurosToCents } from '~/utils/appointmentTypes'
import type { Json } from '~/types/database.types'
import { cleanTiers, EMPTY_PAY_PLAN, type PayPlan, type PayTierMode } from '~/utils/payPlan'

// One person's pay plan (pay_plans), from Reports > Commissions. Every part is
// optional; what is left at zero simply does not count. Owners only (RLS).
const props = defineProps<{ teamMemberId: string; name: string; plan: PayPlan | null }>()
const emit = defineEmits<{ close: []; saved: [] }>()

const t = useT()
const supabase = useSupabaseClient()
const store = useAccountStore()

const euros = (cents: number) => (cents ? (cents / 100).toFixed(2).replace('.', ',') : '')
const start = props.plan ?? EMPTY_PAY_PLAN
const base = ref(euros(start.base_cents))
const paymentsPct = ref(start.payments_pct ? String(start.payments_pct).replace('.', ',') : '')
const visit = ref(euros(start.visit_cents))
const mode = ref<PayTierMode>(start.tier_mode)
const tiers = ref(cleanTiers(start.tiers).map((x) => ({ from: String(x.from), amount: euros(x.cents) })))
const newPatient = ref(euros(start.new_patient_cents))
const salesPct = ref(start.sales_pct ? String(start.sales_pct).replace('.', ',') : '')
const saving = ref(false)
const error = ref('')

const MODES = computed<{ value: PayTierMode; label: string; hint: string }[]>(() => [
  { value: 'reached', label: t('All visits at the tier reached', 'Todas las visitas al tramo alcanzado'), hint: t('35 visits with a tier from 30: all 35 at that rate.', '35 visitas con un tramo desde 30: las 35 a ese importe.') },
  { value: 'band', label: t('Each band at its own rate', 'Cada tramo a su importe'), hint: t('Like tax brackets: visits 20–29 at one rate, 30 onwards at the next.', 'Como el IRPF: de la 20 a la 29 a un importe, desde la 30 al siguiente.') },
  { value: 'bonus', label: t('A bonus for each tier reached', 'Un plus por cada tramo alcanzado'), hint: t('The per-visit amount for every visit, plus the tier’s amount once.', 'El importe por visita en todas, más el del tramo una vez.') },
])

function pctValue(v: string): number | null {
  if (!v.trim()) return 0
  const n = Number(v.replace(',', '.'))
  return Number.isFinite(n) && n >= 0 && n <= 100 ? Math.round(n * 100) / 100 : null
}
function cents(v: string): number | null {
  if (!v.trim()) return 0
  const c = parseEurosToCents(v)
  return c === null || Number.isNaN(c) || c < 0 ? null : c
}

async function save() {
  error.value = ''
  const plan = {
    base_cents: cents(base.value),
    payments_pct: pctValue(paymentsPct.value),
    visit_cents: cents(visit.value),
    new_patient_cents: cents(newPatient.value),
    sales_pct: pctValue(salesPct.value),
  }
  const tierRows = tiers.value.map((x) => ({ from: Math.round(Number(x.from)), cents: cents(x.amount) }))
  if (Object.values(plan).some((v) => v === null) || tierRows.some((x) => !Number.isFinite(x.from) || x.from < 1 || x.cents === null)) {
    error.value = t('Check the amounts: euros and percentages from 0 to 100, and tiers from 1 visit.', 'Revisa los importes: euros y porcentajes de 0 a 100, y tramos desde 1 visita.')
    return
  }
  saving.value = true
  const { error: failed } = await supabase.from('pay_plans').upsert(
    {
      team_member_id: props.teamMemberId,
      account_id: store.accountId!,
      ...(plan as Record<string, number>),
      tier_mode: mode.value,
      // Plain objects, which is all a jsonb column holds.
      tiers: cleanTiers(tierRows as { from: number; cents: number }[]).map((x) => ({ from: x.from, cents: x.cents })) as unknown as Json,
      updated_at: new Date().toISOString(),
      updated_by: store.teamMember?.id ?? null,
    },
    { onConflict: 'team_member_id' },
  )
  saving.value = false
  if (failed) {
    error.value = t('Could not save. Try again.', 'No se ha podido guardar. Inténtalo de nuevo.')
    return
  }
  emit('saved')
}

const field = 'h-9 w-[120px] rounded-ctl border border-line-control bg-surface px-2.5 text-[14px] text-ink-900 touch:h-11'
const label = 'flex flex-wrap items-center justify-between gap-2 text-[13.5px] text-ink-700'
</script>

<template>
  <div class="fixed inset-0 z-50 flex items-center justify-center bg-scrim/40 p-4" @click.self="emit('close')">
    <div class="max-h-[90vh] w-full max-w-lg overflow-y-auto rounded-card border border-line bg-surface p-5 shadow-popover" data-cy="pay-plan-editor" role="dialog" :aria-label="t(`Pay for ${name}`, `Retribución de ${name}`)">
      <h2 class="text-[17px] font-[640] text-ink-900">{{ t(`Pay for ${name}`, `Retribución de ${name}`) }}</h2>
      <p class="mt-1 text-[12.5px] text-ink-muted">{{ t('Fill in the parts you use; anything left empty does not count.', 'Rellena las partes que uses; lo que dejes vacío no cuenta.') }}</p>

      <div class="mt-4 flex flex-col gap-3">
        <label :class="label">{{ t('Fixed per month (€)', 'Fijo al mes (€)') }}<input v-model="base" inputmode="decimal" :class="field" data-cy="pay-base" /></label>
        <label :class="label">
          <span>{{ t('% of the payments for their visits and patients', '% de los cobros de sus visitas y pacientes') }}</span>
          <input v-model="paymentsPct" inputmode="decimal" :class="field" data-cy="pay-payments-pct" />
        </label>

        <div class="rounded-ctl border border-line-row p-3">
          <label :class="label">{{ t('Per attended visit (€)', 'Por visita realizada (€)') }}<input v-model="visit" inputmode="decimal" :class="field" data-cy="pay-visit" /></label>
          <p class="mt-3 text-[12.5px] font-semibold text-ink-700">{{ t('Tiers by visits in the month', 'Tramos por visitas del mes') }}</p>
          <div v-for="(tier, i) in tiers" :key="i" class="mt-2 flex items-center gap-2 text-[13px] text-ink-700" data-cy="pay-tier">
            <span>{{ t('From', 'Desde') }}</span>
            <input v-model="tier.from" inputmode="numeric" class="h-9 w-16 rounded-ctl border border-line-control bg-surface px-2 text-[14px] touch:h-11" :aria-label="t('From visits', 'Desde visitas')" data-cy="pay-tier-from" />
            <span>{{ t('visits:', 'visitas:') }}</span>
            <input v-model="tier.amount" inputmode="decimal" class="h-9 w-24 rounded-ctl border border-line-control bg-surface px-2 text-[14px] touch:h-11" :aria-label="t('Amount (€)', 'Importe (€)')" data-cy="pay-tier-amount" />
            <span>€</span>
            <button type="button" class="ml-auto px-2 text-[12.5px] text-ink-muted hover:text-danger-text" @click="tiers.splice(i, 1)">{{ t('Remove', 'Quitar') }}</button>
          </div>
          <button type="button" class="mt-2 text-[12.5px] font-medium text-brand-text" data-cy="pay-tier-add" @click="tiers.push({ from: '', amount: '' })">{{ t('+ Add a tier', '+ Añadir tramo') }}</button>
          <div v-if="tiers.length" class="mt-3 flex flex-col gap-1.5">
            <label v-for="m in MODES" :key="m.value" class="flex items-start gap-2 text-[13px] text-ink-700">
              <input v-model="mode" type="radio" :value="m.value" class="mt-0.5 accent-brand" :data-cy="`pay-mode-${m.value}`" />
              <span>{{ m.label }}<span class="block text-[12px] text-ink-faint">{{ m.hint }}</span></span>
            </label>
          </div>
        </div>

        <label :class="label">{{ t('Bonus per new patient (€)', 'Plus por paciente nuevo (€)') }}<input v-model="newPatient" inputmode="decimal" :class="field" data-cy="pay-new-patient" /></label>
        <label :class="label">{{ t('% of bonos and memberships they sell', '% de bonos y membresías que vende') }}<input v-model="salesPct" inputmode="decimal" :class="field" data-cy="pay-sales-pct" /></label>
      </div>

      <p v-if="error" role="alert" class="mt-3 text-[12.5px] text-danger-text">{{ error }}</p>
      <div class="mt-5 flex justify-end gap-2">
        <UiBtn @click="emit('close')">{{ t('Cancel', 'Cancelar') }}</UiBtn>
        <UiBtn variant="primary" :disabled="saving" data-cy="pay-save" @click="save">{{ saving ? t('Saving…', 'Guardando…') : t('Save', 'Guardar') }}</UiBtn>
      </div>
    </div>
  </div>
</template>
