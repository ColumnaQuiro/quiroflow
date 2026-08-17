<script setup lang="ts">
import type { Tables } from '~/types/database.types'

const props = defineProps<{
  patientId: string
  initialMessage: string
  appointmentId?: string
}>()

const emit = defineEmits<{ close: []; sent: [] }>()

const supabase = useSupabaseClient()
const message = ref(props.initialMessage)
const files = ref<Tables<'patient_files'>[]>([])
const attachmentFileId = ref('')
const sending = ref(false)
const error = ref('')

onMounted(async () => {
  const { data } = await supabase
    .from('patient_files')
    .select('*')
    .eq('patient_id', props.patientId)
    .order('created_at', { ascending: false })
  files.value = data ?? []
})

async function send() {
  error.value = ''
  if (!message.value.trim()) return
  sending.value = true
  try {
    await $fetch('/api/whatsapp/send', {
      method: 'POST',
      body: {
        patientId: props.patientId,
        message: message.value,
        attachmentFileId: attachmentFileId.value || undefined,
        appointmentId: props.appointmentId,
      },
    })
    emit('sent')
    emit('close')
  } catch (err: any) {
    error.value = err?.data?.statusMessage ?? 'Failed to send'
  } finally {
    sending.value = false
  }
}
</script>

<template>
  <div class="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" @click.self="emit('close')">
    <div class="w-full max-w-md rounded-lg bg-white p-5 shadow-xl">
      <h3 class="text-sm font-semibold text-gray-900">Send WhatsApp message</h3>

      <textarea
        v-model="message"
        rows="5"
        class="mt-3 w-full rounded-md border border-gray-300 px-3 py-2 text-sm focus:border-indigo-500 focus:outline-none focus:ring-1 focus:ring-indigo-500"
      ></textarea>

      <div class="mt-3">
        <label class="block text-xs font-medium text-gray-500">Attach a file (optional)</label>
        <select v-model="attachmentFileId" class="mt-1 w-full rounded-md border border-gray-300 px-3 py-1.5 text-sm">
          <option value="">No attachment</option>
          <option v-for="f in files" :key="f.id" :value="f.id">{{ f.file_name }}</option>
        </select>
      </div>

      <p v-if="error" class="mt-2 text-sm text-red-600">{{ error }}</p>

      <div class="mt-4 flex justify-end gap-2">
        <button type="button" class="rounded-md border border-gray-300 px-3 py-1.5 text-sm text-gray-600 hover:bg-gray-50" @click="emit('close')">
          Cancel
        </button>
        <button
          type="button"
          :disabled="sending"
          class="rounded-md bg-green-600 px-4 py-1.5 text-sm font-medium text-white hover:bg-green-700 disabled:opacity-50"
          @click="send"
        >
          {{ sending ? 'Sending…' : 'Send' }}
        </button>
      </div>
    </div>
  </div>
</template>
