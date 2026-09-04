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
  <div class="min-h-screen bg-surface-page px-4 py-10">
    <div class="mx-auto max-w-2xl">
      <div v-if="phase === 'loading'" class="mt-10 space-y-3 rounded-card border border-line bg-surface p-8">
        <UiSkeleton class="h-5 w-1/2 rounded-ctlSm" />
        <UiSkeleton class="h-3 w-full rounded-ctlSm" />
        <UiSkeleton class="h-3 w-full rounded-ctlSm" />
        <UiSkeleton class="h-3 w-2/3 rounded-ctlSm" />
      </div>

      <div v-else-if="phase === 'not_found'" class="rounded-card border border-line bg-surface p-10 text-center">
        <p class="text-ink-muted">This link is no longer valid.</p>
      </div>

      <div v-else-if="phase === 'done'" class="mx-auto mt-10 rounded-card border border-line bg-surface p-8 text-center">
        <div class="mx-auto flex h-12 w-12 items-center justify-center rounded-full bg-success-bg text-2xl text-success-text">✓</div>
        <h2 class="mt-4 text-lg font-semibold text-ink-900">Thank you</h2>
        <p class="mt-2 text-sm text-ink-muted">This document has been completed.</p>
      </div>

      <template v-else>
        <p class="text-center text-sm text-ink-muted">{{ accountName }}</p>
        <div class="mt-4 rounded-card border border-line bg-surface p-6 shadow-card">
          <h1 class="text-xl font-semibold text-ink-900">{{ title }}</h1>
          <div class="mt-4">
            <DocBlocks :fields="fields" mode="fill" @update:fields="fields = $event" />
          </div>
          <p v-if="error" class="mt-3 text-sm text-danger-text">{{ error }}</p>
          <UiBtn type="button" variant="primary" class="mt-5 w-full" :disabled="saving" @click="submit">
            {{ saving ? 'Submitting…' : 'Submit' }}
          </UiBtn>
        </div>
      </template>
    </div>
  </div>
</template>
