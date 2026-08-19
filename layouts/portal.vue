<script setup lang="ts">
const supabase = useSupabaseClient()

async function signOut() {
  await supabase.auth.signOut()
  await navigateTo('/portal/login')
}
</script>

<template>
  <div class="min-h-screen bg-gray-50">
    <header class="flex h-14 items-center justify-between border-b border-gray-200 bg-white px-6">
      <span class="flex items-center gap-2 text-lg font-semibold text-gray-900">
        <img src="/logo/quiroflow-mark.svg" alt="" class="h-5 w-5" />
        QuiroFlow
      </span>
      <button type="button" class="text-sm text-gray-500 hover:text-gray-700" @click="signOut">Sign out</button>
    </header>
    <main class="mx-auto max-w-2xl p-6">
      <slot />
    </main>
  </div>
</template>
