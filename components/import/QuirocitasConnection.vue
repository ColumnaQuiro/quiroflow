<script setup lang="ts">
// Quirocitas has no API key: the importer signs in with a staff login, the
// same username and password someone at the clinic types into Quirocitas. The
// password is write-only, saved to account_secrets through
// /api/import/quirocitas-connection and never read back; leaving it empty
// keeps the one stored.
const t = useT()
const { showToast } = useToast()
const fieldId = useId()
const connection = useQuirocitasConnection()

const baseUrl = ref('')
const username = ref('')
const password = ref('')
const hasStoredPassword = ref(false)
const loading = ref(true)
const saving = ref(false)
const checking = ref(false)
const checkResult = ref<number | null>(null)
const checkError = ref('')
const disconnecting = ref(false)

async function load() {
  loading.value = true
  const saved = await loadQuirocitasConnection(true)
  baseUrl.value = saved?.baseUrl ?? ''
  username.value = saved?.username ?? ''
  hasStoredPassword.value = !!saved?.hasPassword
  loading.value = false
}
onMounted(load)

async function save() {
  saving.value = true
  checkResult.value = null
  checkError.value = ''
  try {
    await useStaffFetch('/api/import/quirocitas-connection', { method: 'PUT', body: { baseUrl: baseUrl.value.trim(), username: username.value.trim(), password: password.value } })
  } catch (e: any) {
    saving.value = false
    showToast(e?.data?.statusMessage ?? e?.message ?? t('Could not save.', 'No se pudo guardar.'), 'error')
    return
  }
  password.value = ''
  await load()
  saving.value = false
  showToast(t('Saved', 'Guardado'))
  await check()
}

// Signs in afresh and counts the patients, so a wrong login or address shows
// itself before the long read starts.
async function check() {
  checking.value = true
  checkResult.value = null
  checkError.value = ''
  try {
    const { patients } = await quirocitasCall<{ patients: number }>({ op: 'check' })
    checkResult.value = patients
  } catch (e: any) {
    checkError.value = e?.data?.statusMessage ?? e?.message ?? t('Could not connect.', 'No se pudo conectar.')
  } finally {
    checking.value = false
  }
}

async function disconnect() {
  saving.value = true
  await useStaffFetch('/api/import/quirocitas-connection', { method: 'DELETE' }).catch(() => {})
  connection.value = null
  baseUrl.value = ''
  username.value = ''
  hasStoredPassword.value = false
  checkResult.value = null
  saving.value = false
  disconnecting.value = false
}
</script>

