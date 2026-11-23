<script setup lang="ts">
// QuiroHiro is GoHighLevel underneath, with its API: the importer reads with
// a read-only Private Integration token the clinic creates in QuiroHiro, plus
// the address of any QuiroHiro page, which names the clinic's location. The
// token is write-only, saved to account_secrets through
// /api/import/quirohiro-connection and never read back; leaving it empty
// keeps the one stored. Saving tries both against QuiroHiro first.
const t = useT()
const { showToast } = useToast()
const fieldId = useId()
const connection = useQuirohiroConnection()

const location = ref('')
const token = ref('')
const loading = ref(true)
const saving = ref(false)
const saveError = ref('')
const disconnecting = ref(false)

const SCOPES = ['calendars.readonly', 'calendars/events.readonly', 'contacts.readonly', 'users.readonly', 'locations.readonly', 'locations/customFields.readonly']

async function load() {
  loading.value = true
  const saved = await loadQuirohiroConnection(true)
  location.value = saved?.locationId ?? ''
  loading.value = false
}
onMounted(load)

async function save() {
  saving.value = true
  saveError.value = ''
  try {
    await useStaffFetch('/api/import/quirohiro-connection', { method: 'PUT', body: { location: location.value.trim(), token: token.value.trim() } })
  } catch (e: any) {
    saving.value = false
    saveError.value = importErrorText(e, t, { en: 'The connection was not saved.', es: 'No se guardó la conexión.' })
    return
  }
  token.value = ''
  await load()
  saving.value = false
  showToast(t('Connected to QuiroHiro', 'Conectado a QuiroHiro'))
}

async function disconnect() {
  saving.value = true
  await useStaffFetch('/api/import/quirohiro-connection', { method: 'DELETE' }).catch(() => {})
  connection.value = null
  location.value = ''
  saving.value = false
  disconnecting.value = false
}
</script>

