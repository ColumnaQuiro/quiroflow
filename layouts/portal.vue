<script setup lang="ts">
const supabase = useSupabaseClient()

async function signOut() {
  await supabase.auth.signOut()
  await navigateTo('/portal/login')
}

const deletingAccount = ref(false)
async function deleteAccount() {
  if (!confirm("Delete your account? This removes your portal login immediately and can't be undone by you.")) return
  deletingAccount.value = true
  try {
    await $fetch('/api/account/delete', { method: 'POST' })
  } catch (err: any) {
    deletingAccount.value = false
    alert(err?.data?.statusMessage ?? 'Failed to delete account.')
    return
  }
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
      <div class="flex items-center gap-4">
        <button type="button" class="text-sm text-danger-text hover:text-danger-text/80" :disabled="deletingAccount" @click="deleteAccount">
          {{ deletingAccount ? 'Deleting…' : 'Delete account' }}
        </button>
        <button type="button" class="text-sm text-ink-muted hover:text-ink-500" @click="signOut">Sign out</button>
      </div>
    </header>
    <main class="mx-auto max-w-2xl p-6">
      <slot />
    </main>
  </div>
</template>
