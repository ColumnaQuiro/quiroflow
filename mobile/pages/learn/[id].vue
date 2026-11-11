<script setup lang="ts">
// An article the clinic sent, opened from "Para ti" or its push
// (components/patient/LearnRead.vue).
definePageMeta({ layout: 'patient' })

const user = useSupabaseUser()
watch(user, (u) => { if (!u) navigateTo('/login') }, { immediate: true })

const t = useT()
const route = useRoute()
</script>

<template>
  <PatientScreen :title="t('For you', 'Para ti')" back="/care" :back-label="t('Self-care', 'Cuidarme')">
    <PatientLearnRead :send-id="route.params.id as string" exercises-to="/exercises" />
  </PatientScreen>
</template>
