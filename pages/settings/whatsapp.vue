<script setup lang="ts">
import type { Ref } from 'vue'
import type { TablesUpdate } from '~/types/database.types'
import type { EditedTemplateResult, ExistingTemplate } from '~/utils/whatsappTemplateDraft'

const supabase = useSupabaseClient()
const store = useAccountStore()
const t = useT()

const phoneNumberId = ref('')
const businessAccountId = ref('')
// Set when the number was connected while staying on the WhatsApp Business
// app (Coexistence): shown on the card, so nobody wonders why the phone still works.
const businessAppSince = ref<string | null>(null)
// Whether the manual setup starts unfolded, decided once per load. Bound to
// businessAccountId directly, it folded shut on the first character typed
// into that very field.
const manualOpen = ref(false)
const accessToken = ref('')
// Write-only, same shape as the access token above: the value is never read
// back, only whether one is stored. It lives in a service-role-only table, so
// unlike the other integration secrets on `accounts` no staff member can pull
// it out through the REST API.
const appSecret = ref('')
const hasStoredAppSecret = ref(false)
const hasStoredToken = ref(false)
const confirmationTemplateName = ref('')
const confirmationTemplateLanguage = ref('es')
const recallTemplateName = ref('')
const recallTemplateLanguage = ref('es')
const reminderTemplateName = ref('')
const reminderTemplateLanguage = ref('es')
const staffNotifyTemplateName = ref('')
const newLeadNotifyTemplateName = ref('')
const newLeadNotifyTemplateLanguage = ref('es')
const staffNotifyTemplateLanguage = ref('es')

const { showToast } = useToast()
const loading = ref(true)
const saving = ref(false)

// Set only after mount, not as a computed keyed on import.meta.client --
// that would render an empty string during SSR but the real URL on the
// client's first render, and Vue flags that mismatch as a hydration error.
const webhookUrl = ref('')
onMounted(() => {
  webhookUrl.value = `${window.location.origin}/api/whatsapp/webhook`
})

// Setting WhatsApp up by hand, from a clinic's own Meta app, is how the first
// clinic was connected and the only route on a deployment without Embedded
// Signup. Everyone else connects with the button, and a form of ids, tokens
// and an app secret beside it only invites pasting the wrong thing -- so it
// is shown to a clinic that already runs on its own app (it has an app
// secret stored), or where there is no button to use instead.
const runtimeConfig = useRuntimeConfig()
const embeddedSignupAvailable = Boolean(runtimeConfig.public.metaPlatformAppId && runtimeConfig.public.metaEmbeddedSignupConfigId)
const showManual = computed(() => hasStoredAppSecret.value || !embeddedSignupAvailable)

// What Meta lists, with what an edit needs (templateEditBlocker, the dialog).
type Template = ExistingTemplate & { rejectedReason?: string | null }
const templates = ref<Template[]>([])
// Submitted and not approved: pending, rejected or paused at Meta.
const inReview = ref<Template[]>([])
const loadingTemplates = ref(false)
const templatesError = ref('')
const creatingTemplate = ref(false)
const justCreated = ref('')
function templateCreated(created: { name: string }) {
  creatingTemplate.value = false
  justEdited.value = ''
  justCreated.value = created.name
  loadTemplates()
}
// Editing one: the same dialog, opened on a template Meta already has.
const editingTemplate = ref<Template | null>(null)
const justEdited = ref('')
function templateEdited(edited: EditedTemplateResult) {
  editingTemplate.value = null
  justCreated.value = ''
  justEdited.value = edited.name
  loadTemplates()
}
const editBlocker = (tpl: Template) => templateEditBlocker(tpl)
function reviewLabel(status: string | undefined) {
  if (status === 'REJECTED') return t('Rejected', 'Rechazada')
  if (status === 'PAUSED') return t('Paused by Meta', 'Pausada por Meta')
  if (status === 'DISABLED') return t('Disabled by Meta', 'Desactivada por Meta')
  return t('In review', 'En revisión')
}

