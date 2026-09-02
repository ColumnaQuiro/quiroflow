<script setup lang="ts">
// Minimal rich-text editor for campaign emails: bold/italic/underline via
// execCommand (only ever produces a small, known set of tags -- b/i/u/img/
// div/br -- so the HTML it outputs is safe to render unescaped server-side,
// unlike a plain textarea which would let staff paste arbitrary markup) plus
// drag-and-drop/file-picker image upload and one-click patient-variable
// placeholders. Images upload to the public "campaign-images" bucket (not
// patient-files) -- email clients load the <img> src with no auth, so it
// can't be a signed URL that expires.
const props = defineProps<{ modelValue: string }>()
const emit = defineEmits<{ 'update:modelValue': [value: string] }>()

const MAX_IMAGE_BYTES = 3 * 1024 * 1024

const supabase = useSupabaseClient()
const store = useAccountStore()
const t = useT()

const editorRef = ref<HTMLDivElement | null>(null)
const fileInputRef = ref<HTMLInputElement | null>(null)
const uploading = ref(false)
const uploadError = ref('')
const dragOver = ref(false)

onMounted(() => {
  if (editorRef.value) editorRef.value.innerHTML = props.modelValue
})
watch(
  () => props.modelValue,
  (value) => {
    if (editorRef.value && editorRef.value.innerHTML !== value) editorRef.value.innerHTML = value
  },
)

function exec(command: string) {
  document.execCommand(command)
  onInput()
}
function insertLink() {
  const url = prompt(t('Link URL', 'URL del enlace'))
  if (!url) return
  document.execCommand('createLink', false, url)
  onInput()
}

function pickImage() {
  fileInputRef.value?.click()
}
async function onFileChosen(e: Event) {
  const file = (e.target as HTMLInputElement).files?.[0]
  if (file) await uploadAndInsert(file)
  if (fileInputRef.value) fileInputRef.value.value = ''
}
function onDrop(e: DragEvent) {
  dragOver.value = false
  const file = e.dataTransfer?.files?.[0]
  if (file) uploadAndInsert(file)
}
async function uploadAndInsert(file: File) {
  uploadError.value = ''
  if (!file.type.startsWith('image/')) {
    uploadError.value = t('Only image files can be inserted.', 'Solo se pueden insertar archivos de imagen.')
    return
  }
  if (file.size > MAX_IMAGE_BYTES) {
    uploadError.value = `${t('Image is too large', 'La imagen es demasiado grande')} (max ${(MAX_IMAGE_BYTES / (1024 * 1024)).toFixed(0)} MB).`
    return
  }
  uploading.value = true
  try {
    const path = `${store.accountId}/${Date.now()}-${file.name}`
    const { error } = await supabase.storage.from('campaign-images').upload(path, file)
    if (error) {
      uploadError.value = error.message
      return
    }
    const { data } = supabase.storage.from('campaign-images').getPublicUrl(path)
    editorRef.value?.focus()
    document.execCommand('insertImage', false, data.publicUrl)
    onInput()
  } finally {
    uploading.value = false
  }
}

function insertVariable(name: string) {
  document.execCommand('insertText', false, `{{${name}}}`)
  onInput()
}
function onInput() {
  emit('update:modelValue', editorRef.value?.innerHTML ?? '')
}
</script>

<template>
  <div class="overflow-hidden rounded-ctl border border-line-control">
    <div class="flex flex-wrap items-center gap-1 border-b border-line-control bg-surface-subtle px-2 py-1.5">
      <button type="button" class="flex h-6 w-6 items-center justify-center rounded-ctlSm text-[13px] font-bold text-ink-600 hover:bg-line-faint" @click="exec('bold')">B</button>
      <button type="button" class="flex h-6 w-6 items-center justify-center rounded-ctlSm text-[13px] italic text-ink-600 hover:bg-line-faint" @click="exec('italic')">I</button>
      <button type="button" class="flex h-6 w-6 items-center justify-center rounded-ctlSm text-[13px] underline text-ink-600 hover:bg-line-faint" @click="exec('underline')">U</button>
      <span class="mx-1 h-4 w-px bg-line-control"></span>
      <button type="button" class="rounded-ctlSm px-2 py-1 text-[12px] font-medium text-ink-600 hover:bg-line-faint" @click="insertLink">{{ t('Link', 'Enlace') }}</button>
      <button type="button" class="rounded-ctlSm px-2 py-1 text-[12px] font-medium text-ink-600 hover:bg-line-faint" :disabled="uploading" @click="pickImage">
        {{ uploading ? t('Uploading…', 'Subiendo…') : t('Image', 'Imagen') }}
      </button>
      <input ref="fileInputRef" type="file" accept="image/*" class="hidden" @change="onFileChosen" />
      <div class="ml-auto flex items-center gap-1">
        <button type="button" class="rounded-pill border border-line-control bg-surface px-2 py-0.5 text-[11px] text-ink-muted2 hover:border-brand-tintBorder hover:bg-brand-tint hover:text-brand-text" @click="insertVariable('first_name')">{{ t('First name', 'Nombre') }}</button>
        <button type="button" class="rounded-pill border border-line-control bg-surface px-2 py-0.5 text-[11px] text-ink-muted2 hover:border-brand-tintBorder hover:bg-brand-tint hover:text-brand-text" @click="insertVariable('last_name')">{{ t('Last name', 'Apellidos') }}</button>
        <button type="button" class="rounded-pill border border-line-control bg-surface px-2 py-0.5 text-[11px] text-ink-muted2 hover:border-brand-tintBorder hover:bg-brand-tint hover:text-brand-text" @click="insertVariable('email')">{{ t('Email', 'Correo electrónico') }}</button>
      </div>
    </div>
    <div
      ref="editorRef"
      contenteditable="true"
      class="min-h-[120px] px-3 py-2 text-[13.5px] text-ink-900 focus:outline-none [&_img]:max-w-full"
      :class="dragOver ? 'bg-brand-tint' : ''"
      @input="onInput"
      @dragover.prevent="dragOver = true"
      @dragleave="dragOver = false"
      @drop.prevent="onDrop"
    ></div>
    <p v-if="uploadError" class="border-t border-line-control px-3 py-1.5 text-[11.5px] text-danger-text">{{ uploadError }}</p>
    <p class="border-t border-line-control px-3 py-1.5 text-[11px] text-ink-faint2">{{ t('Drag an image into the editor, or use the Image button. Max', 'Arrastra una imagen al editor, o usa el botón Imagen. Máx.') }} {{ (MAX_IMAGE_BYTES / (1024 * 1024)).toFixed(0) }} MB.</p>
  </div>
</template>
