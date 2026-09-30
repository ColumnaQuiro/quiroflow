<script setup lang="ts">
// The key is write-only: saved to account_secrets through
// /api/import/practicehub-connection and never read back. Leaving the field
// empty keeps the key already stored.
const user = useSupabaseUser()
const t = useT()
const { showToast } = useToast()

const baseUrl = ref('')
const apiKey = ref('')
const hasStoredKey = ref(false)
const contactEmail = ref('')
const loading = ref(true)
const saving = ref(false)

async function load() {
  loading.value = true
  const saved = await useStaffFetch<{ baseUrl: string | null; contactEmail: string | null; hasKey: boolean }>('/api/import/practicehub-connection').catch(() => null)
  baseUrl.value = saved?.baseUrl ?? ''
  hasStoredKey.value = !!saved?.hasKey
  contactEmail.value = saved?.contactEmail ?? user.value?.email ?? ''
  loading.value = false
}
onMounted(load)

async function save() {
  saving.value = true
  try {
    await useStaffFetch('/api/import/practicehub-connection', {
      method: 'PUT',
      body: { baseUrl: baseUrl.value.trim(), contactEmail: contactEmail.value.trim(), apiKey: apiKey.value.trim() },
    })
  } catch (e: any) {
    saving.value = false
    showToast(e?.data?.statusMessage ?? e?.message ?? t('Could not save.', 'No se pudo guardar.'), 'error')
    return
  }
  saving.value = false
  showToast(t('Saved', 'Guardado'))
  if (apiKey.value.trim()) hasStoredKey.value = true
  apiKey.value = ''

  // The composable's in-memory ref is what every importer tab's connect
  // form actually reads -- refresh it now so every step picks up the change
  // immediately, not just after a reload.
  const conn = usePracticeHubConnection()
  conn.value = baseUrl.value.trim() && hasStoredKey.value ? { baseUrl: baseUrl.value.trim().replace(/\/$/, ''), apiKey: '', appDetails: `QuiroFlow=${contactEmail.value.trim()}` } : null
}

// Asked in an in-app dialog rather than confirm().
const disconnecting = ref(false)
async function disconnect() {
  saving.value = true
  try {
    await useStaffFetch('/api/import/practicehub-connection', { method: 'DELETE' })
  } catch (e: any) {
    saving.value = false
    showToast(e?.data?.statusMessage ?? e?.message ?? t('Could not disconnect.', 'No se pudo desconectar.'), 'error')
    return
  }
  saving.value = false
  disconnecting.value = false
  baseUrl.value = ''
  hasStoredKey.value = false
  usePracticeHubConnection().value = null
  showToast(t('Disconnected', 'Desconectado'))
}
</script>

<template>
  <div class="max-w-md">
    <p class="text-sm text-ink-muted2">
      {{
        t(
          'Save your PracticeHub connection once here and every import tab (Patients, Appointments, Payments, Packages / Bonos, ...) connects automatically -- no need to paste the API key again for each one, or after a page reload.',
          'Guarda aquí tu conexión de PracticeHub una vez y cada pestaña de importación (Pacientes, Citas, Pagos, Bonos, ...) se conecta automáticamente -- no hace falta volver a pegar la clave API en cada una, ni tras recargar la página.',
        )
      }}
    </p>

    <div v-if="loading" class="mt-4 space-y-4">
      <div v-for="i in 3" :key="i" class="space-y-1.5">
        <UiSkeleton class="h-3 w-32 rounded-ctlSm" />
        <UiSkeleton class="h-9 w-full rounded-md" />
      </div>
    </div>
    <form v-else class="mt-4 space-y-4" @submit.prevent="save">
      <div>
        <label class="block text-sm font-medium text-ink-700">{{ t('PracticeHub URL', 'URL de PracticeHub') }}</label>
        <input
          v-model="baseUrl"
          type="text"
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
          :placeholder="hasStoredKey ? '••••••••••••••••••••' : t('From PracticeHub → Developers → API Keys', 'Desde PracticeHub → Developers → API Keys')"
          class="mt-1 w-full rounded-md border border-line-control bg-surface px-3 py-2 text-sm text-ink-900 focus:border-brand focus:outline-none focus:ring-1 focus:ring-brand"
        />
      </div>
      <div>
        <label class="block text-sm font-medium text-ink-700">{{ t('Your email', 'Tu correo electrónico') }}</label>
        <input
          v-model="contactEmail"
          type="email"
          class="mt-1 w-full rounded-md border border-line-control bg-surface px-3 py-2 text-sm text-ink-900 focus:border-brand focus:outline-none focus:ring-1 focus:ring-brand"
        />
        <p class="mt-1 text-xs text-ink-muted2">{{ t("Sent as PracticeHub's required app identifier.", 'Se envía como identificador de aplicación requerido por PracticeHub.') }}</p>
      </div>
      <div class="flex items-center gap-3">
        <button type="submit" class="rounded-md bg-brand px-4 py-2 text-sm font-medium text-white hover:bg-brand-hover disabled:opacity-50" :disabled="saving">
          {{ saving ? t('Saving…', 'Guardando…') : t('Save', 'Guardar') }}
        </button>
        <button v-if="hasStoredKey" type="button" class="text-sm font-medium text-danger-text hover:underline" :disabled="saving" @click="disconnecting = true">
          {{ t('Disconnect', 'Desconectar') }}
        </button>
      </div>
    </form>

    <UiConfirmDialog
      v-if="disconnecting"
      tone="danger"
      :title="t('Remove the saved PracticeHub connection?', '¿Eliminar la conexión guardada de PracticeHub?')"
      :confirm-label="t('Disconnect', 'Desconectar')"
      :cancel-label="t('Cancel', 'Cancelar')"
      :busy="saving"
      @confirm="disconnect"
      @cancel="disconnecting = false"
    >
      <p class="text-[14px] leading-snug text-ink-700">{{ t('The API key is deleted. Nothing already imported changes; to import again, save the connection anew.', 'Se borra la clave API. No cambia nada de lo ya importado; para volver a importar, guarda la conexión de nuevo.') }}</p>
    </UiConfirmDialog>
  </div>
</template>
