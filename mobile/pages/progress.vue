<script setup lang="ts">
// The patient's progress: their posture over time, shared by their
// practitioner (components/patient/PostureProgress.vue, also the portal's).
// Was a card on the home screen; it has a tab of its own now.
definePageMeta({ layout: 'patient' })

const user = useSupabaseUser()
watch(user, (u) => { if (!u) navigateTo('/login') }, { immediate: true })

const t = useT()
</script>

<template>
  <PatientScreen :title="t('Your progress', 'Tu progreso')">
    <PatientPostureProgress />
  </PatientScreen>
</template>
