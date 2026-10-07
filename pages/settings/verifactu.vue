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
  fee: { monthlyCentsPerLocation: number; locations: number; billedLocations: number } | null
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

function euros(cents: number) {
  return (cents / 100).toLocaleString('es-ES', { style: 'currency', currency: 'EUR' })
}
// "7,50 € + IVA per location per month -- 2 locations: 15,00 € a month."
const feeText = computed(() => {
  const fee = settings.value?.fee
  if (!fee) return null
  const each = euros(fee.monthlyCentsPerLocation)
  const total = euros(fee.monthlyCentsPerLocation * fee.locations)
  return t(
    `From that day VeriFactu costs ${each} + IVA per location per month, added to your subscription (${fee.locations} ${fee.locations === 1 ? 'location' : 'locations'}: ${total} a month).`,
    `Desde ese día VeriFactu cuesta ${each} + IVA por centro y mes, que se añade a tu suscripción (${fee.locations} ${fee.locations === 1 ? 'centro' : 'centros'}: ${total} al mes).`,
  )
})

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
      ) + (feeText.value ? `\n\n${feeText.value}` : ''),
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
  if (!s.company.nif) return t('the clinic has no NIF in Invoicing › Fiscal data', 'la clínica no tiene NIF en Facturación › Datos fiscales')
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

// --- the page's summary: one sentence, then four facts ------------------------
function madridDate(iso: string) {
  return new Date(iso).toLocaleDateString('es-ES', { timeZone: 'Europe/Madrid', day: 'numeric', month: 'long', year: 'numeric' })
}
const liveInFuture = computed(() => !!settings.value?.productionFrom && new Date(settings.value.productionFrom).getTime() > Date.now())
const daysToLive = computed(() => (settings.value?.productionFrom ? Math.ceil((new Date(settings.value.productionFrom).getTime() - Date.now()) / 86_400_000) : null))

const status = computed<{ tone: 'warning' | 'neutral' | 'brand' | 'success'; title: string; detail: string } | null>(() => {
  const s = settings.value
  if (!s) return null
  if (notSendingBecause.value) return { tone: 'warning', title: t('Nothing is being sent yet', 'Todavía no se envía nada'), detail: notSendingBecause.value }
  if (s.mode === 'off') return { tone: 'neutral', title: t('VeriFactu is off', 'VeriFactu está desactivado'), detail: t('Facturas are still recorded and chained, so switching on later sends the whole history.', 'Las facturas se siguen registrando y encadenando, así que al activarlo se envía todo el historial.') }
  if (s.mode === 'test' || liveInFuture.value) {
    return {
      tone: 'brand',
      title: t('Sending to the AEAT’s test service', 'Enviando al servicio de pruebas de la AEAT'),
      detail:
        s.mode === 'live' && s.productionFrom
          ? t(`Goes live on ${madridDate(s.productionFrom)}, in ${daysToLive.value} days.`, `Pasa a producción el ${madridDate(s.productionFrom)}, dentro de ${daysToLive.value} días.`)
          : t('Nothing counts fiscally yet.', 'Todavía nada tiene efecto fiscal.'),
    }
  }
  return { tone: 'success', title: t('Sending to the AEAT', 'Enviando a la AEAT'), detail: s.productionFrom ? t(`Live since ${madridDate(s.productionFrom)}.`, `En producción desde el ${madridDate(s.productionFrom)}.`) : '' }
})

const facts = computed(() => {
  const s = settings.value
  if (!s) return []
  const senderLabel = {
    own_certificate: t('Your own certificate', 'Tu propio certificado'),
    apoderamiento: t('QuiroFlow, by AEAT authorisation', 'QuiroFlow, con autorización de la AEAT'),
    colaboracion_social: t('QuiroFlow, by signed document', 'QuiroFlow, con documento firmado'),
  }[s.sender]
  const certOk = s.sender !== 'own_certificate' || !!s.certificate?.checks?.valid
  return [
    {
      key: 'company',
      label: t('Company', 'Empresa'),
      value: s.company.legalName || t('No legal name yet', 'Sin razón social'),
      sub: s.company.nif || t('No NIF yet', 'Sin NIF'),
      ok: !!(s.company.nif && s.company.legalName),
      href: '/settings/invoicing#fiscal',
    },
    {
      key: 'sender',
      label: t('Who sends', 'Quién envía'),
      value: senderLabel,
      sub: s.sender === 'own_certificate' ? t('Change below', 'Cámbialo abajo') : s.delegation?.acceptedAt ? t('Authorised', 'Autorizado') : t('Waiting for authorisation', 'Pendiente de autorización'),
      ok: s.sender === 'own_certificate' || !!s.delegation?.acceptedAt,
      href: s.platform ? '#sender' : '#certificate',
    },
    {
      key: 'certificate',
      label: t('Certificate', 'Certificado'),
      value: s.sender !== 'own_certificate' ? t('QuiroFlow’s', 'El de QuiroFlow') : !s.certificate ? t('None yet', 'Ninguno') : certOk ? t('Valid', 'Válido') : t('Needs attention', 'Requiere atención'),
      sub: s.sender === 'own_certificate' && daysLeft.value !== null ? t(`${daysLeft.value} days left`, `Quedan ${daysLeft.value} días`) : '',
      ok: certOk,
      href: '#certificate',
    },
    {
      key: 'sending',
      label: t('Sending', 'Envío'),
      value: s.mode === 'off' ? t('Off', 'Desactivado') : s.mode === 'test' ? t('Test only', 'Solo pruebas') : liveInFuture.value ? t(`Live from ${madridDate(s.productionFrom!)}`, `Producción desde ${madridDate(s.productionFrom!)}`) : t('Live', 'Producción'),
      sub: s.mode === 'live' && liveInFuture.value ? t('Test until then', 'Pruebas hasta entonces') : '',
      ok: s.mode !== 'off',
      href: '#sending',
    },
  ]
})
</script>


