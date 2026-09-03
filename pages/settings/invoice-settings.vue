<script setup lang="ts">
const supabase = useSupabaseClient()
const store = useAccountStore()
const t = useT()

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
    <PageHeader :title="t('Invoice Settings', 'Ajustes de facturación')" />
    <div class="flex-1 overflow-y-auto">
      <div class="flex gap-8 p-6">
        <SettingsNav />
        <div v-if="!loading" class="min-w-0 max-w-[560px] flex-1 space-y-6">
          <div class="rounded-card border border-line bg-surface p-4 shadow-card">
            <p class="text-[13px] font-semibold text-ink-700">{{ t('Invoice Numbering', 'Numeración de facturas') }}</p>
            <label class="mt-2 block text-[12.5px] font-medium text-ink-600">{{ t('Next invoice number', 'Próximo número de factura') }}</label>
            <input v-model="nextInvoiceNumber" type="number" min="1" :placeholder="t('Leave blank to keep counting automatically', 'Déjalo en blanco para seguir contando automáticamente')" class="mt-1 h-8 w-64 rounded-ctl border border-line-control bg-surface px-3 text-[13px] text-ink-700 focus:border-brand focus:outline-none" />
          </div>

          <div class="rounded-card border border-line bg-surface p-4 shadow-card">
            <p class="text-[13px] font-semibold text-ink-700">{{ t('Send Invoices Automatically', 'Enviar facturas automáticamente') }}</p>
            <p class="mt-1 text-[12px] text-ink-muted2">{{ t('New patients default to "Send Invoices via Email Automatically" set to this value.', 'Los nuevos pacientes tienen por defecto "Enviar facturas por correo automáticamente" con este valor.') }}</p>
            <label class="mt-2 flex items-center gap-2 text-[13px] text-ink-600">
              <SettingsToggle v-model="sendAutomatically" />
              {{ sendAutomatically ? t('Yes', 'Sí') : t('No', 'No') }}
            </label>
          </div>

          <div class="rounded-card border border-line bg-surface p-4 shadow-card">
            <p class="text-[13px] font-semibold text-ink-700">{{ t('Patient Information Display', 'Visualización de datos del paciente') }}</p>
            <div class="mt-2 space-y-2">
              <label class="flex items-center gap-2 text-[13px] text-ink-600"><SettingsToggle v-model="showDob" /> {{ t('Show date of birth in patient details', 'Mostrar fecha de nacimiento en los datos del paciente') }}</label>
              <label class="flex items-center gap-2 text-[13px] text-ink-600"><SettingsToggle v-model="showSsn" /> {{ t('Show national ID / social security number', 'Mostrar DNI/NIE / número de la seguridad social') }}</label>
              <label class="flex items-center gap-2 text-[13px] text-ink-600"><SettingsToggle v-model="showTaxes" /> {{ t('Show taxes on invoices & statements', 'Mostrar impuestos en facturas y extractos') }}</label>
            </div>
          </div>

          <div class="rounded-card border border-line bg-surface p-4 shadow-card">
            <p class="text-[13px] font-semibold text-ink-700">{{ t('Invoice Content Visibility', 'Visibilidad del contenido de la factura') }}</p>
            <div class="mt-2 space-y-2">
              <label class="flex items-center gap-2 text-[13px] text-ink-600"><SettingsToggle v-model="hideInvoiceBalance" /> {{ t('Hide invoice balance on invoices', 'Ocultar el saldo de la factura en las facturas') }}</label>
              <label class="flex items-center gap-2 text-[13px] text-ink-600"><SettingsToggle v-model="hideAccountBalance" /> {{ t('Hide account balance on invoices', 'Ocultar el saldo de la cuenta en las facturas') }}</label>
              <label class="flex items-center gap-2 text-[13px] text-ink-600"><SettingsToggle v-model="hidePayments" /> {{ t('Hide payments on invoices', 'Ocultar los pagos en las facturas') }}</label>
              <label class="flex items-center gap-2 text-[13px] text-ink-600"><SettingsToggle v-model="hideProvider" /> {{ t('Hide provider on invoices', 'Ocultar el profesional en las facturas') }}</label>
              <label class="flex items-center gap-2 text-[13px] text-ink-600"><SettingsToggle v-model="hideNextVisit" /> {{ t('Hide "Your next visit" on invoices', 'Ocultar "Tu próxima visita" en las facturas') }}</label>
              <label class="flex items-center gap-2 text-[13px] text-ink-600"><SettingsToggle v-model="hideLogo" /> {{ t('Hide logo on invoices & statements', 'Ocultar el logotipo en facturas y extractos') }}</label>
            </div>
          </div>

          <div class="rounded-card border border-line bg-surface p-4 shadow-card">
            <p class="text-[13px] font-semibold text-ink-700">{{ t('Email Customization', 'Personalización del correo') }}</p>
            <label class="mt-2 block text-[12.5px] font-medium text-ink-600">{{ t('Invoice email subject', 'Asunto del correo de factura') }}</label>
            <input v-model="emailSubject" type="text" :placeholder="t('Your invoice from {{clinic_name}}', 'Tu factura de {{clinic_name}}')" class="mt-1 w-full rounded-ctl border border-line-control bg-surface px-3 py-2 text-[13px] text-ink-700 focus:border-brand focus:outline-none" />
            <label class="mt-3 block text-[12.5px] font-medium text-ink-600">{{ t('Invoice email body', 'Cuerpo del correo de factura') }}</label>
            <textarea v-model="emailBody" rows="4" :placeholder="t('Copy for automatic invoice emails sent to patients', 'Texto para los correos automáticos de factura enviados a los pacientes')" class="mt-1 w-full rounded-ctl border border-line-control bg-surface px-3 py-2 text-[13px] text-ink-700 focus:border-brand focus:outline-none" />
          </div>

          <UiBtn variant="primary" :disabled="saving" @click="save">{{ saving ? t('Saving…', 'Guardando…') : t('Save Settings', 'Guardar ajustes') }}</UiBtn>
        </div>
      </div>
    </div>
  </div>
</template>
