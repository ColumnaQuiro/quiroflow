<script setup lang="ts">
const props = defineProps<{ patientId: string }>()

interface MessageRow {
  id: string
  direction: string
  purpose: string | null
  template_name: string | null
  status: string
  error_message: string | null
  body_preview: string | null
  created_at: string
}

const supabase = useSupabaseClient()
const messages = ref<MessageRow[]>([])
const loading = ref(true)

onMounted(async () => {
  const { data } = await supabase
    .from('whatsapp_messages')
    .select('id, direction, purpose, template_name, status, error_message, body_preview, created_at')
    .eq('patient_id', props.patientId)
    .order('created_at', { ascending: false })
  messages.value = data ?? []
  loading.value = false
})

const statusClass: Record<string, string> = {
  sent: 'bg-blue-50 text-blue-700',
  delivered: 'bg-blue-50 text-blue-700',
  read: 'bg-green-50 text-green-700',
  failed: 'bg-red-50 text-red-700',
  received: 'bg-gray-100 text-gray-600',
}
</script>

<template>
  <div class="rounded-lg border border-gray-200 bg-white">
    <div v-if="loading" class="p-6 text-center text-sm text-gray-400">Loading…</div>
    <p v-else-if="messages.length === 0" class="p-8 text-center text-sm text-gray-400">No WhatsApp messages sent to this patient yet.</p>
    <ul v-else class="divide-y divide-gray-100">
      <li v-for="m in messages" :key="m.id" class="flex items-start justify-between gap-4 px-4 py-3">
        <div class="min-w-0">
          <p class="text-sm text-gray-900">
            <span class="font-medium">{{ m.direction === 'inbound' ? 'Received' : 'Sent' }}</span>
            <span v-if="m.template_name" class="text-gray-500"> &middot; {{ m.template_name }}</span>
            <span v-if="m.purpose" class="text-gray-500"> &middot; {{ m.purpose }}</span>
          </p>
          <p v-if="m.body_preview" class="mt-0.5 truncate text-xs text-gray-500">{{ m.body_preview }}</p>
          <p v-if="m.status === 'failed' && m.error_message" class="mt-0.5 text-xs text-red-600">{{ m.error_message }}</p>
        </div>
        <div class="shrink-0 text-right">
          <span class="inline-block rounded px-1.5 py-0.5 text-xs font-medium" :class="statusClass[m.status] ?? 'bg-gray-100 text-gray-600'">{{ m.status }}</span>
          <p class="mt-1 text-xs text-gray-400">{{ new Date(m.created_at).toLocaleString([], { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' }) }}</p>
        </div>
      </li>
    </ul>
  </div>
</template>
