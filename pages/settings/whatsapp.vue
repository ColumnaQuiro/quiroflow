<script setup lang="ts">
const supabase = useSupabaseClient()
const store = useAccountStore()

const webhookUrl = ref('')
const recallTemplate = ref('')
const confirmationTemplate = ref('')
const loading = ref(true)
const saving = ref(false)
const saved = ref(false)
const error = ref('')

async function load() {
  loading.value = true
  const { data } = await supabase
    .from('accounts')
    .select('whatsapp_webhook_url, recall_whatsapp_template, confirmation_whatsapp_template')
    .eq('id', store.accountId!)
    .maybeSingle()
  webhookUrl.value = data?.whatsapp_webhook_url ?? ''
  recallTemplate.value = data?.recall_whatsapp_template ?? ''
  confirmationTemplate.value = data?.confirmation_whatsapp_template ?? ''
  loading.value = false
}
onMounted(load)

function field(name: string) {
  return `{{${name}}}`
}

async function save() {
  error.value = ''
  saved.value = false
  saving.value = true
  const { error: updateError } = await supabase
    .from('accounts')
    .update({
      whatsapp_webhook_url: webhookUrl.value.trim() || null,
      recall_whatsapp_template: recallTemplate.value,
      confirmation_whatsapp_template: confirmationTemplate.value,
    })
    .eq('id', store.accountId!)
  saving.value = false
  if (updateError) {
    error.value = updateError.message
    return
  }
  saved.value = true
}
</script>

<template>
  <div class="max-w-2xl">
    <div class="flex items-center justify-between">
      <h1 class="text-xl font-semibold text-gray-900">WhatsApp</h1>
      <NuxtLink to="/settings" class="text-sm text-gray-500 hover:text-gray-700">&larr; Back to Settings</NuxtLink>
    </div>
    <p class="mt-1 text-sm text-gray-500">
      QuiroFlow doesn't send WhatsApp messages itself &mdash; it posts to a webhook you control (n8n, Make, or your
      own automation) which does the actual sending through your WhatsApp Business setup.
    </p>

    <div v-if="loading" class="mt-6 text-sm text-gray-400">Loading…</div>
    <form v-else class="mt-6 space-y-6" @submit.prevent="save">
      <div>
        <label class="block text-sm font-medium text-gray-700">Webhook URL</label>
        <input
          v-model="webhookUrl"
          type="url"
          placeholder="https://your-n8n-instance.com/webhook/whatsapp"
          class="mt-1 w-full rounded-md border border-gray-300 px-3 py-2 text-sm focus:border-indigo-500 focus:outline-none focus:ring-1 focus:ring-indigo-500"
        />
        <p class="mt-1 text-xs text-gray-500">
          QuiroFlow POSTs <code>{ patient, phone_number, phone_country_code, message, attachment_url }</code> here
          whenever staff send a WhatsApp message. Leave blank to disable WhatsApp sending.
        </p>
      </div>

      <div>
        <label class="block text-sm font-medium text-gray-700">Recall message template</label>
        <textarea
          v-model="recallTemplate"
          rows="3"
          class="mt-1 w-full rounded-md border border-gray-300 px-3 py-2 text-sm focus:border-indigo-500 focus:outline-none focus:ring-1 focus:ring-indigo-500"
        ></textarea>
        <p class="mt-1 text-xs text-gray-500">Available: <code>{{ field('first_name') }}</code>, <code>{{ field('last_name') }}</code>, <code>{{ field('clinic_name') }}</code></p>
      </div>

      <div>
        <label class="block text-sm font-medium text-gray-700">Appointment confirmation template</label>
        <textarea
          v-model="confirmationTemplate"
          rows="3"
          class="mt-1 w-full rounded-md border border-gray-300 px-3 py-2 text-sm focus:border-indigo-500 focus:outline-none focus:ring-1 focus:ring-indigo-500"
        ></textarea>
        <p class="mt-1 text-xs text-gray-500">
          Available: <code>{{ field('first_name') }}</code>, <code>{{ field('last_name') }}</code>,
          <code>{{ field('clinic_name') }}</code>, <code>{{ field('appointment_date') }}</code>, <code>{{ field('appointment_time') }}</code>
        </p>
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
