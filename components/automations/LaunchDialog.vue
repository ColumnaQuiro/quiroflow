<script setup lang="ts">
import { normalizeSearchTerm } from '~/utils/searchText'
import { FIELD } from '~/utils/automationUi'
import { serverMessage } from '~/utils/serverMessage'

// "Launch for one patient": the automation starts now for this patient, at
// its first step, as if the trigger had happened (/api/automations/send-now,
// as Campaigns' "Send now" did). Consent and do-not-contact still apply.

const props = defineProps<{ ruleId: string }>()
const emit = defineEmits<{ close: []; launched: [] }>()
const t = useT()
const supabase = useSupabaseClient()
const { showToast } = useToast()

const query = ref('')
const results = ref<{ id: string; first_name: string; last_name: string | null }[]>([])
const chosen = ref<{ id: string; first_name: string; last_name: string | null } | null>(null)
const busy = ref(false)
const error = ref('')
let timer: ReturnType<typeof setTimeout> | undefined
watch(query, () => {
  clearTimeout(timer)
  chosen.value = null
  timer = setTimeout(async () => {
    const q = query.value.trim()
    if (!q) return (results.value = [])
    const { data } = await supabase.from('patients').select('id, first_name, last_name').ilike('search_name', `%${normalizeSearchTerm(q)}%`).limit(8)
    results.value = data ?? []
  }, 250)
})

async function launch() {
  if (!chosen.value) return
  busy.value = true
  error.value = ''
  try {
    await useStaffFetch('/api/automations/send-now', { method: 'POST', body: { ruleId: props.ruleId, patientId: chosen.value.id } })
    showToast(t(`Launched for ${chosen.value.first_name}`, `Lanzada para ${chosen.value.first_name}`))
    emit('launched')
  } catch (e) {
    error.value = serverMessage(e) ?? t('Could not launch it.', 'No se ha podido lanzar.')
  } finally {
    busy.value = false
  }
}
</script>

<template>
  <UiConfirmDialog
    :title="t('Launch for one patient', 'Lanzar para un paciente')"
    :confirm-label="t('Launch', 'Lanzar')"
    :cancel-label="t('Cancel', 'Cancelar')"
    :busy="busy"
    :disabled="!chosen"
    @confirm="launch"
    @cancel="emit('close')"
  >
    <p class="text-[14px] leading-relaxed text-ink-500">{{ t('They enter the first step right now, as if the trigger had happened.', 'Entra ahora mismo al primer paso, como si hubiera pasado el disparador.') }}</p>
    <label class="flex flex-col gap-1.5 text-[13px] font-semibold text-ink-700">
      {{ t('Patient', 'Paciente') }}
      <input v-model="query" :class="FIELD" :placeholder="t('Search by name', 'Buscar por nombre')" data-test="launch-search" />
    </label>
    <ul v-if="results.length && !chosen" class="max-h-48 overflow-y-auto rounded-ctl border border-line">
      <li v-for="p in results" :key="p.id">
        <button type="button" class="w-full px-3 py-2 text-left text-[13.5px] text-ink-700 hover:bg-surface-subtle touch:min-h-11" :data-test="`launch-patient-${p.id}`" @click="chosen = p">{{ p.first_name }} {{ p.last_name }}</button>
      </li>
    </ul>
    <p v-if="chosen" class="rounded-ctl border border-brand-tintBorder bg-brand-tint px-3 py-2 text-[13.5px] font-semibold text-brand-text">{{ chosen.first_name }} {{ chosen.last_name }}</p>
    <p class="text-[13px] text-ink-muted">{{ t('Their marketing consent and "do not contact" are respected.', 'Respeta su consentimiento de marketing y «no contactar».') }}</p>
    <p v-if="error" class="text-[13px] text-danger-text">{{ error }}</p>
  </UiConfirmDialog>
</template>
