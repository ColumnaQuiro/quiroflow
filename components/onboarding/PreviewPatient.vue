<script setup lang="ts">
import { PREVIEW_PATIENT } from './previewFixtures'

const t = useT()
const p = PREVIEW_PATIENT
</script>

<template>
  <OnboardingPreview
    :eyebrow="t('Waiting inside', 'Te espera dentro')"
    :title="t('One record per patient, across every clinic', 'Un solo historial por paciente, en todas las clínicas')"
    :body="
      t(
        'Visits, notes and invoices in one place — whether Lucía is seen in Valencia or Madrid.',
        'Visitas, notas y facturas en un mismo sitio — vea Lucía en Valencia o en Madrid.',
      )
    "
  >
    <OnboardingPreviewFragment :top="246">
      <div class="flex items-center gap-3 border-b border-line-divider p-4">
        <div class="flex h-[38px] w-[38px] items-center justify-center rounded-full border border-brand-tintBorder bg-brand-tint">
          <span class="text-[13px] font-semibold text-brand-text">{{ p.initials }}</span>
        </div>
        <div class="flex-1">
          <div class="text-[15px] font-semibold text-ink-900">{{ p.name }}</div>
          <div class="mt-0.5 text-[12.5px] text-ink-muted">
            {{ t(`Patient since ${p.since}`, `Paciente desde ${p.sinceEs}`) }} · Valencia · {{ p.phone }}
          </div>
        </div>
        <span class="rounded-pill border border-brand-tintBorder bg-brand-tint px-2.5 py-[3px] text-[11.5px] font-semibold text-brand-text">
          {{ t(`Next: ${p.next}`, `Próxima: ${p.nextEs}`) }}
        </span>
      </div>

      <div class="flex items-center justify-between border-b border-line-divider px-4 py-3">
        <span class="text-[12.5px] font-semibold text-ink-muted">{{ t('Visit history', 'Historial de visitas') }}</span>
        <span class="text-[12.5px] text-ink-muted">{{ t(`3 visits · ${p.totalBilled} billed`, `3 visitas · ${p.totalBilled} facturado`) }}</span>
      </div>

      <div v-for="visit in p.visits" :key="visit.date" class="flex items-center gap-3 border-b border-line-divider px-4 py-3">
        <span class="w-[62px] shrink-0 text-[12.5px] text-ink-muted">{{ visit.date }}</span>
        <span class="flex-1 truncate text-[13.5px] text-ink-900">{{ visit.service }}</span>
        <span class="text-[13.5px] font-semibold text-ink-900">{{ visit.amount }}</span>
        <span class="rounded-pill border border-success-border bg-success-bg px-2.5 py-[3px] text-[11.5px] font-semibold text-success-text">{{ t('Paid', 'Pagada') }}</span>
      </div>

      <div class="border-b border-line-divider px-4 py-3.5">
        <p class="text-[12.5px] font-semibold text-ink-muted">{{ t(`Clinical note · ${p.note.date}`, `Nota clínica · ${p.note.date}`) }}</p>
        <p class="mt-[7px] text-[13.5px] leading-[1.55] text-ink-700">{{ t(p.note.body, p.note.bodyEs) }}</p>
      </div>

      <div class="flex items-center gap-2.5 bg-surface-subtle px-4 py-[13px]">
        <svg viewBox="0 0 18 18" fill="none" aria-hidden="true" class="h-[15px] w-[15px] shrink-0 text-ink-muted">
          <path d="M4 2.8h10v12.4l-2-1.2-2 1.2-2-1.2-2 1.2-2-1.2z" stroke="currentColor" stroke-width="1.4" stroke-linejoin="round" />
        </svg>
        <span class="flex-1 truncate text-[12.5px] text-ink-500">
          {{ t(`Invoice ${p.invoice.number} · ${p.invoice.amount} · card via Stripe`, `Factura ${p.invoice.number} · ${p.invoice.amount} · tarjeta vía Stripe`) }}
        </span>
        <span class="shrink-0 text-[12.5px] font-semibold text-brand-text">{{ t('Download PDF', 'Descargar PDF') }}</span>
      </div>
    </OnboardingPreviewFragment>
  </OnboardingPreview>
</template>
