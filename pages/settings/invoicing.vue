<script setup lang="ts">
import { SIF_NAME, SIF_VERSION } from '~/utils/sifIdentity'
import { exemptionClause } from '~/utils/facturaTax'

// Settings > Invoicing: what facturas and receipts say. Each clinic's fiscal
// data, the number series, what a receipt shows, and the email that sends
// it. These were two pages -- Receipt Settings and Fiscal Data -- which both
// redirect here now.
//
// Fiscal data is still edited on each clinic's own page, beside the address
// the same factura prints; this is the overview a bookkeeper looks for, of
// which locations can issue a valid factura.
const supabase = useSupabaseClient()
const store = useAccountStore()
const t = useT()
const { showToast } = useToast()

const loading = ref(true)
const saving = ref(false)

// IVA on facturas. ColumnaQuiro's services are exempt (art. 20.Uno.3, cause
// E1), which is the default; a clinic that is not exempt sets a rate. It was
// only settable in the database. Applies to facturas issued from now on --
// each factura stores its own rate and cause (fill_factura_tax), so issued
// ones never change.
const taxMode = ref<'exempt' | 'taxed'>('exempt')
const exemptionCode = ref('E1')
const taxRate = ref('21')
const EXEMPTION_CODES = ['E1', 'E2', 'E3', 'E4', 'E5', 'E6'] as const
const taxRateBp = computed(() => Math.round(Number(String(taxRate.value).replace(',', '.')) * 100))
const taxError = computed(() => {
  if (taxMode.value !== 'taxed') return ''
  const bp = taxRateBp.value
  return Number.isFinite(bp) && bp > 0 && bp <= 3000 ? '' : t('The IVA rate is a percentage between 0 and 30, e.g. 21.', 'El tipo de IVA es un porcentaje entre 0 y 30, p. ej. 21.')
})