<template>
  <div class="max-w-md">
    <ImportIntro
      :lead="t('The address and login you use for Quirocitas. Saved once here, every step reads with it.', 'La dirección y el usuario con que entras en Quirocitas. Se guardan una vez aquí y todos los pasos leen con ellos.')"
      :notes="[
        { title: t('Read only.', 'Solo lectura.'), body: t('QuiroFlow only opens the pages that show a record. It never saves, deletes or invoices anything in Quirocitas.', 'QuiroFlow solo abre las páginas que muestran una ficha. Nunca guarda, borra ni factura nada en Quirocitas.') },
        { title: t('The password stays here.', 'La contraseña se queda aquí.'), body: t('It is stored for this clinic only and is never shown again. Use a Quirocitas user that can see every patient.', 'Se guarda solo para esta clínica y no se vuelve a mostrar. Usa un usuario de Quirocitas que vea a todos los pacientes.') },
      ]"
    />

    <div v-if="loading" class="mt-4 space-y-4">
      <div v-for="i in 3" :key="i" class="space-y-1.5">
        <UiSkeleton class="h-3 w-32 rounded-ctlSm" />
        <UiSkeleton class="h-9 w-full rounded-md" />
      </div>
    </div>
    <form v-else class="mt-4 space-y-4" data-cy="qc-connection" @submit.prevent="save">
      <div>
        <label :for="`${fieldId}-url`" class="block text-sm font-medium text-ink-700">{{ t('Quirocitas address', 'Dirección de Quirocitas') }}</label>
        <input :id="`${fieldId}-url`" v-model="baseUrl" type="text" placeholder="https://quirocitas-yourclinic.es/chiro" data-cy="qc-url"
          class="mt-1 w-full rounded-md border border-line-control bg-surface px-3 py-2 text-sm text-ink-900 focus:border-brand focus:outline-none focus:ring-1 focus:ring-brand" />
        <p class="mt-1 text-xs text-ink-muted2">{{ t('Paste the address of any Quirocitas page; it is trimmed to the right one.', 'Pega la dirección de cualquier página de Quirocitas; se recorta a la correcta.') }}</p>
      </div>
      <div>
        <label :for="`${fieldId}-user`" class="block text-sm font-medium text-ink-700">{{ t('Username', 'Usuario') }}</label>
        <input :id="`${fieldId}-user`" v-model="username" type="text" autocomplete="off" data-cy="qc-username"
          class="mt-1 w-full rounded-md border border-line-control bg-surface px-3 py-2 text-sm text-ink-900 focus:border-brand focus:outline-none focus:ring-1 focus:ring-brand" />
      </div>
      <div>
        <label :for="`${fieldId}-password`" class="block text-sm font-medium text-ink-700">{{ t('Password', 'Contraseña') }}</label>
        <input :id="`${fieldId}-password`" v-model="password" type="password" autocomplete="new-password" data-cy="qc-password"
          :placeholder="hasStoredPassword ? '••••••••••••' : ''"
          class="mt-1 w-full rounded-md border border-line-control bg-surface px-3 py-2 text-sm text-ink-900 focus:border-brand focus:outline-none focus:ring-1 focus:ring-brand" />
      </div>
      <div class="flex flex-wrap items-center gap-3">
        <button type="submit" class="rounded-md bg-brand px-4 py-2 text-sm font-medium text-brand-on hover:bg-brand-hover disabled:opacity-50" :disabled="saving || checking" data-cy="qc-save">
          {{ saving ? t('Saving…', 'Guardando…') : t('Save and test', 'Guardar y probar') }}
        </button>
        <button v-if="hasStoredPassword" type="button" class="rounded-md border border-line-control px-3 py-2 text-sm font-medium text-ink-700 hover:bg-surface-subtle disabled:opacity-50" :disabled="checking || saving" @click="check">
          {{ checking ? t('Checking…', 'Comprobando…') : t('Test connection', 'Probar conexión') }}
        </button>
        <button v-if="hasStoredPassword" type="button" class="text-sm font-medium text-danger-text hover:underline" :disabled="saving" @click="disconnecting = true">
          {{ t('Disconnect', 'Desconectar') }}
        </button>
      </div>
      <p v-if="checkResult !== null" class="text-sm text-success-text" data-cy="qc-check-result">
        {{ t(`Signed in. ${checkResult} patients in Quirocitas.`, `Sesión iniciada. ${checkResult} pacientes en Quirocitas.`) }}
      </p>
      <p v-else-if="checkError" class="text-sm text-danger-text" data-cy="qc-check-error">{{ checkError }}</p>
    </form>

    <UiConfirmDialog
      v-if="disconnecting"
      tone="danger"
      :title="t('Remove the saved Quirocitas login?', '¿Eliminar el acceso guardado a Quirocitas?')"
      :confirm-label="t('Disconnect', 'Desconectar')"
      :cancel-label="t('Cancel', 'Cancelar')"
      :busy="saving"
      @confirm="disconnect"
      @cancel="disconnecting = false"
    >
      <p class="text-[14px] leading-snug text-ink-700">{{ t('The password is deleted. Nothing already imported changes.', 'Se borra la contraseña. No cambia nada de lo ya importado.') }}</p>
    </UiConfirmDialog>
  </div>
</template>
