<script setup lang="ts">
const sections = [
  { to: '/settings/clinics', label: 'Clinics', description: 'Locations your practice operates from.' },
  { to: '/settings/team', label: 'Team Members', description: 'Staff accounts, roles, and invites.' },
  { to: '/settings/appointment-types', label: 'Appointment Types', description: 'Visit types, durations, colors, default price.' },
  { to: '/billing/services', label: 'Services & Products', description: 'What you bill for.' },
  { to: '/settings/rooms', label: 'Calendar Resources', description: 'Rooms used for scheduling per clinic.' },
  { to: '/settings/import', label: 'Import Patients (CSV)', description: 'Migrate patient records from another system.' },
]
</script>

<template>
  <div>
    <h1 class="text-xl font-semibold text-gray-900">Settings</h1>
    <div class="mt-4 grid grid-cols-1 gap-4 sm:grid-cols-2">
      <NuxtLink
        v-for="s in sections"
        :key="s.to"
        :to="s.to"
        class="rounded-lg border border-gray-200 bg-white p-4 hover:border-indigo-300 hover:shadow-sm"
      >
        <p class="font-medium text-gray-900">{{ s.label }}</p>
        <p class="mt-1 text-sm text-gray-500">{{ s.description }}</p>
      </NuxtLink>
    </div>
  </div>
</template>
