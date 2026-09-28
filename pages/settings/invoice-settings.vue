<script setup lang="ts">
const supabase = useSupabaseClient()
const store = useAccountStore()
const t = useT()
const { showToast } = useToast()

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

// Factura numbering. The next numbers are sent only when changed: loading 89
// and saving 89 back after the desk issued 89 in the meantime would read as
// moving the count backwards, which the database refuses.
interface FacturaNumbering {
  year: number
  factura_prefix: string
  rectificativa_prefix: string
  next_factura: number
  next_rectificativa: number
}
const numbering = ref<FacturaNumbering | null>(null)
const facturaPrefix = ref('')
const rectificativaPrefix = ref('')
const nextFactura = ref('')
const nextRectificativa = ref('')
const PREFIX = /^[A-Za-z0-9]{1,10}$/

function facturaNumberPreview(prefix: string, next: string) {
  const n = parseInt(next, 10)
  return `${prefix.trim() || '…'}-${numbering.value?.year ?? ''}-${String(Number.isFinite(n) ? n : 1).padStart(4, '0')}`
}

const numberingError = computed(() => {
  if (!numbering.value) return ''
  if (!PREFIX.test(facturaPrefix.value.trim()) || !PREFIX.test(rectificativaPrefix.value.trim())) {
    return t('A prefix is 1 to 10 letters or digits.', 'Un prefijo tiene de 1 a 10 letras o números.')
  }
  if (facturaPrefix.value.trim().toUpperCase() === rectificativaPrefix.value.trim().toUpperCase()) {
    return t('Facturas and rectificativas need different prefixes.', 'Las facturas y las rectificativas necesitan prefijos distintos.')
  }
  const checks: [string, number][] = [[nextFactura.value, numbering.value.next_factura], [nextRectificativa.value, numbering.value.next_rectificativa]]
  for (const [value, current] of checks) {
    const n = parseInt(value, 10)
    if (!Number.isInteger(n) || n < 1 || n > 999999) return t('The next number must be between 1 and 999999.', 'El próximo número debe estar entre 1 y 999999.')
    if (n < current) {
      return t(`The next number can only move forward: numbers below ${current} are already used this year.`, `El próximo número solo puede avanzar: los números por debajo de ${current} ya se han usado este año.`)
    }
  }
  return ''
})

function changedNext(value: string, current: number) {
  const n = parseInt(value, 10)
  return n === current ? null : n
}

async function loadNumbering() {
  const { data } = await supabase.rpc('get_factura_numbering', { p_account_id: store.accountId! })
  const row = data as unknown as FacturaNumbering | null
  numbering.value = row
  if (row) {
    facturaPrefix.value = row.factura_prefix
    rectificativaPrefix.value = row.rectificativa_prefix
    nextFactura.value = String(row.next_factura)
    nextRectificativa.value = String(row.next_rectificativa)
  }
}

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
  await loadNumbering()
  loading.value = false
}
onMounted(load)

async function save() {
  if (numberingError.value) {
    showToast(numberingError.value, 'error')
    return
  }
  saving.value = true
  const { error } = await supabase
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
  if (error) {
    saving.value = false
    showToast(error.message, 'error')
    return
  }
  if (numbering.value) {
    const { error: numberingSaveError } = await supabase.rpc('set_factura_numbering', {
      p_account_id: store.accountId!,
      p_factura_prefix: facturaPrefix.value.trim(),
      p_rectificativa_prefix: rectificativaPrefix.value.trim(),
      p_next_factura: changedNext(nextFactura.value, numbering.value.next_factura),
      p_next_rectificativa: changedNext(nextRectificativa.value, numbering.value.next_rectificativa),
    })
    if (numberingSaveError) {
      saving.value = false
      showToast(numberingSaveError.message, 'error')
      return
    }
    await loadNumbering()
  }
  saving.value = false
  showToast(t('Saved', 'Guardado'))
}
</script>

