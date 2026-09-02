<script setup lang="ts">
import type { Tables } from '~/types/database.types'

const supabase = useSupabaseClient()
const store = useAccountStore()
const t = useT()

const services = ref<Tables<'services_products'>[]>([])
const loading = ref(true)

const name = ref('')
const price = ref('')
const taxRate = ref('0')
const saving = ref(false)
const error = ref('')

async function load() {
  loading.value = true
  const { data } = await supabase.from('services_products').select('*').order('name')
  services.value = data ?? []
  loading.value = false
}
onMounted(load)

async function addService() {
  error.value = ''
  if (!name.value.trim() || !price.value) return
  saving.value = true
  const { error: insertError } = await supabase.from('services_products').insert({
    account_id: store.accountId!,
    name: name.value.trim(),
    price_cents: Math.round(parseFloat(price.value) * 100),
    tax_rate: parseFloat(taxRate.value) || 0,
  })
  saving.value = false
  if (insertError) {
    error.value = insertError.message
    return
  }
  name.value = ''
  price.value = ''
  taxRate.value = '0'
  await load()
}

async function removeService(id: string) {
  if (!confirm(t('Delete this service?', '¿Eliminar este servicio?'))) return
  await supabase.from('services_products').delete().eq('id', id)
  await load()
}
</script>

<template>
  <div class="flex h-full flex-col">
    <PageHeader :title="t('Services & products', 'Servicios y productos')" :meta="t('Catalog used by quick invoices and appointment billing', 'Catálogo usado en facturas rápidas y facturación de citas')">
      <UiBtn variant="secondary" @click="navigateTo('/billing')">&larr; {{ t('Back to billing', 'Volver a facturación') }}</UiBtn>
    </PageHeader>

    <div class="flex-1 overflow-y-auto bg-surface-page p-6">
      <div class="mx-auto max-w-2xl space-y-4">
        <div class="overflow-hidden rounded-card border border-line bg-surface shadow-card">
          <table class="w-full text-[13px]">
            <thead>
              <tr class="border-b border-line bg-surface-subtle text-left text-[10px] font-semibold uppercase tracking-wide text-ink-faint2">
                <th class="px-4 py-2.5">{{ t('Name', 'Nombre') }}</th>
                <th class="px-4 py-2.5">{{ t('Price', 'Precio') }}</th>
                <th class="px-4 py-2.5">{{ t('Tax rate', 'Tipo de IVA') }}</th>
                <th class="px-4 py-2.5"></th>
              </tr>
            </thead>
            <tbody class="divide-y divide-line-row">
              <tr v-if="loading">
                <td colspan="4" class="px-4 py-8 text-center text-ink-muted2">{{ t('Loading…', 'Cargando…') }}</td>
              </tr>
              <tr v-else-if="services.length === 0">
                <td colspan="4" class="px-4 py-8 text-center text-ink-muted2">{{ t('No services yet.', 'Todavía no hay servicios.') }}</td>
              </tr>
              <tr v-for="s in services" :key="s.id">
                <td class="px-4 py-2.5 text-ink-800">{{ s.name }}</td>
                <td class="px-4 py-2.5 font-mono text-ink-muted">€{{ (s.price_cents / 100).toFixed(2) }}</td>
                <td class="px-4 py-2.5 text-ink-muted">{{ s.tax_rate }}%</td>
                <td class="px-4 py-2.5 text-right">
                  <button type="button" class="text-ink-faint2 hover:text-danger-text" @click="removeService(s.id)">✕</button>
                </td>
              </tr>
            </tbody>
          </table>
        </div>

        <form class="flex flex-wrap items-end gap-3 rounded-card border border-line bg-surface p-4 shadow-card" @submit.prevent="addService">
          <div>
            <label class="block text-[12.5px] font-medium text-ink-500">{{ t('Name', 'Nombre') }}</label>
            <input
              v-model="name"
              type="text"
              required
              placeholder="Ajuste Quiropractico"
              class="mt-1 rounded-ctl border border-line-control px-3 py-1.5 text-[13px] focus:border-brand focus:outline-none focus:ring-1 focus:ring-brand"
            />
          </div>
          <div>
            <label class="block text-[12.5px] font-medium text-ink-500">{{ t('Price (€)', 'Precio (€)') }}</label>
            <input
              v-model="price"
              type="number"
              step="0.01"
              min="0"
              required
              class="mt-1 w-28 rounded-ctl border border-line-control px-3 py-1.5 font-mono text-[13px] focus:border-brand focus:outline-none focus:ring-1 focus:ring-brand"
            />
          </div>
          <div>
            <label class="block text-[12.5px] font-medium text-ink-500">{{ t('Tax rate (%)', 'Tipo de IVA (%)') }}</label>
            <input
              v-model="taxRate"
              type="number"
              step="0.01"
              min="0"
              class="mt-1 w-24 rounded-ctl border border-line-control px-3 py-1.5 text-[13px] focus:border-brand focus:outline-none focus:ring-1 focus:ring-brand"
            />
          </div>
          <button
            type="submit"
            :disabled="saving"
            class="inline-flex h-8 items-center justify-center gap-1.5 whitespace-nowrap rounded-ctl border border-brand bg-brand px-3.5 text-[13px] font-semibold text-white hover:bg-brand-hover disabled:cursor-not-allowed disabled:opacity-50"
          >
            {{ saving ? t('Adding…', 'Añadiendo…') : t('Add service', 'Añadir servicio') }}
          </button>
        </form>
        <p v-if="error" class="text-[13px] text-danger-text">{{ error }}</p>
      </div>
    </div>
  </div>
</template>
