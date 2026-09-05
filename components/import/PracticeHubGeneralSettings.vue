<script setup lang="ts">
import type { TablesUpdate } from '~/types/database.types'

const supabase = useSupabaseClient()
const store = useAccountStore()
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
  const { data } = await supabase
    .from('accounts')
    .select('practicehub_base_url, practicehub_api_key, practicehub_contact_email')
    .eq('id', store.accountId!)
    .maybeSingle()
  baseUrl.value = data?.practicehub_base_url ?? ''
  hasStoredKey.value = !!data?.practicehub_api_key
  contactEmail.value = data?.practicehub_contact_email ?? user.value?.email ?? ''
  loading.value = false
}
onMounted(load)

async function save() {
  saving.value = true
  const update: TablesUpdate<'accounts'> = {
    practicehub_base_url: baseUrl.value.trim() || null,
    practicehub_contact_email: contactEmail.value.trim() || null,
  }
  if (apiKey.value.trim()) update.practicehub_api_key = apiKey.value.trim()

  const { error } = await supabase.from('accounts').update(update).eq('id', store.accountId!)
  saving.value = false
  if (error) {
    showToast(error.message, 'error')
    return
  }
  showToast('Saved')
  if (apiKey.value.trim()) hasStoredKey.value = true
  apiKey.value = ''

  // The composable's in-memory ref is what every importer tab's connect
  // form actually reads -- refresh it now so Patients/Appointments/
  // Payments/Packages all pick up the change immediately, not just after
  // a reload.
  const conn = usePracticeHubConnection()
  if (baseUrl.value.trim()) {
    const { data } = await supabase.from('accounts').select('practicehub_api_key').eq('id', store.accountId!).maybeSingle()
    if (data?.practicehub_api_key) {
      conn.value = { baseUrl: baseUrl.value.trim(), apiKey: data.practicehub_api_key, appDetails: `QuiroFlow=${contactEmail.value.trim()}` }
    }
  }
}

async function disconnect() {
  if (!confirm(t('Remove the saved PracticeHub connection?', '¿Eliminar la conexión guardada de PracticeHub?'))) return
  saving.value = true
  const { error } = await supabase
    .from('accounts')
    .update({ practicehub_base_url: null, practicehub_api_key: null, practicehub_contact_email: null })
    .eq('id', store.accountId!)
  saving.value = false
  if (error) {
    showToast(error.message, 'error')
    return
  }
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
        <button v-if="hasStoredKey" type="button" class="text-sm font-medium text-danger-text hover:underline" :disabled="saving" @click="disconnect">
          {{ t('Disconnect', 'Desconectar') }}
        </button>
      </div>
    </form>
  </div>
</template>
