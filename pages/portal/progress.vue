<script setup lang="ts">
// The patient's progress on the web: the same view as the app's Progreso tab
// (components/patient/PostureProgress.vue).
definePageMeta({ layout: 'portal' })

const t = useT()
</script>

<template>
  <div>
    <PatientPageHead
      :title="t('Your progress', 'Tu progreso')"
      :lead="t('Your posture, assessment by assessment, as your chiropractor shares it.', 'Tu postura, valoración a valoración, tal y como te la comparte tu quiropráctico.')"
    />
    <PatientPostureProgress />
  </div>
</template>
