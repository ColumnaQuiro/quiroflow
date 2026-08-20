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
  <div class="flex h-screen bg-gray-50">
    <AppSidebar />
    <div class="flex flex-1 flex-col overflow-hidden">
      <AppTopbar />
      <div v-if="showDenied" class="flex items-center justify-between bg-amber-50 px-6 py-2 text-sm text-amber-800">
        <span>You don't have access to that section.</span>
        <button type="button" class="font-medium underline" @click="dismissDenied">Dismiss</button>
      </div>
      <main class="flex-1 overflow-y-auto p-6">
        <slot />
      </main>
    </div>
  </div>
</template>
