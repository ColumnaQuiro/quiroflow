<script setup lang="ts">
// Brings each submitted form's signed original across from PracticeHub.
//
// The Form responses step imports what the patient answered, but PracticeHub's
// API gives a signature or a drawing only as the widget's id: the image exists
// solely in the PDF its website renders for a signed-in member of staff. So
// this step asks for the clinic's own PracticeHub sign-in, and the server
// fetches each PDF and files it with the patient (server/utils/
// practicehubFormPdfs.ts).
//
// Unlike every other step it does not need this page: the work runs on the
// server and carries on with the tab closed. All this does is start it, pass
// along the verification code PracticeHub may ask for, and show where it is.
const t = useT()

interface Status {
  hasAddress: boolean
  email: string | null
  connected: boolean
  code: { method: 'app' | 'email'; phone: string | null } | null
  job: { status: 'idle' | 'running' | 'needs_code' | 'stopped' | 'failed' | 'done'; cursor: number; patients: number; stored: number; unmatched: number; failed: number; error: string | null; updatedAt: string | null }
  forms: number
  originals: number
}

const status = ref<Status | null>(null)
const busy = ref(false)
const error = ref('')
const email = ref('')
const password = ref('')
const code = ref('')
const changing = ref(false)
const resent = ref(false)

async function call(body: Record<string, unknown>): Promise<boolean> {
  error.value = ''
  try {
    status.value = await useStaffFetch<Status>('/api/import/practicehub-web', { method: 'POST', body })
    return true
  } catch (e: any) {
    error.value = e?.data?.statusMessage ?? e?.statusMessage ?? e?.message ?? String(e)
    return false
  }
}

async function act(body: Record<string, unknown>) {
  busy.value = true
  const ok = await call(body)
  busy.value = false
  return ok
}

async function connect() {
  if (!email.value.trim() || !password.value) return
  if (await act({ op: 'connect', email: email.value.trim(), password: password.value })) {
    password.value = ''
    changing.value = false
  }
}

async function sendCode() {
  if (await act({ op: 'code', code: code.value })) code.value = ''
}

async function resend(via: 'email' | 'sms') {
  resent.value = await act({ op: 'resend', via })
}

async function forget() {
  if (await act({ op: 'forget' })) {
    email.value = ''
    changing.value = false
  }
}

// The templates the Form responses step left behind were guessed from one
// patient's answers. PracticeHub's form editor has each form exactly, so with
// the sign-in saved the server can rebuild them: a real signature block, the
// drawable image with its picture, every option. A few forms per call.
interface TemplateSync {
  total: number
  next: number | null
  updated: number
  created: number
  skipped: number
  failed: string[]
}
const templatesBusy = ref(false)
const templatesDone = ref<{ updated: number; created: number; failed: string[] } | null>(null)

async function rebuildTemplates() {
  templatesBusy.value = true
  templatesDone.value = null
  error.value = ''
  const sum = { updated: 0, created: 0, failed: [] as string[] }
  try {
    for (let after: number | null = 0; after !== null; ) {
      const answer: Status & { templates: TemplateSync | null } = await useStaffFetch<Status & { templates: TemplateSync | null }>('/api/import/practicehub-web', { method: 'POST', body: { op: 'templates', after } })
      status.value = answer
      // PracticeHub asked for a code instead: the prompt above takes over.
      if (!answer.templates) return
      sum.updated += answer.templates.updated
      sum.created += answer.templates.created
      sum.failed.push(...answer.templates.failed)
      after = answer.templates.next
    }
    templatesDone.value = sum
  } catch (e: any) {
    error.value = e?.data?.statusMessage ?? e?.statusMessage ?? e?.message ?? String(e)
  } finally {
    templatesBusy.value = false
  }
}

const running = computed(() => status.value?.job.status === 'running')
const pct = computed(() => {
  const job = status.value?.job
  return !job || job.patients === 0 ? 0 : Math.min(100, Math.round((job.cursor / job.patients) * 100))
})
const missing = computed(() => Math.max(0, (status.value?.forms ?? 0) - (status.value?.originals ?? 0)))

// The job reports to the server, not to this page, so the page asks. Only
// while something can change without a click here.
let timer: ReturnType<typeof setInterval> | null = null
watch(
  () => running.value || Boolean(status.value?.code),
  (live) => {
    if (timer) clearInterval(timer)
    timer = live ? setInterval(() => call({ op: 'status' }), 4000) : null
  },
)
onBeforeUnmount(() => {
  if (timer) clearInterval(timer)
})

onMounted(() => call({ op: 'status' }))

