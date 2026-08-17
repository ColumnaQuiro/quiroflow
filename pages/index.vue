<script setup lang="ts">
const user = useSupabaseUser()
const supabase = useSupabaseClient()
const store = useAccountStore()

if (user.value && !store.loaded) {
  await store.load()
}

async function signOut() {
  await supabase.auth.signOut()
  store.reset()
  await navigateTo('/login')
}
</script>

<template>
  <div v-if="!user" class="flex min-h-screen flex-col items-center justify-center gap-4 bg-gray-50 px-4 text-center">
    <h1 class="text-2xl font-semibold text-gray-900">QuiroFlow</h1>
    <p class="max-w-md text-gray-600">Practice management for multi-location clinics.</p>
    <NuxtLink to="/login" class="rounded-md bg-indigo-600 px-4 py-2 text-sm font-medium text-white hover:bg-indigo-700">
      Sign in
    </NuxtLink>
  </div>
  <div v-else class="min-h-screen bg-gray-50 p-8">
    <div class="flex items-center justify-between">
      <h1 class="text-xl font-semibold text-gray-900">
        {{ store.accountName || 'QuiroFlow' }}
      </h1>
      <button class="text-sm text-gray-500 hover:text-gray-700" @click="signOut">Sign out</button>
    </div>
    <p class="mt-4 text-sm text-gray-600">
      Signed in as {{ store.teamMember?.full_name }} ({{ store.teamMember?.role }}).
      Clinics: {{ store.clinics.map((c) => c.name).join(', ') || 'none yet' }}.
    </p>
    <p class="mt-2 text-sm text-gray-400">Dashboard coming next.</p>
  </div>
</template>
