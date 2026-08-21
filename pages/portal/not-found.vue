<script setup lang="ts">
definePageMeta({ layout: false })

const supabase = useSupabaseClient()

async function signOut() {
  await supabase.auth.signOut()
  await navigateTo('/portal/login')
}
</script>

<template>
  <div class="flex min-h-screen items-center justify-center bg-surface-page px-4">
    <div class="w-full max-w-sm rounded-card border border-line bg-surface p-8 text-center">
      <h1 class="text-lg font-semibold text-ink-900">We couldn't find your record</h1>
      <p class="mt-2 text-sm text-ink-500">
        Your account email doesn't match a patient record at this practice yet. Contact your clinic to be added, then
        try signing in again.
      </p>
      <button type="button" class="mt-4 text-sm font-medium text-brand hover:text-brand-hover" @click="signOut">
        Sign out
      </button>
    </div>
  </div>
</template>
