<script setup lang="ts">
import type { GrowthLeadDetail, LeadTimelineKind } from '~/composables/useGrowthLeadDetail'

defineProps<{ lead: GrowthLeadDetail }>()
const emit = defineEmits<{ close: [] }>()

const t = useT()

// Dot colour carries what kind of thing happened, so the timeline can be
// skimmed vertically: indigo where the AI acted, green where the clinic
// calendar or the patient did, purple for the qualification decision, grey
// for anything not yet real.
const DOT: Record<LeadTimelineKind, string> = {
  form: 'bg-ink-faint3',
  conversation: 'bg-brand',
  qualification: 'bg-info-text',
  appointment: 'bg-success-text',
  reminder: 'bg-ink-faint3',
  pending: 'bg-ink-faint3',
}

function onKeydown(e: KeyboardEvent) {
  if (e.key === 'Escape') emit('close')
}
onMounted(() => document.addEventListener('keydown', onKeydown))
onUnmounted(() => document.removeEventListener('keydown', onKeydown))
</script>

<template>
  <div class="fixed inset-0 z-50 flex justify-end">
    <div class="absolute inset-0 bg-ink-900/20" @click="emit('close')" />

    <aside
      class="relative flex h-full w-full max-w-[720px] flex-col bg-surface shadow-drawer"
      role="dialog"
      aria-modal="true"
      :aria-label="`${t('Lead', 'Contacto')} ${lead.name}`"
    >
      <header class="flex shrink-0 flex-col gap-3 border-b border-line px-5 py-4">
        <div class="flex items-start justify-between gap-3">
          <div class="flex items-center gap-2.5">
            <span class="flex h-9 w-9 items-center justify-center rounded-full border border-brand-tintBorder bg-brand-tint text-[12px] font-semibold text-brand-text">
              {{ lead.initials }}
            </span>
            <div class="flex flex-col">
              <span class="text-[15px] font-semibold tracking-tightTitle text-ink-900">{{ lead.name }}</span>
              <span class="font-mono text-[10.5px] text-ink-faint">{{ lead.reference }} · {{ lead.createdAt }}</span>
            </div>
          </div>
          <div class="flex items-center gap-2">
            <span v-if="lead.aiHandling" class="rounded-pill bg-brand px-2 py-0.5 text-[10px] font-semibold text-white">
              {{ t('AI handling', 'IA gestionando') }}
            </span>
            <button
              type="button"
              class="flex h-7 w-7 items-center justify-center rounded-ctl text-ink-muted hover:bg-surface-subtle"
              :aria-label="t('Close', 'Cerrar')"
              @click="emit('close')"
            >
              <svg width="12" height="12" viewBox="0 0 12 12" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"><path d="M2.5 2.5l7 7M9.5 2.5l-7 7" /></svg>
            </button>
          </div>
        </div>

        <div class="flex flex-wrap items-center gap-x-5 gap-y-2">
          <span class="flex h-7 items-center gap-1.5 rounded-ctl border border-line-control bg-surface px-2.5 text-[11.5px] font-medium text-ink-700">
            {{ t('Stage', 'Etapa') }}: {{ lead.stage }}
          </span>
          <div class="flex flex-col">
            <span class="text-[9.5px] uppercase tracking-[.06em] text-ink-faint">{{ t('Source', 'Origen') }}</span>
            <span class="text-[11.5px] text-ink-700">{{ lead.source }}</span>
          </div>
          <div class="flex flex-col">
            <span class="text-[9.5px] uppercase tracking-[.06em] text-ink-faint">{{ t('Estimated value', 'Valor estimado') }}</span>
            <span class="font-mono text-[11.5px] text-ink-700">{{ lead.value }}</span>
          </div>
          <div class="flex flex-col">
            <span class="text-[9.5px] uppercase tracking-[.06em] text-ink-faint">{{ t('Owner', 'Responsable') }}</span>
            <span class="text-[11.5px] text-ink-700">{{ lead.owner }}</span>
          </div>
        </div>
      </header>

      <div class="flex flex-1 overflow-hidden">
        <div class="flex-1 overflow-y-auto px-5 py-4">
          <div class="mb-3 flex items-baseline justify-between">
            <h3 class="text-[12.5px] font-semibold tracking-tightTitle text-ink-900">{{ t('Timeline', 'Cronología') }}</h3>
            <span class="text-[10.5px] text-ink-faint">{{ t('Newest last', 'Lo más reciente al final') }}</span>
          </div>

          <ol class="flex flex-col gap-2.5">
            <li v-for="(entry, i) in lead.timeline" :key="entry.id" class="flex gap-2.5">
              <!-- Dot plus the rail beneath it. The last entry gets no rail,
              so the line stops at the timeline instead of trailing off. -->
              <div class="flex shrink-0 flex-col items-center pt-1">
                <span class="h-[7px] w-[7px] rounded-full" :class="DOT[entry.kind]" />
                <span v-if="i < lead.timeline.length - 1" class="mt-1 w-px flex-1 bg-line" />
              </div>

              <div class="flex min-w-0 flex-1 flex-col gap-1.5 pb-1.5">
                <div class="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-0.5">
                  <span class="text-[12px] font-semibold text-ink-900" :class="entry.kind === 'pending' ? 'text-ink-muted' : ''">{{ entry.title }}</span>
                  <span class="text-[10.5px] text-ink-faint">{{ entry.time }}</span>
                </div>

                <div v-if="entry.kind === 'conversation'" class="flex flex-col gap-1.5">
                  <p
                    v-for="(msg, m) in entry.messages"
                    :key="m"
                    class="max-w-[82%] rounded-card px-2.5 py-2 text-[12px] leading-[1.45] text-ink-700"
                    :class="msg.from === 'ai'
                      ? 'self-start rounded-bl-[4px] border border-brand-tintBorder bg-brand-tint'
                      : 'self-end rounded-br-[4px] border border-line bg-surface-subtle'"
                  >{{ msg.text }}</p>
                </div>

                <template v-else-if="entry.kind === 'qualification'">
                  <span class="self-start rounded-pill border border-info-border bg-info-bg px-2 py-0.5 text-[10.5px] font-semibold text-info-text">{{ entry.verdict }}</span>
                  <p class="text-[11.5px] leading-[1.5] text-ink-muted">{{ entry.detail }}</p>
                </template>

                <div
                  v-else-if="entry.kind === 'appointment'"
                  class="flex flex-wrap items-center justify-between gap-2 rounded-ctl border border-success-border bg-success-bg px-2.5 py-2"
                >
                  <div class="flex min-w-0 flex-col">
                    <span class="text-[11.5px] font-semibold text-success-text">{{ entry.slot }}</span>
                    <span class="text-[10.5px] text-ink-muted">{{ entry.slotDetail }}</span>
                  </div>
                  <NuxtLink to="/calendar" class="shrink-0 whitespace-nowrap text-[11px] font-semibold text-success-text hover:underline">
                    {{ t('Open in calendar', 'Abrir en el calendario') }} →
                  </NuxtLink>
                </div>

                <p v-else class="text-[11.5px] leading-[1.5] text-ink-muted">{{ entry.detail }}</p>
              </div>
            </li>
          </ol>
        </div>

        <div class="hidden w-[232px] shrink-0 flex-col gap-4 overflow-y-auto border-l border-line px-4 py-4 lg:flex">
          <section class="flex flex-col gap-1.5">
            <h3 class="text-[9.5px] font-semibold uppercase tracking-[.06em] text-ink-faint">{{ t('Contact', 'Contacto') }}</h3>
            <span v-for="line in lead.contact" :key="line" class="break-words text-[11.5px] text-ink-700">{{ line }}</span>
          </section>

          <section class="flex flex-col gap-1.5 border-t border-line-divider pt-3.5">
            <h3 class="text-[9.5px] font-semibold uppercase tracking-[.06em] text-ink-faint">{{ t('Attribution', 'Atribución') }}</h3>
            <div v-for="row in lead.attribution" :key="row.label" class="flex flex-col">
              <span class="text-[10px] text-ink-faint">{{ row.label }}</span>
              <span class="text-[11.5px] text-ink-700">{{ row.value }}</span>
            </div>
          </section>

          <section class="flex flex-col gap-1.5 border-t border-line-divider pt-3.5">
            <h3 class="text-[9.5px] font-semibold uppercase tracking-[.06em] text-ink-faint">{{ t('Consent', 'Consentimiento') }}</h3>
            <span v-for="line in lead.consent" :key="line" class="text-[11.5px] text-ink-700">{{ line }}</span>
          </section>
        </div>
      </div>

      <footer class="flex shrink-0 flex-wrap items-center gap-2 border-t border-line bg-surface-subtle px-5 py-3">
        <button type="button" class="flex h-9 items-center rounded-ctl border border-line-control bg-surface px-3.5 text-[12.5px] font-medium text-ink-700 hover:bg-surface-subtle">
          {{ t('Message', 'Mensaje') }}
        </button>
        <button type="button" class="flex h-9 items-center rounded-ctl border border-line-control bg-surface px-3.5 text-[12.5px] font-medium text-ink-700 hover:bg-surface-subtle">
          {{ t('Call', 'Llamar') }}
        </button>
        <button type="button" class="flex h-9 items-center rounded-ctl border border-line-control bg-surface px-3.5 text-[12.5px] font-medium text-ink-700 hover:bg-surface-subtle">
          {{ t('Book appointment', 'Reservar cita') }}
        </button>

        <!-- The terminal action, and the only one styled as primary: this is
        the bridge out of Growth and into the practice itself. -->
        <div class="ml-auto flex flex-col items-end gap-1">
          <button type="button" class="flex h-9 items-center gap-1.5 rounded-ctl bg-brand px-4 text-[12.5px] font-semibold text-white hover:bg-brand-hover">
            {{ t('Convert to patient', 'Convertir en paciente') }} <span aria-hidden="true">→</span>
          </button>
          <span class="text-[10px] text-ink-faint">
            {{ t('Creates the patient record, keeps the appointment and the attribution', 'Crea la ficha del paciente y conserva la cita y la atribución') }}
          </span>
        </div>
      </footer>
    </aside>
  </div>
</template>
