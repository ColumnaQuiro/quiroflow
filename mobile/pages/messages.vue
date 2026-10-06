<script setup lang="ts">
// Chrome only -- the thread itself is PatientMessagesPanel, shared with the
// web portal (components/patient/MessagesPanel.vue).
//
// A tab now, not a screen pushed from Home, so it keeps the tab bar and
// drops the back arrow that used to be the only way out of it.
definePageMeta({ layout: 'patient' })

const user = useSupabaseUser()
watch(user, (u) => { if (!u) navigateTo('/login') }, { immediate: true })

const { patient, loading: identityLoading } = useIdentity()
const t = useT()
</script>

<template>
  <div class="flex h-full min-h-0 flex-col">
    <AppPageHeader :title="t('Messages', 'Mensajes')" />

    <AppSkeletonList v-if="identityLoading" :rows="4" class="min-h-0 flex-1" />
    <p v-else-if="!patient" class="flex min-h-0 flex-1 items-center justify-center px-6 text-center text-sm text-ink-muted">
      {{ t("This account isn't linked to a patient record.", 'Esta cuenta no está vinculada a una ficha de paciente.') }}
    </p>
    <PatientMessagesPanel v-else :patient-id="patient.id" class="min-h-0 flex-1" />
  </div>
</template>
