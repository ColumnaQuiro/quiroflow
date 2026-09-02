<script setup lang="ts">
import type { Tables } from '~/types/database.types'

const supabase = useSupabaseClient()
const store = useAccountStore()
const t = useT()

const sources = ref<Tables<'referral_sources'>[]>([])
const loading = ref(true)
const name = ref('')
const visibility = ref<'private' | 'public'>('private')
const saving = ref(false)
const error = ref('')

async function load() {
  loading.value = true
  const { data } = await supabase.from('referral_sources').select('*').order('name')
  sources.value = data ?? []
  loading.value = false
}
onMounted(load)

async function addSource() {
  error.value = ''
  if (!name.value.trim()) return
  saving.value = true
  const { error: insertError } = await supabase.from('referral_sources').insert({
    account_id: store.accountId!,
    name: name.value.trim(),
    visibility: visibility.value,
  })
  saving.value = false
  if (insertError) {
    error.value = insertError.message
    return
  }
  name.value = ''
  visibility.value = 'private'
  await load()
}

async function toggleStatus(source: Tables<'referral_sources'>) {
  const status = source.status === 'active' ? 'inactive' : 'active'
  source.status = status
  await supabase.from('referral_sources').update({ status }).eq('id', source.id)
}

async function removeSource(id: string) {
  if (!confirm(t('Delete this referral source?', '¿Eliminar esta fuente de referencia?'))) return
  await supabase.from('referral_sources').delete().eq('id', id)
  await load()
}
</script>

<template>
  <div class="flex h-full flex-col">
    <PageHeader :title="t('Referral Sources', 'Fuentes de Referencia')" />
    <div class="flex-1 overflow-y-auto">
      <div class="flex gap-8 p-6">
        <SettingsNav />
        <div class="min-w-0 max-w-[660px] flex-1">
          <p class="text-[13px] text-ink-muted2">{{ t('The options available on a patient\'s "Referral source" field, and what reports group by.', 'Las opciones disponibles en el campo "Fuente de referencia" de un paciente, y por lo que agrupan los informes.') }}</p>

          <div class="mt-4 overflow-hidden rounded-card border border-line bg-surface shadow-card">
            <table class="w-full text-[13px]">
              <thead class="border-b border-line bg-surface-subtle text-left text-[11px] font-[640] uppercase tracking-[.04em] text-ink-muted2">
                <tr>
                  <th class="px-4 py-2">{{ t('Name', 'Nombre') }}</th>
                  <th class="px-4 py-2">{{ t('Visibility', 'Visibilidad') }}</th>
                  <th class="px-4 py-2">{{ t('Status', 'Estado') }}</th>
                  <th class="px-4 py-2"></th>
                </tr>
              </thead>
              <tbody class="divide-y divide-line-row">
                <tr v-if="loading">
                  <td colspan="4" class="px-4 py-6 text-center text-ink-faint">{{ t('Loading…', 'Cargando…') }}</td>
                </tr>
                <tr v-else-if="sources.length === 0">
                  <td colspan="4" class="px-4 py-6 text-center text-ink-faint">{{ t('No referral sources yet.', 'Aún no hay fuentes de referencia.') }}</td>
                </tr>
                <tr v-for="s in sources" :key="s.id">
                  <td class="px-4 py-2.5 text-ink-700">{{ s.name }}</td>
                  <td class="px-4 py-2.5 text-ink-muted2">{{ s.visibility === 'public' ? t('Public', 'Público') : t('Private (Staff only)', 'Privado (solo personal)') }}</td>
                  <td class="px-4 py-2.5">
                    <button
                      type="button"
                      class="rounded-pill px-2 py-0.5 text-[11px] font-medium"
                      :class="s.status === 'active' ? 'bg-success-bg text-success-text' : 'bg-chip-bg text-chip-text'"
                      @click="toggleStatus(s)"
                    >
                      {{ s.status === 'active' ? t('Active', 'Activo') : t('Inactive', 'Inactivo') }}
                    </button>
                  </td>
                  <td class="px-4 py-2.5 text-right">
                    <button type="button" class="text-ink-faint hover:text-danger-text" @click="removeSource(s.id)">✕</button>
                  </td>
                </tr>
              </tbody>
            </table>
          </div>

          <form class="mt-4 flex flex-wrap items-end gap-3 rounded-card border border-line bg-surface p-4 shadow-card" @submit.prevent="addSource">
            <div>
              <label class="block text-[12.5px] font-medium text-ink-600">{{ t('Name', 'Nombre') }}</label>
              <input v-model="name" type="text" required placeholder="TikTok" class="mt-1 h-8 rounded-ctl border border-line-control bg-surface px-3 text-[13px] text-ink-700 focus:border-brand focus:outline-none focus:ring-1 focus:ring-brand/20" />
            </div>
            <div>
              <label class="block text-[12.5px] font-medium text-ink-600">{{ t('Visibility', 'Visibilidad') }}</label>
              <select v-model="visibility" class="mt-1 h-8 rounded-ctl border border-line-control bg-surface px-2 text-[13px] text-ink-700 focus:border-brand focus:outline-none">
                <option value="private">{{ t('Private (Staff only)', 'Privado (solo personal)') }}</option>
                <option value="public">{{ t('Public', 'Público') }}</option>
              </select>
            </div>
            <UiBtn variant="primary" type="submit" :disabled="saving">{{ saving ? t('Adding…', 'Añadiendo…') : t('Add Source', 'Añadir Fuente') }}</UiBtn>
          </form>
          <p v-if="error" class="mt-2 text-[12.5px] text-danger-text">{{ error }}</p>
        </div>
      </div>
    </div>
  </div>
</template>
