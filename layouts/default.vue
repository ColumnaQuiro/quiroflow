<script setup lang="ts">
const store = useAccountStore()
if (!store.loaded) {
  await store.load()
}

const route = useRoute()
const router = useRouter()
const showDenied = ref(route.query.denied === '1')

function dismissDenied() {
  showDenied.value = false
  const query = { ...route.query }
  delete query.denied
  router.replace({ query })
}
</script>

<template>
  <div class="flex h-screen bg-surface-page">
    <AppSidebar />
    <div class="flex flex-1 flex-col overflow-hidden">
      <div v-if="showDenied" class="flex items-center justify-between bg-amber-50 px-6 py-2 text-sm text-amber-800">
        <span>You don't have access to that section.</span>
        <button type="button" class="font-medium underline" @click="dismissDenied">Dismiss</button>
      </div>
      <main class="flex flex-1 flex-col overflow-hidden">
        <slot />
      </main>
    </div>
  </div>
</template>