async function load() {
  loading.value = true
  const { data } = await supabase
    .from('accounts')
    .select(
      'whatsapp_phone_number_id, whatsapp_business_account_id, whatsapp_business_app_since, whatsapp_confirmation_template_name, whatsapp_confirmation_template_language, whatsapp_recall_template_name, whatsapp_recall_template_language, whatsapp_reminder_template_name, whatsapp_reminder_template_language, online_booking_notify_whatsapp_template_name, online_booking_notify_whatsapp_template_language, new_lead_notify_whatsapp_template_name, new_lead_notify_whatsapp_template_language',
    )
    .eq('id', store.accountId!)
    .maybeSingle()
  phoneNumberId.value = data?.whatsapp_phone_number_id ?? ''
  businessAccountId.value = data?.whatsapp_business_account_id ?? ''
  businessAppSince.value = data?.whatsapp_business_app_since ?? null
  manualOpen.value = !businessAccountId.value
  // The tokens live in account_secrets; the page only learns which are stored.
  try {
    const tokens = await useStaffFetch<{ whatsapp: boolean }>('/api/whatsapp/tokens')
    hasStoredToken.value = tokens.whatsapp
  } catch {
    hasStoredToken.value = false
  }
  try {
    const status = await useStaffFetch<{ configured: boolean }>('/api/whatsapp/app-secret')
    hasStoredAppSecret.value = status.configured
  } catch {
    // Non-fatal: the rest of the page is still usable, and the field just
    // renders as "not configured" rather than blocking the whole form.
    hasStoredAppSecret.value = false
  }
  confirmationTemplateName.value = data?.whatsapp_confirmation_template_name ?? ''
  confirmationTemplateLanguage.value = data?.whatsapp_confirmation_template_language ?? 'es'
  recallTemplateName.value = data?.whatsapp_recall_template_name ?? ''
  recallTemplateLanguage.value = data?.whatsapp_recall_template_language ?? 'es'
  reminderTemplateName.value = data?.whatsapp_reminder_template_name ?? ''
  reminderTemplateLanguage.value = data?.whatsapp_reminder_template_language ?? 'es'
  staffNotifyTemplateName.value = data?.online_booking_notify_whatsapp_template_name ?? ''
  newLeadNotifyTemplateName.value = data?.new_lead_notify_whatsapp_template_name ?? ''
  newLeadNotifyTemplateLanguage.value = data?.new_lead_notify_whatsapp_template_language ?? 'es'
  staffNotifyTemplateLanguage.value = data?.online_booking_notify_whatsapp_template_language ?? 'es'
  loading.value = false

  if (hasStoredToken.value && businessAccountId.value) loadTemplates()
}
onMounted(load)

async function loadTemplates() {
  loadingTemplates.value = true
  templatesError.value = ''
  try {
    const { templates: list, inReview: pending } = await useStaffFetch<{ templates: Template[]; inReview?: Template[] }>('/api/whatsapp/templates')
    templates.value = list
    inReview.value = pending ?? []
  } catch (err: any) {
    templatesError.value = err?.data?.statusMessage ?? t('Failed to load templates', 'Error al cargar las plantillas')
  } finally {
    loadingTemplates.value = false
  }
}

