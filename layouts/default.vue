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

const { loading: loadingPortal, openPortal } = useBillingPortal()
const contactHref = 'mailto:hola@columnaquiro.com'
</script>

<template>
  <!-- Only the staff app (this layout) locks -- public booking, the patient
  portal, and shared docs use their own layouts and keep working regardless,
  so a clinic's unpaid bill never blocks their own patients. -->
  <div v-if="store.isBillingLocked" class="flex h-screen items-center justify-center bg-surface-page px-6">
    <div class="max-w-sm text-center">
      <h1 class="text-lg font-semibold text-gray-900">Account locked</h1>
      <p class="mt-2 text-sm text-gray-600">This QuiroFlow account is locked pending payment.</p>
      <!-- portal-session.post.ts deliberately doesn't gate on subscription
      status (only requireTeamMember, not requireActiveAccount) -- this is
      the one action a locked account can still take to unlock itself. -->
      <button
        v-if="store.isOwner"
        type="button"
        class="mt-4 block w-full rounded-ctl bg-indigo-600 px-4 py-2 text-sm font-medium text-white hover:bg-indigo-700 disabled:opacity-60"
        :disabled="loadingPortal"
        @click="openPortal(contactHref)"
      >
        {{ loadingPortal ? 'Opening…' : 'Manage billing' }}
      </button>
      <p class="mt-3 text-sm text-gray-600">Or contact us directly:</p>
      <a :href="contactHref" class="mt-1 inline-block text-sm font-medium text-indigo-600 hover:text-indigo-800">hola@columnaquiro.com</a>
    </div>
  </div>
  <div v-else class="flex h-screen flex-col bg-surface-page">
    <BillingBanner />
    <div class="flex flex-1 overflow-hidden">
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
  </div>
</template>
