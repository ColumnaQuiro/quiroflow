<script setup lang="ts">
// Chrome only -- the thread itself is PatientMessagesPanel, shared with the
// web portal (components/patient/MessagesPanel.vue).
const user = useSupabaseUser()
watch(user, (u) => { if (!u) navigateTo('/login') }, { immediate: true })

const { patient, loading: identityLoading } = useIdentity()
const t = useT()
</script>

<template>
  <div class="flex h-full min-h-0 flex-col" style="padding-bottom: env(safe-area-inset-bottom); padding-top: env(safe-area-inset-top)">
    <div class="flex h-14 shrink-0 items-center gap-2 border-b border-line bg-surface px-3">
      <NuxtLink to="/" class="flex h-11 w-11 shrink-0 items-center justify-center text-[15px] text-brand-text">&larr;</NuxtLink>
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
