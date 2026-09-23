<script setup lang="ts">
import { sanitizeStorageFilename } from '~/utils/storageFilename'

// Build-mode half of a `drawable_image` block: the clinic picks the diagram
// here, and the patient draws on it in DocImageDraw. Same upload-to-a-public
// -bucket shape as SettingsClinicLogoUpload.
const props = defineProps<{ imagePath: string | null }>()
const emit = defineEmits<{ 'update:imagePath': [string | null] }>()

const supabase = useSupabaseClient()
const t = useT()

const imageUrl = computed(() => (props.imagePath ? supabase.storage.from('doc-images').getPublicUrl(props.imagePath).data.publicUrl : null))

const uploading = ref(false)
const error = ref('')
const fileInput = ref<HTMLInputElement | null>(null)

async function uploadFile(file: File) {
  uploading.value = true
  error.value = ''
  const path = `${useAccountStore().accountId}/${Date.now()}-${sanitizeStorageFilename(file.name)}`
  const { error: uploadError } = await supabase.storage.from('doc-images').upload(path, file)
  uploading.value = false
  if (uploadError) {
    error.value = uploadError.message
    return
  }
  // Only the new path is emitted -- the object the block pointed at before
  // stays in the bucket on purpose. Every document already made from this
  // template carries a copy of that old path (renderTemplateFields), so
  // deleting it would blank the diagram under marks a patient has signed.
  emit('update:imagePath', path)
}

function onFileChosen(event: Event) {
  const file = (event.target as HTMLInputElement).files?.[0]
  if (file) uploadFile(file)
  ;(event.target as HTMLInputElement).value = ''
}
</script>

<template>
  <div>
    <div class="flex items-start gap-3">
      <div class="flex h-20 w-20 shrink-0 items-center justify-center overflow-hidden rounded-ctl border border-line bg-surface-subtle">
        <img v-if="imageUrl" :src="imageUrl" class="h-full w-full object-contain" :alt="t('Diagram', 'Diagrama')" />
        <span v-else class="px-1 text-center text-[10px] leading-tight text-ink-faint">{{ t('No diagram', 'Sin diagrama') }}</span>
      </div>
      <div class="space-y-1">
        <div class="flex items-center gap-3">
          <button type="button" class="text-xs font-medium text-brand-text hover:text-brand-hover disabled:opacity-50" :disabled="uploading" @click="fileInput?.click()">
            {{ uploading ? '…' : imageUrl ? t('Replace diagram', 'Sustituir diagrama') : t('Upload diagram', 'Subir diagrama') }}
          </button>
          <button v-if="imageUrl" type="button" class="text-xs text-ink-faint hover:text-danger-text" @click="emit('update:imagePath', null)">
            {{ t('Remove', 'Quitar') }}
          </button>
        </div>
        <p class="text-[11px] text-ink-faint">
          {{ t('The patient draws on top of this image — e.g. a body chart to mark where it hurts.', 'El paciente dibuja encima de esta imagen — p. ej. un esquema corporal para marcar dónde le duele.') }}
        </p>
        <p v-if="error" class="text-[11px] text-danger-text">{{ error }}</p>
      </div>
    </div>
    <input ref="fileInput" type="file" accept="image/*" class="hidden" @change="onFileChosen" />
  </div>
</template>