// Receipt numbering is the real counter behind next_invoice_number()
// (get/set_receipt_numbering). This field used to save
// accounts.next_invoice_number, which nothing read. A number input's v-model
// hands back a Number once someone types, so it is read through String().
const receiptCurrent = ref<number | null>(null)
const nextReceipt = ref<string | number>('')
const receiptNext = computed(() => String(nextReceipt.value ?? '').trim())
function receiptNumberPreview(next: string) {
  const n = parseInt(next, 10)
  return `INV-${String(Number.isFinite(n) ? n : (receiptCurrent.value ?? 1)).padStart(4, '0')}`
}
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
  if (receiptCurrent.value !== null) {
    const r = parseInt(receiptNext.value, 10)
    if (!Number.isInteger(r) || r < 1) return t('The next receipt number must be 1 or more.', 'El próximo número de recibo debe ser 1 o más.')
    if (r < receiptCurrent.value) {
      return t(`The next receipt number can only move forward: numbers below ${receiptCurrent.value} are already used.`, `El próximo número de recibo solo puede avanzar: los números por debajo de ${receiptCurrent.value} ya se han usado.`)
    }
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
  const { data: receipts } = await supabase.rpc('get_receipt_numbering', { p_account_id: store.accountId! })
  const receiptRow = receipts as unknown as { next_receipt: number } | null
  receiptCurrent.value = receiptRow?.next_receipt ?? null
  nextReceipt.value = receiptRow ? String(receiptRow.next_receipt) : ''
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
      'factura_tax_rate_bp, factura_tax_exemption_code, send_invoices_automatically_default, show_dob_on_invoices, show_ssn_on_invoices, show_taxes_on_invoices, hide_invoice_balance, hide_account_balance, hide_payments_on_invoices, hide_provider_on_invoices, hide_next_visit_on_invoices, hide_logo_on_invoices, invoice_email_subject, invoice_email_body',
    )
    .eq('id', store.accountId!)
    .maybeSingle()
  if (data) {
    taxMode.value = data.factura_tax_exemption_code || !data.factura_tax_rate_bp ? 'exempt' : 'taxed'
    exemptionCode.value = data.factura_tax_exemption_code ?? 'E1'
    taxRate.value = data.factura_tax_rate_bp ? String(data.factura_tax_rate_bp / 100).replace('.', ',') : '21'
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
  if (taxError.value) {
    showToast(taxError.value, 'error')
    return
  }
  saving.value = true
  const { error } = await supabase
    .from('accounts')
    .update({
      // Exempt: rate 0 and the cause, which the factura has to cite. Taxed: the
      // rate, and no cause -- facturas_tax_coherent_check refuses both at once.
      factura_tax_rate_bp: taxMode.value === 'taxed' ? taxRateBp.value : 0,
      factura_tax_exemption_code: taxMode.value === 'exempt' ? exemptionCode.value : null,
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
  }
  if (receiptCurrent.value !== null) {
    const r = changedNext(receiptNext.value, receiptCurrent.value)
    if (r !== null) {
      const { error: receiptSaveError } = await supabase.rpc('set_receipt_numbering', { p_account_id: store.accountId!, p_next_receipt: r })
      if (receiptSaveError) {
        saving.value = false
        showToast(receiptSaveError.message, 'error')
        return
      }
    }
  }
  await loadNumbering()
  saving.value = false
  showToast(t('Saved', 'Guardado'))
}

// --- what a receipt shows ---------------------------------------------------
// The columns are a mix of show_* and hide_* flags. On screen every one is a
// "show" switch -- on means it is on the receipt -- so a person never has to
// read "hide ... : off" twice to know what prints. The hide_* ones are
// flipped here and nowhere else.
interface ReceiptOption {
  key: string
  label: string
  on: boolean
  set: (on: boolean) => void
}
const receiptGroups = computed<{ label: string; options: ReceiptOption[] }[]>(() => [
  {
    label: t('Patient', 'Paciente'),
    options: [
      { key: 'dob', label: t('Date of birth', 'Fecha de nacimiento'), on: showDob.value, set: (v) => (showDob.value = v) },
      { key: 'ssn', label: t('National ID / social security number', 'DNI/NIE / número de la seguridad social'), on: showSsn.value, set: (v) => (showSsn.value = v) },
    ],
  },
  {
    label: t('Amounts', 'Importes'),
    options: [
      { key: 'taxes', label: t('Taxes (IVA, or the exemption)', 'Impuestos (IVA, o la exención)'), on: showTaxes.value, set: (v) => (showTaxes.value = v) },
      { key: 'payments', label: t('Payments made', 'Pagos realizados'), on: !hidePayments.value, set: (v) => (hidePayments.value = !v) },
      { key: 'balance', label: t('Outstanding on this receipt', 'Pendiente de este recibo'), on: !hideInvoiceBalance.value, set: (v) => (hideInvoiceBalance.value = !v) },
      { key: 'account', label: t('Account balance', 'Saldo de la cuenta'), on: !hideAccountBalance.value, set: (v) => (hideAccountBalance.value = !v) },
    ],
  },
  {
    label: t('Other', 'Otros'),
    options: [
      { key: 'provider', label: t('Practitioner', 'Profesional'), on: !hideProvider.value, set: (v) => (hideProvider.value = !v) },
      { key: 'next', label: t('"Your next visit"', '"Tu próxima visita"'), on: !hideNextVisit.value, set: (v) => (hideNextVisit.value = !v) },
      { key: 'logo', label: t('Logo', 'Logotipo'), on: !hideLogo.value, set: (v) => (hideLogo.value = !v) },
    ],
  },
])

// --- fiscal data, formerly /settings/fiscal-data ---------------------------
// One taxpayer per account: every factura carries the oldest clinic's legal
// name and NIF (fill_factura_issuer), and each location only its own address.
// So only that clinic needs a NIF; asking every location for one described
// fields that were never printed.
const fiscalClinicId = ref<string | null>(null)
onMounted(async () => {
  const { data } = await supabase.from('clinics').select('id').order('created_at').limit(1).maybeSingle()
  fiscalClinicId.value = data?.id ?? null
})
type FiscalFields = { id?: string; legal_name?: string | null; tax_id?: string | null; address?: string | null }
const isFiscalClinic = (c: FiscalFields) => !fiscalClinicId.value || c.id === fiscalClinicId.value
const fiscalComplete = (c: FiscalFields) => (isFiscalClinic(c) ? !!(c.legal_name && c.tax_id && c.address) : !!c.address)
const completeClinics = computed(() => store.clinics.filter(fiscalComplete).length)
function missingLabel(c: FiscalFields) {
  const missing = [isFiscalClinic(c) && !c.legal_name && t('legal name', 'razón social'), isFiscalClinic(c) && !c.tax_id && t('NIF', 'NIF'), !c.address && t('address', 'dirección')].filter(Boolean)
  if (missing.length === 3) return t('Not filled in', 'Sin rellenar')
  return t(`Missing ${missing.join(', ')}`, `Falta ${missing.join(', ')}`)
}

// --- VeriFactu, as one line ---------------------------------------------------
// Only owners can open Settings > VeriFactu, and only they can read its
// settings; everyone else is told who looks after it.
const verifactu = ref<{ mode: 'off' | 'test' | 'live'; productionFrom: string | null } | null>(null)
onMounted(async () => {
  if (!store.isOwner) return
  try {
    verifactu.value = await useStaffFetch<{ mode: 'off' | 'test' | 'live'; productionFrom: string | null }>('/api/verifactu/settings')
  } catch {
    verifactu.value = null
  }
})
const verifactuLine = computed(() => {
  if (!store.isOwner) return t('Set up by the owner', 'Lo configura el propietario')
  const v = verifactu.value
  if (!v) return '…'
  if (v.mode === 'off') return t('Off', 'Desactivado')
  if (v.mode === 'test') return t('Test service', 'Servicio de pruebas')
  const day = v.productionFrom ? new Date(v.productionFrom).toLocaleDateString('es-ES', { timeZone: 'Europe/Madrid', day: 'numeric', month: 'short', year: 'numeric' }) : ''
  return v.productionFrom && new Date(v.productionFrom).getTime() > Date.now() ? t(`Test · live from ${day}`, `Pruebas · producción desde ${day}`) : t(`Live since ${day}`, `En producción desde ${day}`)
})

// Written out here: inside the template the braces would be read as an interpolation.
const CLINIC_VAR = '{{clinic_name}}'
const PATIENT_VAR = '{{patient_name}}'

const inputClass = 'h-9 touch:h-11 rounded-ctl border border-line-control bg-surface px-3 text-[14px] text-ink-900 focus:border-brand focus:outline-none focus:ring-1 focus:ring-brand'
</script>

<template>
  <div class="flex h-full flex-col">
    <PageHeader :title="t('Invoicing', 'Facturación')">
      <UiBtn variant="primary" data-cy="invoice-settings-save" :disabled="saving || loading" @click="save">{{ saving ? t('Saving…', 'Guardando…') : t('Save changes', 'Guardar cambios') }}</UiBtn>
    </PageHeader>
    <div class="flex-1 overflow-y-auto">
      <div class="flex gap-8 p-6">
        <SettingsNav />
        <div class="flex min-w-0 max-w-[940px] flex-1 flex-col gap-4" data-cy="invoicing-settings" :data-ready="loading ? undefined : 'true'">
          <p class="text-[13.5px] text-ink-muted">
            {{ t('What your facturas and receipts say, how they are numbered, and the email that sends a receipt.', 'Lo que dicen tus facturas y recibos, cómo se numeran y el correo con el que se envía un recibo.') }}
          </p>

          <!-- Readiness: the question the owner actually has. -->
          <section aria-labelledby="h-ready" class="overflow-hidden rounded-card border border-line bg-surface">
            <h2 id="h-ready" class="px-[18px] pb-2.5 pt-3.5 text-[14px] font-bold text-ink-700">{{ t('Ready to issue facturas?', '¿Listo para emitir facturas?') }}</h2>
            <div class="grid grid-cols-1 border-t border-line-row sm:grid-cols-3">
              <a href="#fiscal" class="flex gap-3 border-line-row px-[18px] py-3.5 hover:bg-surface-subtle max-sm:border-b sm:border-r" data-cy="ready-fiscal">
                <span class="flex h-7 w-7 shrink-0 items-center justify-center rounded-full" :class="completeClinics === store.clinics.length ? 'bg-success-bg text-success-text' : 'bg-warning-bg text-warning-text'" aria-hidden="true">
                  <svg v-if="completeClinics === store.clinics.length" width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round"><path d="M5 12l5 5L20 7" /></svg>
                  <svg v-else width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.6" stroke-linecap="round"><path d="M12 7v6M12 17h.01" /></svg>
                </span>
                <span class="flex flex-col gap-0.5">
                  <strong class="text-[14px] text-ink-900">{{ t('Fiscal data', 'Datos fiscales') }}</strong>
                  <span class="text-[13px]" :class="completeClinics === store.clinics.length ? 'text-ink-muted' : 'text-warning-text'">
                    {{ t(`${completeClinics} of ${store.clinics.length} clinics complete`, `${completeClinics} de ${store.clinics.length} clínicas completas`) }}
                  </span>
                </span>
              </a>
              <a href="#numbering" class="flex gap-3 border-line-row px-[18px] py-3.5 hover:bg-surface-subtle max-sm:border-b sm:border-r">
                <span class="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-success-bg text-success-text" aria-hidden="true">
                  <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round"><path d="M5 12l5 5L20 7" /></svg>
                </span>
                <span class="flex flex-col gap-0.5">
                  <strong class="text-[14px] text-ink-900">{{ t('Numbering', 'Numeración') }}</strong>
                  <span class="text-[13px] text-ink-muted">{{ numbering ? t(`Next factura ${facturaNumberPreview(numbering.factura_prefix, String(numbering.next_factura))}`, `Próxima factura ${facturaNumberPreview(numbering.factura_prefix, String(numbering.next_factura))}`) : '…' }}</span>
                </span>
              </a>
              <component :is="store.isOwner ? 'NuxtLink' : 'div'" :to="store.isOwner ? '/settings/verifactu' : undefined" class="flex gap-3 px-[18px] py-3.5" :class="store.isOwner ? 'hover:bg-surface-subtle' : ''" data-cy="ready-verifactu">
                <span class="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-brand-tint text-brand-text" aria-hidden="true">
                  <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><path d="M12 3l8 4v5c0 5-3.5 8-8 9-4.5-1-8-4-8-9V7z" /></svg>
                </span>
                <span class="flex flex-col gap-0.5">
                  <strong class="text-[14px] text-ink-900">VeriFactu</strong>
                  <span class="text-[13px] text-ink-muted">{{ verifactuLine }}</span>
                </span>
              </component>
            </div>
          </section>

          <nav :aria-label="t('Sections', 'Secciones')" class="flex flex-wrap gap-2">
            <a v-for="s in [
              { id: 'fiscal', label: t('Fiscal data', 'Datos fiscales') },
              { id: 'tax', label: t('IVA', 'IVA') },
              { id: 'numbering', label: t('Numbering', 'Numeración') },
              { id: 'receipt', label: t('What receipts show', 'Qué muestran los recibos') },
              { id: 'email', label: t('Receipt email', 'Correo del recibo') },
            ]" :key="s.id" :href="`#${s.id}`" class="inline-flex h-8 touch:h-11 items-center rounded-pill border border-line-control bg-surface px-3 text-[13px] text-ink-500 hover:border-line-controlHover">{{ s.label }}</a>
          </nav>

          <!-- Fiscal data -->
          <section id="fiscal" aria-labelledby="h-fiscal" class="scroll-mt-4 overflow-hidden rounded-card border border-line bg-surface">
            <div class="px-[18px] pb-3 pt-4">
              <h2 id="h-fiscal" class="text-[16px] font-bold text-ink-900">{{ t('Fiscal data', 'Datos fiscales') }}</h2>
              <p class="mt-1 text-[13px] leading-snug text-ink-muted">
                {{ t('The legal name, NIF and address each clinic’s facturas and receipts are issued with. Required for a factura to be fiscally valid; a factura already issued keeps the details it had.', 'La razón social, el NIF y la dirección con los que se emiten las facturas y recibos de cada clínica. Necesarios para que una factura sea válida; una factura ya emitida conserva los datos que tenía.') }}
              </p>
            </div>
            <p v-if="store.clinics.length === 0" class="border-t border-line-row px-[18px] py-6 text-center text-[14px] text-ink-muted">{{ t('No clinics yet.', 'Todavía no hay clínicas.') }}</p>
            <NuxtLink
              v-for="c in store.clinics"
              :key="c.id"
              :to="`/settings/clinics/${c.id}#fiscal`"
              data-cy="fiscal-clinic"
              class="flex min-h-[68px] items-center gap-3.5 border-t border-line-row px-[18px] py-2.5 hover:bg-surface-subtle"
            >
              <div class="flex min-w-0 flex-1 flex-col gap-0.5">
                <strong class="text-[15px] text-ink-900">{{ c.name }}</strong>
                <span class="truncate text-[13px] text-ink-500">{{ [c.legal_name, c.tax_id, c.address].filter(Boolean).join(' · ') || t('Nothing filled in yet', 'Aún sin rellenar') }}</span>
              </div>
              <UiPill v-if="isFiscalClinic(c)" tone="brand">{{ t('Issues facturas', 'Emite las facturas') }}</UiPill>
              <UiPill v-if="fiscalComplete(c)" tone="success">{{ t('Complete', 'Completo') }}</UiPill>
              <UiPill v-else tone="warning">{{ missingLabel(c) }}</UiPill>
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="shrink-0 text-ink-muted" aria-hidden="true"><path d="M9 6l6 6-6 6" /></svg>
            </NuxtLink>
          </section>

          <template v-if="loading">
            <UiSkeleton class="h-48 w-full rounded-card" />
            <UiSkeleton class="h-72 w-full rounded-card" />
          </template>
          <template v-else>
            <!-- IVA -->
            <section id="tax" aria-labelledby="h-tax" class="scroll-mt-4 overflow-hidden rounded-card border border-line bg-surface" data-cy="factura-tax">
              <div class="px-[18px] pb-3 pt-4">
                <h2 id="h-tax" class="text-[16px] font-bold text-ink-900">{{ t('IVA', 'IVA') }}</h2>
                <p class="mt-1 text-[13px] leading-snug text-ink-muted">
                  {{ t('How facturas treat IVA. It applies to facturas issued from now on; each one already issued keeps the treatment it was issued with.', 'Cómo tratan el IVA las facturas. Se aplica a las facturas que se emitan a partir de ahora; las ya emitidas conservan el tratamiento con el que se emitieron.') }}
                </p>
              </div>
              <div role="radiogroup" :aria-label="t('IVA', 'IVA')" class="flex flex-col border-t border-line-row">
                <label class="flex cursor-pointer items-start gap-3 px-[18px] py-3.5" :class="taxMode === 'exempt' ? 'bg-brand-tint' : ''">
                  <input v-model="taxMode" type="radio" value="exempt" data-cy="tax-exempt" class="mt-1 h-4 w-4 accent-brand" />
                  <span class="flex min-w-0 flex-1 flex-col gap-1.5">
                    <strong class="text-[14.5px] text-ink-900">{{ t('Exempt', 'Exento') }}</strong>
                    <span class="text-[13px] text-ink-500">{{ t('Health care by a registered professional is exempt under art. 20.Uno.3 of Ley 37/1992. The factura shows the total as the base and cites the exemption.', 'La asistencia sanitaria de un profesional colegiado está exenta por el art. 20.Uno.3 de la Ley 37/1992. La factura muestra el total como base y cita la exención.') }}</span>
                    <select v-if="taxMode === 'exempt'" v-model="exemptionCode" data-cy="tax-exemption-code" :aria-label="t('Exemption', 'Exención')" :class="[inputClass, 'w-full max-w-[460px]']">
                      <option v-for="code in EXEMPTION_CODES" :key="code" :value="code">{{ code }} · {{ exemptionClause(code) }}</option>
                    </select>
                  </span>
                </label>
                <label class="flex cursor-pointer items-start gap-3 border-t border-line-row px-[18px] py-3.5" :class="taxMode === 'taxed' ? 'bg-brand-tint' : ''">
                  <input v-model="taxMode" type="radio" value="taxed" data-cy="tax-taxed" class="mt-1 h-4 w-4 accent-brand" />
                  <span class="flex min-w-0 flex-1 flex-col gap-1.5">
                    <strong class="text-[14.5px] text-ink-900">{{ t('With IVA', 'Con IVA') }}</strong>
                    <span class="text-[13px] text-ink-500">{{ t('Prices already include it: the factura splits what the patient paid into base and cuota, so its total still matches the payment.', 'Los precios ya lo incluyen: la factura separa lo que pagó el paciente en base y cuota, y su total sigue coincidiendo con el pago.') }}</span>
                    <span v-if="taxMode === 'taxed'" class="flex items-center gap-2 text-[14px] text-ink-700">
                      <input v-model="taxRate" type="text" inputmode="decimal" data-cy="tax-rate" :aria-label="t('IVA rate (%)', 'Tipo de IVA (%)')" :class="[inputClass, 'w-20 text-right']" /> %
                    </span>
                    <span v-if="taxError" class="text-[12.5px] font-semibold text-danger-text">{{ taxError }}</span>
                  </span>
                </label>
              </div>
            </section>

            <!-- Numbering -->
            <section id="numbering" aria-labelledby="h-num" class="scroll-mt-4 overflow-hidden rounded-card border border-line bg-surface" data-cy="factura-numbering">
              <div class="px-[18px] pb-3 pt-4">
                <h2 id="h-num" class="text-[16px] font-bold text-ink-900">{{ t('Numbering', 'Numeración') }}</h2>
                <p class="mt-1 text-[13px] leading-snug text-ink-muted">
                  {{ t('Facturas are numbered PREFIX-YEAR-NUMBER and start again at 1 every year. A number can move forward -- for example to continue your previous system’s series -- never back: those numbers are already on facturas.', 'Las facturas se numeran PREFIJO-AÑO-NÚMERO y vuelven a empezar en 1 cada año. Un número puede avanzar -- por ejemplo para continuar la serie de tu sistema anterior -- nunca retroceder: esos números ya están en facturas.') }}
                </p>
              </div>
              <div class="hidden grid-cols-[1.2fr_110px_150px_1fr] items-center gap-3 border-t border-line-row bg-surface-subtle px-[18px] py-2 text-[12px] font-bold uppercase tracking-[.04em] text-ink-muted sm:grid">
                <span>{{ t('Series', 'Serie') }}</span><span>{{ t('Prefix', 'Prefijo') }}</span><span>{{ numbering ? t(`Next (${numbering.year})`, `Próximo (${numbering.year})`) : t('Next', 'Próximo') }}</span><span>{{ t('Next document', 'Próximo documento') }}</span>
              </div>
              <template v-if="numbering">
                <div class="grid grid-cols-2 items-center gap-3 border-t border-line-row px-[18px] py-3 sm:grid-cols-[1.2fr_110px_150px_1fr]">
                  <strong class="col-span-2 text-[14.5px] text-ink-900 sm:col-span-1">{{ t('Facturas', 'Facturas') }}</strong>
                  <input v-model="facturaPrefix" type="text" maxlength="10" data-cy="factura-prefix" :aria-label="t('Factura prefix', 'Prefijo de facturas')" :class="[inputClass, 'w-full']" />
                  <input v-model="nextFactura" type="number" :min="numbering.next_factura" data-cy="factura-next" :aria-label="t(`Next factura number (${numbering.year})`, `Próximo número de factura (${numbering.year})`)" :class="[inputClass, 'w-full text-right']" />
                  <code class="col-span-2 font-mono text-[14px] font-medium text-ink-900 sm:col-span-1" data-cy="factura-preview">{{ facturaNumberPreview(facturaPrefix, nextFactura) }}</code>
                </div>
                <div class="grid grid-cols-2 items-center gap-3 border-t border-line-row px-[18px] py-3 sm:grid-cols-[1.2fr_110px_150px_1fr]">
                  <strong class="col-span-2 text-[14.5px] text-ink-900 sm:col-span-1">{{ t('Rectificativas', 'Rectificativas') }}</strong>
                  <input v-model="rectificativaPrefix" type="text" maxlength="10" data-cy="rectificativa-prefix" :aria-label="t('Rectificativa prefix', 'Prefijo de rectificativas')" :class="[inputClass, 'w-full']" />
                  <input v-model="nextRectificativa" type="number" :min="numbering.next_rectificativa" data-cy="rectificativa-next" :aria-label="t(`Next rectificativa number (${numbering.year})`, `Próximo número de rectificativa (${numbering.year})`)" :class="[inputClass, 'w-full text-right']" />
                  <code class="col-span-2 font-mono text-[14px] font-medium text-ink-900 sm:col-span-1" data-cy="rectificativa-preview">{{ facturaNumberPreview(rectificativaPrefix, nextRectificativa) }}</code>
                </div>
              </template>
              <div class="grid grid-cols-2 items-center gap-3 border-t border-line-row px-[18px] py-3 sm:grid-cols-[1.2fr_110px_150px_1fr]">
                <strong class="col-span-2 text-[14.5px] text-ink-900 sm:col-span-1">{{ t('Receipts', 'Recibos') }}</strong>
                <span class="font-mono text-[13px] text-ink-muted" :title="t('Fixed: receipts are one series', 'Fijo: los recibos son una sola serie')">INV-</span>
                <input v-model="nextReceipt" type="number" :min="receiptCurrent ?? 1" data-cy="receipt-next" :aria-label="t('Next receipt number', 'Próximo número de recibo')" :class="[inputClass, 'w-full text-right']" />
                <code class="col-span-2 font-mono text-[14px] font-medium text-ink-900 sm:col-span-1" data-cy="receipt-preview">{{ receiptNumberPreview(receiptNext) }}</code>
              </div>
              <p v-if="numberingError" class="border-t border-line-row px-[18px] py-2.5 text-[12.5px] font-semibold text-danger-text" data-cy="factura-numbering-error">{{ numberingError }}</p>
            </section>

            <!-- What receipts show, beside the receipt -->
            <section id="receipt" aria-labelledby="h-rec" class="scroll-mt-4 overflow-hidden rounded-card border border-line bg-surface">
              <div class="px-[18px] pt-4">
                <h2 id="h-rec" class="text-[16px] font-bold text-ink-900">{{ t('What receipts show', 'Qué muestran los recibos') }}</h2>
                <p class="mt-1 text-[13px] text-ink-muted">{{ t('On the receipt PDF patients download or are emailed. Facturas always carry what the law requires.', 'En el PDF del recibo que el paciente descarga o recibe por correo. Las facturas siempre llevan lo que exige la ley.') }}</p>
              </div>
              <div class="flex flex-col gap-6 px-[18px] pb-[18px] pt-2 md:flex-row">
                <div class="flex min-w-0 flex-1 flex-col">
                  <div v-for="g in receiptGroups" :key="g.label" class="flex flex-col pt-2.5">
                    <span class="pb-0.5 text-[12px] font-bold uppercase tracking-[.04em] text-ink-muted">{{ g.label }}</span>
                    <div v-for="o in g.options" :key="o.key" class="flex min-h-[46px] items-center gap-3 border-b border-line-row">
                      <span :id="`receipt-${o.key}`" class="flex-1 text-[14px] text-ink-900">{{ o.label }}</span>
                      <button
                        type="button"
                        role="switch"
                        :data-cy="`receipt-show-${o.key}`"
                        :aria-checked="o.on"
                        :aria-labelledby="`receipt-${o.key}`"
                        class="relative h-[26px] w-11 shrink-0 rounded-full"
                        :class="o.on ? 'bg-brand' : 'bg-line-control'"
                        @click="o.set(!o.on)"
                      >
                        <span class="absolute top-[3px] h-5 w-5 rounded-full bg-surface shadow-card transition-all" :class="o.on ? 'left-[21px]' : 'left-[3px]'" />
                      </button>
                    </div>
                  </div>
                </div>

                <!-- An illustration of the switches, not the real receipt
                     template: it follows each switch so the effect is seen
                     before saving. -->
                <figure class="flex w-full shrink-0 flex-col gap-2 md:w-[320px]" aria-hidden="true">
                  <figcaption class="text-[12.5px] font-semibold text-ink-500">{{ t('Preview', 'Vista previa') }}</figcaption>
                  <div class="flex flex-col gap-3 rounded-ctl border border-line bg-white p-5 text-[12px] text-[#22252F] shadow-card">
                    <div class="flex items-start justify-between">
                      <span v-if="!hideLogo" class="flex h-10 w-10 items-center justify-center rounded-ctl bg-[#EEF0FE] text-[10px] font-bold text-[#3B32C9]">LOGO</span>
                      <span v-else />
                      <span class="text-right leading-snug"><strong class="text-[13px]">{{ t('Receipt', 'Recibo') }} {{ receiptNumberPreview(receiptNext) }}</strong><br />{{ new Date().toLocaleDateString('es-ES') }}</span>
                    </div>
                    <div class="leading-snug">
                      <strong>{{ t('Patient name', 'Nombre del paciente') }}</strong>
                      <template v-if="showDob"><br />{{ t('Born', 'Nacimiento') }} 14/03/1987</template>
                      <template v-if="showSsn"><br />DNI 00000000T</template>
                    </div>
                    <div class="flex flex-col gap-1 border-y border-[#E8E9ED] py-2">
                      <div class="flex justify-between"><span>{{ t('Visit', 'Visita') }}</span><span>40,00 €</span></div>
                      <div v-if="!hideProvider" class="text-[#6B7180]">{{ t('Practitioner', 'Profesional') }}: …</div>
                      <div v-if="showTaxes" class="flex justify-between text-[#6B7180]"><span>{{ t('Tax', 'Impuestos') }}</span><span>0,00 €</span></div>
                    </div>
                    <div class="flex justify-between text-[13px] font-bold"><span>Total</span><span>40,00 €</span></div>
                    <div v-if="!hidePayments" class="flex justify-between"><span>{{ t('Paid', 'Pagado') }}</span><span>40,00 €</span></div>
                    <div v-if="!hideInvoiceBalance" class="flex justify-between"><span>{{ t('Outstanding', 'Pendiente') }}</span><span>0,00 €</span></div>
                    <div v-if="!hideAccountBalance" class="flex justify-between"><span>{{ t('Account balance', 'Saldo de la cuenta') }}</span><span>0,00 €</span></div>
                    <div v-if="!hideNextVisit" class="rounded-[6px] bg-[#F7F8FA] px-2.5 py-2">{{ t('Your next visit: …', 'Tu próxima visita: …') }}</div>
                  </div>
                </figure>
              </div>
            </section>

            <!-- Receipt email -->
            <section id="email" aria-labelledby="h-email" class="scroll-mt-4 overflow-hidden rounded-card border border-line bg-surface">
              <div class="px-[18px] pt-4">
                <h2 id="h-email" class="text-[16px] font-bold text-ink-900">{{ t('Receipt email', 'Correo del recibo') }}</h2>
              </div>
              <div class="flex flex-col gap-3.5 px-[18px] pb-[18px]">
                <SettingsSwitchRow
                  v-model="sendAutomatically"
                  :divided="false"
                  data-cy="receipt-send-automatically"
                  :title="t('Email receipts automatically', 'Enviar recibos por correo automáticamente')"
                  :description="t('What new patients start with. It can still be changed on each patient.', 'Con lo que empiezan los pacientes nuevos. Se puede cambiar en cada paciente.')"
                />
                <label class="flex flex-col gap-1.5 text-[13px] font-semibold text-ink-700">
                  {{ t('Subject', 'Asunto') }}
                  <input v-model="emailSubject" type="text" :placeholder="t('Empty: “Recibo” and its number', 'Vacío: «Recibo» y su número')" :class="[inputClass, 'w-full font-normal']" />
                </label>
                <label class="flex flex-col gap-1.5 text-[13px] font-semibold text-ink-700">
                  {{ t('Message', 'Mensaje') }}
                  <textarea v-model="emailBody" rows="4" :placeholder="t('Copy for automatic receipt emails sent to patients', 'Texto para los correos automáticos de recibo enviados a los pacientes')" class="rounded-ctl border border-line-control bg-surface px-3 py-2 text-[14px] font-normal leading-snug text-ink-900 focus:border-brand focus:outline-none focus:ring-1 focus:ring-brand" />
                </label>
                <p class="text-[12.5px] text-ink-muted">{{ t(`Write ${CLINIC_VAR} for the clinic’s name and ${PATIENT_VAR} for the patient’s first name.`, `Escribe ${CLINIC_VAR} para el nombre de la clínica y ${PATIENT_VAR} para el nombre del paciente.`) }}</p>
              </div>
            </section>
          </template>

          <!-- RD 1007/2023 requires the producer's declaración responsable to be
               visible inside the invoicing system itself, for the version that is
               running -- publishing it externally is necessary but not enough. -->
          <p class="text-[12.5px] text-ink-muted">
            {{ t('Invoicing system', 'Sistema informático de facturación') }}: {{ SIF_NAME }} {{ SIF_VERSION }} —
            <NuxtLink to="/legal/declaracion-responsable" class="text-brand-text hover:text-brand-hover">{{ t('responsible declaration', 'declaración responsable') }}</NuxtLink>
          </p>
        </div>
      </div>
    </div>
  </div>
</template>
