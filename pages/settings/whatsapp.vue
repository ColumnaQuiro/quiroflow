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

const loading = ref(true)
const saving = ref(false)
const saved = ref(false)
const error = ref('')

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
      'whatsapp_phone_number_id, whatsapp_business_account_id, whatsapp_access_token, whatsapp_confirmation_template_name, whatsapp_confirmation_template_language',
    )
    .eq('id', store.accountId!)
    .maybeSingle()
  phoneNumberId.value = data?.whatsapp_phone_number_id ?? ''
  businessAccountId.value = data?.whatsapp_business_account_id ?? ''
  hasStoredToken.value = !!data?.whatsapp_access_token
  confirmationTemplateName.value = data?.whatsapp_confirmation_template_name ?? ''
  confirmationTemplateLanguage.value = data?.whatsapp_confirmation_template_language ?? 'es'
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

function pickTemplate(t: Template) {
  confirmationTemplateName.value = t.name
  confirmationTemplateLanguage.value = t.language
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
  <div class="max-w-2xl">
    <div class="flex items-center justify-between">
      <h1 class="text-xl font-semibold text-gray-900">WhatsApp</h1>
      <NuxtLink to="/settings" class="text-sm text-gray-500 hover:text-gray-700">&larr; Back to Settings</NuxtLink>
    </div>
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
          Pre-selected when sending an appointment confirmation. Recalls let you pick any approved template at send
          time.
        </p>

        <div class="mt-2">
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
              <button type="button" class="text-xs font-medium text-indigo-600 hover:text-indigo-700" @click="pickTemplate(t)">Use</button>
            </li>
          </ul>
        </div>
      </div>

      <div class="flex items-center gap-3">
        <button type="submit" :disabled="saving" class="rounded-md bg-indigo-600 px-4 py-2 text-sm font-medium text-white hover:bg-indigo-700 disabled:opacity-50">
          {{ saving ? 'Saving…' : 'Save' }}
        </button>
        <span v-if="saved" class="text-sm text-green-600">Saved.</span>
      </div>
      <p v-if="error" class="text-sm text-red-600">{{ error }}</p>
    </form>
  </div>
</template>
