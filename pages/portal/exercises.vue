<script setup lang="ts">
// The home exercises the clinic gave this patient (components/patient/Exercises.vue).
definePageMeta({ layout: 'portal' })

const t = useT()
const { patient } = usePortalPatient()
const patientId = computed(() => patient.value?.id ?? '')
</script>

<template>
  <div>
    <PatientPageHead
      :title="t('Exercises', 'Ejercicios')"
      :lead="t('What your clinic asked you to do at home. Tick each one off the days you do it.', 'Lo que tu clínica te ha pedido hacer en casa. Márcalos los días que los hagas.')"
    />
    <PatientExercises v-if="patientId" :patient-id="patientId" />
  </div>
</template>
