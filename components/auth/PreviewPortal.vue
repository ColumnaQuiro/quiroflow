<script setup lang="ts">
// The patient sign-in's right panel: what a patient gets, not the clinic's
// calendar. Same furniture as the onboarding previews (OnboardingPreview +
// fragments), with sample content -- the visitor is not signed in, so none
// of it is theirs.
const props = defineProps<{ clinicName?: string }>()
const t = useT()

const invoices = [
  { number: 'F-2026-0412', date: '2 oct', dateEn: '2 Oct' },
  { number: 'F-2026-0388', date: '25 sep', dateEn: '25 Sep' },
  { number: 'F-2026-0351', date: '18 sep', dateEn: '18 Sep' },
]
</script>

<template>
  <OnboardingPreview
    :eyebrow="props.clinicName ?? t('Patient portal', 'Espacio del paciente')"
    :title="t('Everything about your care, in one place', 'Todo lo de tus cuidados, a mano')"
    :body="
      t(
        'See your appointments, download your facturas and documents, and write to the clinic.',
        'Consulta tus citas, descarga tus facturas y documentos, y escribe a la clínica.',
      )
    "
  >
    <OnboardingPreviewFragment>
      <div class="px-5 py-4">
        <p class="text-[11px] font-semibold uppercase tracking-[0.08em] text-ink-muted">{{ t('Next appointment', 'Próxima cita') }}</p>
        <p class="mt-1.5 text-[19px] font-semibold tracking-tightTitle text-ink-900">{{ t('Thursday 9 Oct · 17:30', 'Jueves 9 oct · 17:30') }}</p>
        <p class="mt-0.5 text-[13.5px] text-ink-muted">{{ t('Adjustment with Marta Ruiz', 'Ajuste con Marta Ruiz') }}</p>
        <div class="mt-3.5 flex gap-2">
          <span class="rounded-ctl border border-line-control px-3 py-1.5 text-[12.5px] font-medium text-ink-700">{{ t('Directions', 'Cómo llegar') }}</span>
          <span class="rounded-ctl border border-line-control px-3 py-1.5 text-[12.5px] font-medium text-ink-700">{{ t('Add to calendar', 'Añadir al calendario') }}</span>
        </div>
      </div>
    </OnboardingPreviewFragment>

    <OnboardingPreviewFragment>
      <div class="grid grid-cols-2 divide-x divide-line-divider">
        <div class="px-5 py-4">
          <p class="text-[11px] font-semibold uppercase tracking-[0.08em] text-ink-muted">Bono 10</p>
          <p class="mt-1.5 text-[18px] font-semibold text-ink-900">{{ t('3 sessions', '3 sesiones') }}</p>
          <p class="text-[12.5px] text-ink-muted">{{ t('left', 'te quedan') }}</p>
        </div>
        <div class="px-5 py-4">
          <p class="text-[11px] font-semibold uppercase tracking-[0.08em] text-ink-muted">{{ t('Documents', 'Documentos') }}</p>
          <p class="mt-1.5 text-[18px] font-semibold text-ink-900">{{ t('1 new', '1 nuevo') }}</p>
          <p class="text-[12.5px] text-brand-text">{{ t('Assessment report', 'Informe de valoración') }} ›</p>
        </div>
      </div>
    </OnboardingPreviewFragment>

    <OnboardingPreviewFragment>
      <div class="divide-y divide-line-divider px-5">
        <div v-for="invoice in invoices" :key="invoice.number" class="flex items-center justify-between py-3 text-[13.5px]">
          <span class="text-ink-700">{{ t('Invoice', 'Factura') }} {{ invoice.number }} · {{ t(invoice.dateEn, invoice.date) }}</span>
          <span class="font-semibold text-ink-900">45 € ↓</span>
        </div>
      </div>
    </OnboardingPreviewFragment>
  </OnboardingPreview>
</template>
