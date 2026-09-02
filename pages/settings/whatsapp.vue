<script setup lang="ts">
import type { TablesUpdate } from '~/types/database.types'

const supabase = useSupabaseClient()
const store = useAccountStore()
const t = useT()

const phoneNumberId = ref('')
const businessAccountId = ref('')
const accessToken = ref('')
const hasStoredToken = ref(false)
const confirmationTemplateName = ref('')
const confirmationTemplateLanguage = ref('es')
const recallTemplateName = ref('')
const recallTemplateLanguage = ref('es')
const reminderTemplateName = ref('')
const reminderTemplateLanguage = ref('es')

const loading = ref(true)
const saving = ref(false)
const saved = ref(false)
const error = ref('')

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
      'whatsapp_phone_number_id, whatsapp_business_account_id, whatsapp_access_token, whatsapp_confirmation_template_name, whatsapp_confirmation_template_language, whatsapp_recall_template_name, whatsapp_recall_template_language, whatsapp_reminder_template_name, whatsapp_reminder_template_language',
    )
    .eq('id', store.accountId!)
    .maybeSingle()
  phoneNumberId.value = data?.whatsapp_phone_number_id ?? ''
  businessAccountId.value = data?.whatsapp_business_account_id ?? ''
  hasStoredToken.value = !!data?.whatsapp_access_token
  confirmationTemplateName.value = data?.whatsapp_confirmation_template_name ?? ''
  confirmationTemplateLanguage.value = data?.whatsapp_confirmation_template_language ?? 'es'
  recallTemplateName.value = data?.whatsapp_recall_template_name ?? ''
  recallTemplateLanguage.value = data?.whatsapp_recall_template_language ?? 'es'
  reminderTemplateName.value = data?.whatsapp_reminder_template_name ?? ''
  reminderTemplateLanguage.value = data?.whatsapp_reminder_template_language ?? 'es'
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

function useForConfirmation(t: Template) {
  confirmationTemplateName.value = t.name
  confirmationTemplateLanguage.value = t.language
}
function useForRecall(t: Template) {
  recallTemplateName.value = t.name
  recallTemplateLanguage.value = t.language
}
function useForReminder(t: Template) {
  reminderTemplateName.value = t.name
  reminderTemplateLanguage.value = t.language
}

async function save() {
  error.value = ''
  saved.value = false
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
  }
  if (accessToken.value.trim()) update.whatsapp_access_token = accessToken.value.trim()

  const { error: updateError } = await supabase.from('accounts').update(update).eq('id', store.accountId!)
  saving.value = false
  if (updateError) {
    error.value = updateError.message
    return
  }
  saved.value = true
  if (accessToken.value.trim()) hasStoredToken.value = true
  accessToken.value = ''
  if (hasStoredToken.value && businessAccountId.value) loadTemplates()
}
</script>

