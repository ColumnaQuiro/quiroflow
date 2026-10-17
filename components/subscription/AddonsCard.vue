<script setup lang="ts">
import { formatEur } from '~/utils/billing'
import { RECEPTIONIST_BLOCK_PRICE_CENTS, RECEPTIONIST_INCLUDED_REPLIES } from '~/utils/receptionistAllowance'

// Growth and the AI receptionist, added or removed from the Subscription page
// itself. Both used to be reachable only inside "Change plan", where nobody
// looking for "add the receptionist" thinks to look.
//
// A change goes through the same two routes Change plan uses: /api/billing/
// preview shows Stripe's own prorated figure before anything is committed,
// and /api/billing/subscribe makes it -- with the plan, interval and seats as
// they are, so only the add-on moves. An account with no live subscription
// (a trial without a card, a cancelled one) is sent to Checkout by subscribe,
// which is how it gets a card on file at all.
//
// Growth includes the receptionist, and the server never bills both
// (receptionistLineWanted): adding Growth to an account that has the
// receptionist replaces it.
type AddonKey = 'growth' | 'receptionist'
/** free: complimentary; plan: in the plan's price; growth: inside Growth. */
type RowState = 'free' | 'plan' | 'growth' | 'on' | 'off'
interface Prices { monthly_price_cents: number; annual_price_cents: number }

const props = defineProps<{
  planId: string
  interval: 'monthly' | 'annual'
  extraProfessionals: number
  /** Bought as its own line (subscriptions.growth_addon). */
  growthOn: boolean
  /** Bought as its own line (subscriptions.receptionist_addon). */
  receptionistOn: boolean
  planIncludesGrowth: boolean
  comped: boolean
  trialing: boolean
  growthPrices: Prices | null
  receptionistPrices: Prices | null
  canManage: boolean
}>()
const emit = defineEmits<{ changed: [expect: { growth: boolean; receptionist: boolean }] }>()
const t = useT()

const growthIncluded = computed(() => props.comped || props.planIncludesGrowth)
const receptionistIncluded = computed(() => growthIncluded.value || props.growthOn)

function priceOf(p: Prices | null) {
  if (!p) return null
  return props.interval === 'annual' ? p.annual_price_cents : p.monthly_price_cents
}

const rows = computed(() => [
  {
    key: 'growth' as const,
    name: t('Growth', 'Growth'),
    description: t(
      'Lead capture from your ads, the AI receptionist, automations and reputation.',
      'Captación desde tus anuncios, la recepcionista IA, automatizaciones y reputación.',
    ),
    price: priceOf(props.growthPrices),
    state: (props.comped ? 'free' : growthIncluded.value ? 'plan' : props.growthOn ? 'on' : 'off') as RowState,
  },
  {
    key: 'receptionist' as const,
    name: t('AI receptionist', 'Recepcionista IA'),
    description: t(
      `Answers WhatsApp and books from your calendar. ${RECEPTIONIST_INCLUDED_REPLIES.toLocaleString('en-GB')} replies a month included; each further 1,000 is ${formatEur(RECEPTIONIST_BLOCK_PRICE_CENTS)} + IVA.`,
      `Contesta WhatsApp y reserva desde tu agenda. ${RECEPTIONIST_INCLUDED_REPLIES.toLocaleString('es-ES')} respuestas al mes incluidas; cada 1.000 más, ${formatEur(RECEPTIONIST_BLOCK_PRICE_CENTS)} + IVA.`,
    ),
    price: priceOf(props.receptionistPrices),
    state: (props.comped ? 'free' : receptionistIncluded.value ? 'growth' : props.receptionistOn ? 'on' : 'off') as RowState,
  },
])

const STATE_PILL = computed<Record<RowState, { tone: 'brand' | 'success' | 'chip'; label: string }>>(() => ({
  free: { tone: 'brand' as const, label: t('No charge', 'Sin cargo') },
  plan: { tone: 'success' as const, label: t('Included in your plan', 'Incluido en tu plan') },
  growth: { tone: 'success' as const, label: t('Included in Growth', 'Incluida en Growth') },
  on: { tone: 'success' as const, label: t('Active', 'Activo') },
  off: { tone: 'chip' as const, label: props.trialing ? t('In your trial', 'En tu prueba') : t('Not added', 'Sin contratar') },
}))

// ----------------------------------------------------------- the change

const pending = ref<{ key: AddonKey; on: boolean } | null>(null)
const preview = ref<{ loading: boolean; amountDueCents: number | null; error: string }>({ loading: false, amountDueCents: null, error: '' })
const confirming = ref(false)
const confirmError = ref('')

/** What the subscription will carry after the pending change. */
const target = computed(() => {
  const p = pending.value
  const growth = p?.key === 'growth' ? p.on : props.growthOn
  // Removing Growth leaves the receptionist as it was bought: never added
  // behind the owner's back.
  const receptionist = p?.key === 'receptionist' ? p.on : props.receptionistOn && !growth
  return { growth, receptionist }
})

function body() {
  return {
    planId: props.planId,
    interval: props.interval,
    extraProfessionals: props.extraProfessionals,
    growth: target.value.growth,
    receptionist: target.value.receptionist,
  }
}

async function start(key: AddonKey, on: boolean) {
  pending.value = { key, on }
  confirmError.value = ''
  preview.value = { loading: true, amountDueCents: null, error: '' }
  try {
    const result = await $fetch<{ previewable: boolean; amountDueCents?: number }>('/api/billing/preview', { method: 'POST', body: body() })
    preview.value = { loading: false, amountDueCents: result.previewable ? (result.amountDueCents ?? null) : null, error: '' }
  } catch (e) {
    preview.value = { loading: false, amountDueCents: null, error: e instanceof Error ? e.message : String(e) }
  }
}

