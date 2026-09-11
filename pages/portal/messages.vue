<script setup lang="ts">
// The conversation with the clinic, given the whole page.
//
// It used to be a collapsed section at the bottom of the home page behind
// an "Open" toggle, in a 26rem box -- a chat you had to go and find, then
// read through a letterbox.
definePageMeta({ layout: 'portal' })

const t = useT()
const { patient, loading } = usePortalPatient()
</script>

<template>
  <div>
    <PortalPageHead
      :title="t('Messages', 'Mensajes')"
      :lead="t('Write to your clinic and see their replies here.', 'Escribe a tu clínica y lee sus respuestas aquí.')"
    />

    <div v-if="loading"><UiSkeleton class="h-[60vh] w-full rounded-card" /></div>
    <div v-else-if="patient" class="overflow-hidden rounded-card border border-line bg-surface shadow-card">
      <!-- Sized to the viewport rather than a fixed height: on a laptop the
           thread fills the page, on a phone it stops above the tab bar. -->
      <PatientMessagesPanel :patient-id="patient.id" height="min(68vh, 620px)" />
    </div>
  </div>
</template>
