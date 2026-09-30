<script setup lang="ts">
import type { Ref } from 'vue'
import type { TablesUpdate } from '~/types/database.types'

const supabase = useSupabaseClient()
const store = useAccountStore()
const t = useT()

const phoneNumberId = ref('')
const businessAccountId = ref('')
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
const metaAdsAccountId = ref('')
const metaAdsAccessToken = ref('')
// Whether each token is stored. Write-only, like the WhatsApp token: the
// value never comes back to the page, and an empty field keeps it.
const hasInstagramToken = ref(false)
const hasMetaAdsToken = ref(false)
const instagramUserId = ref('')
const instagramAccessToken = ref('')
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

interface Template {
  name: string
  language: string
  category: string
  bodyText: string
}
const templates = ref<Template[]>([])
const loadingTemplates = ref(false)
const templatesError = ref('')

async function load() {
  loading.value = true
  const { data } = await supabase
    .from('accounts')
    .select(
      'whatsapp_phone_number_id, whatsapp_business_account_id, whatsapp_confirmation_template_name, whatsapp_confirmation_template_language, whatsapp_recall_template_name, whatsapp_recall_template_language, whatsapp_reminder_template_name, whatsapp_reminder_template_language, online_booking_notify_whatsapp_template_name, online_booking_notify_whatsapp_template_language, new_lead_notify_whatsapp_template_name, new_lead_notify_whatsapp_template_language, instagram_user_id, meta_ads_account_id',
    )
    .eq('id', store.accountId!)
    .maybeSingle()
  phoneNumberId.value = data?.whatsapp_phone_number_id ?? ''
  businessAccountId.value = data?.whatsapp_business_account_id ?? ''
  manualOpen.value = !businessAccountId.value
  // The tokens live in account_secrets; the page only learns which are stored.
  try {
    const tokens = await useStaffFetch<{ whatsapp: boolean; instagram: boolean; metaAds: boolean }>('/api/whatsapp/tokens')
    hasStoredToken.value = tokens.whatsapp
    hasInstagramToken.value = tokens.instagram
    hasMetaAdsToken.value = tokens.metaAds
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
  metaAdsAccountId.value = data?.meta_ads_account_id ?? ''
  metaAdsAccessToken.value = ''
  instagramUserId.value = data?.instagram_user_id ?? ''
  instagramAccessToken.value = ''
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
    const { templates: list } = await useStaffFetch<{ templates: Template[] }>('/api/whatsapp/templates')
    templates.value = list
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
// (accounts_whatsapp_phone_number_id_key, accounts_instagram_user_id_key).
// Its own words for that are a constraint name, which tells a clinic nothing
// about what to do.
function saveErrorMessage(error: { code?: string; message: string }) {
  if (error.code === '23505' && error.message.includes('instagram_user_id')) {
    return t(
      'This Instagram account is already connected to another QuiroFlow account. Disconnect it there first.',
      'Esta cuenta de Instagram ya está conectada a otra cuenta de QuiroFlow. Desconéctala allí primero.',
    )
  }
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
    meta_ads_account_id: metaAdsAccountId.value.trim() || null,
    instagram_user_id: instagramUserId.value.trim() || null,
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
  const typedTokens = { whatsapp: accessToken.value.trim(), instagram: instagramAccessToken.value.trim(), metaAds: metaAdsAccessToken.value.trim() }
  if (typedTokens.whatsapp || typedTokens.instagram || typedTokens.metaAds) {
    try {
      await useStaffFetch('/api/whatsapp/tokens', { method: 'PUT', body: typedTokens })
      if (typedTokens.instagram) hasInstagramToken.value = true
      if (typedTokens.metaAds) hasMetaAdsToken.value = true
      instagramAccessToken.value = ''
      metaAdsAccessToken.value = ''
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
      <div class="flex gap-8 p-6">
        <SettingsNav />
        <div class="flex min-w-0 max-w-[940px] flex-1 flex-col gap-4" data-cy="whatsapp-settings" :data-ready="loading ? undefined : 'true'">
          <p class="text-[13.5px] text-ink-muted">
            {{ t('Your clinic’s WhatsApp number: what QuiroFlow sends from it, and the other Meta accounts that use the same connection.', 'El número de WhatsApp de tu clínica: lo que QuiroFlow envía desde él y las otras cuentas de Meta que usan la misma conexión.') }}
          </p>

          <!-- The one-click route first: it is the one almost every clinic should take. -->
          <SettingsWhatsAppConnectCard :connected-waba-id="businessAccountId || null" @connected="load" />

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
                  <span class="text-[12.5px] text-ink-muted">{{ connected ? t(`Business account ${businessAccountId}`, `Cuenta de empresa ${businessAccountId}`) : t('Connect above, or set it up by hand below.', 'Conéctalo arriba, o configúralo a mano abajo.') }}</span>
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
                <UiBtn :disabled="loadingTemplates || !hasStoredToken || !businessAccountId" data-cy="whatsapp-templates-refresh" @click="loadTemplates">
                  {{ loadingTemplates ? t('Loading…', 'Cargando…') : t('Refresh from Meta', 'Actualizar desde Meta') }}
                </UiBtn>
              </div>
              <p v-if="templatesError" class="border-t border-line-row px-[18px] py-2.5 text-[13px] font-semibold text-danger-text">{{ templatesError }}</p>

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
                    <option value="">{{ t('None -- not sent', 'Ninguna -- no se envía') }}</option>
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

            <!-- Instagram rides the same Meta app and webhook: only which account to receive and send as. -->
            <section aria-labelledby="h-ig" class="overflow-hidden rounded-card border border-line bg-surface">
              <div class="flex flex-wrap items-center gap-3 px-[18px] pb-1 pt-4">
                <h2 id="h-ig" class="flex-1 text-[16px] font-bold text-ink-900">{{ t('Instagram messages', 'Mensajes de Instagram') }}</h2>
                <UiPill v-if="instagramUserId && (hasInstagramToken || instagramAccessToken)" tone="success" dot>{{ t('Receiving and replying', 'Recibe y responde') }}</UiPill>
                <UiPill v-else-if="instagramUserId" tone="warning" dot>{{ t('Receiving only', 'Solo recibe') }}</UiPill>
                <UiPill v-else tone="neutral">{{ t('Not connected', 'Sin conectar') }}</UiPill>
              </div>
              <p class="px-[18px] pb-2 text-[13px] text-ink-muted">{{ t('DMs to your professional account arrive in the Inbox beside WhatsApp. Leave it empty to keep Instagram disconnected.', 'Los mensajes a tu cuenta profesional llegan a la Bandeja junto a WhatsApp. Déjalo vacío para no conectar Instagram.') }}</p>
              <div class="flex flex-wrap items-center gap-4 border-t border-line-row px-[18px] py-3">
                <label for="ig-id" class="min-w-[220px] flex-1 text-[14.5px] font-bold text-ink-900">{{ t('Instagram account ID', 'ID de la cuenta de Instagram') }}</label>
                <input id="ig-id" v-model="instagramUserId" type="text" placeholder="17841400000000000" data-test="instagram-user-id" :class="[inputClass, 'w-full font-mono text-[13px] sm:w-[300px]']" />
              </div>
              <div class="flex flex-wrap items-center gap-4 border-t border-line-row px-[18px] py-3">
                <div class="flex min-w-[220px] flex-1 flex-col gap-0.5">
                  <label for="ig-token" class="text-[14.5px] font-bold text-ink-900">{{ t('Access token', 'Token de acceso') }}</label>
                  <span class="text-[13px] text-ink-500">{{ t('A Page token with instagram_manage_messages. Only needed to reply.', 'Un token de página con instagram_manage_messages. Solo hace falta para responder.') }}</span>
                </div>
                <input id="ig-token" v-model="instagramAccessToken" type="password" autocomplete="off" :placeholder="hasInstagramToken ? '••••••••••••••••••••' : 'EAA…'" data-test="instagram-access-token" :class="[inputClass, 'w-full sm:w-[300px]']" />
              </div>
            </section>

            <!-- Reading only: the token asked for is ads_read, so a leaked one cannot spend money. -->
            <section aria-labelledby="h-ads" class="overflow-hidden rounded-card border border-line bg-surface">
              <div class="flex flex-wrap items-center gap-3 px-[18px] pb-1 pt-4">
                <h2 id="h-ads" class="flex-1 text-[16px] font-bold text-ink-900">{{ t('Meta Ads spend', 'Gasto en Meta Ads') }}</h2>
                <UiPill v-if="metaAdsAccountId && (hasMetaAdsToken || metaAdsAccessToken)" tone="success" dot>{{ t('Connected', 'Conectado') }}</UiPill>
                <UiPill v-else tone="neutral">{{ t('Not connected', 'Sin conectar') }}</UiPill>
              </div>
              <p class="px-[18px] pb-2 text-[13px] text-ink-muted">{{ t('Lets Growth read what you spent on Meta ads instead of you typing it each month. Read-only: nothing here can spend money.', 'Permite a Crecimiento leer lo que gastaste en Meta en lugar de escribirlo cada mes. Solo lectura: nada aquí puede gastar dinero.') }}</p>
              <div class="flex flex-wrap items-center gap-4 border-t border-line-row px-[18px] py-3">
                <div class="flex min-w-[220px] flex-1 flex-col gap-0.5">
                  <label for="ads-id" class="text-[14.5px] font-bold text-ink-900">{{ t('Ad account ID', 'ID de la cuenta publicitaria') }}</label>
                  <span class="text-[13px] text-ink-500">{{ t('With or without act_. Euro accounts only for now.', 'Con o sin act_. De momento solo cuentas en euros.') }}</span>
                </div>
                <input id="ads-id" v-model="metaAdsAccountId" type="text" placeholder="act_1234567890" data-test="meta-ads-account-id" :class="[inputClass, 'w-full font-mono text-[13px] sm:w-[300px]']" />
              </div>
              <div class="flex flex-wrap items-center gap-4 border-t border-line-row px-[18px] py-3">
                <div class="flex min-w-[220px] flex-1 flex-col gap-0.5">
                  <label for="ads-token" class="text-[14.5px] font-bold text-ink-900">{{ t('Read token', 'Token de lectura') }}</label>
                  <span class="text-[13px] text-ink-500">{{ t('A long-lived token with ads_read for that account.', 'Un token de larga duración con ads_read para esa cuenta.') }}</span>
                </div>
                <input id="ads-token" v-model="metaAdsAccessToken" type="password" autocomplete="off" :placeholder="hasMetaAdsToken ? '••••••••••••••••••••' : 'EAA…'" data-test="meta-ads-token" :class="[inputClass, 'w-full sm:w-[300px]']" />
              </div>
            </section>

            <!-- The manual route, folded but never gone: a clinic set up by hand (Columnaquiro) keeps it.
                 Open by default until something is connected, so a clinic without the button still finds it. -->
            <section class="overflow-hidden rounded-card border border-line bg-surface">
              <details :open="manualOpen" class="group" data-cy="whatsapp-manual">
                <summary class="flex min-h-[52px] cursor-pointer list-none items-center gap-2 px-[18px] text-[14px] font-semibold text-ink-500 hover:bg-surface-subtle">
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" class="transition-transform group-open:rotate-90"><path d="M9 6l6 6-6 6" /></svg>
                  {{ t('Already have your own Meta app? Set it up by hand', '¿Ya tienes tu propia app de Meta? Configúralo a mano') }}
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
              </details>
              <details class="group border-t border-line" data-cy="whatsapp-webhook">
                <summary class="flex min-h-[52px] cursor-pointer list-none items-center gap-2 px-[18px] text-[14px] font-semibold text-ink-500 hover:bg-surface-subtle">
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" class="transition-transform group-open:rotate-90"><path d="M9 6l6 6-6 6" /></svg>
                  {{ t('Delivery and reply tracking: the webhook', 'Seguimiento de entrega y respuesta: el webhook') }}
                </summary>
                <div class="px-[18px] pb-4">
            <p class="mt-1 text-[12.5px] leading-relaxed text-ink-muted2">
              {{ t('Optional. Feeds the "Scheduled Reminders" report — whether a message actually delivered (vs. a bad number or a recipient with no WhatsApp) and whether a patient replied to confirm or reschedule. Meta only allows', 'Opcional. Alimenta el informe "Recordatorios Programados" — si un mensaje realmente se entregó (frente a un número incorrecto o un destinatario sin WhatsApp) y si un paciente respondió para confirmar o reprogramar. Meta solo permite') }}
              <strong>{{ t('one', 'una') }}</strong> {{ t('webhook URL per WhatsApp Business number, so if you already point it at another tool (n8n, Zapier, your own backend...), you have two options — no need to give that up:', 'URL de webhook por número de WhatsApp Business, así que si ya lo tienes apuntando a otra herramienta (n8n, Zapier, tu propio backend...), tienes dos opciones — no hace falta renunciar a ello:') }}
            </p>
            <ol class="mt-3 list-decimal space-y-3 pl-5 text-[12.5px] text-ink-500">
              <li>
                <strong>{{ t('Nothing already using the webhook slot?', '¿Nada usa todavía el espacio del webhook?') }}</strong> {{ t('Register this URL directly in your Meta App dashboard, under', 'Registra esta URL directamente en tu panel de Meta App, en') }} <strong>WhatsApp &rarr; Configuration &rarr; Webhook</strong>:
                <div class="mt-1.5 flex items-center gap-2">
                  <code class="flex-1 overflow-x-auto rounded-ctlSm bg-surface-subtle px-2 py-1 text-[12px] text-ink-600">{{ webhookUrl }}</code>
                </div>
              </li>
              <li>
                <strong>{{ t('Already forwarding to n8n or something else?', '¿Ya reenvías a n8n o a otra cosa?') }}</strong> {{ t("Add one more step to that existing flow — an HTTP request node that forwards the same incoming payload, unmodified, to the URL above. QuiroFlow doesn't need to be Meta's registered endpoint, just a second place the payload also lands.", 'Añade un paso más a ese flujo existente — un nodo de solicitud HTTP que reenvíe el mismo payload entrante, sin modificar, a la URL de arriba. QuiroFlow no necesita ser el endpoint registrado de Meta, solo un segundo lugar donde también llegue el payload.') }}
              </li>
            </ol>
            <p class="mt-3 rounded-ctl border border-line bg-surface-subtle p-3 text-[12px] leading-relaxed text-ink-600">
              <strong>{{ t('Each option authenticates differently, and one of the two is now required.', 'Cada opción se autentica de forma distinta, y ahora una de las dos es obligatoria.') }}</strong>
              {{ t('Incoming webhooks used to be accepted from anyone; they are now ignored unless they can be proven genuine.', 'Antes se aceptaban webhooks entrantes de cualquiera; ahora se ignoran salvo que se pueda probar que son auténticos.') }}
              <br /><br />
              <strong>{{ t('Option 1', 'Opción 1') }}</strong> — {{ t('Meta signs every request, so fill in the', 'Meta firma cada solicitud, así que rellena el') }}
              <strong>{{ t('Meta App Secret', 'Secreto de la app de Meta') }}</strong> {{ t('field above and nothing else is needed.', 'de arriba y no hace falta nada más.') }}
              <br /><br />
              <strong>{{ t('Option 2', 'Opción 2') }}</strong> — {{ t("Meta's signature cannot survive the forwarding hop: it covers the exact bytes, and n8n re-encodes the JSON on the way through, so the signature no longer matches. Instead, create a token in", 'La firma de Meta no sobrevive al reenvío: cubre los bytes exactos, y n8n vuelve a codificar el JSON al pasar, así que la firma deja de coincidir. En su lugar, crea un token en') }}
              <strong>{{ t('Settings → Developers', 'Configuración → Desarrolladores') }}</strong> {{ t('with the', 'con el permiso') }}
              <code class="rounded-ctlSm bg-surface px-1 py-0.5">whatsapp:webhook</code> {{ t('scope, and have your HTTP Request node send it as a header:', 'y haz que tu nodo de solicitud HTTP lo envíe como cabecera:') }}
              <code class="mt-1.5 block overflow-x-auto rounded-ctlSm bg-surface px-2 py-1 text-[12px]">Authorization: Bearer qf_live_…</code>
            </p>
            <p class="mt-3 text-[12px] text-ink-muted2">
              {{ t("Either way it needs a verify token — set", 'De cualquier forma necesita un token de verificación — configura') }}
              <code class="rounded-ctlSm bg-surface-subtle px-1 py-0.5">WHATSAPP_WEBHOOK_VERIFY_TOKEN</code>
              {{ t("in your server's environment (only relevant for option 1, Meta's own verification handshake), and", 'en el entorno de tu servidor (solo relevante para la opción 1, el propio protocolo de verificación de Meta), y') }}
              <code class="rounded-ctlSm bg-surface-subtle px-1 py-0.5">NUXT_SUPABASE_SECRET_KEY</code> {{ t('(Supabase Project Settings → API → service_role secret) either way, since this endpoint has no QuiroFlow login to authenticate with.', '(Supabase Project Settings → API → secreto service_role) de cualquier forma, ya que este endpoint no tiene un inicio de sesión de QuiroFlow con el que autenticarse.') }}
            </p>
            <p class="mt-2 text-[12px] text-ink-faint">
              {{ t('Skip this entirely and confirmations still send fine — you\'ll just see "pending" stay pending in the report instead of moving to confirmed/reschedule automatically.', 'Omite esto por completo y las confirmaciones seguirán enviándose bien — solo verás que "pendiente" se queda pendiente en el informe en lugar de pasar automáticamente a confirmado/reprogramado.') }}
            </p>
                </div>
              </details>
            </section>
          </template>
        </div>
      </div>
    </div>
  </div>
</template>
