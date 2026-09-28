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
type Sender = 'own_certificate' | 'apoderamiento' | 'colaboracion_social'
interface Delegation {
  route: 'apoderamiento' | 'colaboracion_social'
  requestedAt: string
  signedDocumentName: string | null
  signedDocumentUploadedAt: string | null
  acceptedAt: string | null
}
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
      aeat: { state: 'accepted' | 'refused' | 'aeat-error' | 'unreachable' | 'unused'; at: string | null; message: string | null }
      valid: boolean
    } | null
  } | null
  platformKeyConfigured: boolean
  sender: Sender
  platform: { nif: string | null; legalName: string | null } | null
  isPlatform: boolean
  delegation: Delegation | null
  activity: {
    waiting: number
    parked: number
    testRecords: number
    productionRecords: number
    last: {
      status: string
      notAuthorised: boolean
      kind: 'accepted' | 'accepted-with-warnings' | 'refused' | 'aeat-error' | 'unreachable'
      errorCode: string | null
      errorMessage: string | null
      sentAt: string | null
    } | null
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
    sender.value = settings.value.sender
    if (settings.value.isPlatform) await loadDelegations()
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

// --- Who sends -----------------------------------------------------------------
// The clinic's own certificate, or QuiroFlow's under one of the two
// authorisations the AEAT accepts. Choosing QuiroFlow files a request; the
// records go with QuiroFlow's certificate once QuiroFlow confirms the
// authorisation, since until then the AEAT refuses every one with 4112.
const sender = ref<Sender>('own_certificate')
const savingSender = ref(false)

async function saveSender() {
  if (!settings.value || sender.value === settings.value.sender) return
  savingSender.value = true
  try {
    await useStaffFetch('/api/verifactu/sender', { method: 'PUT', body: { sender: sender.value } })
    showToast(t('Saved', 'Guardado'))
    await load()
  } catch (e: any) {
    showToast(e?.data?.statusMessage || e?.message || t('Could not save.', 'No se pudo guardar.'), 'error')
  } finally {
    savingSender.value = false
  }
}

const docFile = ref<File | null>(null)
const docInput = ref<HTMLInputElement | null>(null)
const uploadingDoc = ref(false)

async function uploadSignedDocument() {
  if (!docFile.value) return
  uploadingDoc.value = true
  try {
    const fileBase64 = await fileToBase64(docFile.value)
    await useStaffFetch('/api/verifactu/delegation-document', { method: 'POST', body: { fileBase64, fileName: docFile.value.name } })
    showToast(t('Document uploaded', 'Documento subido'))
    docFile.value = null
    if (docInput.value) docInput.value.value = ''
    await load()
  } catch (e: any) {
    showToast(e?.data?.statusMessage || e?.message || t('Could not upload the document.', 'No se pudo subir el documento.'), 'error')
  } finally {
    uploadingDoc.value = false
  }
}

// --- QuiroFlow's own account: the clinics it sends for -------------------------
interface PlatformDelegation extends Delegation {
  accountId: string
  clinicName: string | null
  nif: string | null
}
const delegations = ref<PlatformDelegation[]>([])
const decidingFor = ref<string | null>(null)

async function loadDelegations() {
  try {
    const res = await useStaffFetch<{ delegations: PlatformDelegation[] }>('/api/verifactu/delegations')
    delegations.value = res.delegations
  } catch {
    delegations.value = []
  }
}

async function setAccepted(d: PlatformDelegation, accepted: boolean) {
  if (accepted) {
    const ok = confirm(
      d.route === 'apoderamiento'
        ? t(`Confirm that QuiroFlow has ACCEPTED the IZ860 apoderamiento from ${d.clinicName ?? d.nif} in the AEAT’s office. From now on its records are sent with QuiroFlow’s certificate.`, `Confirma que QuiroFlow ha ACEPTADO el apoderamiento IZ860 de ${d.clinicName ?? d.nif} en la sede de la AEAT. Desde ahora sus registros se envían con el certificado de QuiroFlow.`)
        : t(`Confirm that the signed document from ${d.clinicName ?? d.nif} has been checked. From now on its records are sent with QuiroFlow’s certificate.`, `Confirma que se ha revisado el documento firmado de ${d.clinicName ?? d.nif}. Desde ahora sus registros se envían con el certificado de QuiroFlow.`),
    )
    if (!ok) return
  }
  decidingFor.value = d.accountId
  try {
    await useStaffFetch(`/api/verifactu/delegations/${d.accountId}`, { method: 'PUT', body: { accepted } })
    await loadDelegations()
  } catch (e: any) {
    showToast(e?.data?.statusMessage || e?.message || t('Could not save.', 'No se pudo guardar.'), 'error')
  } finally {
    decidingFor.value = null
  }
}

async function downloadSignedDocument(d: PlatformDelegation) {
  const blob = await useStaffFetch<Blob>(`/api/verifactu/delegations/${d.accountId}/document`, { responseType: 'blob' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = d.signedDocumentName ?? 'documento-representacion.pdf'
  a.click()
  URL.revokeObjectURL(url)
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
  if (s.sender !== 'own_certificate') {
    if (s.sender === 'colaboracion_social' && !s.delegation?.signedDocumentUploadedAt) return t('the signed representation document has not been uploaded', 'no se ha subido el documento de representación firmado')
    if (!s.delegation?.acceptedAt) return t('QuiroFlow has not confirmed your authorisation yet', 'QuiroFlow aún no ha confirmado tu autorización')
    return null
  }
  if (!s.certificate) return t('no certificate has been uploaded', 'no se ha subido ningún certificado')
  if (!s.certificate.hasPassphrase) return t('the certificate’s password is missing -- upload it again', 'falta la contraseña del certificado: vuelve a subirlo')
  if (daysLeft.value !== null && daysLeft.value <= 0) return t('the certificate has expired', 'el certificado ha caducado')
  if (!s.platformKeyConfigured) return t('the platform key is not configured', 'la clave de la plataforma no está configurada')
  return null
})

// The AEAT's status words ("Incorrecto", "transport_error") mean nothing at
// a clinic's front desk; say what happened.
const lastAnswerLabel = computed(() => {
  const kind = settings.value?.activity.last?.kind
  return {
    accepted: t('Accepted', 'Aceptado'),
    'accepted-with-warnings': t('Accepted with warnings', 'Aceptado con avisos'),
    refused: t('Refused', 'Rechazado'),
    'aeat-error': t('AEAT internal error', 'Error interno de la AEAT'),
    unreachable: t('Not reached', 'Sin conexión'),
  }[kind ?? 'unreachable']
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

            <!-- Who sends ------------------------------------------------------------->
            <section v-if="settings.platform" class="mt-4 rounded-card border border-line bg-surface p-4 shadow-card" data-cy="verifactu-sender">
              <div class="flex items-center justify-between gap-3">
                <h2 class="text-[14px] font-semibold text-ink-900">{{ t('Who sends', 'Quién envía') }}</h2>
                <template v-if="settings.sender !== 'own_certificate'">
                  <UiPill v-if="settings.delegation?.acceptedAt" tone="success" dot data-cy="verifactu-delegation-status">{{ t('Authorised', 'Autorizado') }}</UiPill>
                  <UiPill v-else tone="warning" dot data-cy="verifactu-delegation-status">{{ t('Waiting for authorisation', 'Pendiente de autorización') }}</UiPill>
                </template>
              </div>
              <p class="mt-1 text-[12px] text-ink-muted2">
                {{ t('Records always name your company as the issuer. This only decides whose certificate sends them to the AEAT.', 'Los registros siempre identifican a tu empresa como emisora. Esto solo decide con qué certificado se envían a la AEAT.') }}
              </p>

              <div class="mt-3 space-y-2">
                <label class="flex cursor-pointer items-start gap-2.5 rounded-ctl border p-3" :class="sender === 'own_certificate' ? 'border-brand bg-brand-tint' : 'border-line hover:bg-surface-subtle'">
                  <input v-model="sender" type="radio" value="own_certificate" data-cy="verifactu-sender-own" class="mt-0.5" />
                  <span>
                    <span class="block text-[13px] font-medium text-ink-900">{{ t('Your own certificate', 'Tu propio certificado') }}</span>
                    <span class="mt-0.5 block text-[12px] text-ink-muted2">{{ t('Upload your company’s certificate below. You renew it when it expires.', 'Sube abajo el certificado de tu empresa. Lo renuevas cuando caduque.') }}</span>
                  </span>
                </label>
                <label class="flex cursor-pointer items-start gap-2.5 rounded-ctl border p-3" :class="sender === 'apoderamiento' ? 'border-brand bg-brand-tint' : 'border-line hover:bg-surface-subtle'">
                  <input v-model="sender" type="radio" value="apoderamiento" data-cy="verifactu-sender-apoderamiento" class="mt-0.5" />
                  <span>
                    <span class="block text-[13px] font-medium text-ink-900">{{ t('QuiroFlow sends for you — AEAT authorisation', 'QuiroFlow envía por ti — autorización en la AEAT') }}</span>
                    <span class="mt-0.5 block text-[12px] text-ink-muted2">{{ t('You authorise QuiroFlow once in the AEAT’s online office (apoderamiento IZ860). No certificate to upload or renew.', 'Autorizas a QuiroFlow una vez en la sede electrónica de la AEAT (apoderamiento IZ860). Sin certificado que subir ni renovar.') }}</span>
                  </span>
                </label>
                <label class="flex cursor-pointer items-start gap-2.5 rounded-ctl border p-3" :class="sender === 'colaboracion_social' ? 'border-brand bg-brand-tint' : 'border-line hover:bg-surface-subtle'">
                  <input v-model="sender" type="radio" value="colaboracion_social" data-cy="verifactu-sender-colaboracion" class="mt-0.5" />
                  <span>
                    <span class="block text-[13px] font-medium text-ink-900">{{ t('QuiroFlow sends for you — signed document', 'QuiroFlow envía por ti — documento firmado') }}</span>
                    <span class="mt-0.5 block text-[12px] text-ink-muted2">{{ t('You sign a representation document for QuiroFlow as a colaborador social of the AEAT, and upload it here. No certificate to upload or renew.', 'Firmas un documento de representación a favor de QuiroFlow como colaborador social de la AEAT y lo subes aquí. Sin certificado que subir ni renovar.') }}</span>
                  </span>
                </label>
              </div>
              <UiBtn v-if="sender !== settings.sender" variant="primary" class="mt-3" data-cy="verifactu-sender-save" :disabled="savingSender" @click="saveSender">
                {{ savingSender ? t('Saving…', 'Guardando…') : t('Save', 'Guardar') }}
              </UiBtn>

              <!-- Route A: the steps at the AEAT, with QuiroFlow's details filled in. -->
              <div v-if="settings.sender === 'apoderamiento' && sender === 'apoderamiento'" class="mt-4 rounded-ctl bg-surface-subtle px-3 py-3 text-[12.5px] text-ink-700" data-cy="verifactu-apoderamiento-steps">
                <p class="font-medium text-ink-900">{{ t('What to do at the AEAT', 'Qué hacer en la AEAT') }}</p>
                <ol class="mt-1.5 list-decimal space-y-1 pl-5">
                  <li>{{ t('Your company’s legal representative, with their certificate, opens the AEAT online office → Registro de Apoderamientos → “Apoderamiento para un trámite concreto”.', 'El representante legal de tu empresa, con su certificado, entra en la sede electrónica de la AEAT → Registro de Apoderamientos → «Apoderamiento para un trámite concreto».') }}</li>
                  <li>
                    {{ t('Authorised party (apoderado):', 'Apoderado:') }}
                    <span class="font-medium" data-cy="verifactu-platform-identity">{{ [settings.platform.legalName, settings.platform.nif].filter(Boolean).join(' · ') }}</span>
                  </li>
                  <li>{{ t('Procedure: IZ860 — “Remisión y consulta de registros de facturación por servicio web” (listed under IVA). Not IZ862 or IZ863: they look alike and the AEAT refuses the records.', 'Trámite: IZ860 — «Remisión y consulta de registros de facturación por servicio web» (en IVA). No IZ862 ni IZ863: se parecen y la AEAT rechaza los registros.') }}</li>
                  <li>{{ t('QuiroFlow then accepts it at the AEAT and confirms it here. Records start going as soon as it does.', 'Después QuiroFlow lo acepta en la AEAT y lo confirma aquí. Los registros empiezan a enviarse en ese momento.') }}</li>
                </ol>
              </div>

              <!-- Route B: the signed document. -->
              <div v-if="settings.sender === 'colaboracion_social' && sender === 'colaboracion_social'" class="mt-4 rounded-ctl bg-surface-subtle px-3 py-3 text-[12.5px] text-ink-700" data-cy="verifactu-colaboracion-steps">
                <p class="font-medium text-ink-900">{{ t('The representation document', 'El documento de representación') }}</p>
                <p class="mt-1">
                  {{ t('Fill in the model representation document of the', 'Rellena el modelo de documento de representación de la') }}
                  <a href="https://www.boe.es/buscar/doc.php?id=BOE-A-2024-27600" target="_blank" rel="noopener" class="font-medium text-brand-text hover:text-brand-hover">Resolución de 18 de diciembre de 2024 (BOE-A-2024-27600)</a>
                  {{ t('naming', 'a favor de') }} <span class="font-medium">{{ [settings.platform.legalName, settings.platform.nif].filter(Boolean).join(' · ') }}</span>{{ t(', have your legal representative sign it — by hand with a copy of their ID, or with a qualified electronic signature — and upload the PDF.', ', haz que lo firme tu representante legal —a mano con copia de su DNI, o con firma electrónica cualificada— y sube el PDF.') }}
                </p>
                <p v-if="settings.delegation?.signedDocumentUploadedAt" class="mt-2 text-ink-600" data-cy="verifactu-signed-document">
                  ✓ {{ settings.delegation.signedDocumentName }} · {{ formatDateTime(settings.delegation.signedDocumentUploadedAt) }}
                </p>
                <form class="mt-2 flex flex-wrap items-center gap-2" @submit.prevent="uploadSignedDocument">
                  <input ref="docInput" type="file" accept="application/pdf,.pdf" data-cy="verifactu-signed-document-file" class="text-[12.5px]" @change="docFile = ($event.target as HTMLInputElement).files?.[0] ?? null" />
                  <UiBtn type="submit" variant="secondary" data-cy="verifactu-signed-document-upload" :disabled="!docFile || uploadingDoc">
                    {{ uploadingDoc ? t('Uploading…', 'Subiendo…') : settings.delegation?.signedDocumentUploadedAt ? t('Replace document', 'Sustituir documento') : t('Upload signed document', 'Subir documento firmado') }}
                  </UiBtn>
                </form>
              </div>

              <p v-if="settings.sender !== 'own_certificate' && settings.delegation?.acceptedAt" class="mt-3 text-[12.5px] text-ink-muted">
                {{ t('QuiroFlow confirmed your authorisation on', 'QuiroFlow confirmó tu autorización el') }} {{ formatDateTime(settings.delegation.acceptedAt) }}.
              </p>
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
            <p v-if="settings.sender !== 'own_certificate'" class="mt-4 rounded-card border border-line bg-surface p-4 text-[12.5px] text-ink-muted shadow-card" data-cy="verifactu-certificate-by-quiroflow">
              {{ t('Your records are sent with QuiroFlow’s certificate, so you do not need one of your own here.', 'Tus registros se envían con el certificado de QuiroFlow, así que aquí no necesitas uno propio.') }}
            </p>
            <section v-else class="mt-4 rounded-card border border-line bg-surface p-4 shadow-card" data-cy="verifactu-certificate">
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
                  <template v-else-if="settings.certificate.checks.aeat.state === 'aeat-error'">
                    {{ t('The AEAT answered, so the connection works, but its own service had an internal error', 'La AEAT respondió, así que la conexión funciona, pero su propio servicio tuvo un error interno') }} ({{ formatDateTime(settings.certificate.checks.aeat.at) }}): {{ settings.certificate.checks.aeat.message }}.
                    {{ t('This is on the AEAT’s side; QuiroFlow keeps trying every minute.', 'Es un problema de la AEAT; QuiroFlow sigue intentándolo cada minuto.') }}
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
                <span data-cy="verifactu-last-answer" class="font-medium text-ink-700">{{ lastAnswerLabel }}</span>
                · {{ formatDateTime(settings.activity.last.sentAt) }}
                <span v-if="settings.activity.last.kind !== 'accepted' && (settings.activity.last.errorCode || settings.activity.last.errorMessage)">
                  · {{ [settings.activity.last.errorCode, settings.activity.last.errorMessage].filter(Boolean).join(' ') }}
                </span>
              </p>
              <p v-if="settings.activity.last?.notAuthorised" data-cy="verifactu-not-authorised" class="mt-2 rounded-ctl bg-warning-bg px-3 py-2 text-[12.5px] text-warning-text">
                {{
                  settings.sender === 'own_certificate'
                    ? t('The AEAT says this certificate is not allowed to send for your company’s NIF. Check it belongs to your company, or that its holder is authorised to represent it.', 'La AEAT indica que este certificado no puede enviar por el NIF de tu empresa. Comprueba que es de tu empresa o que su titular está autorizado para representarla.')
                    : t('The AEAT says QuiroFlow is not yet authorised to send for your company. Check the apoderamiento was granted for procedure IZ860 (not IZ862/IZ863) to QuiroFlow’s NIF; QuiroFlow has been told.', 'La AEAT indica que QuiroFlow aún no está autorizado para enviar por tu empresa. Comprueba que el apoderamiento se concedió para el trámite IZ860 (no IZ862/IZ863) al NIF de QuiroFlow; QuiroFlow ya está avisado.')
                }}
              </p>
              <p v-else class="mt-3 text-[12.5px] text-ink-muted2">{{ t('Nothing has been sent yet.', 'Todavía no se ha enviado nada.') }}</p>
            </section>
            <!-- QuiroFlow's own account: the clinics it sends for ------------------------->
            <section v-if="settings.isPlatform" class="mt-4 rounded-card border border-line bg-surface p-4 shadow-card" data-cy="verifactu-delegations">
              <h2 class="text-[14px] font-semibold text-ink-900">{{ t('Clinics QuiroFlow sends for', 'Clínicas por las que envía QuiroFlow') }}</h2>
              <p class="mt-1 text-[12px] text-ink-muted2">
                {{ t('Only QuiroFlow sees this. Confirm a clinic once its IZ860 has been accepted in the AEAT’s office, or its signed document has been checked. Its records then go with this account’s certificate.', 'Solo lo ve QuiroFlow. Confirma una clínica cuando su IZ860 esté aceptado en la sede de la AEAT o su documento firmado esté revisado. Sus registros se envían entonces con el certificado de esta cuenta.') }}
              </p>
              <p v-if="!delegations.length" class="mt-3 text-[12.5px] text-ink-muted2">{{ t('No clinic has asked yet.', 'Ninguna clínica lo ha pedido aún.') }}</p>
              <ul v-else class="mt-3 divide-y divide-line">
                <li v-for="d in delegations" :key="d.accountId" class="flex flex-wrap items-center justify-between gap-2 py-2.5" data-cy="verifactu-delegation-row">
                  <div class="min-w-0">
                    <p class="text-[13px] font-medium text-ink-900">{{ d.clinicName || t('Unnamed clinic', 'Clínica sin nombre') }} <span class="font-normal text-ink-muted2">· {{ d.nif || t('no NIF', 'sin NIF') }}</span></p>
                    <p class="text-[12px] text-ink-muted2">
                      {{ d.route === 'apoderamiento' ? t('Apoderamiento IZ860', 'Apoderamiento IZ860') : t('Signed document', 'Documento firmado') }}
                      · {{ t('asked', 'pedido') }} {{ formatDateTime(d.requestedAt) }}
                      <template v-if="d.acceptedAt"> · {{ t('confirmed', 'confirmado') }} {{ formatDateTime(d.acceptedAt) }}</template>
                    </p>
                  </div>
                  <div class="flex items-center gap-2">
                    <UiBtn v-if="d.route === 'colaboracion_social' && d.signedDocumentUploadedAt" variant="secondary" size="sm" @click="downloadSignedDocument(d)">{{ t('Document', 'Documento') }}</UiBtn>
                    <UiBtn v-if="!d.acceptedAt" variant="primary" size="sm" data-cy="verifactu-delegation-accept" :disabled="decidingFor === d.accountId || (d.route === 'colaboracion_social' && !d.signedDocumentUploadedAt)" @click="setAccepted(d, true)">{{ t('Confirm', 'Confirmar') }}</UiBtn>
                    <UiBtn v-else variant="secondary" size="sm" data-cy="verifactu-delegation-withdraw" :disabled="decidingFor === d.accountId" @click="setAccepted(d, false)">{{ t('Withdraw', 'Retirar') }}</UiBtn>
                  </div>
                </li>
              </ul>
            </section>
          </template>
        </div>
      </div>
    </div>
  </div>
</template>
