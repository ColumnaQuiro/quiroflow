<script setup lang="ts">
definePageMeta({ layout: false })

const user = useSupabaseUser()

watch(
  user,
  (value) => {
    if (!value) return
    // This browser's flag, else the account's own (set at sign-up): the
    // link is often opened on another device, or came from the app.
    const intent = localStorage.getItem('signup_intent') ?? (value.user_metadata as { signup_intent?: string } | undefined)?.signup_intent
    localStorage.removeItem('signup_intent')
    navigateTo(intent === 'portal' ? '/portal' : '/dashboard')
  },
  { immediate: true },
)
</script>

<template>
  <div class="flex min-h-screen items-center justify-center bg-surface-page px-4">
    <p class="text-sm text-ink-500">Confirming your email…</p>
  </div>
</template>
