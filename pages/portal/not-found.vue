<script setup lang="ts">
definePageMeta({ layout: false })

const supabase = useSupabaseClient()

async function signOut() {
  await supabase.auth.signOut()
  await navigateTo('/portal/login')
}
</script>

<template>
  <div class="flex min-h-screen items-center justify-center bg-gray-50 px-4">
    <div class="w-full max-w-sm rounded-lg border border-gray-200 bg-white p-8 text-center">
      <h1 class="text-lg font-semibold text-gray-900">We couldn't find your record</h1>
      <p class="mt-2 text-sm text-gray-600">
        Your account email doesn't match a patient record at this practice yet. Contact your clinic to be added, then
        try signing in again.
      </p>
      <button type="button" class="mt-4 text-sm font-medium text-indigo-600 hover:text-indigo-500" @click="signOut">
        Sign out
      </button>
    </div>
  </div>
</template>
