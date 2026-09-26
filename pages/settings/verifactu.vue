<script setup lang="ts">
// Settings > VeriFactu: whether this clinic's invoicing records go to the
// AEAT, to which of its services, and the certificate they go with.
//
// Per clinic, because every clinic is its own company: its own NIF, its own
// certificate, its own date to go live. This used to be a deploy-wide
// environment variable, which only ever fitted one clinic.
//
// Owners only (routePermissions, and requireOwner behind every endpoint).

type Mode = 'off' | 'test' | 'live'
interface Settings {
  mode: Mode
  productionFrom: string | null
  locked: boolean
  company: { nif: string | null; legalName: string | null }
  certificate: {
    type: 'representative' | 'seal'
    subject: string | null
    notAfter: string | null
    updatedAt: string
    hasPassphrase: boolean
    checks: {
      belongsToCompany: boolean | null
      expired: boolean
      passwordOpens: boolean | null
      aeat: { state: 'accepted' | 'refused' | 'unreachable' | 'unused'; at: string | null; message: string | null }
      valid: boolean
    } | null
  } | null
  platformKeyConfigured: boolean
  activity: {
    waiting: number
    parked: number
    testRecords: number
    productionRecords: number
    last: { status: string; errorCode: string | null; errorMessage: string | null; sentAt: string | null } | null
  }
}

const t = useT()
const { showToast } = useToast()

const settings = ref<Settings | null>(null)
const loadError = ref('')
const mode = ref<Mode>('off')
// The day the clinic goes live, as the owner picks it. Midnight in Madrid.
const liveDay = ref('2027-01-01')
const saving = ref(false)

function madridDay(iso: string) {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Madrid', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date(iso))
}
const todayDay = madridDay(new Date().toISOString())

async function load() {
  try {
    settings.value = await useStaffFetch<Settings>('/api/verifactu/settings')
    mode.value = settings.value.mode
    if (settings.value.productionFrom) liveDay.value = madridDay(settings.value.productionFrom)
  } catch (e: any) {
    loadError.value = e?.data?.statusMessage || e?.message || t('Could not load the VeriFactu settings.', 'No se pudieron cargar los ajustes de VeriFactu.')
  }
}
onMounted(load)

const changed = computed(() => {
  if (!settings.value) return false
  if (mode.value !== settings.value.mode) return true
  return mode.value === 'live' && (!settings.value.productionFrom || liveDay.value !== madridDay(settings.value.productionFrom))
})

async function save() {
  if (!changed.value) return
  if (mode.value === 'live') {
    const ok = confirm(
      t(
        `Go live on ${liveDay.value}? From midnight that day (Madrid), every factura is sent to the AEAT's real service. Once the first one has gone, the date cannot change and VeriFactu cannot be switched off.`,
        `¿Pasar a producción el ${liveDay.value}? Desde la medianoche de ese día (Madrid), cada factura se envía al servicio real de la AEAT. Una vez enviada la primera, la fecha no se puede cambiar y VeriFactu no se puede desactivar.`,
      ),
    )
    if (!ok) return
  }
  saving.value = true
  try {
    await useStaffFetch('/api/verifactu/settings', { method: 'PUT', body: { mode: mode.value, productionFrom: mode.value === 'live' ? liveDay.value : null } })
    showToast(t('Saved', 'Guardado'))
    await load()
  } catch (e: any) {
    showToast(e?.data?.statusMessage || e?.message || t('Could not save.', 'No se pudo guardar.'), 'error')
  } finally {
    saving.value = false
  }
}

// --- Certificate ---------------------------------------------------------------
const certType = ref<'representative' | 'seal'>('representative')
const certFile = ref<File | null>(null)
const certPassword = ref('')
const uploading = ref(false)
const fileInput = ref<HTMLInputElement | null>(null)

function onFile(e: Event) {
  certFile.value = (e.target as HTMLInputElement).files?.[0] ?? null
}

function fileToBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => resolve(String(reader.result).replace(/^data:[^,]*,/, ''))
    reader.onerror = () => reject(reader.error)
    reader.readAsDataURL(file)
  })
}

