<script setup lang="ts">
// An article the clinic sent, opened from "Para ti" (components/patient/LearnRead.vue).
definePageMeta({ layout: 'portal' })

const route = useRoute()
</script>

<template>
  <div class="max-w-[680px]">
    <PatientLearnRead :send-id="route.params.id as string" exercises-to="/portal/exercises" />
  </div>
</template>
