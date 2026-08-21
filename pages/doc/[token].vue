<script setup lang="ts">
import type { DocField } from '~/utils/docFields'

definePageMeta({ layout: false })

const route = useRoute()
const token = route.params.token as string
const supabase = useSupabaseClient()

const phase = ref<'loading' | 'not_found' | 'fill' | 'done'>('loading')
const title = ref('')
const fields = ref<DocField[]>([])
const accountName = ref('')
const saving = ref(false)
const error = ref('')

onMounted(async () => {
  const { data, error: rpcError } = await supabase.rpc('get_public_patient_doc', { p_token: token })
  if (rpcError || !data) {
    phase.value = 'not_found'
    return
  }
  const parsed = data as unknown as { title: string; fields: DocField[]; completed_at: string | null; account_name: string }
  title.value = parsed.title
  fields.value = Array.isArray(parsed.fields) ? parsed.fields : []
  accountName.value = parsed.account_name
  phase.value = parsed.completed_at ? 'done' : 'fill'
})

async function submit() {
  error.value = ''
  saving.value = true
  const { error: rpcError } = await supabase.rpc('save_public_patient_doc', {
    p_token: token,
    p_fields: fields.value as any,
    p_complete: true,
  })
  saving.value = false
  if (rpcError) {
    error.value = rpcError.message
    return
  }
  phase.value = 'done'
}
</script>

<template>
  <div class="min-h-screen bg-stone-50 px-4 py-10">
    <div class="mx-auto max-w-2xl">
      <div v-if="phase === 'loading'" class="py-24 text-center text-sm text-gray-400">Loading…</div>

      <div v-else-if="phase === 'not_found'" class="rounded-lg border border-gray-200 bg-white p-10 text-center">
        <p class="text-gray-500">This link is no longer valid.</p>
      </div>

      <div v-else-if="phase === 'done'" class="mx-auto mt-10 rounded-lg border border-gray-200 bg-white p-8 text-center">
        <div class="mx-auto flex h-12 w-12 items-center justify-center rounded-full bg-green-100 text-2xl text-green-800">✓</div>
        <h2 class="mt-4 text-lg font-semibold text-gray-900">Thank you</h2>
        <p class="mt-2 text-sm text-gray-500">This document has been completed.</p>
      </div>

      <template v-else>
        <p class="text-center text-sm text-gray-500">{{ accountName }}</p>
        <div class="mt-4 rounded-lg border border-gray-200 bg-white p-6">
          <h1 class="text-xl font-semibold text-gray-900">{{ title }}</h1>
          <div class="mt-4">
            <DocBlocks :fields="fields" mode="fill" @update:fields="fields = $event" />
          </div>
          <p v-if="error" class="mt-3 text-sm text-red-600">{{ error }}</p>
          <button
            type="button"
            :disabled="saving"
            class="mt-5 w-full rounded-md bg-indigo-600 px-5 py-2.5 text-sm font-medium text-white hover:bg-indigo-700 disabled:opacity-50"
            @click="submit"
          >
            {{ saving ? 'Submitting…' : 'Submit' }}
          </button>
        </div>
      </template>
    </div>
  </div>
</template>
