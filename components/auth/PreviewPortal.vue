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
    :title="t('Everything about your care, in one place', 'Todo lo de tu tratamiento, a mano')"
    :body="
      t(
        'See and change your appointments, download your invoices, sign your documents and write to the clinic.',
        'Consulta y cambia tus citas, descarga tus facturas, firma tus documentos y escribe a la clínica.',
      )
    "
  >
    <OnboardingPreviewFragment :top="246" :width="520">
      <div class="px-5 py-4">
        <p class="text-[11px] font-semibold uppercase tracking-[0.08em] text-ink-muted">{{ t('Next appointment', 'Próxima cita') }}</p>
        <p class="mt-1.5 text-[19px] font-semibold tracking-tightTitle text-ink-900">{{ t('Thursday 9 Oct · 17:30', 'Jueves 9 oct · 17:30') }}</p>
        <p class="mt-0.5 text-[13.5px] text-ink-muted">{{ t('Adjustment with Marta Ruiz', 'Ajuste con Marta Ruiz') }}</p>
        <div class="mt-3.5 flex gap-2">
          <span class="rounded-ctl border border-line-control px-3 py-1.5 text-[12.5px] font-medium text-ink-700">{{ t('Change', 'Cambiar') }}</span>
          <span class="rounded-ctl border border-line-control px-3 py-1.5 text-[12.5px] font-medium text-ink-700">{{ t('Add to calendar', 'Añadir al calendario') }}</span>
        </div>
      </div>
    </OnboardingPreviewFragment>

    <OnboardingPreviewFragment :top="432" :width="520">
      <div class="grid grid-cols-2 divide-x divide-line-divider">
        <div class="px-5 py-4">
          <p class="text-[11px] font-semibold uppercase tracking-[0.08em] text-ink-muted">Bono 10</p>
          <p class="mt-1.5 text-[18px] font-semibold text-ink-900">{{ t('3 sessions left', '3 sesiones') }}</p>
          <p class="text-[12.5px] text-ink-muted">{{ t('remaining', 'te quedan') }}</p>
        </div>
        <div class="px-5 py-4">
          <p class="text-[11px] font-semibold uppercase tracking-[0.08em] text-ink-muted">{{ t('Documents', 'Documentos') }}</p>
          <p class="mt-1.5 text-[18px] font-semibold text-ink-900">{{ t('1 to sign', '1 por firmar') }}</p>
          <p class="text-[12.5px] text-brand-text">{{ t('Data protection', 'Protección de datos') }} ›</p>
        </div>
      </div>
    </OnboardingPreviewFragment>

    <OnboardingPreviewFragment :top="574" :width="520">
      <div class="divide-y divide-line-divider px-5">
        <div v-for="invoice in invoices" :key="invoice.number" class="flex items-center justify-between py-3 text-[13.5px]">
          <span class="text-ink-700">{{ t('Invoice', 'Factura') }} {{ invoice.number }} · {{ t(invoice.dateEn, invoice.date) }}</span>
          <span class="font-semibold text-ink-900">45 € ↓</span>
        </div>
      </div>
    </OnboardingPreviewFragment>
  </OnboardingPreview>
</template>