async function uploadCertificate() {
  if (!certFile.value || !certPassword.value) return
  uploading.value = true
  try {
    const fileBase64 = await fileToBase64(certFile.value)
    await useStaffFetch('/api/verifactu/certificate', { method: 'POST', body: { fileBase64, passphrase: certPassword.value, certificateType: certType.value } })
    showToast(t('Certificate saved', 'Certificado guardado'))
    certFile.value = null
    certPassword.value = ''
    if (fileInput.value) fileInput.value.value = ''
    await load()
  } catch (e: any) {
    showToast(e?.data?.statusMessage || e?.message || t('Could not save the certificate.', 'No se pudo guardar el certificado.'), 'error')
  } finally {
    uploading.value = false
  }
}

const daysLeft = computed(() => {
  const notAfter = settings.value?.certificate?.notAfter
  return notAfter ? Math.ceil((new Date(notAfter).getTime() - Date.now()) / 86_400_000) : null
})

// What stops anything being sent right now, in words -- the same conditions
// the sender checks, so the page never says "on" while nothing goes out.
const notSendingBecause = computed(() => {
  const s = settings.value
  if (!s || s.mode === 'off') return null
  if (!s.company.nif) return t('the clinic has no NIF in Fiscal Data', 'la clínica no tiene NIF en Datos fiscales')
  if (!s.certificate) return t('no certificate has been uploaded', 'no se ha subido ningún certificado')
  if (!s.certificate.hasPassphrase) return t('the certificate’s password is missing -- upload it again', 'falta la contraseña del certificado: vuelve a subirlo')
  if (daysLeft.value !== null && daysLeft.value <= 0) return t('the certificate has expired', 'el certificado ha caducado')
  if (!s.platformKeyConfigured) return t('the platform key is not configured', 'la clave de la plataforma no está configurada')
  return null
})

function formatDateTime(iso: string | null) {
  return iso ? new Date(iso).toLocaleString('es-ES', { dateStyle: 'medium', timeStyle: 'short' }) : '—'
}
</script>

