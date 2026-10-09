<script setup lang="ts">
import { exerciseMediaKind } from '../../composables/useExerciseMedia'

// The "upload a video or photo" control for an exercise, in Settings >
// Exercise Library and in the record's new-exercise form (so a practitioner
// can film it in the staff app and attach it there). It uploads straight
// away and hands back the storage path; the form it sits in saves the path
// with the exercise, and is the one that removes an upload it then discards
// (see useExerciseMedia.remove).
const props = defineProps<{ accountId: string; modelValue: string | null }>()
const emit = defineEmits<{ 'update:modelValue': [string | null] }>()

const t = useT()
const media = useExerciseMedia()
const uploading = ref(false)
const error = ref('')
const fileInput = ref<HTMLInputElement | null>(null)

async function onFile(e: Event) {
  const file = (e.target as HTMLInputElement).files?.[0]
  ;(e.target as HTMLInputElement).value = ''
  if (!file) return
  error.value = ''
  uploading.value = true
  const result = await media.upload(props.accountId, file)
  uploading.value = false
  if ('error' in result) {
    error.value = result.error
    return
  }
  emit('update:modelValue', result.path)
}

async function preview() {
  if (!props.modelValue) return
  const path = props.modelValue
  openWhenReady(() => media.signedUrl(path))
}
</script>

<template>
  <div class="text-[12.5px]" data-cy="exercise-media-field">
    <div v-if="modelValue" class="flex flex-wrap items-center gap-3 rounded-ctl border border-line-control bg-surface px-3 py-2">
      <span class="font-medium text-ink-900" data-cy="exercise-media-attached">{{ exerciseMediaKind(modelValue) === 'video' ? t('Video attached', 'Vídeo adjunto') : t('Photo attached', 'Foto adjunta') }}</span>
      <button type="button" class="font-medium text-brand-text" @click="preview">{{ t('View', 'Ver') }}</button>
      <button type="button" class="font-medium text-ink-muted hover:text-danger-text" data-cy="exercise-media-remove" @click="emit('update:modelValue', null)">{{ t('Remove', 'Quitar') }}</button>
    </div>
    <template v-else>
      <input ref="fileInput" type="file" accept="video/*,image/*" class="hidden" data-cy="exercise-media-input" @change="onFile" />
      <button type="button" class="font-medium text-brand-text disabled:text-ink-muted" :disabled="uploading" data-cy="exercise-media-upload" @click="fileInput?.click()">
        {{ uploading ? t('Uploading…', 'Subiendo…') : t('+ Upload a video or photo', '+ Subir un vídeo o una foto') }}
      </button>
      <span class="ml-2 text-ink-faint">{{ t('up to 50 MB', 'hasta 50 MB') }}</span>
    </template>
    <p v-if="error" role="alert" class="mt-1 text-danger-text">{{ error }}</p>
  </div>
</template>
