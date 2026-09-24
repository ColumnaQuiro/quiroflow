<script setup lang="ts">
import { SIF_NAME, SIF_VERSION } from '~/utils/sifIdentity'

// Each clinic's billing details are edited on that clinic's own page
// (Settings -> Clinics -> <clinic>, "Datos fiscales"), beside the address the
// same factura prints. This page stays under Billing as the overview a
// bookkeeper looks for: which locations can issue a valid factura.
const store = useAccountStore()
const t = useT()
</script>

<template>
  <div class="flex h-full flex-col">
    <PageHeader :title="t('Fiscal Data', 'Datos fiscales')" />
    <div class="flex-1 overflow-y-auto">
      <div class="flex gap-8 p-6">
        <SettingsNav />
        <div class="min-w-0 max-w-[660px] flex-1">
          <p class="text-[13px] text-ink-muted2">
            {{ t('Legal name, tax ID, and address shown on facturas and receipts, plus a footer note printed at the bottom of both. Required for a factura to be fiscally valid. Changes apply to facturas issued from now on; a factura already issued keeps the details it was issued with.', 'Nombre legal, NIF/CIF y dirección que aparecen en facturas y recibos, además de una nota de pie impresa al final de ambos. Necesarios para que una factura sea fiscalmente válida. Los cambios se aplican a las facturas que se emitan a partir de ahora; una factura ya emitida conserva los datos con los que se emitió.') }}
          </p>

          <div class="mt-4 flex flex-col gap-2">
            <p v-if="store.clinics.length === 0" class="rounded-card border border-line bg-surface px-4 py-6 text-center text-[13px] text-ink-faint">{{ t('No clinics yet.', 'Todavía no hay clínicas.') }}</p>
            <NuxtLink
              v-for="c in store.clinics"
              :key="c.id"
              :to="`/settings/clinics/${c.id}#fiscal`"
              data-cy="fiscal-clinic"
              class="flex items-center gap-4 rounded-card border border-line bg-surface px-4 py-3.5 shadow-card hover:border-line-controlHover"
            >
              <div class="flex min-w-0 flex-1 flex-col gap-0.5">
                <span class="text-[14px] font-semibold text-ink-900">{{ c.name }}</span>
                <span class="truncate text-[13px] text-ink-muted2">{{ [c.legal_name, c.tax_id, c.address].filter(Boolean).join(' · ') || t('Nothing filled in yet', 'Aún sin rellenar') }}</span>
              </div>
              <span v-if="!c.legal_name || !c.tax_id || !c.address" class="shrink-0 rounded-pill bg-warning-bg px-2 py-0.5 text-[12px] font-bold text-warning-text">{{ t('Incomplete', 'Incompleto') }}</span>
              <span v-else class="shrink-0 rounded-pill bg-success-bg px-2 py-0.5 text-[12px] font-bold text-success-text">{{ t('Complete', 'Completo') }}</span>
              <span class="shrink-0 text-[13px] font-semibold text-brand-text">{{ t('Edit', 'Editar') }}</span>
            </NuxtLink>
          </div>
        </div>
      </div>

      <!-- RD 1007/2023 requires the producer's declaración responsable to be
           visible inside the invoicing system itself, for the version that is
           running -- publishing it externally is necessary but not enough. -->
      <div class="mt-8 border-t border-line pt-4">
        <p class="text-[12px] text-ink-faint">
          {{ t('Invoicing system', 'Sistema informático de facturación') }}: {{ SIF_NAME }} {{ SIF_VERSION }} —
          <NuxtLink to="/legal/declaracion-responsable" class="text-brand-text hover:text-brand-hover">
            {{ t('responsible declaration', 'declaración responsable') }}
          </NuxtLink>
        </p>
      </div>
    </div>
  </div>
</template>