// --- the five messages, one table ---
// Each message QuiroFlow can start a WhatsApp conversation with, and the
// approved template it uses. This replaces a name/language pair of text
// fields per message plus a row of "Use for …" buttons on each template --
// which had no button for the new-lead alert at all.
interface TemplateUse {
  key: string
  title: string
  when: string
  name: Ref<string>
  lang: Ref<string>
}
const USES = computed<TemplateUse[]>(() => [
  { key: 'confirmation', title: t('Appointment confirmation', 'Confirmación de cita'), when: t('When an appointment is booked. A patient’s own language is used when it has an approved variant.', 'Al reservar una cita. Se usa el idioma del paciente si tiene una variante aprobada.'), name: confirmationTemplateName, lang: confirmationTemplateLanguage },
  { key: 'reminder', title: t('Appointment reminder', 'Recordatorio de cita'), when: t('Before the appointment, as set in Messages.', 'Antes de la cita, según Mensajes.'), name: reminderTemplateName, lang: reminderTemplateLanguage },
  { key: 'recall', title: t('Recall', 'Revisión'), when: t('Pre-selected when staff send a recall; they can switch it each time.', 'Preseleccionada al enviar una revisión; se puede cambiar cada vez.'), name: recallTemplateName, lang: recallTemplateLanguage },
  { key: 'staff-booking', title: t('New booking alert (to staff)', 'Aviso de reserva (al personal)'), when: t('To Online Booking’s notify number, when it has not written to the clinic in 24 h.', 'Al número de aviso de Reserva online, si no ha escrito a la clínica en 24 h.'), name: staffNotifyTemplateName, lang: staffNotifyTemplateLanguage },
  { key: 'staff-lead', title: t('New lead alert (to staff)', 'Aviso de lead (al personal)'), when: t('To the notify number in Leads. Fills name, phone, email, source.', 'Al número de aviso de Leads. Rellena nombre, teléfono, email y origen.'), name: newLeadNotifyTemplateName, lang: newLeadNotifyTemplateLanguage },
])
const chosenCount = computed(() => USES.value.filter((u) => u.name.value.trim()).length)

function useKey(name: string, lang: string) {
  return name ? `${name}|${lang}` : ''
}
function pickTemplate(use: TemplateUse, value: string) {
  const [name = '', lang = 'es'] = value.split('|')
  use.name.value = name
  use.lang.value = name ? lang : 'es'
}
// What the chosen template actually says, from Meta's list -- so a clinic
// picks by the words a patient will read, not by an internal name.
function templateBody(name: string, lang: string) {
  return templates.value.find((x) => x.name === name && x.language === lang)?.bodyText ?? ''
}
// A template stored before it was renamed or deleted at Meta still shows,
// flagged, rather than silently vanishing from the picker.
function isKnownTemplate(name: string, lang: string) {
  return templates.value.some((x) => x.name === name && x.language === lang)
}

const connected = computed(() => !!(phoneNumberId.value && businessAccountId.value && hasStoredToken.value))

const inputClass = 'h-9 touch:h-11 rounded-ctl border border-line-control bg-surface px-3 text-[14px] text-ink-900 placeholder:text-ink-faint2 focus:border-brand focus:outline-none focus:ring-1 focus:ring-brand'

// Each id routes inbound messages to exactly one account, so the database
// refuses one that another account already holds
// (accounts_whatsapp_phone_number_id_key).
// Its own words for that are a constraint name, which tells a clinic nothing
// about what to do.
function saveErrorMessage(error: { code?: string; message: string }) {
  if (error.code === '23505' && error.message.includes('whatsapp_phone_number_id')) {
    return t(
      'This WhatsApp number is already connected to another QuiroFlow account. Disconnect it there first.',
      'Este número de WhatsApp ya está conectado a otra cuenta de QuiroFlow. Desconéctalo allí primero.',
    )
  }
  return error.message
}

