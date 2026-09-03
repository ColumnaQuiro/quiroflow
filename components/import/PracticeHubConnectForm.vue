<script setup lang="ts">
const emit = defineEmits<{ connect: [conn: { baseUrl: string; apiKey: string; appDetails: string }] }>()

const user = useSupabaseUser()
const sharedConn = usePracticeHubConnection()

const baseUrl = ref(sharedConn.value?.baseUrl ?? '')
const apiKey = ref(sharedConn.value?.apiKey ?? '')
const email = ref(user.value?.email ?? '')

function submit() {
  if (!baseUrl.value.trim() || !apiKey.value.trim() || !email.value.trim()) return
  const conn = {
    baseUrl: baseUrl.value.trim(),
    apiKey: apiKey.value.trim(),
    appDetails: `QuiroFlow=${email.value.trim()}`,
  }
  sharedConn.value = conn
  emit('connect', conn)
}
</script>

<template>
  <form class="space-y-4" @submit.prevent="submit">
    <div>
      <label class="block text-sm font-medium text-ink-700">PracticeHub URL</label>
      <input
        v-model="baseUrl"
        type="text"
        required
        placeholder="https://your-clinic.practicehub.io"
        class="mt-1 w-full rounded-md border border-line-control bg-surface px-3 py-2 text-sm text-ink-900 focus:border-brand focus:outline-none focus:ring-1 focus:ring-brand"
      />
    </div>
    <div>
      <label class="block text-sm font-medium text-ink-700">API Key</label>
      <input
        v-model="apiKey"
        type="password"
        autocomplete="off"
        required
        placeholder="From PracticeHub → Developers → API Keys"
        class="mt-1 w-full rounded-md border border-line-control bg-surface px-3 py-2 text-sm text-ink-900 focus:border-brand focus:outline-none focus:ring-1 focus:ring-brand"
      />
      <p class="mt-1 text-xs text-ink-muted2">Not stored — used only for this import.</p>
    </div>
    <div>
      <label class="block text-sm font-medium text-ink-700">Your email</label>
      <input
        v-model="email"
        type="email"
        required
        class="mt-1 w-full rounded-md border border-line-control bg-surface px-3 py-2 text-sm text-ink-900 focus:border-brand focus:outline-none focus:ring-1 focus:ring-brand"
      />
      <p class="mt-1 text-xs text-ink-muted2">Sent as PracticeHub's required app identifier.</p>
    </div>
    <button type="submit" class="rounded-md bg-brand px-4 py-2 text-sm font-medium text-white hover:bg-brand-hover">
      Connect
    </button>
  </form>
</template>
