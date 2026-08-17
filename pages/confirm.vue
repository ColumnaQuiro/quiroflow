<script setup lang="ts">
definePageMeta({ layout: false })

const user = useSupabaseUser()

watch(
  user,
  (value) => {
    if (!value) return
    const intent = localStorage.getItem('signup_intent')
    localStorage.removeItem('signup_intent')
    navigateTo(intent === 'portal' ? '/portal' : '/dashboard')
  },
  { immediate: true },
)
</script>

<template>
  <div class="flex min-h-screen items-center justify-center bg-gray-50 px-4">
    <p class="text-sm text-gray-600">Confirming your email…</p>
  </div>
</template>