<template>
  <div class="flex h-full flex-col">
    <PageHeader title="VeriFactu" />
    <div class="flex-1 overflow-y-auto">
      <div class="flex gap-8 p-6">
        <SettingsNav />
        <div class="min-w-0 max-w-[720px] flex-1" data-cy="verifactu-settings">
          <p class="text-[13px] text-ink-muted2">
            {{ t("Every factura this clinic issues is recorded and chained for VeriFactu. This is where you decide whether those records go to the AEAT, to its test or its real service, and the certificate they are sent with. It applies to this clinic only.", 'Cada factura que emite esta clínica queda registrada y encadenada para VeriFactu. Aquí decides si esos registros se envían a la AEAT, a su servicio de pruebas o al real, y con qué certificado. Solo afecta a esta clínica.') }}
          </p>

          <p v-if="loadError" class="mt-4 rounded-card border border-danger-border bg-danger-bg px-4 py-3 text-[13px] text-danger-text">{{ loadError }}</p>
          <div v-else-if="!settings" class="mt-4 space-y-3">
            <UiSkeleton class="h-40 w-full rounded-card" />
            <UiSkeleton class="h-28 w-full rounded-card" />
          </div>

          <template v-else>
            <p v-if="notSendingBecause" data-cy="verifactu-not-sending" class="mt-4 rounded-card bg-warning-bg px-4 py-3 text-[13px] text-warning-text">
              {{ t('Nothing is being sent yet:', 'Todavía no se envía nada:') }} {{ notSendingBecause }}.
            </p>

            <!-- Sending ------------------------------------------------------------------>
            <section class="mt-4 rounded-card border border-line bg-surface p-4 shadow-card">
              <h2 class="text-[14px] font-semibold text-ink-900">{{ t('Sending to the AEAT', 'Envío a la AEAT') }}</h2>

              <div class="mt-3 space-y-2">
                <label class="flex cursor-pointer items-start gap-2.5 rounded-ctl border p-3" :class="[mode === 'off' ? 'border-brand bg-brand-tint' : 'border-line hover:bg-surface-subtle', settings.locked ? 'pointer-events-none opacity-50' : '']">
                  <input v-model="mode" type="radio" value="off" data-cy="verifactu-mode-off" :disabled="settings.locked" class="mt-0.5" />
                  <span>
                    <span class="block text-[13px] font-medium text-ink-900">{{ t('Off', 'Desactivado') }}</span>
                    <span class="mt-0.5 block text-[12px] text-ink-muted2">{{ t('Nothing is sent. Facturas are still recorded and chained, so switching on later sends the whole history.', 'No se envía nada. Las facturas se siguen registrando y encadenando, así que al activarlo más tarde se envía todo el historial.') }}</span>
                  </span>
                </label>
                <label class="flex cursor-pointer items-start gap-2.5 rounded-ctl border p-3" :class="[mode === 'test' ? 'border-brand bg-brand-tint' : 'border-line hover:bg-surface-subtle', settings.locked ? 'pointer-events-none opacity-50' : '']">
                  <input v-model="mode" type="radio" value="test" data-cy="verifactu-mode-test" :disabled="settings.locked" class="mt-0.5" />
                  <span>
                    <span class="block text-[13px] font-medium text-ink-900">{{ t('Test', 'Pruebas') }}</span>
                    <span class="mt-0.5 block text-[12px] text-ink-muted2">{{ t('Records go to the AEAT’s test service. Nothing counts fiscally; use it to check the set-up works.', 'Los registros van al servicio de pruebas de la AEAT. Nada tiene efecto fiscal; sirve para comprobar que todo funciona.') }}</span>
                  </span>
                </label>
                <label class="flex cursor-pointer items-start gap-2.5 rounded-ctl border p-3" :class="mode === 'live' ? 'border-brand bg-brand-tint' : 'border-line hover:bg-surface-subtle'">
                  <input v-model="mode" type="radio" value="live" data-cy="verifactu-mode-live" :disabled="settings.locked" class="mt-0.5" />
                  <span class="flex-1">
                    <span class="block text-[13px] font-medium text-ink-900">{{ t('Live from a date', 'En producción desde una fecha') }}</span>
                    <span class="mt-0.5 block text-[12px] text-ink-muted2">{{ t('Test service until that day, then the real one. From midnight (Madrid) that day, the first factura starts the real chain, with nothing from the test period before it.', 'Servicio de pruebas hasta ese día y el real a partir de entonces. Desde la medianoche (Madrid) de ese día, la primera factura inicia la cadena real, sin nada del periodo de pruebas por delante.') }}</span>
                    <input
                      v-if="mode === 'live'"
                      v-model="liveDay"
                      type="date"
                      data-cy="verifactu-live-date"
                      :min="settings.locked ? undefined : todayDay"
                      :disabled="settings.locked"
                      class="mt-2 rounded-ctlSm border border-line-control bg-surface px-2 py-1 text-[13px]"
                    />
                  </span>
                </label>
              </div>

              <p v-if="settings.locked" data-cy="verifactu-locked" class="mt-3 text-[12.5px] text-ink-muted">
                {{ t(`Live since ${liveDay}. The AEAT holds this clinic’s real chain, so the date is fixed and VeriFactu stays on.`, `En producción desde el ${liveDay}. La AEAT tiene la cadena real de esta clínica, así que la fecha es fija y VeriFactu permanece activo.`) }}
              </p>
              <UiBtn v-else variant="primary" class="mt-3" data-cy="verifactu-save" :disabled="!changed || saving" @click="save">
                {{ saving ? t('Saving…', 'Guardando…') : t('Save', 'Guardar') }}
              </UiBtn>
            </section>

            <!-- Company ---------------------------------------------------------------->
            <section class="mt-4 rounded-card border border-line bg-surface p-4 shadow-card">
              <div class="flex items-center justify-between gap-3">
                <h2 class="text-[14px] font-semibold text-ink-900">{{ t('Company', 'Empresa') }}</h2>
                <UiPill v-if="settings.company.nif && settings.company.legalName" tone="success">{{ t('Complete', 'Completo') }}</UiPill>
                <UiPill v-else tone="warning">{{ t('Incomplete', 'Incompleto') }}</UiPill>
              </div>
              <p class="mt-1 text-[13px] text-ink-700">{{ [settings.company.legalName, settings.company.nif].filter(Boolean).join(' · ') || t('No legal name or NIF yet', 'Aún sin razón social ni NIF') }}</p>
              <p class="mt-1 text-[12px] text-ink-muted2">
                {{ t('Every record names the company by its NIF. Edited in', 'Cada registro identifica a la empresa por su NIF. Se edita en') }}
                <NuxtLink to="/settings/fiscal-data" class="font-medium text-brand-text hover:text-brand-hover">{{ t('Fiscal Data', 'Datos fiscales') }}</NuxtLink>.
              </p>
            </section>

            <!-- Certificate ------------------------------------------------------------>
            <section class="mt-4 rounded-card border border-line bg-surface p-4 shadow-card" data-cy="verifactu-certificate">
              <div class="flex items-center justify-between gap-3">
                <h2 class="text-[14px] font-semibold text-ink-900">{{ t('Certificate', 'Certificado') }}</h2>
                <UiPill v-if="settings.certificate?.checks?.valid" tone="success" dot data-cy="verifactu-cert-status">{{ t('Valid', 'Válido') }}</UiPill>
                <UiPill v-else-if="settings.certificate" tone="warning" dot data-cy="verifactu-cert-status">{{ t('Needs attention', 'Requiere atención') }}</UiPill>
              </div>

              <!-- What "valid" is made of, one line each, so a warning says
              which part is wrong rather than leaving the owner to guess. -->
              <ul v-if="settings.certificate?.checks" data-cy="verifactu-cert-checks" class="mt-2 space-y-1 text-[12.5px]">
                <li :class="settings.certificate.checks.belongsToCompany === false ? 'text-danger-text' : 'text-ink-600'">
                  {{ settings.certificate.checks.belongsToCompany === false ? '✕' : settings.certificate.checks.belongsToCompany ? '✓' : '·' }}
                  {{
                    settings.certificate.checks.belongsToCompany === false
                      ? t(`It is not for this company (${settings.company.nif}).`, `No es de esta empresa (${settings.company.nif}).`)
                      : settings.certificate.checks.belongsToCompany
                        ? t(`Issued for this company (${settings.company.nif}).`, `Emitido para esta empresa (${settings.company.nif}).`)
                        : t('Add the NIF in Fiscal Data to check whose it is.', 'Añade el NIF en Datos fiscales para comprobar de quién es.')
                  }}
                </li>
                <li :class="settings.certificate.checks.expired ? 'text-danger-text' : 'text-ink-600'">
                  {{ settings.certificate.checks.expired ? '✕' : '✓' }}
                  {{ settings.certificate.checks.expired ? t('Expired.', 'Caducado.') : t(`In date${daysLeft !== null ? ` -- ${daysLeft} days left` : ''}.`, `Vigente${daysLeft !== null ? `: quedan ${daysLeft} días` : ''}.`) }}
                </li>
                <li :class="settings.certificate.checks.passwordOpens === false ? 'text-danger-text' : 'text-ink-600'">
                  {{ settings.certificate.checks.passwordOpens === false ? '✕' : settings.certificate.checks.passwordOpens ? '✓' : '·' }}
                  {{
                    settings.certificate.checks.passwordOpens === false
                      ? t('The stored password does not open it. Upload it again with its password.', 'La contraseña guardada no lo abre. Vuelve a subirlo con su contraseña.')
                      : settings.certificate.checks.passwordOpens
                        ? t('The stored password opens it.', 'La contraseña guardada lo abre.')
                        : t('The password cannot be checked until the platform key is configured.', 'La contraseña no se puede comprobar hasta que se configure la clave de la plataforma.')
                  }}
                </li>
                <li data-cy="verifactu-cert-aeat" :class="settings.certificate.checks.aeat.state === 'accepted' ? 'text-ink-600' : settings.certificate.checks.aeat.state === 'unused' ? 'text-ink-muted2' : 'text-warning-text'">
                  {{ settings.certificate.checks.aeat.state === 'accepted' ? '✓' : settings.certificate.checks.aeat.state === 'unused' ? '·' : '!' }}
                  <template v-if="settings.certificate.checks.aeat.state === 'accepted'">{{ t('The AEAT has accepted records sent with it', 'La AEAT ha aceptado registros enviados con él') }} ({{ formatDateTime(settings.certificate.checks.aeat.at) }}).</template>
                  <template v-else-if="settings.certificate.checks.aeat.state === 'refused'">
                    {{ t('The AEAT answered, so the connection works, but refused the last record', 'La AEAT respondió, así que la conexión funciona, pero rechazó el último registro') }} ({{ formatDateTime(settings.certificate.checks.aeat.at) }}): {{ settings.certificate.checks.aeat.message }}
                  </template>
                  <template v-else-if="settings.certificate.checks.aeat.state === 'unreachable'">
                    {{ t('Could not reach the AEAT with it', 'No se pudo conectar con la AEAT con él') }} ({{ formatDateTime(settings.certificate.checks.aeat.at) }}): {{ settings.certificate.checks.aeat.message }}
                  </template>
                  <template v-else>{{ t('Nothing has been sent with it yet.', 'Todavía no se ha enviado nada con él.') }}</template>
                </li>
              </ul>

              <div v-if="settings.certificate" class="mt-2 rounded-ctl bg-surface-subtle px-3 py-2 text-[13px]">
                <p class="font-medium text-ink-900">{{ settings.certificate.subject || t('Certificate on file', 'Certificado guardado') }}</p>
                <p class="mt-0.5 text-[12px] text-ink-muted2">
                  {{ settings.certificate.type === 'seal' ? t('Seal certificate', 'Certificado de sello') : t('Representative certificate', 'Certificado de representante') }}
                  <template v-if="settings.certificate.notAfter"> · {{ t('expires', 'caduca') }} {{ formatDateTime(settings.certificate.notAfter) }}</template>
                </p>
                <p v-if="daysLeft !== null && daysLeft <= 30" class="mt-1 text-[12px] font-medium text-warning-text">
                  {{ daysLeft <= 0 ? t('Expired. Upload the renewed one.', 'Caducado. Sube el renovado.') : t(`Expires in ${daysLeft} days. Upload the renewed one before then.`, `Caduca en ${daysLeft} días. Sube el renovado antes.`) }}
                </p>
                <p v-if="!settings.certificate.hasPassphrase" class="mt-1 text-[12px] font-medium text-warning-text">
                  {{ t('Its password is not stored here yet. Upload the certificate again with its password.', 'Su contraseña aún no está guardada aquí. Vuelve a subir el certificado con su contraseña.') }}
                </p>
              </div>
              <p v-else class="mt-1 text-[12.5px] text-ink-muted2">{{ t('No certificate yet.', 'Todavía no hay certificado.') }}</p>

              <p v-if="!settings.platformKeyConfigured" class="mt-3 text-[12px] text-warning-text">
                {{ t('Certificates cannot be stored until the platform key is configured. This is a one-time setting for QuiroFlow, not for your clinic.', 'No se pueden guardar certificados hasta que se configure la clave de la plataforma. Es un ajuste único de QuiroFlow, no de tu clínica.') }}
              </p>

              <form class="mt-3 grid gap-3 sm:grid-cols-2" @submit.prevent="uploadCertificate">
                <label class="flex flex-col gap-1 text-[12.5px] font-medium text-ink-600">
                  {{ t('Type', 'Tipo') }}
                  <select v-model="certType" class="h-8 rounded-ctl border border-line-control bg-surface px-2 text-[13px] text-ink-700">
                    <option value="representative">{{ t('Representative (FNMT “AC Representación”)', 'Representante (FNMT “AC Representación”)') }}</option>
                    <option value="seal">{{ t('Company seal', 'Sello de empresa') }}</option>
                  </select>
                </label>
                <label class="flex flex-col gap-1 text-[12.5px] font-medium text-ink-600">
                  {{ t('File (.p12 or .pfx)', 'Archivo (.p12 o .pfx)') }}
                  <input ref="fileInput" type="file" accept=".p12,.pfx,application/x-pkcs12" data-cy="verifactu-cert-file" class="text-[12.5px]" @change="onFile" />
                </label>
                <label class="flex flex-col gap-1 text-[12.5px] font-medium text-ink-600 sm:col-span-2">
                  {{ t('Certificate password', 'Contraseña del certificado') }}
                  <input v-model="certPassword" type="password" autocomplete="off" data-cy="verifactu-cert-password" class="h-8 max-w-[280px] rounded-ctl border border-line-control bg-surface px-3 text-[13px]" />
                  <span class="text-[11.5px] font-normal text-ink-faint">{{ t('Checked against the file before it is stored, then kept encrypted. It is never shown again.', 'Se comprueba con el archivo antes de guardarlo y se conserva cifrada. No se vuelve a mostrar.') }}</span>
                </label>
                <div class="sm:col-span-2">
                  <UiBtn type="submit" variant="secondary" data-cy="verifactu-cert-upload" :disabled="!certFile || !certPassword || uploading || !settings.platformKeyConfigured">
                    {{ uploading ? t('Checking…', 'Comprobando…') : settings.certificate ? t('Replace certificate', 'Sustituir certificado') : t('Upload certificate', 'Subir certificado') }}
                  </UiBtn>
                </div>
              </form>
            </section>

            <!-- Activity --------------------------------------------------------------->
            <section class="mt-4 rounded-card border border-line bg-surface p-4 shadow-card" data-cy="verifactu-activity">
              <h2 class="text-[14px] font-semibold text-ink-900">{{ t('Activity', 'Actividad') }}</h2>
              <dl class="mt-2 grid grid-cols-2 gap-x-6 gap-y-1.5 text-[13px] sm:grid-cols-4">
                <div><dt class="text-[11.5px] text-ink-muted2">{{ t('Waiting to send', 'Pendientes de envío') }}</dt><dd class="font-semibold text-ink-900">{{ settings.activity.waiting }}</dd></div>
                <div><dt class="text-[11.5px] text-ink-muted2">{{ t('Refused 10+ times', 'Rechazados 10+ veces') }}</dt><dd class="font-semibold" :class="settings.activity.parked ? 'text-danger-text' : 'text-ink-900'">{{ settings.activity.parked }}</dd></div>
                <div><dt class="text-[11.5px] text-ink-muted2">{{ t('Test records', 'Registros de prueba') }}</dt><dd class="font-semibold text-ink-900">{{ settings.activity.testRecords }}</dd></div>
                <div><dt class="text-[11.5px] text-ink-muted2">{{ t('Real records', 'Registros reales') }}</dt><dd class="font-semibold text-ink-900">{{ settings.activity.productionRecords }}</dd></div>
              </dl>
              <p v-if="settings.activity.last" class="mt-3 text-[12.5px] text-ink-muted">
                {{ t('Last answer from the AEAT:', 'Última respuesta de la AEAT:') }}
                <span class="font-medium text-ink-700">{{ settings.activity.last.status }}</span>
                · {{ formatDateTime(settings.activity.last.sentAt) }}
                <span v-if="settings.activity.last.errorCode"> · {{ settings.activity.last.errorCode }} {{ settings.activity.last.errorMessage }}</span>
              </p>
              <p v-else class="mt-3 text-[12.5px] text-ink-muted2">{{ t('Nothing has been sent yet.', 'Todavía no se ha enviado nada.') }}</p>
            </section>
          </template>
        </div>
      </div>
    </div>
  </div>
</template>
