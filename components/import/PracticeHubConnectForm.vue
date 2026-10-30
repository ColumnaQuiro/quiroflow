<script setup lang="ts">
const emit = defineEmits<{ connect: [conn: { baseUrl: string; apiKey: string; appDetails: string }] }>()

const t = useT()
const user = useSupabaseUser()
const sharedConn = usePracticeHubConnection()
const { showToast } = useToast()

const baseUrl = ref(sharedConn.value?.baseUrl ?? '')
const apiKey = ref(sharedConn.value?.apiKey ?? '')
const email = ref(user.value?.email ?? '')

// The connection saved under Connection arrives without its key, which stays
// on the server (practicehub-proxy adds it to a request that carries none).
// This form used to demand a key regardless, so every step asked for the key
// the clinic had just saved -- eleven times over a migration. A saved
// connection is now one click; typing a key is the exception.
const saved = computed(() => (sharedConn.value?.baseUrl && !sharedConn.value.apiKey ? sharedConn.value : null))
const useAnotherKey = ref(false)

function useSaved() {
  if (!saved.value) return
  emit('connect', { ...saved.value })
}

function submit() {
  if (!baseUrl.value.trim() || !apiKey.value.trim() || !email.value.trim()) return
  const conn = {
    baseUrl: baseUrl.value.trim(),
    apiKey: apiKey.value.trim(),
    appDetails: `QuiroFlow=${email.value.trim()}`,
  }
  sharedConn.value = conn
  emit('connect', conn)
  showToast(t('Connected to PracticeHub', 'Conectado a PracticeHub'))
}

// Ties each visible <label> to the field under it (for/id), so a screen
// reader announces the field by its name.
const fieldId = useId()
</script>

<template>
  <div v-if="saved && !useAnotherKey" class="space-y-3">
    <p class="text-sm text-ink-700">
      {{ t(`Using the saved connection · ${saved.baseUrl.replace(/^https?:\/\//, '')}`, `Con la conexión guardada · ${saved.baseUrl.replace(/^https?:\/\//, '')}`) }}
    </p>
    <div class="flex flex-wrap items-center gap-3">
      <button type="button" class="rounded-md bg-brand px-4 py-2 text-sm font-medium text-brand-on hover:bg-brand-hover" data-cy="ph-use-saved-connection" @click="useSaved">
        {{ t('Start', 'Empezar') }}
      </button>
      <button type="button" class="text-sm font-medium text-ink-600 hover:underline" @click="useAnotherKey = true">
        {{ t('Use another key', 'Usar otra clave') }}
      </button>
    </div>
  </div>
  <form v-else class="space-y-4" @submit.prevent="submit">
    <div>
      <label :for="`${fieldId}-baseUrl`" class="block text-sm font-medium text-ink-700">{{ t('PracticeHub URL', 'URL de PracticeHub') }}</label>
      <input :id="`${fieldId}-baseUrl`"
        v-model="baseUrl"
        type="text"
        required
        placeholder="https://your-clinic.practicehub.io"
        class="mt-1 w-full rounded-md border border-line-control bg-surface px-3 py-2 text-sm text-ink-900 focus:border-brand focus:outline-none focus:ring-1 focus:ring-brand"
      />
    </div>
    <div>
      <label :for="`${fieldId}-apiKey`" class="block text-sm font-medium text-ink-700">{{ t('API Key', 'Clave API') }}</label>
      <input :id="`${fieldId}-apiKey`"
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
      <label :for="`${fieldId}-email`" class="block text-sm font-medium text-ink-700">{{ t('Your email', 'Tu correo electrónico') }}</label>
      <input :id="`${fieldId}-email`"
        v-model="email"
        type="email"
        required
        class="mt-1 w-full rounded-md border border-line-control bg-surface px-3 py-2 text-sm text-ink-900 focus:border-brand focus:outline-none focus:ring-1 focus:ring-brand"
      />
      <p class="mt-1 text-xs text-ink-muted2">{{ t("Sent as PracticeHub's required app identifier.", 'Se envía como identificador de aplicación requerido por PracticeHub.') }}</p>
    </div>
    <button type="submit" class="rounded-md bg-brand px-4 py-2 text-sm font-medium text-brand-on hover:bg-brand-hover">
      {{ t('Connect', 'Conectar') }}
    </button>
  </form>
</template>
