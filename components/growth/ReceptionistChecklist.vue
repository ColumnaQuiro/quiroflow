<script setup lang="ts">
import type { ReceptionistConfig, ReceptionistType } from '~/composables/useGrowthReceptionist'

// What a clinic that has just arrived still has to do before the
// receptionist can work, in the order it should do it: types it can offer
// with their prices, what is not in the settings, try it, connect a channel,
// turn it on. Hidden once every step is done -- it is a way in, not a
// dashboard.
//
// Prices, the address and the hours come from the settings, not from the
// knowledge cards (utils/receptionistTypes.ts, utils/receptionistClinic.ts):
// this used to say "tell it the prices and opening hours", which is now how
// to give it a second copy that goes stale.
const props = defineProps<{
  config: ReceptionistConfig
  offeredTypes: ReceptionistType[]
  liveChannelCount: number
  /** Whether the owner has sent a test message this session (the Try panel). */
  tried: boolean
}>()
const emit = defineEmits<{ go: [tab: 'knowledge' | 'behaviour' | 'try'] }>()

const t = useT()

// A type it offers with no price is one it cannot quote, and one with no
// stage it cannot tell a first visit from a session by.
const unfinishedTypes = computed(() => props.offeredTypes.filter((type) => !type.stage || !type.priceCents).length)
const steps = computed(() => [
  props.offeredTypes.length === 0
    ? { key: 'types', done: false, label: t('Have at least one appointment type it may offer', 'Ten al menos un tipo de cita que pueda ofrecer'), tab: 'behaviour' as const }
    : {
        key: 'types',
        done: unfinishedTypes.value === 0,
        label: unfinishedTypes.value === 1
          ? t('Give the appointment type it offers a price and a stage', 'Ponle precio y etapa al tipo de cita que ofrece')
          : t(`Give the ${unfinishedTypes.value || ''} appointment types it offers a price and a stage`, `Ponles precio y etapa a los ${unfinishedTypes.value || ''} tipos de cita que ofrece`),
        link: '/settings/appointment-types',
      },
  { key: 'knowledge', done: props.config.knowledge.length > 0, label: t('Tell it what is not in the settings: what you treat, what the first visit includes', 'Cuéntale lo que no está en Ajustes: qué tratáis, qué incluye la primera visita'), tab: 'knowledge' as const },
  { key: 'try', done: props.tried, label: t('Try it as a patient would', 'Pruébala como lo haría un paciente'), tab: 'try' as const },
  { key: 'channel', done: props.liveChannelCount > 0, label: t('Connect WhatsApp or Instagram', 'Conecta WhatsApp o Instagram'), link: '/settings/whatsapp' },
  { key: 'on', done: props.config.enabled, label: t('Turn it on', 'Actívala') },
])
const doneCount = computed(() => steps.value.filter((s) => s.done).length)
const complete = computed(() => doneCount.value === steps.value.length)
</script>

<template>
  <section v-if="!complete" class="flex flex-col gap-2.5 rounded-card border border-brand-tintBorder bg-brand-tint p-4" data-test="receptionist-checklist">
    <div class="flex items-baseline justify-between gap-3">
      <h2 class="text-[12.5px] font-semibold tracking-tightTitle text-brand-text">{{ t('Getting it ready', 'Para ponerla en marcha') }}</h2>
      <span class="text-[11px] font-semibold uppercase tracking-[.06em] text-ink-faint">{{ doneCount }} {{ t('of', 'de') }} {{ steps.length }}</span>
    </div>
    <ul class="flex flex-col gap-1.5">
      <li v-for="step in steps" :key="step.key" class="flex items-center gap-2 text-[12px]" :data-test="`checklist-${step.key}`" :data-done="step.done">
        <span
          class="flex h-4 w-4 shrink-0 items-center justify-center rounded-full text-[11px]"
          :class="step.done ? 'bg-success-bg text-success-text' : 'border border-line-control bg-surface text-ink-faint'"
        >{{ step.done ? '✓' : '' }}</span>
        <span v-if="step.done" class="text-ink-muted line-through">{{ step.label }}</span>
        <NuxtLink v-else-if="'link' in step && step.link" :to="step.link" class="text-ink-700 hover:text-brand-text hover:underline">{{ step.label }} →</NuxtLink>
        <button v-else-if="'tab' in step && step.tab" type="button" class="text-left text-ink-700 hover:text-brand-text hover:underline" @click="emit('go', step.tab)">{{ step.label }} →</button>
        <span v-else class="text-ink-700">{{ step.label }}</span>
      </li>
    </ul>
  </section>
</template>
