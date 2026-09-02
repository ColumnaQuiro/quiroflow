<script setup lang="ts">
const props = defineProps<{ patientId: string; patientName: string }>()
const emit = defineEmits<{ close: [] }>()

interface LogRow { id: string; action: string; note: string | null; created_at: string }

const supabase = useSupabaseClient()
const t = useT()
const rows = ref<LogRow[]>([])
const loading = ref(true)

onMounted(async () => {
  const { data } = await supabase
    .from('contact_log')
    .select('id, action, note, created_at')
    .eq('patient_id', props.patientId)
    .order('created_at', { ascending: false })
  rows.value = data ?? []
  loading.value = false
})

const actionLabels = computed<Record<string, string>>(() => ({
  sent_whatsapp: t('WhatsApp sent', 'WhatsApp enviado'),
  called_no_answer: t('Called, no answer', 'Llamado, sin respuesta'),
  called_left_message: t('Left a message', 'Se dejó un mensaje'),
  booked: t('Booked', 'Reservado'),
  other: t('Contacted', 'Contactado'),
}))

function fullDate(iso: string) {
  return new Date(iso).toLocaleString(undefined, { day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' })
}
</script>

<template>
  <div class="fixed inset-0 z-50 flex items-center justify-center bg-ink-900/40 p-4" @click.self="emit('close')">
    <div class="flex max-h-[80vh] w-full max-w-md flex-col rounded-card bg-surface shadow-xl">
      <div class="flex h-12 shrink-0 items-center justify-between border-b border-line px-4">
        <h3 class="text-[13.5px] font-semibold text-ink-900">{{ t('Contact history', 'Historial de contacto') }} — {{ patientName }}</h3>
        <button type="button" class="flex h-6 w-6 items-center justify-center rounded-ctlSm text-ink-faint2 hover:bg-surface-subtle" @click="emit('close')">✕</button>
      </div>
      <div class="flex-1 overflow-y-auto">
        <div v-if="loading" class="p-6 text-center text-[13px] text-ink-faint">{{ t('Loading…', 'Cargando…') }}</div>
        <p v-else-if="rows.length === 0" class="p-6 text-center text-[13px] text-ink-faint">{{ t('No contact history yet.', 'Aún no hay historial de contacto.') }}</p>
        <ul v-else class="divide-y divide-line-row">
          <li v-for="row in rows" :key="row.id" class="px-4 py-2.5">
            <p class="text-[13px] font-medium text-ink-700">{{ actionLabels[row.action] ?? row.action }}</p>
            <p v-if="row.note" class="mt-0.5 text-[12px] text-ink-muted2">{{ row.note }}</p>
            <p class="mt-0.5 text-[11.5px] text-ink-faint">{{ fullDate(row.created_at) }}</p>
          </li>
        </ul>
      </div>
    </div>
  </div>
</template>
