<script setup lang="ts">
const supabase = useSupabaseClient()
const store = useAccountStore()
const t = useT()

const editingId = ref<string | null>(null)
const legalName = ref('')
const taxId = ref('')
const footerText = ref('')
const saving = ref(false)
const error = ref('')

function openEditor(id: string) {
  const clinic = store.clinics.find((c) => c.id === id)
  if (!clinic) return
  editingId.value = id
  legalName.value = clinic.legal_name ?? ''
  taxId.value = clinic.tax_id ?? ''
  footerText.value = clinic.invoice_footer_text ?? ''
  error.value = ''
}

const editingClinic = computed(() => store.clinics.find((c) => c.id === editingId.value) ?? null)

async function save() {
  if (!editingId.value) return
  saving.value = true
  const { error: updateError } = await supabase
    .from('clinics')
    .update({ legal_name: legalName.value.trim() || null, tax_id: taxId.value.trim() || null, invoice_footer_text: footerText.value.trim() || null })
    .eq('id', editingId.value)
  saving.value = false
  if (updateError) {
    error.value = updateError.message
    return
  }
  editingId.value = null
  store.reset()
  await store.load()
}
</script>

<template>
  <div class="flex h-full flex-col">
    <PageHeader :title="t('Fiscal Data', 'Datos fiscales')" />
    <div class="flex-1 overflow-y-auto">
      <div class="flex gap-8 p-6">
        <SettingsNav />
        <div class="min-w-0 max-w-[660px] flex-1">
          <p class="text-[13px] text-ink-muted2">
            {{ t('Legal name, tax ID, and address shown on invoices, plus a footer note printed at the bottom of every invoice. Required for invoices to be fiscally valid.', 'Nombre legal, NIF/CIF y dirección que aparecen en las facturas, además de una nota de pie impresa al final de cada factura. Necesarios para que las facturas sean fiscalmente válidas.') }}
          </p>

          <div class="mt-4 overflow-hidden rounded-card border border-line bg-surface shadow-card">
            <table class="w-full text-[13px]">
              <thead class="border-b border-line bg-surface-subtle text-left text-[11px] font-[640] uppercase tracking-[.04em] text-ink-muted2">
                <tr>
                  <th class="px-4 py-2">{{ t('Clinic', 'Clínica') }}</th>
                  <th class="px-4 py-2">{{ t('Legal name', 'Nombre legal') }}</th>
                  <th class="px-4 py-2">{{ t('Tax ID', 'NIF/CIF') }}</th>
                  <th class="px-4 py-2">{{ t('Address', 'Dirección') }}</th>
                  <th class="px-4 py-2"></th>
                </tr>
              </thead>
              <tbody class="divide-y divide-line-row">
                <tr v-if="store.clinics.length === 0">
                  <td colspan="5" class="px-4 py-6 text-center text-ink-faint">{{ t('No clinics yet -- add one in Settings → Clinics.', 'Todavía no hay clínicas -- añade una en Ajustes → Clínicas.') }}</td>
                </tr>
                <tr v-for="c in store.clinics" :key="c.id">
                  <td class="px-4 py-2.5 text-ink-700">{{ c.name }}</td>
                  <td class="px-4 py-2.5 text-ink-muted2">{{ c.legal_name ?? t('Not set', 'Sin definir') }}</td>
                  <td class="px-4 py-2.5 text-ink-muted2">{{ c.tax_id ?? t('Not set', 'Sin definir') }}</td>
                  <td class="px-4 py-2.5 text-ink-muted2">
                    <span v-if="c.address">{{ c.address }}</span>
                    <NuxtLink v-else to="/settings/clinics" class="text-brand-text hover:text-brand-hover">{{ t('Missing — add in Clinics', 'Falta — añádela en Clínicas') }}</NuxtLink>
                  </td>
                  <td class="px-4 py-2.5 text-right">
                    <button type="button" class="text-[12.5px] font-medium text-brand-text hover:text-brand-hover" @click="openEditor(c.id)">{{ t('Edit', 'Editar') }}</button>
                  </td>
                </tr>
              </tbody>
            </table>
          </div>

          <form v-if="editingId && editingClinic" class="mt-4 space-y-3 rounded-card border border-line bg-surface p-4 shadow-card" @submit.prevent="save">
            <div class="flex flex-wrap items-end gap-3">
              <div>
                <label class="block text-[12.5px] font-medium text-ink-600">{{ t('Legal name', 'Nombre legal') }}</label>
                <input
                  v-model="legalName"
                  type="text"
                  placeholder="Centro Quiropractico Columnaquiro S.L."
                  class="mt-1 h-8 w-72 rounded-ctl border border-line-control bg-surface px-3 text-[13px] text-ink-700 placeholder:text-ink-faint2 focus:border-brand focus:outline-none focus:ring-1 focus:ring-brand/20"
                />
              </div>
              <div>
                <label class="block text-[12.5px] font-medium text-ink-600">{{ t('Tax ID', 'NIF/CIF') }}</label>
                <input
                  v-model="taxId"
                  type="text"
                  placeholder="B12345678"
                  class="mt-1 h-8 w-40 rounded-ctl border border-line-control bg-surface px-3 text-[13px] text-ink-700 placeholder:text-ink-faint2 focus:border-brand focus:outline-none focus:ring-1 focus:ring-brand/20"
                />
              </div>
            </div>
            <p class="text-[12px] text-ink-faint">
              {{ t('Address is edited in', 'La dirección se edita en') }} <NuxtLink to="/settings/clinics" class="text-brand-text hover:text-brand-hover">{{ t('Settings → Clinics', 'Ajustes → Clínicas') }}</NuxtLink> {{ t('and reused here automatically.', 'y se reutiliza aquí automáticamente.') }}
            </p>
            <div>
              <label class="block text-[12.5px] font-medium text-ink-600">{{ t('Invoice footer text', 'Texto de pie de factura') }}</label>
              <p class="text-[11.5px] text-ink-faint">{{ t('Printed at the bottom of every invoice for this clinic (payment terms, thank-you note, etc.).', 'Se imprime al final de cada factura de esta clínica (condiciones de pago, nota de agradecimiento, etc.).') }}</p>
              <textarea
                v-model="footerText"
                rows="3"
                :placeholder="t('Thank you for your visit. Payment due within 14 days.', 'Gracias por tu visita. El pago vence en un plazo de 14 días.')"
                class="mt-1 w-full resize-y rounded-ctl border border-line-control bg-surface px-3 py-2 text-[13px] text-ink-700 placeholder:text-ink-faint2 focus:border-brand focus:outline-none focus:ring-1 focus:ring-brand/20"
              ></textarea>
            </div>
            <div class="flex items-center gap-3">
              <UiBtn variant="primary" type="submit" :disabled="saving">{{ saving ? t('Saving…', 'Guardando…') : t('Save', 'Guardar') }}</UiBtn>
              <button type="button" class="text-[12.5px] text-ink-faint hover:text-ink-muted" @click="editingId = null">{{ t('Cancel', 'Cancelar') }}</button>
            </div>
          </form>
          <p v-if="error" class="mt-2 text-[12.5px] text-danger-text">{{ error }}</p>
        </div>
      </div>
    </div>
  </div>
</template>