async function save() {
  saving.value = true
  const update: TablesUpdate<'accounts'> = {
    whatsapp_phone_number_id: phoneNumberId.value.trim() || null,
    whatsapp_business_account_id: businessAccountId.value.trim() || null,
    whatsapp_confirmation_template_name: confirmationTemplateName.value.trim() || null,
    whatsapp_confirmation_template_language: confirmationTemplateLanguage.value.trim() || 'es',
    whatsapp_recall_template_name: recallTemplateName.value.trim() || null,
    whatsapp_recall_template_language: recallTemplateLanguage.value.trim() || 'es',
    whatsapp_reminder_template_name: reminderTemplateName.value.trim() || null,
    whatsapp_reminder_template_language: reminderTemplateLanguage.value.trim() || 'es',
    online_booking_notify_whatsapp_template_name: staffNotifyTemplateName.value.trim() || null,
    new_lead_notify_whatsapp_template_name: newLeadNotifyTemplateName.value.trim() || null,
    new_lead_notify_whatsapp_template_language: newLeadNotifyTemplateLanguage.value.trim() || 'es',
    online_booking_notify_whatsapp_template_language: staffNotifyTemplateLanguage.value.trim() || 'es',
  }
  const { error: updateError } = await supabase.from('accounts').update(update).eq('id', store.accountId!)
  saving.value = false
  if (updateError) {
    showToast(saveErrorMessage(updateError), 'error')
    return
  }
  // Tokens through the server, into account_secrets: not a column every
  // member of the clinic can read.
  if (accessToken.value.trim()) {
    try {
      await useStaffFetch('/api/whatsapp/tokens', { method: 'PUT', body: { whatsapp: accessToken.value.trim() } })
    } catch (e: any) {
      showToast(e?.data?.statusMessage ?? e?.statusMessage ?? t('Could not save the access token', 'No se pudo guardar el token de acceso'), 'error')
      return
    }
  }
  // Its own endpoint, not part of the accounts update above, because the
  // column it writes is not reachable from the browser at all.
  if (appSecret.value.trim()) {
    try {
      await useStaffFetch('/api/whatsapp/app-secret', { method: 'POST', body: { appSecret: appSecret.value.trim() } })
      hasStoredAppSecret.value = true
      appSecret.value = ''
    } catch (e: any) {
      showToast(e?.data?.statusMessage ?? e?.statusMessage ?? t('Could not save the app secret', 'No se pudo guardar el secreto de la app'), 'error')
      return
    }
  }

  showToast(t('Saved', 'Guardado'))
  if (accessToken.value.trim()) hasStoredToken.value = true
  accessToken.value = ''
  if (hasStoredToken.value && businessAccountId.value) loadTemplates()
}
</script>

