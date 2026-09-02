<script setup lang="ts">
import type { Tables } from '~/types/database.types'

const supabase = useSupabaseClient()
const store = useAccountStore()
const t = useT()

const modalities = ref<Tables<'modalities'>[]>([])
const loading = ref(true)
const name = ref('')
const saving = ref(false)
const error = ref('')

async function load() {
  loading.value = true
  const { data } = await supabase.from('modalities').select('*').order('name')
  modalities.value = data ?? []
  loading.value = false
}
onMounted(load)

async function addModality() {
  error.value = ''
  if (!name.value.trim()) return
  saving.value = true
  const { error: insertError } = await supabase.from('modalities').insert({
    account_id: store.accountId!,
    name: name.value.trim(),
  })
  saving.value = false
  if (insertError) {
    error.value = insertError.message
    return
  }
  name.value = ''
  await load()
}

async function toggleActive(modality: Tables<'modalities'>) {
  modality.is_active = !modality.is_active
  await supabase.from('modalities').update({ is_active: modality.is_active }).eq('id', modality.id)
}

async function removeModality(id: string) {
  if (!confirm(t('Delete this modality?', '¿Eliminar esta modalidad?'))) return
  await supabase.from('modalities').delete().eq('id', id)
  await load()
}
</script>

<template>
  <div class="flex h-full flex-col">
    <PageHeader :title="t('Modalities', 'Modalidades')" />
    <div class="flex-1 overflow-y-auto">
      <div class="flex gap-8 p-6">
        <SettingsNav />
        <div class="min-w-0 max-w-[660px] flex-1">
          <p class="text-[13px] text-ink-muted2">{{ t("Categorise practitioners, appointment types, and services by what's being provided (e.g. Chiropractic, Sports Massage, Osteopathy).", 'Clasifica profesionales, tipos de cita y servicios según lo que se ofrece (p. ej. Quiropráctica, Masaje deportivo, Osteopatía).') }}</p>

          <div class="mt-4 overflow-hidden rounded-card border border-line bg-surface shadow-card">
            <table class="w-full text-[13px]">
              <thead class="border-b border-line bg-surface-subtle text-left text-[11px] font-[640] uppercase tracking-[.04em] text-ink-muted2">
                <tr>
                  <th class="px-4 py-2">{{ t('Name', 'Nombre') }}</th>
                  <th class="px-4 py-2">{{ t('Status', 'Estado') }}</th>
                  <th class="px-4 py-2"></th>
                </tr>
              </thead>
              <tbody class="divide-y divide-line-row">
                <tr v-if="loading">
                  <td colspan="3" class="px-4 py-6 text-center text-ink-faint">{{ t('Loading…', 'Cargando…') }}</td>
                </tr>
                <tr v-else-if="modalities.length === 0">
                  <td colspan="3" class="px-4 py-6 text-center text-ink-faint">{{ t('No modalities yet.', 'Todavía no hay modalidades.') }}</td>
                </tr>
                <tr v-for="m in modalities" :key="m.id">
                  <td class="px-4 py-2.5 text-ink-700">{{ m.name }}</td>
                  <td class="px-4 py-2.5">
                    <button
                      type="button"
                      class="rounded-pill px-2 py-0.5 text-[11px] font-medium"
                      :class="m.is_active ? 'bg-success-bg text-success-text' : 'bg-chip-bg text-chip-text'"
                      @click="toggleActive(m)"
                    >
                      {{ m.is_active ? t('Active', 'Activa') : t('Inactive', 'Inactiva') }}
                    </button>
                  </td>
                  <td class="px-4 py-2.5 text-right">
                    <button type="button" class="text-ink-faint hover:text-danger-text" @click="removeModality(m.id)">✕</button>
                  </td>
                </tr>
              </tbody>
            </table>
          </div>

          <form class="mt-4 flex flex-wrap items-end gap-3 rounded-card border border-line bg-surface p-4 shadow-card" @submit.prevent="addModality">
            <div>
              <label class="block text-[12.5px] font-medium text-ink-600">{{ t('Name', 'Nombre') }}</label>
              <input v-model="name" type="text" required :placeholder="t('Sports Massage', 'Masaje deportivo')" class="mt-1 h-8 rounded-ctl border border-line-control bg-surface px-3 text-[13px] text-ink-700 focus:border-brand focus:outline-none focus:ring-1 focus:ring-brand/20" />
            </div>
            <UiBtn variant="primary" type="submit" :disabled="saving">{{ saving ? t('Adding…', 'Añadiendo…') : t('Add Modality', 'Añadir modalidad') }}</UiBtn>
          </form>
          <p v-if="error" class="mt-2 text-[12.5px] text-danger-text">{{ error }}</p>
        </div>
      </div>
    </div>
  </div>
</template>
