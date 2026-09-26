<script setup lang="ts">
// Minimal rich-text editor for campaign emails: bold/italic/underline/link
// via execCommand (only ever produces a small, known set of tags -- a/b/i/u/
// img/div/br -- so the HTML it outputs is safe to render unescaped
// server-side, unlike a plain textarea which would let staff paste arbitrary
// markup; the paste handler below is what keeps that true, since a paste
// from Word or a web page would otherwise bring its own markup in) plus
// drag-and-drop/file-picker image upload and one-click patient-variable
// placeholders. Images upload to the public "campaign-images" bucket (not
// patient-files) -- email clients load the <img> src with no auth, so it
// can't be a signed URL that expires.
import { sanitizeStorageFilename } from '~/utils/storageFilename'

// `variables`: the merge fields offered as chips. Without it, the three the
// settings emails use (name, surname, email); the automation builder passes
// every field an automated email can resolve.
const props = defineProps<{ modelValue: string; variables?: { key: string; label: string }[] }>()
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
  editorRef.value?.focus()
  document.execCommand(command)
  onInput()
}
function insertLink() {
  const url = prompt(t('Link URL', 'URL del enlace'))
  if (!url) return
  editorRef.value?.focus()
  document.execCommand('createLink', false, withScheme(url))
  onInput()
}

// A URL typed or pasted without a scheme ("columnaquiro.com") becomes a
// relative link in the sent email and resolves against the mail client's own
// host, which goes nowhere.
function withScheme(url: string) {
  const trimmed = url.trim()
  if (/^(https?:|mailto:|tel:)/i.test(trimmed)) return trimmed
  if (/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(trimmed)) return `mailto:${trimmed}`
  return `https://${trimmed}`
}

function looksLikeUrl(text: string) {
  const trimmed = text.trim()
  if (!trimmed || /\s/.test(trimmed)) return false
  return /^(https?:\/\/|mailto:|www\.)/i.test(trimmed) || /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(trimmed) || /^[\w-]+(\.[\w-]+)+(\/\S*)?$/.test(trimmed)
}

function hasSelection() {
  const selection = window.getSelection()
  return Boolean(selection && !selection.isCollapsed && selection.toString().trim())
}

// Ctrl/Cmd+B/I/U already work in a contenteditable in every browser we
// support, but only because the browser decides to -- handling them here
// makes them ours, and gets the model updated on the same tick rather than
// whenever the browser's own input event lands. Ctrl/Cmd+K is the one people
// actually miss: there is no native equivalent.
function onKeydown(e: KeyboardEvent) {
  if (!(e.metaKey || e.ctrlKey) || e.altKey) return
  const key = e.key.toLowerCase()
  if (key === 'b' || key === 'i' || key === 'u') {
    e.preventDefault()
    exec({ b: 'bold', i: 'italic', u: 'underline' }[key] as string)
  } else if (key === 'k') {
    e.preventDefault()
    insertLink()
  }
}

// Paste does two things beyond the default.
//
// A URL pasted over selected text becomes a link on that text -- the thing
// every other editor does, and what staff expect when they highlight "book
// here" and paste the booking URL over it.
//
// Everything else is inserted as PLAIN TEXT. That is not tidiness: the body
// this editor produces is injected into the outgoing email unescaped, on the
// stated assumption that it only ever contains the small tag set these
// buttons produce. A paste from Word or a web page would break that
// assumption silently, and carries font and colour markup that renders badly
// in a mail client regardless.
function onPaste(e: ClipboardEvent) {
  const text = e.clipboardData?.getData('text/plain') ?? ''
  if (!text) return
  e.preventDefault()
  editorRef.value?.focus()
  if (looksLikeUrl(text) && hasSelection()) document.execCommand('createLink', false, withScheme(text))
  else document.execCommand('insertText', false, text)
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
    const path = `${store.accountId}/${Date.now()}-${sanitizeStorageFilename(file.name)}`
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

const chips = computed(
  () =>
    props.variables ?? [
      { key: 'first_name', label: t('First name', 'Nombre') },
      { key: 'last_name', label: t('Last name', 'Apellidos') },
      { key: 'email', label: t('Email', 'Correo electrónico') },
    ],
)

function insertVariable(name: string) {
  // Into the editor even when the cursor was elsewhere: focusing first keeps
  // the chip from typing into whatever field had focus.
  if (document.activeElement !== editorRef.value) editorRef.value?.focus()
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
      <button type="button" class="rounded-ctlSm px-2 py-1 text-[12px] font-medium text-ink-600 hover:bg-line-faint" :title="t('Link (Ctrl/Cmd + K)', 'Enlace (Ctrl/Cmd + K)')" @click="insertLink">{{ t('Link', 'Enlace') }}</button>
      <button type="button" class="rounded-ctlSm px-2 py-1 text-[12px] font-medium text-ink-600 hover:bg-line-faint" :disabled="uploading" @click="pickImage">
        {{ uploading ? t('Uploading…', 'Subiendo…') : t('Image', 'Imagen') }}
      </button>
      <input ref="fileInputRef" type="file" accept="image/*" class="hidden" @change="onFileChosen" />
      <div class="ml-auto flex flex-wrap items-center gap-1">
        <button
          v-for="v in chips"
          :key="v.key"
          type="button"
          class="rounded-pill border border-line-control bg-surface px-2 py-0.5 text-[11px] text-ink-muted2 hover:border-brand-tintBorder hover:bg-brand-tint hover:text-brand-text touch:min-h-9"
          @mousedown.prevent
          @click="insertVariable(v.key)"
        >{{ v.label }}</button>
      </div>
    </div>
    <div
      ref="editorRef"
      data-test="email-body"
      contenteditable="true"
      class="min-h-[120px] px-3 py-2 text-[13.5px] text-ink-900 focus:outline-none [&_img]:max-w-full [&_a]:text-brand-text [&_a]:underline"
      :class="dragOver ? 'bg-brand-tint' : ''"
      @input="onInput"
      @keydown="onKeydown"
      @paste="onPaste"
      @dragover.prevent="dragOver = true"
      @dragleave="dragOver = false"
      @drop.prevent="onDrop"
    ></div>
    <p v-if="uploadError" class="border-t border-line-control px-3 py-1.5 text-[11.5px] text-danger-text">{{ uploadError }}</p>
    <p class="border-t border-line-control px-3 py-1.5 text-[11px] text-ink-faint2">{{ t('Ctrl/Cmd + B, I, U for bold, italic and underline; Ctrl/Cmd + K, or paste a URL over selected text, to link it. Drag an image in, or use the Image button. Max', 'Ctrl/Cmd + B, I, U para negrita, cursiva y subrayado; Ctrl/Cmd + K, o pega una URL sobre el texto seleccionado, para enlazarlo. Arrastra una imagen, o usa el botón Imagen. Máx.') }} {{ (MAX_IMAGE_BYTES / (1024 * 1024)).toFixed(0) }} MB.</p>
  </div>
</template>