<template>
  <div class="max-w-lg">
    <ImportIntro
      :lead="t('QuiroFlow reads QuiroHiro through its own API, with a read-only key you create in QuiroHiro. Nobody signs in to QuiroHiro for you, so its email or phone code never comes into it.', 'QuiroFlow lee QuiroHiro con su propia API, con una clave de solo lectura que creas en QuiroHiro. Nadie inicia sesión en QuiroHiro por ti, así que su código por email o teléfono no interviene.')"
      :notes="[
        { title: t('Read only.', 'Solo lectura.'), body: t('The key only lets QuiroFlow look. Nothing in QuiroHiro is changed, sent or deleted.', 'La clave solo permite a QuiroFlow consultar. No se cambia, envía ni borra nada en QuiroHiro.') },
        { title: t('Revoke it when you are done.', 'Revócala al terminar.'), body: t('Once you have left QuiroHiro, delete the integration there and the key stops working.', 'Cuando dejes QuiroHiro, borra allí la integración y la clave deja de funcionar.') },
      ]"
    />

    <ol class="mt-4 list-decimal space-y-1.5 pl-5 text-[13.5px] leading-snug text-ink-700">
      <li>{{ t('In QuiroHiro, open Settings → Private Integrations and click "Create new integration". Name it "QuiroFlow".', 'En QuiroHiro, abre Configuración → Integraciones Privado y pulsa «Crear Nueva Integración». Llámala «QuiroFlow».') }}</li>
      <li>
        {{ t('Under Scopes, tick these six (all "Ver", read-only):', 'En Ámbitos, marca estos seis (todos «Ver», de solo lectura):') }}
        <span class="mt-1 flex flex-wrap gap-1">
          <code v-for="s in SCOPES" :key="s" class="rounded bg-surface-subtle px-1.5 py-0.5 text-[12px] text-ink-700">{{ s }}</code>
        </span>
      </li>
      <li>{{ t('Click Create, copy the token it shows (it starts with "pit-") and paste it below, with the address of any QuiroHiro page.', 'Pulsa Crear, copia el token que aparece (empieza por «pit-») y pégalo abajo, con la dirección de cualquier página de QuiroHiro.') }}</li>
    </ol>

    <div v-if="loading" class="mt-4 space-y-4">
      <div v-for="i in 2" :key="i" class="space-y-1.5">
        <UiSkeleton class="h-3 w-32 rounded-ctlSm" />
        <UiSkeleton class="h-9 w-full rounded-md" />
      </div>
    </div>
    <form v-else class="mt-4 space-y-4" data-cy="qh-connection" @submit.prevent="save">
      <p v-if="quirohiroConnected(connection)" class="rounded-ctl border border-success-border bg-success-bg p-3 text-[13px] text-success-text" data-cy="qh-connected">
        {{ t(`Connected to ${connection!.locationName || connection!.locationId}.`, `Conectado a ${connection!.locationName || connection!.locationId}.`) }}
      </p>
      <div>
        <label :for="`${fieldId}-location`" class="block text-sm font-medium text-ink-700">{{ t('QuiroHiro address', 'Dirección de QuiroHiro') }}</label>
        <input :id="`${fieldId}-location`" v-model="location" type="text" placeholder="https://app.quirohiro.io/v2/location/…" data-cy="qh-location"
          class="mt-1 w-full rounded-md border border-line-control bg-surface px-3 py-2 text-sm text-ink-900 focus:border-brand focus:outline-none focus:ring-1 focus:ring-brand" />
        <p class="mt-1 text-xs text-ink-muted2">{{ t('Paste the address of any QuiroHiro page you are signed in to; only the clinic\'s id is kept.', 'Pega la dirección de cualquier página de QuiroHiro en la que hayas iniciado sesión; solo se guarda el identificador de la clínica.') }}</p>
      </div>
      <div>
        <label :for="`${fieldId}-token`" class="block text-sm font-medium text-ink-700">{{ t('Private Integration token', 'Token de la integración privada') }}</label>
        <input :id="`${fieldId}-token`" v-model="token" type="password" autocomplete="off" data-cy="qh-token"
          :placeholder="connection?.hasToken ? '••••••••••••' : 'pit-…'"
          class="mt-1 w-full rounded-md border border-line-control bg-surface px-3 py-2 text-sm text-ink-900 focus:border-brand focus:outline-none focus:ring-1 focus:ring-brand" />
      </div>
      <div class="flex flex-wrap items-center gap-3">
        <button type="submit" class="rounded-md bg-brand px-4 py-2 text-sm font-medium text-brand-on hover:bg-brand-hover disabled:opacity-50" :disabled="saving" data-cy="qh-save">
          {{ saving ? t('Checking…', 'Comprobando…') : t('Save and test', 'Guardar y probar') }}
        </button>
        <button v-if="connection?.hasToken" type="button" class="text-sm font-medium text-danger-text hover:underline" :disabled="saving" @click="disconnecting = true">
          {{ t('Disconnect', 'Desconectar') }}
        </button>
      </div>
      <p v-if="saveError" class="text-sm text-danger-text" data-cy="qh-save-error">{{ saveError }}</p>
    </form>

    <UiConfirmDialog
      v-if="disconnecting"
      tone="danger"
      :title="t('Remove the saved QuiroHiro key?', '¿Eliminar la clave guardada de QuiroHiro?')"
      :confirm-label="t('Disconnect', 'Desconectar')"
      :cancel-label="t('Cancel', 'Cancelar')"
      :busy="saving"
      @confirm="disconnect"
      @cancel="disconnecting = false"
    >
      <p class="text-[14px] leading-snug text-ink-700">{{ t('The key and the copy read from QuiroHiro are deleted here. Nothing already imported changes. To stop the key working, also delete the integration in QuiroHiro.', 'Se borran aquí la clave y la copia leída de QuiroHiro. No cambia nada de lo ya importado. Para que la clave deje de funcionar, borra también la integración en QuiroHiro.') }}</p>
    </UiConfirmDialog>
  </div>
</template>
