<script setup lang="ts">
// No login here -- the phone that scans the QR has no session at all, and
// doesn't need one; the token itself (validated server-side) is what gates
// this. Same layout: false pattern as the public booking page.
definePageMeta({ layout: false })

const route = useRoute()
const token = route.params.token as string

const phase = ref<'loading' | 'invalid' | 'ready' | 'uploading' | 'done'>('loading')
const patientFirstName = ref('')
const error = ref('')

onMounted(async () => {
  try {
    const data = await $fetch<{ patientFirstName: string }>(`/api/photo-upload/${token}`)
    patientFirstName.value = data.patientFirstName
    phase.value = 'ready'
  } catch (e: any) {
    error.value = e?.data?.statusMessage ?? 'This link is invalid or has expired.'
    phase.value = 'invalid'
  }
})

async function onFileChosen(event: Event) {
  const file = (event.target as HTMLInputElement).files?.[0]
  if (!file) return
  phase.value = 'uploading'
  error.value = ''
  const formData = new FormData()
  formData.append('file', file)
  try {
    await $fetch(`/api/photo-upload/${token}`, { method: 'POST', body: formData })
    phase.value = 'done'
  } catch (e: any) {
    error.value = e?.data?.statusMessage ?? 'Upload failed.'
    phase.value = 'ready'
  }
}
</script>

<template>
  <div class="flex min-h-screen items-center justify-center bg-surface-page px-4">
    <div class="w-full max-w-sm rounded-card border border-line bg-surface p-6 text-center shadow-card">
      <div v-if="phase === 'loading'" class="text-sm text-ink-faint">Cargando…</div>

      <div v-else-if="phase === 'invalid'" class="text-sm text-danger-text">{{ error }}</div>

      <template v-else-if="phase === 'ready' || phase === 'uploading'">
        <h1 class="text-lg font-semibold text-ink-900">Foto de perfil{{ patientFirstName ? ` de ${patientFirstName}` : '' }}</h1>
        <p class="mt-1 text-sm text-ink-muted">Toma una foto con tu cámara.</p>
        <label
          class="mt-5 flex w-full cursor-pointer items-center justify-center rounded-ctl bg-brand px-4 py-3 text-sm font-medium text-white hover:bg-brand-hover"
          :class="{ 'pointer-events-none opacity-50': phase === 'uploading' }"
        >
          {{ phase === 'uploading' ? 'Subiendo…' : 'Abrir cámara' }}
          <input type="file" accept="image/*" capture="environment" class="hidden" :disabled="phase === 'uploading'" @change="onFileChosen" />
        </label>
        <p v-if="error" class="mt-3 text-sm text-danger-text">{{ error }}</p>
      </template>

      <template v-else-if="phase === 'done'">
        <div class="mx-auto flex h-12 w-12 items-center justify-center rounded-full bg-success-bg text-2xl text-success-text">✓</div>
        <h1 class="mt-4 text-lg font-semibold text-ink-900">¡Foto subida!</h1>
        <p class="mt-2 text-sm text-ink-muted">Ya puedes cerrar esta página.</p>
      </template>
    </div>
  </div>
</template>
