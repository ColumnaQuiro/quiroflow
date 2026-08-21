<script setup lang="ts">
const supabase = useSupabaseClient()

async function signOut() {
  await supabase.auth.signOut()
  await navigateTo('/portal/login')
}
</script>

<template>
  <div class="min-h-screen bg-surface-page">
    <header class="flex h-14 items-center justify-between border-b border-line bg-surface px-6">
      <span class="flex items-center gap-2 text-lg font-semibold text-ink-900">
        <img src="/logo/quiroflow-mark.svg" alt="" class="h-5 w-5" />
        QuiroFlow
      </span>
      <button type="button" class="text-sm text-ink-muted hover:text-ink-500" @click="signOut">Sign out</button>
    </header>
    <main class="mx-auto max-w-2xl p-6">
      <slot />
    </main>
  </div>
</template>
