<script setup lang="ts">
const store = useAccountStore()
</script>

<template>
  <div>
    <h1 class="text-xl font-semibold text-gray-900">Good to see you, {{ store.teamMember?.full_name }}</h1>
    <p class="mt-1 text-sm text-gray-500">Here's what's happening across {{ store.accountName }}.</p>

    <div class="mt-6 rounded-lg border border-dashed border-gray-300 bg-white p-8 text-center text-sm text-gray-400">
      Dashboard metrics (patient counts, weekly visits, revenue) land once the Patients, Calendar,
      and Billing modules are in place.
    </div>
  </div>
</template>
