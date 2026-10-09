<script setup lang="ts">
// The home exercises the clinic gave this patient (components/patient/Exercises.vue),
// opened from the home screen.
definePageMeta({ layout: 'patient' })

const user = useSupabaseUser()
watch(user, (u) => { if (!u) navigateTo('/login') }, { immediate: true })

const t = useT()
const { patient } = useIdentity()
const patientId = computed(() => patient.value?.id ?? '')
</script>

<template>
  <PatientScreen :title="t('Exercises', 'Ejercicios')">
    <PatientExercises v-if="patientId" :patient-id="patientId" />
  </PatientScreen>
</template>