<template>
  <div class="flex h-full flex-col">
    <PageHeader :title="t('WhatsApp', 'WhatsApp')">
      <UiBtn variant="primary" data-cy="whatsapp-save" :disabled="saving || loading" @click="save">{{ saving ? t('Saving…', 'Guardando…') : t('Save changes', 'Guardar cambios') }}</UiBtn>
    </PageHeader>
    <div class="flex-1 overflow-y-auto">
      <div class="flex gap-8 p-4 pb-24 sm:px-6 sm:pt-6 lg:pb-6">
        <SettingsNav />
        <div class="flex min-w-0 max-w-[940px] flex-1 flex-col gap-4" data-cy="whatsapp-settings" :data-ready="loading ? undefined : 'true'">
          <p class="text-[13.5px] text-ink-muted">
            {{ t('Your clinic’s WhatsApp number, and the approved templates QuiroFlow starts each conversation with.', 'El número de WhatsApp de tu clínica y las plantillas aprobadas con las que QuiroFlow inicia cada conversación.') }}
          </p>

          <!-- The one-click route first: it is the one almost every clinic should take. -->
          <SettingsWhatsAppConnectCard :connected-waba-id="businessAccountId || null" :business-app-since="businessAppSince" @connected="load" />

          <template v-if="loading">
            <UiSkeleton class="h-24 w-full rounded-card" />
            <UiSkeleton class="h-72 w-full rounded-card" />
          </template>
          <template v-else>
            <!-- Where things stand, as facts rather than fields. -->
            <section :aria-label="t('Status', 'Estado')" class="grid grid-cols-1 overflow-hidden rounded-card border border-line bg-surface sm:grid-cols-2" data-cy="whatsapp-status">
              <div class="flex gap-3 border-line-row px-[18px] py-3.5 max-sm:border-b sm:border-r">
                <span class="flex h-[22px] w-[22px] shrink-0 items-center justify-center rounded-full" :class="connected ? 'bg-success-bg text-success-text' : 'bg-warning-bg text-warning-text'" aria-hidden="true">
                  <svg v-if="connected" width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"><path d="M5 12l5 5L20 7" /></svg>
                  <svg v-else width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round"><path d="M12 7v6M12 17h.01" /></svg>
                </span>
                <span class="flex flex-col gap-0.5">
                  <strong class="text-[13.5px] text-ink-900">{{ connected ? t('Messages can be sent', 'Se pueden enviar mensajes') : t('Not connected yet', 'Aún sin conectar') }}</strong>
                  <span class="text-[12.5px] text-ink-muted">{{ connected ? t(`Business account ${businessAccountId}`, `Cuenta de empresa ${businessAccountId}`) : t('Connect it above.', 'Conéctalo arriba.') }}</span>
                </span>
              </div>
              <div class="flex gap-3 px-[18px] py-3.5">
                <span class="flex h-[22px] w-[22px] shrink-0 items-center justify-center rounded-full" :class="chosenCount === USES.length ? 'bg-success-bg text-success-text' : 'bg-warning-bg text-warning-text'" aria-hidden="true">
                  <svg v-if="chosenCount === USES.length" width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"><path d="M5 12l5 5L20 7" /></svg>
                  <svg v-else width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round"><path d="M12 7v6M12 17h.01" /></svg>
                </span>
                <span class="flex flex-col gap-0.5">
                  <strong class="text-[13.5px] text-ink-900" data-cy="whatsapp-templates-count">{{ t(`${chosenCount} of ${USES.length} templates chosen`, `${chosenCount} de ${USES.length} plantillas elegidas`) }}</strong>
                  <span class="text-[12.5px] text-ink-muted">{{ chosenCount === USES.length ? t('Every message has one.', 'Cada mensaje tiene la suya.') : t('A message without one is not sent.', 'Un mensaje sin plantilla no se envía.') }}</span>
                </span>
              </div>
            </section>

            <!-- Templates: one table, one place to change each -->
            <section aria-labelledby="h-templates" class="overflow-hidden rounded-card border border-line bg-surface">
              <div class="flex flex-wrap items-start gap-3 px-[18px] pb-3 pt-4">
                <div class="min-w-[240px] flex-1">
                  <h2 id="h-templates" class="text-[16px] font-bold text-ink-900">{{ t('Message templates', 'Plantillas de mensaje') }}</h2>
                  <p class="mt-1 text-[13px] leading-snug text-ink-muted">{{ t('WhatsApp only lets a business start a conversation with a template Meta has approved. Pick which one each message uses.', 'WhatsApp solo deja a una empresa iniciar una conversación con una plantilla aprobada por Meta. Elige cuál usa cada mensaje.') }}</p>
                </div>
                <div class="flex flex-wrap gap-2">
                  <UiBtn :disabled="loadingTemplates || !hasStoredToken || !businessAccountId" data-cy="whatsapp-templates-refresh" @click="loadTemplates">
                    {{ loadingTemplates ? t('Loading…', 'Cargando…') : t('Refresh from Meta', 'Actualizar desde Meta') }}
                  </UiBtn>
                  <UiBtn variant="primary" :disabled="!hasStoredToken || !businessAccountId" data-cy="whatsapp-template-create" @click="creatingTemplate = true">
                    {{ t('Create template', 'Crear plantilla') }}
                  </UiBtn>
                </div>
              </div>
              <p v-if="templatesError" class="border-t border-line-row px-[18px] py-2.5 text-[13px] font-semibold text-danger-text">{{ templatesError }}</p>
              <p v-if="justCreated" class="border-t border-line-row bg-success-bg px-[18px] py-2.5 text-[13px] text-success-text" data-cy="whatsapp-template-created">
                {{ t(`"${justCreated}" was sent to Meta. Once it is approved you can choose it here and in your automations.`, `«${justCreated}» se ha enviado a Meta. Cuando la aprueben podrás elegirla aquí y en tus automatizaciones.`) }}
              </p>
              <!-- Submitted but not usable yet: a template does not vanish
              between creating it and Meta approving it, and a rejection says
              why. -->
              <div v-if="inReview.length" class="flex flex-col gap-1.5 border-t border-line-row px-[18px] py-3" data-cy="whatsapp-templates-in-review">
                <span class="text-[12.5px] font-semibold text-ink-700">{{ t('Waiting on Meta', 'Pendientes de Meta') }}</span>
                <div v-for="tpl in inReview" :key="tpl.name + tpl.language" class="flex flex-wrap items-center gap-2 text-[13px]" :data-template-row="tpl.name">
                  <span class="font-mono text-ink-900">{{ tpl.name }}</span>
                  <span class="text-ink-muted">· {{ tpl.language }}</span>
                  <UiPill :tone="tpl.status === 'REJECTED' || tpl.status === 'DISABLED' ? 'danger' : 'warning'" dot>{{ reviewLabel(tpl.status) }}</UiPill>
                  <span v-if="tpl.rejectedReason" class="text-[12px] text-ink-muted">{{ t(templateRejectionReason(tpl.rejectedReason).en, templateRejectionReason(tpl.rejectedReason).es) }}</span>
                  <!-- A rejection is fixed by changing it, not by starting again under a new name. -->
                  <button v-if="!editBlocker(tpl)" type="button" class="text-[12.5px] font-semibold text-brand hover:underline" :data-template-edit="tpl.name" data-cy="whatsapp-template-edit" @click="editingTemplate = tpl">
                    {{ t('Edit', 'Editar') }}
                  </button>
                </div>
              </div>
              <p v-if="justEdited" class="border-t border-line-row bg-success-bg px-[18px] py-2.5 text-[13px] text-success-text" data-cy="whatsapp-template-edited">
                {{ t(`The change to "${justEdited}" was sent to Meta. It reviews it again, usually within minutes.`, `El cambio en «${justEdited}» se ha enviado a Meta. La vuelve a revisar, normalmente en unos minutos.`) }}
              </p>
              <!-- Every approved template, to change one: the table below only
              shows the five QuiroFlow sends itself, not the guides and offers
              the automations send. -->
              <details v-if="templates.length" class="group border-t border-line-row" data-cy="whatsapp-templates-all">
                <summary class="flex min-h-[44px] cursor-pointer list-none items-center gap-2 px-[18px] text-[13px] font-semibold text-ink-700 hover:bg-surface-subtle">
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" class="transition-transform group-open:rotate-90"><path d="M9 6l6 6-6 6" /></svg>
                  {{ t(`Approved templates (${templates.length})`, `Plantillas aprobadas (${templates.length})`) }}
                </summary>
                <ul class="flex flex-col pb-1">
                  <li v-for="tpl in templates" :key="tpl.name + tpl.language" class="flex flex-wrap items-start gap-x-3 gap-y-1 border-t border-line-row px-[18px] py-2.5 text-[13px]" :data-template-row="tpl.name">
                    <div class="flex min-w-0 flex-1 flex-col gap-0.5">
                      <span><span class="font-mono text-ink-900">{{ tpl.name }}</span> <span class="text-ink-muted">· {{ tpl.language }} · {{ tpl.category === 'MARKETING' ? t('Marketing', 'Marketing') : tpl.category === 'UTILITY' ? t('Service', 'Servicio') : tpl.category }}</span></span>
                      <span class="line-clamp-2 text-[12.5px] leading-snug text-ink-500">“{{ tpl.bodyText }}”</span>
                      <span v-if="editBlocker(tpl)" class="text-[12px] text-ink-muted" data-cy="whatsapp-template-edit-blocked">{{ t(editBlocker(tpl)!.en, editBlocker(tpl)!.es) }}</span>
                    </div>
                    <UiBtn v-if="!editBlocker(tpl)" :data-template-edit="tpl.name" data-cy="whatsapp-template-edit" @click="editingTemplate = tpl">{{ t('Edit', 'Editar') }}</UiBtn>
                  </li>
                </ul>
              </details>
              <SettingsWhatsAppTemplateDialog v-if="creatingTemplate" @close="creatingTemplate = false" @created="templateCreated" />
              <SettingsWhatsAppTemplateDialog v-if="editingTemplate" :template="editingTemplate" @close="editingTemplate = null" @edited="templateEdited" />

              <div v-for="u in USES" :key="u.key" :data-template-use="u.key" class="grid grid-cols-1 items-start gap-2 border-t border-line-row px-[18px] py-3 md:grid-cols-[1fr_1.15fr] md:gap-4">
                <div class="flex flex-col gap-0.5">
                  <strong :id="`use-${u.key}`" class="text-[14.5px] text-ink-900">{{ u.title }}</strong>
                  <span class="text-[12.5px] leading-snug text-ink-muted">{{ u.when }}</span>
                </div>
                <div class="flex min-w-0 flex-col gap-1.5">
                  <!-- Picked from Meta's list once it has loaded; typed by hand when it cannot be. -->
                  <select
                    v-if="templates.length > 0"
                    :value="useKey(u.name.value, u.lang.value)"
                    :aria-labelledby="`use-${u.key}`"
                    data-cy="whatsapp-template-select"
                    :class="[inputClass, 'w-full']"
                    @change="pickTemplate(u, ($event.target as HTMLSelectElement).value)"
                  >
                    <option value="">{{ t('None — not sent', 'Ninguna — no se envía') }}</option>
                    <option v-if="u.name.value && !isKnownTemplate(u.name.value, u.lang.value)" :value="useKey(u.name.value, u.lang.value)">
                      {{ u.name.value }} · {{ u.lang.value }} · {{ t('not in Meta’s list', 'no está en Meta') }}
                    </option>
                    <option v-for="tpl in templates" :key="tpl.name + tpl.language" :value="useKey(tpl.name, tpl.language)">{{ tpl.name }} · {{ tpl.language }} · {{ tpl.category }}</option>
                  </select>
                  <div v-else class="flex gap-2">
                    <input v-model="u.name.value" type="text" placeholder="template_name" :aria-label="t(`${u.title}: template name`, `${u.title}: nombre de la plantilla`)" data-cy="whatsapp-template-name" :class="[inputClass, 'min-w-0 flex-1 font-mono text-[13px]']" />
                    <input v-model="u.lang.value" type="text" placeholder="es" :aria-label="t(`${u.title}: language`, `${u.title}: idioma`)" :class="[inputClass, 'w-16 text-center']" />
                  </div>
                  <p v-if="templateBody(u.name.value, u.lang.value)" class="line-clamp-2 text-[12.5px] leading-snug text-ink-500">“{{ templateBody(u.name.value, u.lang.value) }}”</p>
                </div>
              </div>
            </section>

            <!-- By hand, from a clinic's own Meta app: only where that is how the clinic
                 already runs (it has an app secret stored), or there is no Connect button. -->
            <section v-if="showManual" class="overflow-hidden rounded-card border border-line bg-surface">
              <details :open="manualOpen" class="group" data-cy="whatsapp-manual">
                <summary class="flex min-h-[52px] cursor-pointer list-none items-center gap-2 px-[18px] text-[14px] font-semibold text-ink-500 hover:bg-surface-subtle">
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" class="transition-transform group-open:rotate-90"><path d="M9 6l6 6-6 6" /></svg>
                  {{ t('Your own Meta app, set up by hand', 'Tu propia app de Meta, configurada a mano') }}
                </summary>
                <p class="px-[18px] pb-2 text-[13px] leading-snug text-ink-muted">
                  {{ t('A Phone Number ID, a WhatsApp Business Account ID and a permanent access token from your Meta app, plus at least one approved message template.', 'Un ID de número de teléfono, un ID de cuenta de WhatsApp Business y un token de acceso permanente de tu app de Meta, además de al menos una plantilla aprobada.') }}
                </p>
                <div class="flex flex-wrap items-center gap-4 border-t border-line-row px-[18px] py-3">
                  <label for="wa-phone" class="min-w-[220px] flex-1 text-[14.5px] font-bold text-ink-900">{{ t('Phone Number ID', 'ID del número de teléfono') }}</label>
                  <input id="wa-phone" v-model="phoneNumberId" type="text" :class="[inputClass, 'w-full font-mono text-[13px] sm:w-[300px]']" />
                </div>
                <div class="flex flex-wrap items-center gap-4 border-t border-line-row px-[18px] py-3">
                  <label for="wa-waba" class="min-w-[220px] flex-1 text-[14.5px] font-bold text-ink-900">{{ t('WhatsApp Business Account ID', 'ID de la cuenta de WhatsApp Business') }}</label>
                  <input id="wa-waba" v-model="businessAccountId" type="text" :class="[inputClass, 'w-full font-mono text-[13px] sm:w-[300px]']" />
                </div>
                <div class="flex flex-wrap items-center gap-4 border-t border-line-row px-[18px] py-3">
                  <div class="flex min-w-[220px] flex-1 flex-col gap-0.5">
                    <label for="wa-token" class="text-[14.5px] font-bold text-ink-900">{{ t('Access token', 'Token de acceso') }}</label>
                    <span class="text-[13px] text-ink-500">{{ t('From your Meta Business account.', 'De tu cuenta de Meta Business.') }}</span>
                  </div>
                  <input id="wa-token" v-model="accessToken" type="password" autocomplete="off" :placeholder="hasStoredToken ? '••••••••••••••••••••' : ''" :class="[inputClass, 'w-full sm:w-[300px]']" />
                </div>
                <div class="flex flex-wrap items-center gap-4 border-t border-line-row px-[18px] py-3">
                  <div class="flex min-w-[220px] flex-1 flex-col gap-0.5">
                    <label for="wa-secret" class="text-[14.5px] font-bold text-ink-900">{{ t('Meta App Secret', 'Secreto de la app de Meta') }}</label>
                    <span class="text-[13px] leading-snug text-ink-500">{{ t('Meta App dashboard → Settings → Basic → App Secret. Needed so incoming webhooks can be verified as genuinely from Meta; without it, replies and delivery status are ignored.', 'Panel de la app de Meta → Configuración → Básica → Secreto de la app. Necesario para verificar que los webhooks vienen de Meta; sin él, se ignoran las respuestas y el estado de entrega.') }}</span>
                  </div>
                  <div class="flex w-full items-center gap-2 sm:w-[300px]">
                    <input id="wa-secret" v-model="appSecret" type="password" autocomplete="off" :placeholder="hasStoredAppSecret ? '••••••••••••••••••••' : ''" :class="[inputClass, 'min-w-0 flex-1']" />
                    <UiPill v-if="hasStoredAppSecret" tone="success">{{ t('Stored', 'Guardado') }}</UiPill>
                    <UiPill v-else tone="warning">{{ t('Not set', 'Sin configurar') }}</UiPill>
                  </div>
                </div>
                <!-- The webhook the clinic's own app posts to. The platform app's is
                     QuiroFlow's to set, so a clinic that connected with the button never sees this. -->
                <div class="border-t border-line-row px-[18px] py-3" data-cy="whatsapp-webhook">
                  <span class="text-[14.5px] font-bold text-ink-900">{{ t('Webhook', 'Webhook') }}</span>
                  <p class="mt-0.5 text-[13px] leading-snug text-ink-500">
                    {{ t('In your Meta app, under WhatsApp → Configuration, point the webhook here and subscribe it to messages. Replies and delivery status only arrive with the App Secret above stored.', 'En tu app de Meta, en WhatsApp → Configuración, apunta el webhook aquí y suscríbelo a messages. Las respuestas y el estado de entrega solo llegan con el secreto de la app de arriba guardado.') }}
                  </p>
                  <code class="mt-2 block overflow-x-auto rounded-ctlSm bg-surface-subtle px-2 py-1 text-[12px] text-ink-600">{{ webhookUrl }}</code>
                </div>
              </details>
            </section>
          </template>
        </div>
      </div>
    </div>
  </div>
</template>