<template>
  <div class="flex h-full flex-col">
    <PageHeader title="VeriFactu">
      <UiPill tone="neutral">
        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="5" y="11" width="14" height="9" rx="2" /><path d="M8 11V8a4 4 0 0 1 8 0v3" /></svg>
        {{ t('Owners only', 'Solo propietarios') }}
      </UiPill>
    </PageHeader>
    <div class="flex-1 overflow-y-auto">
      <div class="flex gap-8 p-4 pb-24 sm:px-6 sm:pt-6 lg:pb-6">
        <SettingsNav />
        <div class="flex min-w-0 max-w-[900px] flex-1 flex-col gap-4" data-cy="verifactu-settings">
          <p class="text-[13.5px] leading-snug text-ink-muted">
            {{ t('Every factura this clinic issues is recorded and chained for VeriFactu. Here you decide whether those records go to the AEAT, to its test or its real service, and whose certificate sends them.', 'Cada factura que emite esta clínica se registra y encadena para VeriFactu. Aquí decides si esos registros van a la AEAT, a su servicio de pruebas o al real, y con qué certificado se envían.') }}
          </p>

          <p v-if="loadError" class="rounded-card border border-danger-border bg-danger-bg px-4 py-3 text-[13px] text-danger-text">{{ loadError }}</p>
          <template v-else-if="!settings">
            <UiSkeleton class="h-24 w-full rounded-card" />
            <UiSkeleton class="h-24 w-full rounded-card" />
            <UiSkeleton class="h-40 w-full rounded-card" />
          </template>

          <template v-else>
            <!-- Where things stand, in one sentence. -->
            <section
              v-if="status"
              aria-labelledby="h-status"
              class="flex flex-wrap items-center gap-4 rounded-card border px-[22px] py-5"
              :class="{
                'border-warning-border bg-warning-bg': status.tone === 'warning',
                'border-line bg-surface': status.tone === 'neutral',
                'border-brand-tintBorder bg-brand-tint': status.tone === 'brand',
                'border-success-border bg-success-bg': status.tone === 'success',
              }"
            >
              <span
                class="flex h-12 w-12 shrink-0 items-center justify-center rounded-full bg-surface"
                :class="{ 'text-warning-text': status.tone === 'warning', 'text-ink-muted': status.tone === 'neutral', 'text-brand-text': status.tone === 'brand', 'text-success-text': status.tone === 'success' }"
                aria-hidden="true"
              >
                <svg v-if="status.tone === 'warning'" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"><path d="M12 7v6M12 17h.01" /></svg>
                <svg v-else width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 3l8 4v5c0 5-3.5 8-8 9-4.5-1-8-4-8-9V7z" /><path v-if="status.tone !== 'neutral'" d="M9 12l2 2 4-4" /></svg>
              </span>
              <div class="flex min-w-[240px] flex-1 flex-col gap-1">
                <h2 id="h-status" class="text-[19px] font-bold text-ink-900">{{ status.title }}</h2>
                <p v-if="notSendingBecause" data-cy="verifactu-not-sending" class="text-[14px] text-warning-text">{{ t('Nothing is being sent yet:', 'Todavía no se envía nada:') }} {{ notSendingBecause }}.</p>
                <p v-else class="text-[14px] text-ink-500">{{ status.detail }}</p>
              </div>
              <a href="#activity" class="inline-flex h-9 touch:h-11 items-center rounded-ctl border border-line-control bg-surface px-3.5 text-[13px] font-medium text-ink-500 hover:border-line-controlHover">{{ t('See activity', 'Ver actividad') }}</a>
            </section>

            <!-- The set-up, as four facts. -->
            <div class="grid grid-cols-2 gap-2.5 lg:grid-cols-4" data-cy="verifactu-facts">
              <component
                :is="f.href.startsWith('/') ? 'NuxtLink' : 'a'"
                v-for="f in facts"
                :key="f.key"
                :to="f.href.startsWith('/') ? f.href : undefined"
                :href="f.href.startsWith('/') ? undefined : f.href"
                class="flex min-w-0 flex-col gap-1.5 rounded-card border border-line bg-surface px-4 py-3.5 hover:border-line-controlHover"
              >
                <span class="flex items-center gap-2">
                  <span class="flex h-[22px] w-[22px] shrink-0 items-center justify-center rounded-full" :class="f.ok ? 'bg-success-bg text-success-text' : 'bg-warning-bg text-warning-text'" aria-hidden="true">
                    <svg v-if="f.ok" width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"><path d="M5 12l5 5L20 7" /></svg>
                    <svg v-else width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round"><path d="M12 7v6M12 17h.01" /></svg>
                  </span>
                  <span class="text-[12px] font-bold uppercase tracking-[.04em] text-ink-muted">{{ f.label }}</span>
                </span>
                <strong class="truncate text-[14px] text-ink-900">{{ f.value }}</strong>
                <span v-if="f.sub" class="truncate text-[12.5px] text-ink-muted">{{ f.sub }}</span>
              </component>
            </div>

            <!-- Sending ------------------------------------------------------------>
            <section id="sending" aria-labelledby="h-send" class="scroll-mt-4 overflow-hidden rounded-card border border-line bg-surface">
              <div class="px-[18px] pb-3 pt-4">
                <h2 id="h-send" class="text-[16px] font-bold text-ink-900">{{ t('Sending to the AEAT', 'Envío a la AEAT') }}</h2>
              </div>
              <fieldset class="grid grid-cols-1 gap-2.5 px-[18px] pb-4 md:grid-cols-3" :disabled="settings.locked">
                <legend class="sr-only">{{ t('Sending mode', 'Modo de envío') }}</legend>
                <label
                  v-for="opt in [
                    { value: 'off', cy: 'verifactu-mode-off', title: t('Off', 'Desactivado'), text: t('Nothing is sent. Facturas are still recorded and chained, so switching on later sends the whole history.', 'No se envía nada. Las facturas se siguen registrando y encadenando, así que al activarlo se envía todo el historial.') },
                    { value: 'test', cy: 'verifactu-mode-test', title: t('Test only', 'Solo pruebas'), text: t('The AEAT’s test service. Nothing counts fiscally; use it to check the set-up works.', 'El servicio de pruebas de la AEAT. Nada tiene efecto fiscal; sirve para comprobar que la configuración funciona.') },
                    { value: 'live', cy: 'verifactu-mode-live', title: t('Live from a date', 'En producción desde una fecha'), text: t('Test until that day, then the real service. From midnight (Madrid) that day, the first factura starts the real chain.', 'Pruebas hasta ese día y después el servicio real. Desde la medianoche (Madrid) de ese día, la primera factura inicia la cadena real.') },
                  ]"
                  :key="opt.value"
                  class="flex cursor-pointer flex-col gap-1.5 rounded-[10px] border p-3.5"
                  :class="[mode === opt.value ? 'border-[1.5px] border-brand bg-brand-tint' : 'border-line hover:bg-surface-subtle', settings.locked && opt.value !== 'live' ? 'pointer-events-none opacity-50' : '']"
                >
                  <span class="flex items-center gap-2">
                    <input v-model="mode" type="radio" :value="opt.value" :data-cy="opt.cy" :disabled="settings.locked" class="h-4 w-4 accent-brand" />
                    <strong class="text-[14px] text-ink-900">{{ opt.title }}</strong>
                  </span>
                  <span class="text-[12.5px] leading-snug text-ink-500">{{ opt.text }}</span>
                  <input
                    v-if="opt.value === 'live' && mode === 'live'"
                    v-model="liveDay"
                    type="date"
                    data-cy="verifactu-live-date"
                    :aria-label="t('Live from', 'En producción desde')"
                    :min="settings.locked ? undefined : todayDay"
                    :disabled="settings.locked"
                    class="mt-1 h-9 touch:h-11 rounded-ctl border border-line-control bg-surface px-3 text-[14px] text-ink-900"
                  />
                </label>
              </fieldset>
              <div class="flex flex-wrap items-center gap-3 border-t border-line-row bg-surface-subtle px-[18px] py-3">
                <span v-if="settings.locked" data-cy="verifactu-locked" class="flex-1 text-[13px] text-ink-500">
                  {{ t(`Live since ${liveDay}. The AEAT holds this clinic’s real chain, so the date is fixed and VeriFactu stays on.`, `En producción desde el ${liveDay}. La AEAT tiene la cadena real de esta clínica, así que la fecha es fija y VeriFactu permanece activo.`) }}
                </span>
                <span v-else-if="feeText" data-cy="verifactu-fee" class="flex-1 text-[13px] text-ink-500">{{ feeText }}</span>
                <span v-else class="flex-1" />
                <UiBtn v-if="!settings.locked" variant="primary" data-cy="verifactu-save" :disabled="!changed || saving" @click="save">
                  {{ saving ? t('Saving…', 'Guardando…') : t('Save', 'Guardar') }}
                </UiBtn>
              </div>
            </section>

            <!-- Who sends ------------------------------------------------------------->
            <section v-if="settings.platform" id="sender" aria-labelledby="h-who" class="scroll-mt-4 overflow-hidden rounded-card border border-line bg-surface" data-cy="verifactu-sender">
              <div class="flex items-start gap-3 px-[18px] pb-3 pt-4">
                <div class="flex-1">
                  <h2 id="h-who" class="text-[16px] font-bold text-ink-900">{{ t('Who sends', 'Quién envía') }}</h2>
                  <p class="mt-1 text-[13px] text-ink-muted">{{ t('Records always name your company as the issuer. This only decides whose certificate sends them to the AEAT.', 'Los registros siempre identifican a tu empresa como emisora. Esto solo decide con qué certificado se envían a la AEAT.') }}</p>
                </div>
                <template v-if="settings.sender !== 'own_certificate'">
                  <UiPill v-if="settings.delegation?.acceptedAt" tone="success" dot data-cy="verifactu-delegation-status">{{ t('Authorised', 'Autorizado') }}</UiPill>
                  <UiPill v-else tone="warning" dot data-cy="verifactu-delegation-status">{{ t('Waiting for authorisation', 'Pendiente de autorización') }}</UiPill>
                </template>
              </div>
              <fieldset class="flex flex-col gap-2 px-[18px] pb-4">
                <legend class="sr-only">{{ t('Who sends', 'Quién envía') }}</legend>
                <label
                  v-for="opt in [
                    { value: 'own_certificate', cy: 'verifactu-sender-own', title: t('Your own certificate', 'Tu propio certificado'), text: t('Upload your company’s certificate below. You renew it when it expires.', 'Sube abajo el certificado de tu empresa. Lo renuevas cuando caduque.') },
                    { value: 'apoderamiento', cy: 'verifactu-sender-apoderamiento', title: t('QuiroFlow sends for you, with an AEAT authorisation', 'QuiroFlow envía por ti, con autorización de la AEAT'), text: t('You authorise QuiroFlow once in the AEAT’s online office (apoderamiento IZ860). No certificate to upload or renew.', 'Autorizas a QuiroFlow una vez en la sede electrónica de la AEAT (apoderamiento IZ860). Sin certificado que subir ni renovar.') },
                    { value: 'colaboracion_social', cy: 'verifactu-sender-colaboracion', title: t('QuiroFlow sends for you, with a signed document', 'QuiroFlow envía por ti, con un documento firmado'), text: t('You sign a representation document for QuiroFlow as a colaborador social of the AEAT, and upload it here. No certificate to upload or renew.', 'Firmas un documento de representación a favor de QuiroFlow como colaborador social de la AEAT y lo subes aquí. Sin certificado que subir ni renovar.') },
                  ]"
                  :key="opt.value"
                  class="flex cursor-pointer gap-3 rounded-[10px] border p-3.5"
                  :class="sender === opt.value ? 'border-[1.5px] border-brand bg-brand-tint' : 'border-line hover:bg-surface-subtle'"
                >
                  <input v-model="sender" type="radio" :value="opt.value" :data-cy="opt.cy" class="mt-0.5 h-4 w-4 shrink-0 accent-brand" />
                  <span class="flex flex-col gap-0.5">
                    <strong class="text-[14px] text-ink-900">{{ opt.title }}</strong>
                    <span class="text-[12.5px] leading-snug text-ink-500">{{ opt.text }}</span>
                  </span>
                </label>
                <div v-if="sender !== settings.sender">
                  <UiBtn variant="primary" data-cy="verifactu-sender-save" :disabled="savingSender" @click="saveSender">{{ savingSender ? t('Saving…', 'Guardando…') : t('Save', 'Guardar') }}</UiBtn>
                </div>

                <!-- Route A: the steps at the AEAT, with QuiroFlow's details filled in. -->
                <div v-if="settings.sender === 'apoderamiento' && sender === 'apoderamiento'" class="rounded-ctl bg-surface-subtle px-3.5 py-3 text-[13px] text-ink-700" data-cy="verifactu-apoderamiento-steps">
                  <p class="font-semibold text-ink-900">{{ t('What to do at the AEAT', 'Qué hacer en la AEAT') }}</p>
                  <ol class="mt-1.5 list-decimal space-y-1 pl-5">
                    <li>{{ t('Your company’s legal representative, with their certificate, opens the AEAT online office → Registro de Apoderamientos → “Apoderamiento para un trámite concreto”.', 'El representante legal de tu empresa, con su certificado, entra en la sede electrónica de la AEAT → Registro de Apoderamientos → «Apoderamiento para un trámite concreto».') }}</li>
                    <li>
                      {{ t('Authorised party (apoderado):', 'Apoderado:') }}
                      <span class="font-semibold" data-cy="verifactu-platform-identity">{{ [settings.platform.legalName, settings.platform.nif].filter(Boolean).join(' · ') }}</span>
                    </li>
                    <li>{{ t('Procedure: IZ860 — “Remisión y consulta de registros de facturación por servicio web” (listed under IVA). Not IZ862 or IZ863: they look alike and the AEAT refuses the records.', 'Trámite: IZ860 — «Remisión y consulta de registros de facturación por servicio web» (en IVA). No IZ862 ni IZ863: se parecen y la AEAT rechaza los registros.') }}</li>
                    <li>{{ t('QuiroFlow then accepts it at the AEAT and confirms it here. Records start going as soon as it does.', 'Después QuiroFlow lo acepta en la AEAT y lo confirma aquí. Los registros empiezan a enviarse en ese momento.') }}</li>
                  </ol>
                </div>

                <!-- Route B: the signed document. -->
                <div v-if="settings.sender === 'colaboracion_social' && sender === 'colaboracion_social'" class="rounded-ctl bg-surface-subtle px-3.5 py-3 text-[13px] text-ink-700" data-cy="verifactu-colaboracion-steps">
                  <p class="font-semibold text-ink-900">{{ t('The representation document', 'El documento de representación') }}</p>
                  <p class="mt-1">
                    {{ t('Fill in the model representation document of the', 'Rellena el modelo de documento de representación de la') }}
                    <a href="https://www.boe.es/buscar/doc.php?id=BOE-A-2024-27600" target="_blank" rel="noopener" class="font-medium text-brand-text hover:text-brand-hover">Resolución de 18 de diciembre de 2024 (BOE-A-2024-27600)</a>
                    {{ t('naming', 'a favor de') }} <span class="font-semibold">{{ [settings.platform.legalName, settings.platform.nif].filter(Boolean).join(' · ') }}</span>{{ t(', have your legal representative sign it — by hand with a copy of their ID, or with a qualified electronic signature — and upload the PDF.', ', haz que lo firme tu representante legal —a mano con copia de su DNI, o con firma electrónica cualificada— y sube el PDF.') }}
                  </p>
                  <p v-if="settings.delegation?.signedDocumentUploadedAt" class="mt-2 flex items-center gap-1.5 text-ink-500" data-cy="verifactu-signed-document">
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round" class="text-success-text" aria-hidden="true"><path d="M5 12l5 5L20 7" /></svg>
                    {{ settings.delegation.signedDocumentName }} · {{ formatDateTime(settings.delegation.signedDocumentUploadedAt) }}
                  </p>
                  <form class="mt-2 flex flex-wrap items-center gap-2" @submit.prevent="uploadSignedDocument">
                    <input ref="docInput" type="file" accept="application/pdf,.pdf" data-cy="verifactu-signed-document-file" class="text-[12.5px]" @change="docFile = ($event.target as HTMLInputElement).files?.[0] ?? null" />
                    <UiBtn type="submit" data-cy="verifactu-signed-document-upload" :disabled="!docFile || uploadingDoc">
                      {{ uploadingDoc ? t('Uploading…', 'Subiendo…') : settings.delegation?.signedDocumentUploadedAt ? t('Replace document', 'Sustituir documento') : t('Upload signed document', 'Subir documento firmado') }}
                    </UiBtn>
                  </form>
                  <p v-if="settings.delegation?.acceptedAt" class="mt-1.5 text-[12.5px] text-warning-text" data-cy="verifactu-replace-warning">
                    {{ t('Replacing it sends it back to QuiroFlow for confirmation, and nothing is sent to the AEAT for you until it is confirmed again.', 'Sustituirlo lo devuelve a QuiroFlow para confirmarlo, y no se envía nada a la AEAT por ti hasta que se confirme de nuevo.') }}
                  </p>
                </div>

                <p v-if="settings.sender !== 'own_certificate' && settings.delegation?.acceptedAt" class="text-[13px] text-ink-muted">
                  {{ t('QuiroFlow confirmed your authorisation on', 'QuiroFlow confirmó tu autorización el') }} {{ formatDateTime(settings.delegation.acceptedAt) }}.
                </p>
              </fieldset>
            </section>

            <!-- Certificate ------------------------------------------------------------>
            <p v-if="settings.sender !== 'own_certificate'" id="certificate" class="scroll-mt-4 rounded-card border border-line bg-surface px-[18px] py-4 text-[13.5px] text-ink-500" data-cy="verifactu-certificate-by-quiroflow">
              {{ t('Your records are sent with QuiroFlow’s certificate, so you do not need one of your own here.', 'Tus registros se envían con el certificado de QuiroFlow, así que aquí no necesitas uno propio.') }}
            </p>
            <section v-else id="certificate" aria-labelledby="h-cert" class="scroll-mt-4 overflow-hidden rounded-card border border-line bg-surface" data-cy="verifactu-certificate">
              <div class="flex items-center gap-2.5 px-[18px] pb-3 pt-4">
                <h2 id="h-cert" class="flex-1 text-[16px] font-bold text-ink-900">{{ t('Certificate', 'Certificado') }}</h2>
                <UiPill v-if="settings.certificate?.checks?.valid" tone="success" dot data-cy="verifactu-cert-status">{{ t('Valid', 'Válido') }}</UiPill>
                <UiPill v-else-if="settings.certificate" tone="warning" dot data-cy="verifactu-cert-status">{{ t('Needs attention', 'Requiere atención') }}</UiPill>
              </div>

              <div v-if="settings.certificate" class="mx-[18px] flex items-center gap-3.5 rounded-ctl border border-line-row bg-surface-subtle px-3.5 py-3">
                <span class="flex h-9 w-9 shrink-0 items-center justify-center rounded-ctl bg-brand-tint text-brand-text" aria-hidden="true">
                  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="9" r="5" /><path d="M9 13.5L8 21l4-2 4 2-1-7.5" /></svg>
                </span>
                <div class="flex min-w-0 flex-1 flex-col gap-0.5">
                  <strong class="truncate text-[14px] text-ink-900">{{ settings.certificate.subject || t('Certificate on file', 'Certificado guardado') }}</strong>
                  <span class="text-[12.5px] text-ink-muted">
                    {{ settings.certificate.type === 'seal' ? t('Seal certificate', 'Certificado de sello') : t('Representative certificate', 'Certificado de representante') }}
                    <template v-if="settings.certificate.notAfter"> · {{ t('expires', 'caduca') }} {{ formatDateTime(settings.certificate.notAfter) }}</template>
                  </span>
                </div>
              </div>
              <p v-else class="px-[18px] text-[13.5px] text-ink-muted">{{ t('No certificate yet.', 'Todavía no hay certificado.') }}</p>

              <!-- What "valid" is made of, one line each, so a warning says
                   which part is wrong rather than leaving the owner to guess. -->
              <ul v-if="settings.certificate?.checks" data-cy="verifactu-cert-checks" class="flex flex-col gap-2 px-[18px] pt-3 text-[13.5px]">
                <li class="flex gap-2.5" :class="settings.certificate.checks.belongsToCompany === false ? 'text-danger-text' : 'text-ink-700'">
                  <VerifactuCheckMark :state="settings.certificate.checks.belongsToCompany === false ? 'bad' : settings.certificate.checks.belongsToCompany ? 'good' : 'unknown'" />
                  <span>{{
                    settings.certificate.checks.belongsToCompany === false
                      ? t(`It is not for this company (${settings.company.nif}).`, `No es de esta empresa (${settings.company.nif}).`)
                      : settings.certificate.checks.belongsToCompany
                        ? t(`Issued for this company (${settings.company.nif}).`, `Emitido para esta empresa (${settings.company.nif}).`)
                        : t('Add the NIF in Invoicing to check whose it is.', 'Añade el NIF en Facturación para comprobar de quién es.')
                  }}</span>
                </li>
                <li class="flex gap-2.5" :class="settings.certificate.checks.expired ? 'text-danger-text' : 'text-ink-700'">
                  <VerifactuCheckMark :state="settings.certificate.checks.expired ? 'bad' : 'good'" />
                  <span>{{ settings.certificate.checks.expired ? t('Expired.', 'Caducado.') : t(`In date${daysLeft !== null ? ` -- ${daysLeft} days left` : ''}.`, `Vigente${daysLeft !== null ? `: quedan ${daysLeft} días` : ''}.`) }}</span>
                </li>
                <li class="flex gap-2.5" :class="settings.certificate.checks.passwordOpens === false ? 'text-danger-text' : 'text-ink-700'">
                  <VerifactuCheckMark :state="settings.certificate.checks.passwordOpens === false ? 'bad' : settings.certificate.checks.passwordOpens ? 'good' : 'unknown'" />
                  <span>{{
                    settings.certificate.checks.passwordOpens === false
                      ? t('The stored password does not open it. Upload it again with its password.', 'La contraseña guardada no lo abre. Vuelve a subirlo con su contraseña.')
                      : settings.certificate.checks.passwordOpens
                        ? t('The stored password opens it.', 'La contraseña guardada lo abre.')
                        : t('The password cannot be checked until the platform key is configured.', 'La contraseña no se puede comprobar hasta que se configure la clave de la plataforma.')
                  }}</span>
                </li>
                <li data-cy="verifactu-cert-aeat" class="flex gap-2.5" :class="settings.certificate.checks.aeat.state === 'accepted' ? 'text-ink-700' : settings.certificate.checks.aeat.state === 'unused' ? 'text-ink-muted' : 'text-warning-text'">
                  <VerifactuCheckMark :state="settings.certificate.checks.aeat.state === 'accepted' ? 'good' : settings.certificate.checks.aeat.state === 'unused' ? 'unknown' : 'warn'" />
                  <span>
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
                  </span>
                </li>
              </ul>

              <div v-if="settings.certificate && (daysLeft !== null && daysLeft <= 30 || !settings.certificate.hasPassphrase)" class="mx-[18px] mt-3 flex flex-col gap-1 rounded-ctl bg-warning-bg px-3.5 py-2.5 text-[13px] font-medium text-warning-text">
                <span v-if="daysLeft !== null && daysLeft <= 30">{{ daysLeft <= 0 ? t('Expired. Upload the renewed one.', 'Caducado. Sube el renovado.') : t(`Expires in ${daysLeft} days. Upload the renewed one before then.`, `Caduca en ${daysLeft} días. Sube el renovado antes.`) }}</span>
                <span v-if="!settings.certificate.hasPassphrase">{{ t('Its password is not stored here yet. Upload the certificate again with its password.', 'Su contraseña aún no está guardada aquí. Vuelve a subir el certificado con su contraseña.') }}</span>
              </div>

              <p v-if="!settings.platformKeyConfigured" class="mx-[18px] mt-3 text-[12.5px] text-warning-text">
                {{ t('Certificates cannot be stored until the platform key is configured. This is a one-time setting for QuiroFlow, not for your clinic.', 'No se pueden guardar certificados hasta que se configure la clave de la plataforma. Es un ajuste único de QuiroFlow, no de tu clínica.') }}
              </p>

              <details class="mt-4 border-t border-line" :open="!settings.certificate">
                <summary class="flex min-h-[48px] cursor-pointer list-none items-center gap-2 px-[18px] text-[13.5px] font-semibold text-ink-500 hover:bg-surface-subtle">
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M9 6l6 6-6 6" /></svg>
                  {{ settings.certificate ? t('Replace the certificate', 'Sustituir el certificado') : t('Upload a certificate', 'Subir un certificado') }}
                </summary>
                <form class="grid grid-cols-[minmax(0,1fr)] gap-3 px-[18px] pb-4 sm:grid-cols-2" @submit.prevent="uploadCertificate">
                  <label class="flex flex-col gap-1.5 text-[13px] font-semibold text-ink-700">
                    {{ t('Type', 'Tipo') }}
                    <select v-model="certType" class="h-9 touch:h-11 rounded-ctl border border-line-control bg-surface px-2 text-[14px] font-normal text-ink-900">
                      <option value="representative">{{ t('Representative (FNMT “AC Representación”)', 'Representante (FNMT “AC Representación”)') }}</option>
                      <option value="seal">{{ t('Company seal', 'Sello de empresa') }}</option>
                    </select>
                  </label>
                  <label class="flex flex-col gap-1.5 text-[13px] font-semibold text-ink-700">
                    {{ t('File (.p12 or .pfx)', 'Archivo (.p12 o .pfx)') }}
                    <input ref="fileInput" type="file" accept=".p12,.pfx,application/x-pkcs12" data-cy="verifactu-cert-file" class="text-[13px] font-normal" @change="onFile" />
                  </label>
                  <label class="flex flex-col gap-1.5 text-[13px] font-semibold text-ink-700 sm:col-span-2">
                    {{ t('Certificate password', 'Contraseña del certificado') }}
                    <input v-model="certPassword" type="password" autocomplete="off" data-cy="verifactu-cert-password" class="h-9 touch:h-11 max-w-[320px] rounded-ctl border border-line-control bg-surface px-3 text-[14px] font-normal" />
                    <span class="text-[12px] font-normal text-ink-muted">{{ t('Checked against the file before it is stored, then kept encrypted. It is never shown again.', 'Se comprueba con el archivo antes de guardarlo y se conserva cifrada. No se vuelve a mostrar.') }}</span>
                  </label>
                  <div class="sm:col-span-2">
                    <UiBtn type="submit" data-cy="verifactu-cert-upload" :disabled="!certFile || !certPassword || uploading || !settings.platformKeyConfigured">
                      {{ uploading ? t('Checking…', 'Comprobando…') : settings.certificate ? t('Replace certificate', 'Sustituir certificado') : t('Upload certificate', 'Subir certificado') }}
                    </UiBtn>
                  </div>
                </form>
              </details>
            </section>

            <!-- Activity --------------------------------------------------------------->
            <section id="activity" aria-labelledby="h-act" class="scroll-mt-4 overflow-hidden rounded-card border border-line bg-surface" data-cy="verifactu-activity">
              <div class="px-[18px] pb-3 pt-4">
                <h2 id="h-act" class="text-[16px] font-bold text-ink-900">{{ t('Activity', 'Actividad') }}</h2>
              </div>
              <dl class="grid grid-cols-2 gap-2.5 px-[18px] pb-3.5 sm:grid-cols-4">
                <div v-for="stat in [
                  { label: t('Waiting to send', 'Pendientes de envío'), value: settings.activity.waiting, bad: false },
                  { label: t('Refused 10+ times', 'Rechazados 10+ veces'), value: settings.activity.parked, bad: settings.activity.parked > 0 },
                  { label: t('Test records', 'Registros de prueba'), value: settings.activity.testRecords, bad: false },
                  { label: t('Real records', 'Registros reales'), value: settings.activity.productionRecords, bad: false },
                ]" :key="stat.label" class="flex flex-col gap-1 rounded-ctl border border-line-row bg-surface-subtle px-3.5 py-3">
                  <dt class="text-[12.5px] text-ink-muted">{{ stat.label }}</dt>
                  <dd class="text-[22px] font-[640]" :class="stat.bad ? 'text-danger-text' : 'text-ink-900'">{{ stat.value }}</dd>
                </div>
              </dl>
              <p v-if="settings.activity.last" class="border-t border-line-row px-[18px] py-3 text-[13px] text-ink-500">
                {{ t('Last answer from the AEAT:', 'Última respuesta de la AEAT:') }}
                <span data-cy="verifactu-last-answer" class="font-semibold" :class="settings.activity.last.kind.startsWith('accepted') ? 'text-success-text' : 'text-ink-700'">{{ lastAnswerLabel }}</span>
                · {{ formatDateTime(settings.activity.last.sentAt) }}
                <span v-if="settings.activity.last.kind !== 'accepted' && (settings.activity.last.errorCode || settings.activity.last.errorMessage)">
                  · {{ [settings.activity.last.errorCode, settings.activity.last.errorMessage].filter(Boolean).join(' ') }}
                </span>
              </p>
              <p v-else class="border-t border-line-row px-[18px] py-3 text-[13px] text-ink-muted">{{ t('Nothing has been sent yet.', 'Todavía no se ha enviado nada.') }}</p>
              <p v-if="settings.activity.last?.notAuthorised" data-cy="verifactu-not-authorised" class="mx-[18px] mb-3.5 rounded-ctl bg-warning-bg px-3.5 py-2.5 text-[13px] text-warning-text">
                {{
                  settings.sender === 'own_certificate'
                    ? t('The AEAT says this certificate is not allowed to send for your company’s NIF. Check it belongs to your company, or that its holder is authorised to represent it.', 'La AEAT indica que este certificado no puede enviar por el NIF de tu empresa. Comprueba que sea de tu empresa o que su titular esté autorizado para representarla.')
                    : t('The AEAT says QuiroFlow is not yet authorised to send for your company. Check the apoderamiento was granted for procedure IZ860 (not IZ862/IZ863) to QuiroFlow’s NIF; QuiroFlow has been told.', 'La AEAT indica que QuiroFlow aún no está autorizado para enviar por tu empresa. Comprueba que el apoderamiento se otorgó para el trámite IZ860 (no IZ862/IZ863) al NIF de QuiroFlow; QuiroFlow ya está avisado.')
                }}
              </p>
            </section>

            <!-- QuiroFlow's own account: the clinics it sends for ------------------------->
            <section v-if="settings.isPlatform" aria-labelledby="h-plat" class="overflow-hidden rounded-card border-[1.5px] border-dashed border-line-controlHover" data-cy="verifactu-delegations">
              <div class="px-[18px] pb-3 pt-4">
                <span class="text-[12px] font-bold uppercase tracking-[.05em] text-ink-muted">{{ t('Only QuiroFlow sees this', 'Solo lo ve QuiroFlow') }}</span>
                <h2 id="h-plat" class="mt-1 text-[16px] font-bold text-ink-900">{{ t(`Clinics QuiroFlow sends for · ${delegations.length}`, `Clínicas por las que envía QuiroFlow · ${delegations.length}`) }}</h2>
                <p class="mt-1 text-[13px] text-ink-muted">
                  {{ t('Confirm a clinic once its IZ860 has been accepted in the AEAT’s office, or its signed document has been checked. Its records then go with this account’s certificate.', 'Confirma una clínica cuando su IZ860 se haya aceptado en la sede de la AEAT, o se haya revisado su documento firmado. Sus registros se envían entonces con el certificado de esta cuenta.') }}
                </p>
              </div>
              <p v-if="!delegations.length" class="border-t border-line bg-surface px-[18px] py-4 text-[13px] text-ink-muted">{{ t('No clinic has asked yet.', 'Ninguna clínica lo ha pedido aún.') }}</p>
              <div v-for="d in delegations" :key="d.accountId" class="flex flex-wrap items-center gap-3 border-t border-line bg-surface px-[18px] py-3" data-cy="verifactu-delegation-row">
                <div class="flex min-w-0 flex-1 flex-col gap-0.5">
                  <strong class="text-[14.5px] text-ink-900">{{ d.clinicName || t('Unnamed clinic', 'Clínica sin nombre') }} <span class="font-normal text-ink-muted">· {{ d.nif || t('no NIF', 'sin NIF') }}</span></strong>
                  <span class="text-[12.5px] text-ink-muted">
                    {{ d.route === 'apoderamiento' ? t('Apoderamiento IZ860', 'Apoderamiento IZ860') : t('Signed document', 'Documento firmado') }}
                    · {{ t('asked', 'pedido') }} {{ formatDateTime(d.requestedAt) }}
                    <template v-if="d.acceptedAt"> · {{ t('confirmed', 'confirmado') }} {{ formatDateTime(d.acceptedAt) }}</template>
                  </span>
                </div>
                <UiPill v-if="!d.acceptedAt" tone="warning">{{ t('Waiting', 'Pendiente') }}</UiPill>
                <UiBtn v-if="d.route === 'colaboracion_social' && d.signedDocumentUploadedAt" size="sm" @click="downloadSignedDocument(d)">{{ t('Document', 'Documento') }}</UiBtn>
                <UiBtn v-if="!d.acceptedAt" variant="primary" size="sm" data-cy="verifactu-delegation-accept" :disabled="decidingFor === d.accountId || (d.route === 'colaboracion_social' && !d.signedDocumentUploadedAt)" @click="setAccepted(d, true)">{{ t('Confirm', 'Confirmar') }}</UiBtn>
                <UiBtn v-else size="sm" data-cy="verifactu-delegation-withdraw" :disabled="decidingFor === d.accountId" @click="setAccepted(d, false)">{{ t('Withdraw', 'Retirar') }}</UiBtn>
              </div>
            </section>
          </template>
        </div>
      </div>
    </div>
  </div>
</template>
