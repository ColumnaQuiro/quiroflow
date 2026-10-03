<script setup lang="ts">
// "Clinic team | I'm a patient" at the top of both sign-ins.
//
// app.quiroflow.com is the address people type, and it lands on the STAFF
// sign-in -- where a patient used to find only "Create one", which starts a
// new clinic. Links, not a toggle: each side is its own page with its own
// address (and RouterLink marks the one you are on with aria-current).
defineProps<{ current: 'staff' | 'patient' }>()
const t = useT()

const sides = computed(() => [
  { key: 'staff', to: '/login', label: t('Clinic team', 'Equipo de la clínica') },
  { key: 'patient', to: '/portal/login', label: t("I'm a patient", 'Soy paciente') },
])
</script>

<template>
  <nav :aria-label="t('Who is signing in', 'Quién inicia sesión')" class="grid grid-cols-2 gap-[3px] rounded-card bg-surface-subtle p-[3px]">
    <NuxtLink
      v-for="side in sides"
      :key="side.key"
      :to="side.to"
      class="flex h-9 items-center justify-center rounded-ctl text-[13.5px] outline-none focus-visible:shadow-focus lg:h-8 lg:text-[13px]"
      :class="side.key === current ? 'bg-surface font-semibold text-ink-900 shadow-card' : 'font-medium text-ink-muted hover:text-ink-700'"
    >
      {{ side.label }}
    </NuxtLink>
  </nav>
</template>