function cancel() {
  pending.value = null
}

async function confirm() {
  if (confirming.value || !pending.value) return
  confirming.value = true
  confirmError.value = ''
  try {
    const result = await $fetch<{ url?: string; updated?: boolean }>('/api/billing/subscribe', { method: 'POST', body: body() })
    if (result.url) {
      window.location.href = result.url
      return
    }
    emit('changed', { ...target.value })
    pending.value = null
  } catch (e) {
    confirmError.value = e instanceof Error ? e.message : String(e)
  } finally {
    confirming.value = false
  }
}

// The receptionist's own card has an "Add" button; it lands here.
defineExpose({ start })
</script>

<template>
  <SubscriptionCard>
    <div data-cy="subscription-addons">
      <h3 class="text-[14px] font-semibold text-ink-900">{{ t('Add-ons', 'Complementos') }}</h3>
      <div
        v-for="row in rows"
        :key="row.key"
        class="mt-3 border-t border-line-divider pt-3"
        :data-cy="`subscription-addon-${row.key}`"
      >
        <div class="flex flex-col gap-3 sm:flex-row sm:items-start">
          <div class="min-w-0 flex-1">
            <div class="flex flex-wrap items-center gap-2">
              <span class="text-[13.5px] font-semibold text-ink-900">{{ row.name }}</span>
              <SubscriptionPill :tone="STATE_PILL[row.state].tone" :data-cy="`subscription-addon-${row.key}-state`">{{ STATE_PILL[row.state].label }}</SubscriptionPill>
            </div>
            <p class="mt-1 text-[12.5px] leading-[1.5] text-ink-muted">{{ row.description }}</p>
          </div>
          <div class="flex shrink-0 items-center gap-3 sm:flex-col sm:items-end sm:gap-1.5">
            <span v-if="row.price !== null && (row.state === 'on' || row.state === 'off')" class="font-mono text-[13px] font-semibold text-ink-900">
              {{ formatEur(row.price) }}{{ t('/mo + IVA', '/mes + IVA') }}
            </span>
            <template v-if="canManage && pending?.key !== row.key">
              <UiBtn
                v-if="row.state === 'off'"
                size="sm"
                variant="primary"
                :data-cy="`subscription-addon-${row.key}-add`"
                @click="start(row.key, true)"
              >
                {{ trialing ? t('Keep after the trial', 'Mantener tras la prueba') : t('Add', 'Añadir') }}
              </UiBtn>
              <UiBtn
                v-else-if="row.state === 'on'"
                size="sm"
                variant="secondary"
                :data-cy="`subscription-addon-${row.key}-remove`"
                @click="start(row.key, false)"
              >
                {{ t('Remove', 'Quitar') }}
              </UiBtn>
            </template>
          </div>
        </div>

        <!-- Stripe's figure, never one worked out here: a proration is wrong
        the moment a credit or a mid-period change is involved. -->
        <div v-if="pending?.key === row.key" class="mt-3 rounded-ctl border border-line bg-surface-subtle p-3" :data-cy="`subscription-addon-${row.key}-confirm`">
          <p v-if="pending.on && row.key === 'growth' && receptionistOn" class="mb-1 text-[12.5px] text-ink-700">
            {{ t('Growth includes the AI receptionist, so its own line comes off.', 'Growth incluye la recepcionista IA, así que su línea aparte se quita.') }}
          </p>
          <p v-else-if="!pending.on && row.key === 'growth' && !receptionistOn" class="mb-1 text-[12.5px] text-ink-700">
            {{ t('The AI receptionist goes with Growth. Add it on its own afterwards if you want to keep it.', 'La recepcionista IA se va con Growth. Añádela aparte después si quieres conservarla.') }}
          </p>
          <p class="text-[12.5px] text-ink-muted" data-cy="subscription-addon-preview">
            <template v-if="preview.loading">{{ t('Working out the charge…', 'Calculando el cargo…') }}</template>
            <template v-else-if="preview.error">{{ preview.error }}</template>
            <template v-else-if="preview.amountDueCents === null">
              {{ t('You will add a card and confirm in Stripe.', 'Añadirás una tarjeta y confirmarás en Stripe.') }}
            </template>
            <template v-else-if="preview.amountDueCents > 0">
              {{ t(`Charged today, prorated, IVA included: ${formatEur(preview.amountDueCents)}.`, `Se cobra hoy, prorrateado, IVA incluido: ${formatEur(preview.amountDueCents)}.`) }}
            </template>
            <template v-else>
              {{ t('Nothing is charged today; the change shows on your next invoice.', 'Hoy no se cobra nada; el cambio aparece en tu próxima factura.') }}
            </template>
          </p>
          <p v-if="confirmError" role="alert" class="mt-1.5 text-[12.5px] text-danger-text">{{ confirmError }}</p>
          <div class="mt-2.5 flex gap-2">
            <UiBtn size="sm" variant="primary" :disabled="confirming || preview.loading || !!preview.error" data-cy="subscription-addon-confirm" @click="confirm">
              {{ confirming ? t('Working…', 'Procesando…') : pending.on ? t('Confirm and add', 'Confirmar y añadir') : t('Confirm and remove', 'Confirmar y quitar') }}
            </UiBtn>
            <UiBtn size="sm" variant="ghost" :disabled="confirming" @click="cancel">{{ t('Cancel', 'Cancelar') }}</UiBtn>
          </div>
        </div>
      </div>
    </div>
  </SubscriptionCard>
</template>
