<script setup lang="ts">
import { formatEur } from '~/utils/billing'
import { RECEPTIONIST_BLOCK_PRICE_CENTS, RECEPTIONIST_INCLUDED_REPLIES, receptionistExtraBlocks } from '~/utils/receptionistAllowance'

// The AI receptionist on the Subscription page: whether the account has it
// and why, this month's replies against the 1,000 included, and what the
// replies past them cost. Shown for every account -- a complimentary one
// included, which has it and is never charged for it -- so what a clinic is
// paying for (or would be) is on the page that talks about money, not only
// on Growth > AI receptionist.
//
// The numbers are utils/receptionistAllowance.ts's, the same the monthly
// charge (receptionist-overage-cron) reads; and who is not charged is that
// cron's rule: complimentary, trialing, or no card to charge.
const props = defineProps<{
  /** Why it is included, or null when the account does not have it. */
  includedBy: 'comped' | 'trial' | 'growth' | 'addon' | null
  /** This calendar month's replies; null until read. */
  replies: number | null
  monthlyPriceCents: number | null
  canManage: boolean
}>()
const emit = defineEmits<{ add: [] }>()
const t = useT()

const included = RECEPTIONIST_INCLUDED_REPLIES.toLocaleString('es-ES')
const blockPrice = formatEur(RECEPTIONIST_BLOCK_PRICE_CENTS)
const percent = computed(() => (props.replies === null ? 0 : Math.min(100, Math.round((props.replies / RECEPTIONIST_INCLUDED_REPLIES) * 100))))
const blocks = computed(() => receptionistExtraBlocks(props.replies ?? 0))
const charged = computed(() => props.includedBy === 'growth' || props.includedBy === 'addon')

const pill = computed(() => {
  if (props.includedBy === 'comped') return { label: t('No charge', 'Sin cargo'), cls: 'bg-brand-tint text-brand-text' }
  if (props.includedBy === 'trial') return { label: t('In your trial', 'En tu prueba'), cls: 'bg-brand-tint text-brand-text' }
  if (props.includedBy === 'growth') return { label: t('Included in Growth', 'Incluida en Growth'), cls: 'bg-success-bg text-success-text' }
  if (props.includedBy === 'addon') return { label: t('Add-on', 'Complemento'), cls: 'bg-success-bg text-success-text' }
  return { label: t('Not on this plan', 'No contratada'), cls: 'bg-chip-bg text-chip-text' }
})
</script>

<template>
  <SubscriptionCard>
    <div data-cy="subscription-receptionist">
      <div class="flex flex-wrap items-center gap-2.5">
        <h3 class="flex-1 text-[14px] font-semibold text-ink-900">{{ t('AI receptionist', 'Recepcionista IA') }}</h3>
        <span class="inline-flex h-[22px] items-center rounded-pill px-2 text-[11.5px] font-semibold" :class="pill.cls" data-cy="subscription-receptionist-state">{{ pill.label }}</span>
      </div>

      <template v-if="includedBy">
        <div class="mt-3 flex items-baseline justify-between gap-3">
          <p class="text-[22px] font-semibold text-ink-900">
            <span data-cy="subscription-receptionist-replies">{{ replies === null ? '—' : replies.toLocaleString('es-ES') }}</span>
            <span class="ml-1 text-[13px] font-normal text-ink-muted">{{ t(`of ${included} replies included this month`, `de ${included} respuestas incluidas este mes`) }}</span>
          </p>
          <span class="text-[12px] text-ink-faint">{{ percent }}%</span>
        </div>
        <SubscriptionMeter class="mt-2" :percent="percent" />
        <p class="mt-2.5 text-[12.5px] leading-[1.5] text-ink-muted" data-cy="subscription-receptionist-terms">
          <template v-if="!charged">
            {{ includedBy === 'comped'
              ? t('This account pays nothing for it, the replies past the included ones neither. They are counted all the same, so you can see what a paying clinic would use.', 'Esta cuenta no paga nada por ella, tampoco las respuestas de más. Se cuentan igual, para ver lo que usaría una clínica que paga.')
              : t('Included while the trial lasts, with no charge for replies past the included ones.', 'Incluida mientras dure la prueba, sin cargo por las respuestas de más.') }}
          </template>
          <template v-else>
            {{ t(`Past the ${included} included, each further 1,000 (or part of one) is ${blockPrice} + IVA, charged at the start of the next month.`, `Pasadas las ${included} incluidas, cada 1.000 más (o parte) son ${blockPrice} + IVA, cobrados a principios del mes siguiente.`) }}
          </template>
        </p>
        <p v-if="blocks > 0" class="mt-2 rounded-ctl border border-warning-border bg-warning-bg px-2.5 py-1.5 text-[12px] text-warning-text" data-cy="subscription-receptionist-extra">
          {{ charged
            ? t(`${blocks} extra ${blocks === 1 ? 'block' : 'blocks'} so far this month: ${formatEur(blocks * RECEPTIONIST_BLOCK_PRICE_CENTS)} + IVA.`, `${blocks} ${blocks === 1 ? 'bloque' : 'bloques'} de más este mes: ${formatEur(blocks * RECEPTIONIST_BLOCK_PRICE_CENTS)} + IVA.`)
            : t(`${blocks} extra ${blocks === 1 ? 'block' : 'blocks'} this month, not charged.`, `${blocks} ${blocks === 1 ? 'bloque' : 'bloques'} de más este mes, sin cargo.`) }}
        </p>
        <NuxtLink to="/growth/receptionist" class="mt-3 inline-flex text-[12.5px] font-semibold text-brand-text hover:text-brand-hover">{{ t('Set it up, and a monthly ceiling →', 'Configurarla, y un tope mensual →') }}</NuxtLink>
      </template>

      <template v-else>
        <p class="mt-2 text-[13px] leading-[1.5] text-ink-muted">
          {{ t('Answers patients and leads on WhatsApp, Instagram and your website, books them in, and hands over to the desk when it should.', 'Responde a pacientes y contactos por WhatsApp, Instagram y la web, les reserva cita y pasa a recepción cuando debe.') }}
          <template v-if="monthlyPriceCents"> {{ t(`${formatEur(monthlyPriceCents)} a month + IVA, ${included} replies included.`, `${formatEur(monthlyPriceCents)} al mes + IVA, ${included} respuestas incluidas.`) }}</template>
        </p>
        <UiBtn v-if="canManage" size="sm" variant="primary" class="mt-3" data-cy="subscription-receptionist-add" @click="emit('add')">{{ t('Add the AI receptionist', 'Añadir la recepcionista IA') }}</UiBtn>
      </template>
    </div>
  </SubscriptionCard>
</template>