<template>
  <div class="flex h-full flex-col">
    <PageHeader :title="t('Receipt Settings', 'Ajustes de recibos')" />
    <div class="flex-1 overflow-y-auto">
      <div class="flex gap-8 p-6">
        <SettingsNav />
        <div v-if="!loading" class="min-w-0 max-w-[560px] flex-1 space-y-6">
          <div class="rounded-card border border-line bg-surface p-4 shadow-card">
            <p class="text-[13px] font-semibold text-ink-700">{{ t('Receipt Numbering', 'Numeración de recibos') }}</p>
            <label class="mt-2 block text-[12.5px] font-medium text-ink-600">{{ t('Next receipt number', 'Próximo número de recibo') }}</label>
            <input v-model="nextInvoiceNumber" type="number" min="1" :placeholder="t('Leave blank to keep counting automatically', 'Déjalo en blanco para seguir contando automáticamente')" class="mt-1 h-8 w-64 rounded-ctl border border-line-control bg-surface px-3 text-[13px] text-ink-700 focus:border-brand focus:outline-none" />
          </div>

          <div v-if="numbering" class="rounded-card border border-line bg-surface p-4 shadow-card" data-cy="factura-numbering">
            <p class="text-[13px] font-semibold text-ink-700">{{ t('Factura Numbering', 'Numeración de facturas') }}</p>
            <p class="mt-1 text-[12px] text-ink-muted2">
              {{ t(
                `Facturas are numbered PREFIX-YEAR-NUMBER, and the number starts again at 1 every year. You can change the prefix, and move this year's next number forward — for example to continue the series of your previous system. It cannot go back: those numbers are already on facturas.`,
                `Las facturas se numeran PREFIJO-AÑO-NÚMERO, y el número vuelve a empezar en 1 cada año. Puedes cambiar el prefijo y adelantar el próximo número de este año, por ejemplo para continuar la serie de tu sistema anterior. No puede retroceder: esos números ya están en facturas.`,
              ) }}
            </p>
            <div class="mt-3 grid grid-cols-[auto_auto_1fr] items-end gap-x-3 gap-y-3">
              <div>
                <label class="block text-[12.5px] font-medium text-ink-600">{{ t('Factura prefix', 'Prefijo de facturas') }}</label>
                <input v-model="facturaPrefix" type="text" maxlength="10" data-cy="factura-prefix" class="mt-1 h-8 w-24 rounded-ctl border border-line-control bg-surface px-3 text-[13px] text-ink-700 focus:border-brand focus:outline-none" />
              </div>
              <div>
                <label class="block text-[12.5px] font-medium text-ink-600">{{ t(`Next number (${numbering.year})`, `Próximo número (${numbering.year})`) }}</label>
                <input v-model="nextFactura" type="number" :min="numbering.next_factura" data-cy="factura-next" class="mt-1 h-8 w-32 rounded-ctl border border-line-control bg-surface px-3 text-[13px] text-ink-700 focus:border-brand focus:outline-none" />
              </div>
              <p class="pb-1.5 text-[12.5px] text-ink-muted2">{{ t('Next:', 'Siguiente:') }} <span class="font-medium text-ink-700" data-cy="factura-preview">{{ facturaNumberPreview(facturaPrefix, nextFactura) }}</span></p>
              <div>
                <label class="block text-[12.5px] font-medium text-ink-600">{{ t('Rectificativa prefix', 'Prefijo de rectificativas') }}</label>
                <input v-model="rectificativaPrefix" type="text" maxlength="10" data-cy="rectificativa-prefix" class="mt-1 h-8 w-24 rounded-ctl border border-line-control bg-surface px-3 text-[13px] text-ink-700 focus:border-brand focus:outline-none" />
              </div>
              <div>
                <label class="block text-[12.5px] font-medium text-ink-600">{{ t(`Next number (${numbering.year})`, `Próximo número (${numbering.year})`) }}</label>
                <input v-model="nextRectificativa" type="number" :min="numbering.next_rectificativa" data-cy="rectificativa-next" class="mt-1 h-8 w-32 rounded-ctl border border-line-control bg-surface px-3 text-[13px] text-ink-700 focus:border-brand focus:outline-none" />
              </div>
              <p class="pb-1.5 text-[12.5px] text-ink-muted2">{{ t('Next:', 'Siguiente:') }} <span class="font-medium text-ink-700" data-cy="rectificativa-preview">{{ facturaNumberPreview(rectificativaPrefix, nextRectificativa) }}</span></p>
            </div>
            <p v-if="numberingError" class="mt-2 text-[12px] text-danger-text" data-cy="factura-numbering-error">{{ numberingError }}</p>
          </div>

          <div class="rounded-card border border-line bg-surface p-4 shadow-card">
            <p class="text-[13px] font-semibold text-ink-700">{{ t('Send Receipts Automatically', 'Enviar recibos automáticamente') }}</p>
            <p class="mt-1 text-[12px] text-ink-muted2">{{ t('New patients default to "Send Receipts via Email Automatically" set to this value.', 'Los nuevos pacientes tienen por defecto "Enviar recibos por correo automáticamente" con este valor.') }}</p>
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
              <label class="flex items-center gap-2 text-[13px] text-ink-600"><SettingsToggle v-model="showTaxes" /> {{ t('Show taxes on receipts & statements', 'Mostrar impuestos en recibos y extractos') }}</label>
            </div>
          </div>

          <div class="rounded-card border border-line bg-surface p-4 shadow-card">
            <p class="text-[13px] font-semibold text-ink-700">{{ t('Receipt Content Visibility', 'Visibilidad del contenido del recibo') }}</p>
            <div class="mt-2 space-y-2">
              <label class="flex items-center gap-2 text-[13px] text-ink-600"><SettingsToggle v-model="hideInvoiceBalance" /> {{ t('Hide the outstanding balance on receipts', 'Ocultar el saldo pendiente en los recibos') }}</label>
              <label class="flex items-center gap-2 text-[13px] text-ink-600"><SettingsToggle v-model="hideAccountBalance" /> {{ t('Hide account balance on receipts', 'Ocultar el saldo de la cuenta en los recibos') }}</label>
              <label class="flex items-center gap-2 text-[13px] text-ink-600"><SettingsToggle v-model="hidePayments" /> {{ t('Hide payments on receipts', 'Ocultar los pagos en los recibos') }}</label>
              <label class="flex items-center gap-2 text-[13px] text-ink-600"><SettingsToggle v-model="hideProvider" /> {{ t('Hide provider on receipts', 'Ocultar el profesional en los recibos') }}</label>
              <label class="flex items-center gap-2 text-[13px] text-ink-600"><SettingsToggle v-model="hideNextVisit" /> {{ t('Hide "Your next visit" on receipts', 'Ocultar "Tu próxima visita" en los recibos') }}</label>
              <label class="flex items-center gap-2 text-[13px] text-ink-600"><SettingsToggle v-model="hideLogo" /> {{ t('Hide logo on receipts & statements', 'Ocultar el logotipo en recibos y extractos') }}</label>
            </div>
          </div>

          <div class="rounded-card border border-line bg-surface p-4 shadow-card">
            <p class="text-[13px] font-semibold text-ink-700">{{ t('Email Customization', 'Personalización del correo') }}</p>
            <label class="mt-2 block text-[12.5px] font-medium text-ink-600">{{ t('Receipt email subject', 'Asunto del correo de recibo') }}</label>
            <input v-model="emailSubject" type="text" :placeholder="t('Your receipt from {{clinic_name}}', 'Tu recibo de {{clinic_name}}')" class="mt-1 w-full rounded-ctl border border-line-control bg-surface px-3 py-2 text-[13px] text-ink-700 focus:border-brand focus:outline-none" />
            <label class="mt-3 block text-[12.5px] font-medium text-ink-600">{{ t('Receipt email body', 'Cuerpo del correo de recibo') }}</label>
            <textarea v-model="emailBody" rows="4" :placeholder="t('Copy for automatic receipt emails sent to patients', 'Texto para los correos automáticos de recibo enviados a los pacientes')" class="mt-1 w-full rounded-ctl border border-line-control bg-surface px-3 py-2 text-[13px] text-ink-700 focus:border-brand focus:outline-none" />
          </div>

          <UiBtn variant="primary" :disabled="saving" data-cy="invoice-settings-save" @click="save">{{ saving ? t('Saving…', 'Guardando…') : t('Save Settings', 'Guardar ajustes') }}</UiBtn>
        </div>
      </div>
    </div>
  </div>
</template>
