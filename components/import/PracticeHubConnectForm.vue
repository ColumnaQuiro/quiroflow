<script setup lang="ts">
const emit = defineEmits<{ connect: [conn: { baseUrl: string; apiKey: string; appDetails: string }] }>()

const t = useT()
const user = useSupabaseUser()

const baseUrl = ref('')
const apiKey = ref('')
const email = ref(user.value?.email ?? '')

function submit() {
  if (!baseUrl.value.trim() || !apiKey.value.trim() || !email.value.trim()) return
  emit('connect', {
    baseUrl: baseUrl.value.trim(),
    apiKey: apiKey.value.trim(),
    appDetails: `QuiroFlow=${email.value.trim()}`,
  })
}
</script>

<template>
  <form class="space-y-4" @submit.prevent="submit">
    <div>
      <label class="block text-sm font-medium text-ink-700">{{ t('PracticeHub URL', 'URL de PracticeHub') }}</label>
      <input
        v-model="baseUrl"
        type="text"
        required
        placeholder="https://your-clinic.practicehub.io"
        class="mt-1 w-full rounded-md border border-line-control bg-surface px-3 py-2 text-sm text-ink-900 focus:border-brand focus:outline-none focus:ring-1 focus:ring-brand"
      />
    </div>
    <div>
      <label class="block text-sm font-medium text-ink-700">{{ t('API Key', 'Clave API') }}</label>
      <input
        v-model="apiKey"
        type="password"
        autocomplete="off"
        required
        :placeholder="t('From PracticeHub → Developers → API Keys', 'Desde PracticeHub → Developers → API Keys')"
        class="mt-1 w-full rounded-md border border-line-control bg-surface px-3 py-2 text-sm text-ink-900 focus:border-brand focus:outline-none focus:ring-1 focus:ring-brand"
      />
      <p class="mt-1 text-xs text-ink-muted2">{{ t('Not stored — used only for this import.', 'No se almacena; se usa solo para esta importación.') }}</p>
    </div>
    <div>
      <label class="block text-sm font-medium text-ink-700">{{ t('Your email', 'Tu correo electrónico') }}</label>
      <input
        v-model="email"
        type="email"
        required
        class="mt-1 w-full rounded-md border border-line-control bg-surface px-3 py-2 text-sm text-ink-900 focus:border-brand focus:outline-none focus:ring-1 focus:ring-brand"
      />
      <p class="mt-1 text-xs text-ink-muted2">{{ t("Sent as PracticeHub's required app identifier.", 'Se envía como identificador de aplicación requerido por PracticeHub.') }}</p>
    </div>
    <button type="submit" class="rounded-md bg-brand px-4 py-2 text-sm font-medium text-white hover:bg-brand-hover">
      {{ t('Connect', 'Conectar') }}
    </button>
  </form>
</template>
