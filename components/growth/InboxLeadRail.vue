<script setup lang="ts">
import type { LeadThread } from '~/composables/useGrowthLeadThread'

defineProps<{ thread: LeadThread }>()

const t = useT()
</script>

<template>
  <!-- Hidden below xl: the thread is what matters on a narrow screen, and a
  third column would squeeze it to nothing. Everything here is also on the
  lead's own page. -->
  <aside class="hidden w-[248px] shrink-0 flex-col gap-4 overflow-y-auto border-l border-line bg-surface px-4 py-4 xl:flex" data-test="lead-rail">
    <div class="flex flex-col gap-1.5">
      <span class="text-[12.5px] font-semibold text-ink-900">{{ thread.name }}</span>
      <span class="text-[10.5px] text-ink-muted">
        {{ t('Lead', 'Contacto') }} · {{ thread.stage }}<template v-if="thread.source"> · {{ thread.source }}</template>
      </span>
      <span v-if="thread.phone" class="text-[11.5px] text-ink-700">{{ thread.phone }}</span>
      <span v-if="thread.email" class="break-words text-[11.5px] text-ink-700">{{ thread.email }}</span>
      <span v-if="thread.clinic" class="text-[11.5px] text-ink-muted">{{ thread.clinic }}</span>
    </div>

    <!-- The bridge the tier is selling: what this person already is, or is
    not yet, inside the practice itself. Only rows that are actually known --
    a lead has no visit history and no balance, and rendering those as zeroes
    would state something false rather than leave a gap. -->
    <section class="flex flex-col gap-1.5 border-t border-line-divider pt-3.5">
      <h3 class="text-[9.5px] font-semibold uppercase tracking-[.06em] text-ink-faint">{{ t('In QuiroFlow', 'En QuiroFlow') }}</h3>

      <div class="flex items-baseline justify-between gap-2">
        <span class="text-[11px] text-ink-faint">{{ t('Patient record', 'Ficha de paciente') }}</span>
        <NuxtLink v-if="thread.patientId" :to="`/patients/${thread.patientId}`" class="text-right text-[11.5px] font-medium text-brand-text hover:underline">
          {{ t('Open', 'Abrir') }} →
        </NuxtLink>
        <span v-else class="text-right text-[11.5px] text-ink-700">{{ t('Not created', 'Sin crear') }}</span>
      </div>

      <div v-if="thread.patientBalance" class="flex items-baseline justify-between gap-2">
        <span class="text-[11px] text-ink-faint">{{ t('Balance', 'Saldo') }}</span>
        <span class="text-right font-mono text-[11.5px] text-ink-700">{{ thread.patientBalance }}</span>
      </div>

      <div v-if="thread.value" class="flex items-baseline justify-between gap-2">
        <span class="text-[11px] text-ink-faint">{{ t('Estimated value', 'Valor estimado') }}</span>
        <span class="text-right font-mono text-[11.5px] text-ink-700">{{ thread.value }}</span>
      </div>
    </section>

    <section class="flex flex-col gap-2 border-t border-line-divider pt-3.5">
      <NuxtLink
        to="/growth/leads"
        class="flex h-8 items-center justify-center rounded-ctl border border-line-control bg-surface px-3 text-[12px] font-medium text-ink-700 hover:bg-surface-subtle"
      >{{ t('Open lead', 'Abrir contacto') }}</NuxtLink>
    </section>
  </aside>
</template>
