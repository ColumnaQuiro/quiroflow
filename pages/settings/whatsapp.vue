<script setup lang="ts">
import type { TablesUpdate } from '~/types/database.types'

const supabase = useSupabaseClient()
const store = useAccountStore()

const phoneNumberId = ref('')
const businessAccountId = ref('')
const accessToken = ref('')
const hasStoredToken = ref(false)
const confirmationTemplateName = ref('')
const confirmationTemplateLanguage = ref('es')
const recallTemplateName = ref('')
const recallTemplateLanguage = ref('es')

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
      'whatsapp_phone_number_id, whatsapp_business_account_id, whatsapp_access_token, whatsapp_confirmation_template_name, whatsapp_confirmation_template_language, whatsapp_recall_template_name, whatsapp_recall_template_language',
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
  loading.value = false

  if (hasStoredToken.value && businessAccountId.value) loadTemplates()
}
onMounted(load)

async function loadTemplates() {
  loadingTemplates.value = true
  templatesError.value = ''
  try {
    const { templates: list } = await $fetch<{ templates: Template[] }>('/api/whatsapp/templates')
    templates.value = list
  } catch (err: any) {
    templatesError.value = err?.data?.statusMessage ?? 'Failed to load templates'
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
  <div class="flex gap-8">
    <SettingsNav />
    <div class="min-w-0 max-w-2xl flex-1">
      <h1 class="text-xl font-semibold text-gray-900">WhatsApp</h1>
    <p class="mt-1 text-sm text-gray-500">
      Connects directly to Meta's WhatsApp Business Cloud API. You'll need a Phone Number ID, a WhatsApp Business
      Account ID, and a permanent access token from your Meta Business account, plus at least one approved message
      template.
    </p>

    <div v-if="loading" class="mt-6 text-sm text-gray-400">Loading…</div>
    <form v-else class="mt-6 space-y-6" @submit.prevent="save">
      <div>
        <label class="block text-sm font-medium text-gray-700">Phone Number ID</label>
        <input
          v-model="phoneNumberId"
          type="text"
          class="mt-1 w-full rounded-md border border-gray-300 px-3 py-2 text-sm focus:border-indigo-500 focus:outline-none focus:ring-1 focus:ring-indigo-500"
        />
      </div>

      <div>
        <label class="block text-sm font-medium text-gray-700">WhatsApp Business Account ID</label>
        <input
          v-model="businessAccountId"
          type="text"
          class="mt-1 w-full rounded-md border border-gray-300 px-3 py-2 text-sm focus:border-indigo-500 focus:outline-none focus:ring-1 focus:ring-indigo-500"
        />
      </div>

      <div>
        <label class="block text-sm font-medium text-gray-700">Access token</label>
        <input
          v-model="accessToken"
          type="password"
          autocomplete="off"
          :placeholder="hasStoredToken ? 'Token is set — leave blank to keep it' : ''"
          class="mt-1 w-full rounded-md border border-gray-300 px-3 py-2 text-sm focus:border-indigo-500 focus:outline-none focus:ring-1 focus:ring-indigo-500"
        />
      </div>

      <div>
        <label class="block text-sm font-medium text-gray-700">Default confirmation template</label>
        <div class="mt-1 flex gap-2">
          <input
            v-model="confirmationTemplateName"
            type="text"
            placeholder="template_name"
            class="w-full rounded-md border border-gray-300 px-3 py-2 text-sm focus:border-indigo-500 focus:outline-none focus:ring-1 focus:ring-indigo-500"
          />
          <input
            v-model="confirmationTemplateLanguage"
            type="text"
            placeholder="es"
            class="w-20 rounded-md border border-gray-300 px-3 py-2 text-sm focus:border-indigo-500 focus:outline-none focus:ring-1 focus:ring-indigo-500"
          />
        </div>
        <p class="mt-1 text-xs text-gray-500">
          Used automatically when sending an appointment confirmation — no template picker shown, just the variables
          to fill in. If the patient's preferred language has its own approved variant of this template, that one is
          used instead of the language set here.
        </p>
      </div>

      <div>
        <label class="block text-sm font-medium text-gray-700">Default recall template</label>
        <div class="mt-1 flex gap-2">
          <input
            v-model="recallTemplateName"
            type="text"
            placeholder="template_name"
            class="w-full rounded-md border border-gray-300 px-3 py-2 text-sm focus:border-indigo-500 focus:outline-none focus:ring-1 focus:ring-indigo-500"
          />
          <input
            v-model="recallTemplateLanguage"
            type="text"
            placeholder="es"
            class="w-20 rounded-md border border-gray-300 px-3 py-2 text-sm focus:border-indigo-500 focus:outline-none focus:ring-1 focus:ring-indigo-500"
          />
        </div>
        <p class="mt-1 text-xs text-gray-500">
          Pre-selected when sending a recall, but the template picker stays visible so staff can switch to a
          different one (different recalls often need different wording).
        </p>
      </div>

      <div>
        <button type="button" class="text-xs font-medium text-indigo-600 hover:text-indigo-700" @click="loadTemplates">
          {{ loadingTemplates ? 'Loading…' : 'Load approved templates from Meta' }}
        </button>
        <p v-if="templatesError" class="mt-1 text-xs text-red-600">{{ templatesError }}</p>
        <ul v-if="templates.length > 0" class="mt-2 divide-y divide-gray-100 rounded-md border border-gray-200">
          <li v-for="t in templates" :key="t.name + t.language" class="flex items-center justify-between px-3 py-2 text-sm">
            <div>
              <span class="font-medium text-gray-900">{{ t.name }}</span>
              <span class="ml-1 text-xs text-gray-400">{{ t.language }} &middot; {{ t.category }}</span>
            </div>
            <div class="flex gap-3 text-xs font-medium">
              <button type="button" class="text-indigo-600 hover:text-indigo-700" @click="useForConfirmation(t)">Use for confirmation</button>
              <button type="button" class="text-indigo-600 hover:text-indigo-700" @click="useForRecall(t)">Use for recall</button>
            </div>
          </li>
        </ul>
      </div>

      <div class="flex items-center gap-3">
        <button type="submit" :disabled="saving" class="rounded-md bg-indigo-600 px-4 py-2 text-sm font-medium text-white hover:bg-indigo-700 disabled:opacity-50">
          {{ saving ? 'Saving…' : 'Save' }}
        </button>
        <span v-if="saved" class="text-sm text-green-600">Saved.</span>
      </div>
      <p v-if="error" class="text-sm text-red-600">{{ error }}</p>
    </form>

    <div class="mt-8 rounded-lg border border-gray-200 bg-white p-4">
      <h3 class="text-sm font-semibold text-gray-900">Delivery &amp; reply tracking</h3>
      <p class="mt-1 text-sm text-gray-500">
        Optional. Feeds the "Scheduled Reminders" report — whether a message actually delivered (vs. a bad number or
        a recipient with no WhatsApp) and whether a patient replied to confirm or reschedule. Meta only allows
        <strong>one</strong> webhook URL per WhatsApp Business number, so if you already point it at another tool
        (n8n, Zapier, your own backend...), you have two options — no need to give that up:
      </p>
      <ol class="mt-3 list-decimal space-y-3 pl-5 text-sm text-gray-700">
        <li>
          <strong>Nothing already using the webhook slot?</strong> Register this URL directly in your Meta App
          dashboard, under <strong>WhatsApp &rarr; Configuration &rarr; Webhook</strong>:
          <div class="mt-1.5 flex items-center gap-2">
            <code class="flex-1 overflow-x-auto rounded bg-gray-100 px-2 py-1 text-xs">{{ webhookUrl }}</code>
          </div>
        </li>
        <li>
          <strong>Already forwarding to n8n or something else?</strong> Add one more step to that existing flow — an
          HTTP request node that forwards the same incoming payload, unmodified, to the URL above. QuiroFlow doesn't
          need to be Meta's registered endpoint, just a second place the payload also lands.
        </li>
      </ol>
      <p class="mt-3 text-xs text-gray-500">
        Either way it needs a verify token — set <code class="rounded bg-gray-100 px-1 py-0.5">WHATSAPP_WEBHOOK_VERIFY_TOKEN</code>
        in your server's environment (only relevant for option 1, Meta's own verification handshake), and
        <code class="rounded bg-gray-100 px-1 py-0.5">NUXT_SUPABASE_SECRET_KEY</code> (Supabase Project Settings
        &rarr; API &rarr; service_role secret) either way, since this endpoint has no QuiroFlow login to authenticate
        with.
      </p>
      <p class="mt-2 text-xs text-gray-400">
        Skip this entirely and confirmations still send fine — you'll just see "pending" stay pending in the report
        instead of moving to confirmed/reschedule automatically.
      </p>
    </div>
    </div>
  </div>
</template>
