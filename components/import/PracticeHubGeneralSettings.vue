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
// PracticeHub 2.0's API key (phk_...), kept apart from the Classic one.
const v3ApiKey = ref('')
const hasStoredV3Key = ref(false)
const contactEmail = ref('')
const loading = ref(true)
const saving = ref(false)

async function load() {
  loading.value = true
  const saved = await useStaffFetch<{ baseUrl: string | null; contactEmail: string | null; hasKey: boolean; hasV3Key?: boolean }>('/api/import/practicehub-connection').catch(() => null)
  baseUrl.value = saved?.baseUrl ?? ''
  hasStoredKey.value = !!saved?.hasKey
  hasStoredV3Key.value = !!saved?.hasV3Key
  contactEmail.value = saved?.contactEmail ?? user.value?.email ?? ''
  loading.value = false
}
onMounted(load)

async function save() {
  saving.value = true
  try {
    await useStaffFetch('/api/import/practicehub-connection', {
      method: 'PUT',
      body: { baseUrl: baseUrl.value.trim(), contactEmail: contactEmail.value.trim(), apiKey: apiKey.value.trim(), v3ApiKey: v3ApiKey.value.trim() },
    })
  } catch (e: any) {
    saving.value = false
    showToast(e?.data?.statusMessage ?? e?.message ?? t('Could not save.', 'No se pudo guardar.'), 'error')
    return
  }
  saving.value = false
  showToast(t('Saved', 'Guardado'))
  if (apiKey.value.trim()) hasStoredKey.value = true
  if (v3ApiKey.value.trim()) hasStoredV3Key.value = true
  apiKey.value = ''
  v3ApiKey.value = ''
  checkResult.value = null

  // The composable's in-memory ref is what every importer tab's connect
  // form actually reads -- refresh it now so every step picks up the change
  // immediately, not just after a reload.
  const conn = usePracticeHubConnection()
  conn.value = baseUrl.value.trim() && hasStoredKey.value ? { baseUrl: baseUrl.value.trim().replace(/\/$/, ''), apiKey: '', appDetails: `QuiroFlow=${contactEmail.value.trim()}` } : null
}

// "Test connection" for the 2.0 key: which account it reaches and how much is
// there, so a key for the wrong clinic shows itself before anything moves.
const checkResult = ref<{ accountName: string | null; patients: number | null; carePlans: number | null; canWrite: boolean } | null>(null)
const checkError = ref('')
const checking = ref(false)
async function checkV3() {
  checking.value = true
  checkError.value = ''
  try {
    checkResult.value = await useStaffFetch('/api/import/practicehub-v3-check')
  } catch (e: any) {
    checkResult.value = null
    checkError.value = e?.data?.statusMessage ?? e?.message ?? t('Could not reach PracticeHub 2.0.', 'No se pudo conectar con PracticeHub 2.0.')
  } finally {
    checking.value = false
  }
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
  hasStoredV3Key.value = false
  checkResult.value = null
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
        <label class="block text-sm font-medium text-ink-700">{{ t('PracticeHub 2.0 API key', 'Clave API de PracticeHub 2.0') }}</label>
        <input
          v-model="v3ApiKey"
          type="password"
          autocomplete="off"
          data-cy="ph-v3-key"
          :placeholder="hasStoredV3Key ? '••••••••••••••••••••' : 'phk_…'"
          class="mt-1 w-full rounded-md border border-line-control bg-surface px-3 py-2 text-sm text-ink-900 focus:border-brand focus:outline-none focus:ring-1 focus:ring-brand"
        />
        <p class="mt-1 text-xs text-ink-muted2">{{ t('The new API, for clinics on PracticeHub 2.0 or about to switch. A separate key, starting phk_, from the same Developers → API Keys page.', 'La API nueva, para clínicas en PracticeHub 2.0 o a punto de pasarse. Una clave aparte, que empieza por phk_, de la misma página Developers → API Keys.') }}</p>
        <div v-if="hasStoredV3Key" class="mt-2 flex flex-wrap items-center gap-2">
          <button type="button" class="rounded-md border border-line-control px-3 py-1.5 text-sm font-medium text-ink-700 hover:bg-surface-subtle disabled:opacity-50" :disabled="checking" data-cy="ph-v3-check" @click="checkV3">
            {{ checking ? t('Checking…', 'Comprobando…') : t('Test connection', 'Probar conexión') }}
          </button>
          <span v-if="checkResult" class="text-sm text-success-text" data-cy="ph-v3-check-result">
            {{ checkResult.accountName }} · {{ t(`${checkResult.patients ?? 0} patients · ${checkResult.carePlans ?? 0} 2.0 care plans`, `${checkResult.patients ?? 0} pacientes · ${checkResult.carePlans ?? 0} planes de cuidados 2.0`) }}
          </span>
          <span v-else-if="checkError" class="text-sm text-danger-text" data-cy="ph-v3-check-error">{{ checkError }}</span>
        </div>
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
