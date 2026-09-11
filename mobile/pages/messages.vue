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
    <div class="flex h-14 shrink-0 items-center border-b border-line bg-surface px-4">
      <p class="text-[15px] font-[600] text-ink-900">{{ t('Messages', 'Mensajes') }}</p>
    </div>

    <div v-if="identityLoading" class="flex min-h-0 flex-1 items-center justify-center text-sm text-ink-faint">
      {{ t('Loading…', 'Cargando…') }}
    </div>
    <p v-else-if="!patient" class="flex min-h-0 flex-1 items-center justify-center px-6 text-center text-sm text-ink-muted">
      {{ t("This account isn't linked to a patient record.", 'Esta cuenta no está vinculada a una ficha de paciente.') }}
    </p>
    <PatientMessagesPanel v-else :patient-id="patient.id" class="min-h-0 flex-1" />
  </div>
</template>
