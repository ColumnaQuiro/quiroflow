<script setup lang="ts">
const supabase = useSupabaseClient()
const store = useAccountStore()

const loading = ref(true)
const saving = ref(false)

const nextInvoiceNumber = ref('')
const sendAutomatically = ref(false)
const showDob = ref(false)
const showSsn = ref(false)
const showTaxes = ref(false)
const hideInvoiceBalance = ref(false)
const hideAccountBalance = ref(false)
const hidePayments = ref(false)
const hideProvider = ref(false)
const hideNextVisit = ref(false)
const hideLogo = ref(false)
const emailSubject = ref('')
const emailBody = ref('')

async function load() {
  loading.value = true
  const { data } = await supabase
    .from('accounts')
    .select(
      'next_invoice_number, send_invoices_automatically_default, show_dob_on_invoices, show_ssn_on_invoices, show_taxes_on_invoices, hide_invoice_balance, hide_account_balance, hide_payments_on_invoices, hide_provider_on_invoices, hide_next_visit_on_invoices, hide_logo_on_invoices, invoice_email_subject, invoice_email_body',
    )
    .eq('id', store.accountId!)
    .maybeSingle()
  if (data) {
    nextInvoiceNumber.value = data.next_invoice_number != null ? String(data.next_invoice_number) : ''
    sendAutomatically.value = data.send_invoices_automatically_default
    showDob.value = data.show_dob_on_invoices
    showSsn.value = data.show_ssn_on_invoices
    showTaxes.value = data.show_taxes_on_invoices
    hideInvoiceBalance.value = data.hide_invoice_balance
    hideAccountBalance.value = data.hide_account_balance
    hidePayments.value = data.hide_payments_on_invoices
    hideProvider.value = data.hide_provider_on_invoices
    hideNextVisit.value = data.hide_next_visit_on_invoices
    hideLogo.value = data.hide_logo_on_invoices
    emailSubject.value = data.invoice_email_subject ?? ''
    emailBody.value = data.invoice_email_body ?? ''
  }
  loading.value = false
}
onMounted(load)

async function save() {
  saving.value = true
  await supabase
    .from('accounts')
    .update({
      next_invoice_number: nextInvoiceNumber.value.trim() ? parseInt(nextInvoiceNumber.value, 10) : null,
      send_invoices_automatically_default: sendAutomatically.value,
      show_dob_on_invoices: showDob.value,
      show_ssn_on_invoices: showSsn.value,
      show_taxes_on_invoices: showTaxes.value,
      hide_invoice_balance: hideInvoiceBalance.value,
      hide_account_balance: hideAccountBalance.value,
      hide_payments_on_invoices: hidePayments.value,
      hide_provider_on_invoices: hideProvider.value,
      hide_next_visit_on_invoices: hideNextVisit.value,
      hide_logo_on_invoices: hideLogo.value,
      invoice_email_subject: emailSubject.value || null,
      invoice_email_body: emailBody.value || null,
    })
    .eq('id', store.accountId!)
  saving.value = false
}
</script>

<template>
  <div class="flex h-full flex-col">
    <PageHeader title="Invoice Settings" />
    <div class="flex-1 overflow-y-auto">
      <div class="flex gap-8 p-6">
        <SettingsNav />
        <div v-if="!loading" class="min-w-0 max-w-[560px] flex-1 space-y-6">
          <div class="rounded-card border border-line bg-surface p-4 shadow-card">
            <p class="text-[13px] font-semibold text-ink-700">Invoice Numbering</p>
            <label class="mt-2 block text-[12.5px] font-medium text-ink-600">Next invoice number</label>
            <input v-model="nextInvoiceNumber" type="number" min="1" placeholder="Leave blank to keep counting automatically" class="mt-1 h-8 w-64 rounded-ctl border border-line-control bg-surface px-3 text-[13px] text-ink-700 focus:border-brand focus:outline-none" />
          </div>

          <div class="rounded-card border border-line bg-surface p-4 shadow-card">
            <p class="text-[13px] font-semibold text-ink-700">Send Invoices Automatically</p>
            <p class="mt-1 text-[12px] text-ink-muted2">New patients default to "Send Invoices via Email Automatically" set to this value.</p>
            <label class="mt-2 flex items-center gap-2 text-[13px] text-ink-600">
              <SettingsToggle v-model="sendAutomatically" />
              {{ sendAutomatically ? 'Yes' : 'No' }}
            </label>
          </div>

          <div class="rounded-card border border-line bg-surface p-4 shadow-card">
            <p class="text-[13px] font-semibold text-ink-700">Patient Information Display</p>
            <div class="mt-2 space-y-2">
              <label class="flex items-center gap-2 text-[13px] text-ink-600"><SettingsToggle v-model="showDob" /> Show date of birth in patient details</label>
              <label class="flex items-center gap-2 text-[13px] text-ink-600"><SettingsToggle v-model="showSsn" /> Show national ID / social security number</label>
              <label class="flex items-center gap-2 text-[13px] text-ink-600"><SettingsToggle v-model="showTaxes" /> Show taxes on invoices & statements</label>
            </div>
          </div>

          <div class="rounded-card border border-line bg-surface p-4 shadow-card">
            <p class="text-[13px] font-semibold text-ink-700">Invoice Content Visibility</p>
            <div class="mt-2 space-y-2">
              <label class="flex items-center gap-2 text-[13px] text-ink-600"><SettingsToggle v-model="hideInvoiceBalance" /> Hide invoice balance on invoices</label>
              <label class="flex items-center gap-2 text-[13px] text-ink-600"><SettingsToggle v-model="hideAccountBalance" /> Hide account balance on invoices</label>
              <label class="flex items-center gap-2 text-[13px] text-ink-600"><SettingsToggle v-model="hidePayments" /> Hide payments on invoices</label>
              <label class="flex items-center gap-2 text-[13px] text-ink-600"><SettingsToggle v-model="hideProvider" /> Hide provider on invoices</label>
              <label class="flex items-center gap-2 text-[13px] text-ink-600"><SettingsToggle v-model="hideNextVisit" /> Hide "Your next visit" on invoices</label>
              <label class="flex items-center gap-2 text-[13px] text-ink-600"><SettingsToggle v-model="hideLogo" /> Hide logo on invoices & statements</label>
            </div>
          </div>

          <div class="rounded-card border border-line bg-surface p-4 shadow-card">
            <p class="text-[13px] font-semibold text-ink-700">Email Customization</p>
            <label class="mt-2 block text-[12.5px] font-medium text-ink-600">Invoice email subject</label>
            <input v-model="emailSubject" type="text" placeholder="Your invoice from {{clinic_name}}" class="mt-1 w-full rounded-ctl border border-line-control bg-surface px-3 py-2 text-[13px] text-ink-700 focus:border-brand focus:outline-none" />
            <label class="mt-3 block text-[12.5px] font-medium text-ink-600">Invoice email body</label>
            <textarea v-model="emailBody" rows="4" placeholder="Copy for automatic invoice emails sent to patients" class="mt-1 w-full rounded-ctl border border-line-control bg-surface px-3 py-2 text-[13px] text-ink-700 focus:border-brand focus:outline-none" />
          </div>

          <UiBtn variant="primary" :disabled="saving" @click="save">{{ saving ? 'Saving…' : 'Save Settings' }}</UiBtn>
        </div>
      </div>
    </div>
  </div>
</template>
