<script setup lang="ts">
interface MembershipRow {
  id: string
  name: string
  price_cents: number
}

const supabase = useSupabaseClient()
const store = useAccountStore()
const t = useT()

const memberships = ref<MembershipRow[]>([])
const loading = ref(true)

const name = ref('')
const price = ref(0)
const saving = ref(false)
const error = ref('')

async function load() {
  loading.value = true
  const { data } = await supabase.from('memberships').select('id, name, price_cents').order('name')
  memberships.value = data ?? []
  loading.value = false
}
onMounted(load)

async function addMembership() {
  error.value = ''
  if (!name.value.trim()) return
  saving.value = true
  const { error: insertError } = await supabase.from('memberships').insert({
    account_id: store.accountId!,
    name: name.value.trim(),
    price_cents: Math.round(price.value * 100),
  })
  saving.value = false
  if (insertError) {
    error.value = insertError.message
    return
  }
  name.value = ''
  price.value = 0
  await load()
  useBillingTemplates().invalidate()
}

async function removeMembership(id: string) {
  if (!confirm(t('Delete this membership plan? Patients already on it are unaffected.', '¿Eliminar este plan de membresía? Los pacientes que ya lo tengan no se verán afectados.'))) return
  await supabase.from('memberships').delete().eq('id', id)
  await load()
  useBillingTemplates().invalidate()
}
</script>

<template>
  <div class="flex h-full flex-col">
    <PageHeader :title="t('Memberships', 'Membresías')" />
    <div class="flex-1 overflow-y-auto">
      <div class="flex gap-8 p-6">
        <SettingsNav />
        <div class="min-w-0 max-w-[660px] flex-1">
          <p class="text-[13px] text-ink-muted2">{{ t('Recurring plan templates (e.g. monthly maintenance membership).', 'Plantillas de planes recurrentes (p. ej. membresía mensual de mantenimiento).') }}</p>

          <div class="mt-4 overflow-hidden rounded-card border border-line bg-surface shadow-card">
            <table class="w-full text-[13px]">
              <thead class="border-b border-line bg-surface-subtle text-left text-[11px] font-[640] uppercase tracking-[.04em] text-ink-muted2">
                <tr>
                  <th class="px-4 py-2">{{ t('Name', 'Nombre') }}</th>
                  <th class="px-4 py-2">{{ t('Price / period', 'Precio / período') }}</th>
                  <th class="px-4 py-2"></th>
                </tr>
              </thead>
              <tbody class="divide-y divide-line-row">
                <template v-if="loading">
                  <tr v-for="i in 4" :key="i">
                    <td class="px-4 py-2.5"><UiSkeleton class="h-3.5 w-32 rounded-ctlSm" /></td>
                    <td class="px-4 py-2.5"><UiSkeleton class="h-3.5 w-24 rounded-ctlSm" /></td>
                    <td class="px-4 py-2.5" />
                  </tr>
                </template>
                <tr v-else-if="memberships.length === 0">
                  <td colspan="3" class="px-4 py-6 text-center text-ink-faint">{{ t('No membership plans yet.', 'Todavía no hay planes de membresía.') }}</td>
                </tr>
                <tr v-for="m in memberships" :key="m.id">
                  <td class="px-4 py-2.5 text-ink-700">{{ m.name }}</td>
                  <td class="px-4 py-2.5 text-ink-muted2">€{{ (m.price_cents / 100).toFixed(2) }}</td>
                  <td class="px-4 py-2.5 text-right">
                    <button type="button" class="text-ink-faint hover:text-danger-text" @click="removeMembership(m.id)">✕</button>
                  </td>
                </tr>
              </tbody>
            </table>
          </div>

          <form class="mt-4 flex flex-wrap items-end gap-3 rounded-card border border-line bg-surface p-4 shadow-card" @submit.prevent="addMembership">
            <div>
              <label class="block text-[12.5px] font-medium text-ink-600">{{ t('Name', 'Nombre') }}</label>
              <input v-model="name" type="text" required placeholder="Membresía mensual" class="mt-1 h-8 rounded-ctl border border-line-control bg-surface px-3 text-[13px] text-ink-700 focus:border-brand focus:outline-none focus:ring-1 focus:ring-brand/20" />
            </div>
            <div>
              <label class="block text-[12.5px] font-medium text-ink-600">{{ t('Price (€)', 'Precio (€)') }}</label>
              <input v-model.number="price" type="number" min="0" step="0.01" class="mt-1 h-8 w-28 rounded-ctl border border-line-control bg-surface px-3 text-[13px] text-ink-700 focus:border-brand focus:outline-none focus:ring-1 focus:ring-brand/20" />
            </div>
            <UiBtn variant="primary" type="submit" :disabled="saving">{{ saving ? t('Adding…', 'Añadiendo…') : t('Add Membership', 'Añadir membresía') }}</UiBtn>
          </form>
          <p v-if="error" class="mt-2 text-[12.5px] text-danger-text">{{ error }}</p>
        </div>
      </div>
    </div>
  </div>
</template>
