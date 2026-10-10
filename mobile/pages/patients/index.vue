<script setup lang="ts">
// Kept alive between tabs, at the same place in the list (StaffPatientList).
defineOptions({ name: 'StaffPatientsPage' })
definePageMeta({ layout: 'practitioner', keepalive: true })

const user = useSupabaseUser()
watch(user, (u) => { if (!u) navigateTo('/login') }, { immediate: true })

const t = useT()
</script>

<template>
  <!-- On a wide iPad the list keeps to a column, and opening a patient puts
       the record beside it (pages/patients/[id].vue); until one is open, the
       space says so. -->
  <div class="flex h-full min-h-0">
    <StaffPatientList class="w-full lg:w-80 lg:shrink-0 lg:border-r lg:border-line" />
    <div class="hidden min-w-0 flex-1 items-center justify-center px-6 text-center text-[14px] text-ink-muted lg:flex">
      {{ t('Choose a patient to see their record.', 'Elige un paciente para ver su ficha.') }}
    </div>
  </div>
</template>
