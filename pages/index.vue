<script setup lang="ts">
definePageMeta({ layout: false })
</script>

<template>
  <div class="flex min-h-screen flex-col items-center justify-center gap-4 bg-gray-50 px-4 text-center">
    <h1 class="text-2xl font-semibold text-gray-900">QuiroFlow</h1>
    <p class="max-w-md text-gray-600">Practice management for multi-location clinics.</p>
    <NuxtLink to="/login" class="rounded-md bg-indigo-600 px-4 py-2 text-sm font-medium text-white hover:bg-indigo-700">
      Sign in
    </NuxtLink>
  </div>
</template>