const fieldId = useId()
const inputClass = 'mt-1 w-full rounded-md border border-line-control bg-surface px-3 py-2 text-sm text-ink-900 focus:border-brand focus:outline-none focus:ring-1 focus:ring-brand'

const introLead = computed(() => t('Brings the signed original of every imported form across from PracticeHub, as a PDF with the signature, the drawings, the date and the IP address it was submitted from. Run Form responses first: an original is filed with the form it belongs to.', 'Trae de PracticeHub el original firmado de cada formulario importado, como PDF con la firma, los dibujos, la fecha y la dirección IP desde la que se envió. Ejecuta antes Respuestas de formularios: cada original se guarda con el formulario al que pertenece.'))
const introNotes = computed(() => [
  { title: t('Why it needs your PracticeHub sign-in.', 'Por qué necesita tu acceso a PracticeHub.'), body: t('The API key does not reach signatures. PracticeHub only shows them to someone signed in to its website, so QuiroFlow signs in as you, reads the forms and nothing else. The password is kept on the server, where nobody at the clinic can read it back, and is never shown again.', 'La clave API no llega a las firmas. PracticeHub solo las muestra a quien ha iniciado sesión en su web, así que QuiroFlow entra como tú, lee los formularios y nada más. La contraseña se guarda en el servidor, donde nadie de la clínica puede volver a leerla, y no se muestra de nuevo.') },
  { title: t('You can close this page.', 'Puedes cerrar esta página.'), body: t('Once started it runs on its own, here or with everything closed. Come back to see how far it got.', 'Una vez iniciado funciona solo, aquí o con todo cerrado. Vuelve cuando quieras para ver por dónde va.') },
  { title: t('Safe to run again.', 'Se puede volver a ejecutar.'), body: t('An original already here is never downloaded twice.', 'Un original que ya está aquí nunca se descarga dos veces.') },
])
</script>

