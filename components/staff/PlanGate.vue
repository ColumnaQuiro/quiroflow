<script setup lang="ts">
// What an owner on Solo sees instead of Personal (and Rentabilidad): what it
// is and where to get it. Practice and Clinic include it, as a trial does
// (staffSectionIncluded in utils/growthPlans.ts).
const t = useT()
</script>

<template>
  <UiEmptyState
    class="mx-auto max-w-[560px]"
    :title="t('Staff comes with Practice and Clinic', 'Personal viene con Practice y Clinic')"
    :description="t('Everyone’s holidays for the year, a file per person with their contract and documents, payslips they see in the app, the month’s pack for the gestoría, and what each practitioner brings in against what they cost.', 'Las vacaciones de todo el equipo en el año, una ficha por persona con su contrato y sus documentos, nóminas que ven en la app, el resumen del mes para la gestoría y lo que aporta cada profesional frente a lo que cuesta.')"
    data-cy="staff-plan-gate"
  >
    <template #actions>
      <NuxtLink to="/subscription" class="inline-flex h-9 items-center rounded-ctl bg-brand px-3.5 text-[13px] font-semibold text-brand-on hover:bg-brand-hover touch:h-11" data-cy="staff-plan-gate-upgrade">{{ t('See plans', 'Ver planes') }}</NuxtLink>
    </template>
  </UiEmptyState>
</template>
