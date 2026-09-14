<script setup lang="ts">
import type { LeadConversation } from '~/composables/useGrowthConversations'

defineProps<{ conversation: LeadConversation }>()

const t = useT()
</script>

<template>
  <!-- Hidden below xl: the thread is what matters on a narrow screen, and a
  third column would squeeze it to nothing. Everything here is also on the
  lead's own page. -->
  <aside class="hidden w-[248px] shrink-0 flex-col gap-4 overflow-y-auto border-l border-line bg-surface px-4 py-4 xl:flex" data-test="lead-rail">
    <div class="flex flex-col gap-2">
      <div class="flex items-center gap-2.5">
        <span class="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-brand-tint text-[11px] font-semibold text-brand-text">
          {{ conversation.initials }}
        </span>
        <div class="flex min-w-0 flex-col">
          <span class="truncate text-[12.5px] font-semibold text-ink-900">{{ conversation.name }}</span>
          <span class="truncate text-[10.5px] text-ink-muted">{{ conversation.context.subtitle }}</span>
        </div>
      </div>
      <div class="flex flex-col gap-0.5">
        <span class="text-[11.5px] text-ink-700">{{ conversation.context.phone }}</span>
        <span class="text-[11.5px] text-ink-muted">{{ conversation.context.location }}</span>
      </div>
    </div>

    <!-- The bridge the tier is selling: what this person already is, or is
    not yet, inside the practice itself. -->
    <section class="flex flex-col gap-1.5 border-t border-line-divider pt-3.5">
      <h3 class="text-[9.5px] font-semibold uppercase tracking-[.06em] text-ink-faint">{{ t('In QuiroFlow', 'En QuiroFlow') }}</h3>
      <div class="flex items-baseline justify-between gap-2">
        <span class="text-[11px] text-ink-faint">{{ t('Next appointment', 'Próxima cita') }}</span>
        <span class="text-right text-[11.5px] text-ink-700">{{ conversation.context.nextAppointment }}</span>
      </div>
      <div class="flex items-baseline justify-between gap-2">
        <span class="text-[11px] text-ink-faint">{{ t('Last visit', 'Última visita') }}</span>
        <span class="text-right text-[11.5px] text-ink-700">{{ conversation.context.lastVisit }}</span>
      </div>
      <div class="flex items-baseline justify-between gap-2">
        <span class="text-[11px] text-ink-faint">{{ t('Balance', 'Saldo') }}</span>
        <span class="text-right font-mono text-[11.5px] text-ink-700">{{ conversation.context.balance }}</span>
      </div>
      <div class="flex items-baseline justify-between gap-2">
        <span class="text-[11px] text-ink-faint">{{ t('Patient record', 'Ficha de paciente') }}</span>
        <span class="text-right text-[11.5px] text-ink-700">{{ conversation.context.patientRecord }}</span>
      </div>
    </section>

    <section v-if="conversation.context.quickBookSlots.length" class="flex flex-col gap-2 border-t border-line-divider pt-3.5">
      <h3 class="text-[9.5px] font-semibold uppercase tracking-[.06em] text-ink-faint">{{ t('Quick book', 'Reserva rápida') }}</h3>
      <span class="rounded-ctl border border-line-control bg-surface px-2.5 py-1.5 text-[11.5px] text-ink-700">{{ conversation.context.quickBookService }}</span>
      <div class="flex flex-wrap gap-1.5">
        <span v-for="slot in conversation.context.quickBookSlots" :key="slot" class="rounded-pill border border-brand-tintBorder bg-brand-tint px-2 py-0.5 text-[11px] text-brand-text">
          {{ slot }}
        </span>
      </div>
      <NuxtLink
        to="/calendar"
        class="flex h-8 items-center justify-center rounded-ctl bg-brand px-3 text-[12px] font-semibold text-white hover:bg-brand-hover"
      >{{ t('Book into calendar', 'Reservar en el calendario') }}</NuxtLink>
      <span class="text-[10px] text-ink-faint">
        {{ t('Room auto-assigned · creates the patient record on booking', 'Sala asignada automáticamente · crea la ficha al reservar') }}
      </span>
    </section>

    <section v-if="conversation.context.tags.length" class="flex flex-col gap-1.5 border-t border-line-divider pt-3.5">
      <h3 class="text-[9.5px] font-semibold uppercase tracking-[.06em] text-ink-faint">{{ t('Tags', 'Etiquetas') }}</h3>
      <div class="flex flex-wrap gap-1.5">
        <span v-for="tag in conversation.context.tags" :key="tag" class="rounded-pill border border-chip-border bg-chip-bg px-2 py-0.5 text-[11px] text-ink-muted">
          {{ tag }}
        </span>
      </div>
    </section>
  </aside>
</template>
