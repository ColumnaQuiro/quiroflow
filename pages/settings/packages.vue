<script setup lang="ts">
interface PackageRow {
  id: string
  name: string
  session_count: number
  price_cents: number
}

const supabase = useSupabaseClient()
const store = useAccountStore()
const t = useT()

const packages = ref<PackageRow[]>([])
const loading = ref(true)

const name = ref('')
const sessionCount = ref(10)
const price = ref(0)
const saving = ref(false)
const error = ref('')

async function load() {
  loading.value = true
  const { data } = await supabase.from('packages').select('id, name, session_count, price_cents').order('name')
  packages.value = data ?? []
  loading.value = false
}
onMounted(load)

async function addPackage() {
  error.value = ''
  if (!name.value.trim() || sessionCount.value <= 0) return
  saving.value = true
  const { error: insertError } = await supabase.from('packages').insert({
    account_id: store.accountId!,
    name: name.value.trim(),
    session_count: sessionCount.value,
    price_cents: Math.round(price.value * 100),
  })
  saving.value = false
  if (insertError) {
    error.value = insertError.message
    return
  }
  name.value = ''
  sessionCount.value = 10
  price.value = 0
  await load()
}

async function removePackage(id: string) {
  if (!confirm(t('Delete this package template? Existing purchases are unaffected.', '¿Eliminar esta plantilla de bono? Las compras ya existentes no se verán afectadas.'))) return
  await supabase.from('packages').delete().eq('id', id)
  await load()
}
</script>

<template>
  <div class="flex h-full flex-col">
    <PageHeader title="Packages / Bonos" />
    <div class="flex-1 overflow-y-auto">
      <div class="flex gap-8 p-6">
        <SettingsNav />
        <div class="min-w-0 max-w-[660px] flex-1">
          <p class="text-[13px] text-ink-muted2">Session bundle templates you can sell to patients (e.g. "Bono 10 sesiones").</p>

          <div class="mt-4 overflow-hidden rounded-card border border-line bg-surface shadow-card">
            <table class="w-full text-[13px]">
              <thead class="border-b border-line bg-surface-subtle text-left text-[11px] font-[640] uppercase tracking-[.04em] text-ink-muted2">
                <tr>
                  <th class="px-4 py-2">Name</th>
                  <th class="px-4 py-2">Sessions</th>
                  <th class="px-4 py-2">Price</th>
                  <th class="px-4 py-2"></th>
                </tr>
              </thead>
              <tbody class="divide-y divide-line-row">
                <tr v-if="loading">
                  <td colspan="4" class="px-4 py-6 text-center text-ink-faint">Loading…</td>
                </tr>
                <tr v-else-if="packages.length === 0">
                  <td colspan="4" class="px-4 py-6 text-center text-ink-faint">No packages yet.</td>
                </tr>
                <tr v-for="p in packages" :key="p.id">
                  <td class="px-4 py-2.5 text-ink-700">{{ p.name }}</td>
                  <td class="px-4 py-2.5 text-ink-muted2">{{ p.session_count }}</td>
                  <td class="px-4 py-2.5 text-ink-muted2">€{{ (p.price_cents / 100).toFixed(2) }}</td>
                  <td class="px-4 py-2.5 text-right">
                    <button type="button" class="text-ink-faint hover:text-danger-text" @click="removePackage(p.id)">✕</button>
                  </td>
                </tr>
              </tbody>
            </table>
          </div>

          <form class="mt-4 flex flex-wrap items-end gap-3 rounded-card border border-line bg-surface p-4 shadow-card" @submit.prevent="addPackage">
            <div>
              <label class="block text-[12.5px] font-medium text-ink-600">Name</label>
              <input v-model="name" type="text" required placeholder="Bono 10 sesiones" class="mt-1 h-8 rounded-ctl border border-line-control bg-surface px-3 text-[13px] text-ink-700 focus:border-brand focus:outline-none focus:ring-1 focus:ring-brand/20" />
            </div>
            <div>
              <label class="block text-[12.5px] font-medium text-ink-600">Sessions</label>
              <input v-model.number="sessionCount" type="number" min="1" required class="mt-1 h-8 w-24 rounded-ctl border border-line-control bg-surface px-3 text-[13px] text-ink-700 focus:border-brand focus:outline-none focus:ring-1 focus:ring-brand/20" />
            </div>
            <div>
              <label class="block text-[12.5px] font-medium text-ink-600">Price (€)</label>
              <input v-model.number="price" type="number" min="0" step="0.01" class="mt-1 h-8 w-28 rounded-ctl border border-line-control bg-surface px-3 text-[13px] text-ink-700 focus:border-brand focus:outline-none focus:ring-1 focus:ring-brand/20" />
            </div>
            <UiBtn variant="primary" type="submit" :disabled="saving">{{ saving ? 'Adding…' : 'Add Package' }}</UiBtn>
          </form>
          <p v-if="error" class="mt-2 text-[12.5px] text-danger-text">{{ error }}</p>
        </div>
      </div>
    </div>
  </div>
</template>