<template>
  <div class="flex h-full flex-col">
    <PageHeader :title="t('WhatsApp', 'WhatsApp')">
      <UiBtn variant="primary" :disabled="saving || loading" @click="save">{{ saving ? t('Saving…', 'Guardando…') : t('Save changes', 'Guardar cambios') }}</UiBtn>
    </PageHeader>
    <div class="flex-1 overflow-y-auto">
      <div class="flex gap-8 p-6">
        <SettingsNav />
        <div class="min-w-0 max-w-[660px] flex-1">
          <p class="text-[13px] leading-relaxed text-ink-muted2">
            {{ t("Connects directly to Meta's WhatsApp Business Cloud API. You'll need a Phone Number ID, a WhatsApp Business Account ID, and a permanent access token from your Meta Business account, plus at least one approved message template.", 'Se conecta directamente con la API de WhatsApp Business Cloud de Meta. Necesitarás un ID de número de teléfono, un ID de cuenta de WhatsApp Business y un token de acceso permanente de tu cuenta de Meta Business, además de al menos una plantilla de mensaje aprobada.') }}
          </p>

          <div v-if="loading" class="mt-6 text-[13px] text-ink-faint">{{ t('Loading…', 'Cargando…') }}</div>
          <form v-else class="mt-5 space-y-3" @submit.prevent="save">
            <SettingsFieldRow :label="t('Phone Number ID', 'ID del número de teléfono')">
              <input v-model="phoneNumberId" type="text" class="h-8 w-[230px] rounded-ctl border border-line-control bg-surface px-3 text-[13px] text-ink-700 focus:border-brand focus:outline-none focus:ring-1 focus:ring-brand/20" />
            </SettingsFieldRow>

            <SettingsFieldRow :label="t('WhatsApp Business Account ID', 'ID de la cuenta de WhatsApp Business')">
              <input v-model="businessAccountId" type="text" class="h-8 w-[230px] rounded-ctl border border-line-control bg-surface px-3 text-[13px] text-ink-700 focus:border-brand focus:outline-none focus:ring-1 focus:ring-brand/20" />
            </SettingsFieldRow>

            <SettingsFieldRow :label="t('Access token', 'Token de acceso')" :helper="hasStoredToken ? t('A token is already stored — leave blank to keep it.', 'Ya hay un token guardado — déjalo en blanco para conservarlo.') : t('From your Meta Business account.', 'De tu cuenta de Meta Business.')">
              <input
                v-model="accessToken"
                type="password"
                autocomplete="off"
                :placeholder="hasStoredToken ? t('Leave blank to keep it', 'Déjalo en blanco para conservarlo') : ''"
                class="h-8 w-[230px] rounded-ctl border border-line-control bg-surface px-3 text-[13px] text-ink-700 placeholder:text-ink-faint2 focus:border-brand focus:outline-none focus:ring-1 focus:ring-brand/20"
              />
            </SettingsFieldRow>

            <SettingsFieldRow
              :label="t('Default confirmation template', 'Plantilla de confirmación predeterminada')"
              :helper="t('Used automatically for appointment confirmations. If the patient\'s preferred language has its own approved variant, that one is used instead.', 'Se usa automáticamente para las confirmaciones de cita. Si el idioma preferido del paciente tiene su propia variante aprobada, se usa esa en su lugar.')"
              align="top"
            >
              <div class="flex gap-2">
                <input
                  v-model="confirmationTemplateName"
                  type="text"
                  placeholder="template_name"
                  class="h-8 w-[152px] rounded-ctl border border-line-control bg-surface px-3 text-[13px] text-ink-700 placeholder:text-ink-faint2 focus:border-brand focus:outline-none focus:ring-1 focus:ring-brand/20"
                />
                <input
                  v-model="confirmationTemplateLanguage"
                  type="text"
                  placeholder="es"
                  class="h-8 w-[70px] rounded-ctl border border-line-control bg-surface px-3 text-[13px] text-ink-700 placeholder:text-ink-faint2 focus:border-brand focus:outline-none focus:ring-1 focus:ring-brand/20"
                />
              </div>
            </SettingsFieldRow>

            <SettingsFieldRow
              :label="t('Default recall template', 'Plantilla de recordatorio de revisión predeterminada')"
              :helper="t('Pre-selected when sending a recall, but the picker stays visible so staff can switch it per recall.', 'Preseleccionada al enviar un recordatorio de revisión, pero el selector sigue visible para que el personal pueda cambiarla en cada envío.')"
              align="top"
            >
              <div class="flex gap-2">
                <input
                  v-model="recallTemplateName"
                  type="text"
                  placeholder="template_name"
                  class="h-8 w-[152px] rounded-ctl border border-line-control bg-surface px-3 text-[13px] text-ink-700 placeholder:text-ink-faint2 focus:border-brand focus:outline-none focus:ring-1 focus:ring-brand/20"
                />
                <input
                  v-model="recallTemplateLanguage"
                  type="text"
                  placeholder="es"
                  class="h-8 w-[70px] rounded-ctl border border-line-control bg-surface px-3 text-[13px] text-ink-700 placeholder:text-ink-faint2 focus:border-brand focus:outline-none focus:ring-1 focus:ring-brand/20"
                />
              </div>
            </SettingsFieldRow>

            <SettingsFieldRow
              :label="t('Default reminder template', 'Plantilla de recordatorio predeterminada')"
              :helper="t('Used automatically for appointment reminders. If the patient\'s preferred language has its own approved variant, that one is used instead. Enable/disable reminders and pick how far ahead they send in Settings → Communication → General.', 'Se usa automáticamente para los recordatorios de cita. Si el idioma preferido del paciente tiene su propia variante aprobada, se usa esa en su lugar. Activa/desactiva los recordatorios y elige con cuánta antelación se envían en Ajustes → Comunicación → General.')"
              align="top"
            >
              <div class="flex gap-2">
                <input
                  v-model="reminderTemplateName"
                  type="text"
                  placeholder="template_name"
                  class="h-8 w-[152px] rounded-ctl border border-line-control bg-surface px-3 text-[13px] text-ink-700 placeholder:text-ink-faint2 focus:border-brand focus:outline-none focus:ring-1 focus:ring-brand/20"
                />
                <input
                  v-model="reminderTemplateLanguage"
                  type="text"
                  placeholder="es"
                  class="h-8 w-[70px] rounded-ctl border border-line-control bg-surface px-3 text-[13px] text-ink-700 placeholder:text-ink-faint2 focus:border-brand focus:outline-none focus:ring-1 focus:ring-brand/20"
                />
              </div>
            </SettingsFieldRow>

            <div class="rounded-card border border-line bg-surface p-4 shadow-card">
              <div class="flex items-center justify-between">
                <p class="text-[13.5px] font-[560] text-ink-700">{{ t('Approved templates', 'Plantillas aprobadas') }}</p>
                <button type="button" class="text-[12.5px] font-medium text-brand-text hover:text-brand-hover" @click="loadTemplates">
                  {{ loadingTemplates ? t('Loading…', 'Cargando…') : t('Load from Meta', 'Cargar desde Meta') }}
                </button>
              </div>
              <p v-if="templatesError" class="mt-1 text-[12.5px] text-danger-text">{{ templatesError }}</p>
              <ul v-if="templates.length > 0" class="mt-3 divide-y divide-line-row rounded-ctl border border-line">
                <li v-for="tpl in templates" :key="tpl.name + tpl.language" class="flex items-center justify-between px-3 py-2 text-[13px]">
                  <div>
                    <span class="font-medium text-ink-700">{{ tpl.name }}</span>
                    <span class="ml-1 text-[12px] text-ink-faint2">{{ tpl.language }} &middot; {{ tpl.category }}</span>
                  </div>
                  <div class="flex gap-3 text-[12px] font-medium">
                    <button type="button" class="text-brand-text hover:text-brand-hover" @click="useForConfirmation(tpl)">{{ t('Use for confirmation', 'Usar para confirmación') }}</button>
                    <button type="button" class="text-brand-text hover:text-brand-hover" @click="useForRecall(tpl)">{{ t('Use for recall', 'Usar para revisión') }}</button>
                    <button type="button" class="text-brand-text hover:text-brand-hover" @click="useForReminder(tpl)">{{ t('Use for reminder', 'Usar para recordatorio') }}</button>
                  </div>
                </li>
              </ul>
            </div>

            <p v-if="saved" class="text-[12.5px] text-success-text">{{ t('Saved.', 'Guardado.') }}</p>
            <p v-if="error" class="text-[12.5px] text-danger-text">{{ error }}</p>
          </form>

          <div class="mt-6 rounded-card border border-line bg-surface p-4 shadow-card">
            <h3 class="text-[13.5px] font-[560] text-ink-700">{{ t('Delivery & reply tracking', 'Seguimiento de entrega y respuesta') }}</h3>
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
        </div>
      </div>
    </div>
  </div>
</template>