<template>
  <div data-cy="ph-signed-forms">
    <ImportIntro :lead="introLead" :notes="introNotes" />

    <div v-if="!status" class="mt-4 rounded-card border border-line bg-surface p-8 text-center text-[13px] text-ink-muted2">
      {{ error || t('Loading…', 'Cargando…') }}
    </div>

    <div v-else-if="!status.hasAddress" class="mt-4 rounded-card border border-line bg-surface p-4 text-[13px] text-ink-700">
      {{ t('Save your PracticeHub address under Connection first.', 'Guarda antes la dirección de tu PracticeHub en Conexión.') }}
    </div>

    <template v-else>
      <!-- A code PracticeHub is waiting for. Above everything else: nothing moves until it is typed. -->
      <form v-if="status.code" class="mt-4 max-w-md space-y-3 rounded-card border border-warning-border bg-warning-bg p-4" data-cy="ph-web-code" @submit.prevent="sendCode">
        <p class="text-[13px] font-medium text-ink-900">{{ t('PracticeHub is asking for a verification code', 'PracticeHub pide un código de verificación') }}</p>
        <p class="text-[12.5px] text-ink-700">
          {{ status.code.method === 'app'
            ? t('Enter the code from the authenticator app you use for PracticeHub.', 'Escribe el código de la aplicación de autenticación que usas con PracticeHub.')
            : t(`PracticeHub has just sent a code to ${status.email}. Enter it here.`, `PracticeHub acaba de enviar un código a ${status.email}. Escríbelo aquí.`) }}
        </p>
        <div>
          <label :for="`${fieldId}-code`" class="block text-sm font-medium text-ink-700">{{ t('Verification code', 'Código de verificación') }}</label>
          <input :id="`${fieldId}-code`" v-model="code" type="text" inputmode="numeric" autocomplete="one-time-code" required :class="inputClass" data-cy="ph-web-code-input" />
        </div>
        <div class="flex flex-wrap items-center gap-3">
          <UiBtn variant="primary" type="submit" :disabled="busy">{{ t('Confirm code', 'Confirmar código') }}</UiBtn>
          <template v-if="status.code.method === 'email'">
            <button type="button" class="text-sm font-medium text-ink-600 hover:underline" :disabled="busy" @click="resend('email')">{{ t('Send it again by email', 'Enviar de nuevo por correo') }}</button>
            <button v-if="status.code.phone" type="button" class="text-sm font-medium text-ink-600 hover:underline" :disabled="busy" @click="resend('sms')">{{ t(`Send by SMS to ${status.code.phone}`, `Enviar por SMS al ${status.code.phone}`) }}</button>
          </template>
        </div>
        <p v-if="resent" class="text-[12.5px] text-ink-muted2">{{ t('PracticeHub was asked to send a new code.', 'Se ha pedido a PracticeHub un código nuevo.') }}</p>
      </form>

      <form v-if="!status.email || changing" class="mt-4 max-w-md space-y-4" data-cy="ph-web-connect" @submit.prevent="connect">
        <div>
          <label :for="`${fieldId}-email`" class="block text-sm font-medium text-ink-700">{{ t('Email you sign in to PracticeHub with', 'Correo con el que entras en PracticeHub') }}</label>
          <input :id="`${fieldId}-email`" v-model="email" type="email" autocomplete="off" required :class="inputClass" data-cy="ph-web-email" />
        </div>
        <div>
          <label :for="`${fieldId}-password`" class="block text-sm font-medium text-ink-700">{{ t('PracticeHub password', 'Contraseña de PracticeHub') }}</label>
          <input :id="`${fieldId}-password`" v-model="password" type="password" autocomplete="new-password" required :class="inputClass" data-cy="ph-web-password" />
          <p class="mt-1 text-[12px] text-ink-faint">{{ t('An account that only signs in with Google has no password: set one in PracticeHub first.', 'Una cuenta que solo entra con Google no tiene contraseña: ponle una antes en PracticeHub.') }}</p>
        </div>
        <div class="flex items-center gap-3">
          <UiBtn variant="primary" type="submit" :disabled="busy" data-cy="ph-web-connect-submit">{{ busy ? t('Signing in…', 'Entrando…') : t('Sign in to PracticeHub', 'Entrar en PracticeHub') }}</UiBtn>
          <button v-if="changing" type="button" class="text-sm font-medium text-ink-600 hover:underline" @click="changing = false">{{ t('Cancel', 'Cancelar') }}</button>
        </div>
      </form>

      <div v-else class="mt-4 space-y-4">
        <div class="flex flex-wrap items-center gap-x-4 gap-y-1 text-[13px] text-ink-700">
          <span data-cy="ph-web-connected">{{ status.connected ? t(`Signed in to PracticeHub as ${status.email}`, `Sesión iniciada en PracticeHub como ${status.email}`) : t(`Saved sign-in: ${status.email}`, `Acceso guardado: ${status.email}`) }}</span>
          <button type="button" class="text-sm font-medium text-ink-600 hover:underline" :disabled="busy || running" @click="changing = true">{{ t('Change', 'Cambiar') }}</button>
          <button type="button" class="text-sm font-medium text-ink-600 hover:underline" :disabled="busy || running" @click="forget">{{ t('Remove', 'Quitar') }}</button>
        </div>

        <div class="rounded-card border border-line bg-surface p-4">
          <dl class="grid grid-cols-3 gap-3 text-[12.5px]">
            <div>
              <dt class="text-ink-faint">{{ t('Forms imported', 'Formularios importados') }}</dt>
              <dd class="mt-0.5 font-mono text-[15px] text-ink-900" data-cy="ph-forms-total">{{ status.forms }}</dd>
            </div>
            <div>
              <dt class="text-ink-faint">{{ t('With their original', 'Con su original') }}</dt>
              <dd class="mt-0.5 font-mono text-[15px] text-ink-900" data-cy="ph-forms-originals">{{ status.originals }}</dd>
            </div>
            <div>
              <dt class="text-ink-faint">{{ t('Still missing', 'Faltan') }}</dt>
              <dd class="mt-0.5 font-mono text-[15px]" :class="missing > 0 ? 'text-warning-text' : 'text-ink-700'">{{ missing }}</dd>
            </div>
          </dl>

          <template v-if="running">
            <div class="mt-4 flex items-baseline justify-between">
              <p class="text-[13px] font-medium text-ink-700">{{ t(`Patients checked: ${status.job.cursor} / ${status.job.patients}`, `Pacientes revisados: ${status.job.cursor} / ${status.job.patients}`) }}</p>
              <p class="text-[12.5px] text-ink-muted2">{{ pct }}%</p>
            </div>
            <div class="mt-2 h-2 overflow-hidden rounded-full bg-line">
              <div class="h-full rounded-full bg-brand transition-all" :style="{ width: `${pct}%` }" />
            </div>
            <p class="mt-2 text-[12.5px] text-ink-muted2">{{ t('Running on the server. You can close this page.', 'En marcha en el servidor. Puedes cerrar esta página.') }}</p>
          </template>

          <p v-else-if="status.job.status === 'done'" class="mt-4 text-[12.5px] text-ink-700" data-cy="ph-forms-done">
            {{ t(`Finished. Originals brought over in the last run: ${status.job.stored}.`, `Terminado. Originales traídos en la última ejecución: ${status.job.stored}.`) }}
          </p>
          <p v-else-if="status.job.status === 'failed'" class="mt-4 text-[12.5px] text-danger-text">
            {{ t(`It stopped because it could not get any further: ${status.job.error ?? ''}. Start it again to carry on from what is already here.`, `Se detuvo porque no podía avanzar: ${status.job.error ?? ''}. Inícialo de nuevo para seguir desde lo que ya está aquí.`) }}
          </p>
          <p v-else-if="status.job.status === 'stopped'" class="mt-4 text-[12.5px] text-ink-muted2">
            {{ t('Stopped. What was brought over is kept; start again to carry on.', 'Detenido. Lo que se trajo se conserva; inícialo de nuevo para seguir.') }}
          </p>

          <p v-if="status.job.failed > 0 && !running" class="mt-2 text-[12.5px] text-warning-text">
            {{ t(`Forms whose original could not be fetched: ${status.job.failed}. Start again to retry them.`, `Formularios cuyo original no se pudo traer: ${status.job.failed}. Inícialo de nuevo para reintentarlos.`) }}
          </p>
          <p v-if="status.job.unmatched > 0 && !running" class="mt-2 text-[12.5px] text-ink-faint">
            {{ t(`Forms in PracticeHub that are not imported here, so there was nothing to file them with: ${status.job.unmatched}. Run Form responses and start again.`, `Formularios de PracticeHub que no están importados aquí, así que no había con qué guardarlos: ${status.job.unmatched}. Ejecuta Respuestas de formularios y vuelve a iniciar.`) }}
          </p>
        </div>

        <div class="flex flex-wrap gap-2">
          <UiBtn v-if="!running" variant="primary" :disabled="busy || Boolean(status.code) || status.forms === 0" data-cy="ph-forms-start" @click="act({ op: 'start' })">
            {{ status.job.status === 'idle' ? t('Bring the signed originals', 'Traer los originales firmados') : t('Run again', 'Ejecutar de nuevo') }}
          </UiBtn>
          <UiBtn v-else variant="secondary" :disabled="busy" @click="act({ op: 'stop' })">{{ t('Stop', 'Parar') }}</UiBtn>
        </div>

        <div class="rounded-card border border-line bg-surface p-4" data-cy="ph-templates">
          <p class="text-[13px] font-medium text-ink-900">{{ t('Form templates', 'Plantillas de formulario') }}</p>
          <p class="mt-1 text-[12.5px] text-ink-700">
            {{ t('Rebuilds the templates imported from PracticeHub exactly as its form editor has them: a signature where the form had one, the image to draw on, every option of every question and what was required. It replaces the questions of those templates, so changes made to them in QuiroFlow since are lost. Forms patients already filled in are not touched.', 'Rehace las plantillas importadas de PracticeHub tal como están en su editor de formularios: una firma donde el formulario la tenía, la imagen para dibujar, todas las opciones de cada pregunta y lo que era obligatorio. Sustituye las preguntas de esas plantillas, así que se pierden los cambios hechos en QuiroFlow desde entonces. Los formularios que los pacientes ya rellenaron no se tocan.') }}
          </p>
          <div class="mt-3 flex flex-wrap items-center gap-3">
            <UiBtn variant="secondary" :disabled="busy || templatesBusy || Boolean(status.code)" data-cy="ph-templates-sync" @click="rebuildTemplates">
              {{ templatesBusy ? t('Rebuilding…', 'Rehaciendo…') : t('Rebuild templates from PracticeHub', 'Rehacer plantillas desde PracticeHub') }}
            </UiBtn>
            <p v-if="templatesDone" class="text-[12.5px] text-ink-700" data-cy="ph-templates-done">
              {{ t(`Templates rebuilt: ${templatesDone.updated}. New: ${templatesDone.created}.`, `Plantillas rehechas: ${templatesDone.updated}. Nuevas: ${templatesDone.created}.`) }}
            </p>
          </div>
          <p v-if="templatesDone && templatesDone.failed.length > 0" class="mt-2 text-[12.5px] text-warning-text">
            {{ t(`Could not be rebuilt: ${templatesDone.failed.join(', ')}. Try again.`, `No se pudieron rehacer: ${templatesDone.failed.join(', ')}. Inténtalo de nuevo.`) }}
          </p>
        </div>
      </div>

      <p v-if="error" class="mt-3 text-[12.5px] text-danger-text" data-cy="ph-web-error">{{ error }}</p>
    </template>
  </div>
</template>
