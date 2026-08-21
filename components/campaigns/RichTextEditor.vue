<script setup lang="ts">
// Minimal rich-text editor for campaign emails: bold/italic/underline via
// execCommand (only ever produces a small, known set of tags -- b/i/u/img/
// div/br -- so the HTML it outputs is safe to render unescaped server-side,
// unlike a plain textarea which would let staff paste arbitrary markup) plus
// image-by-URL and one-click patient-variable placeholders.
const props = defineProps<{ modelValue: string }>()
const emit = defineEmits<{ 'update:modelValue': [value: string] }>()

const editorRef = ref<HTMLDivElement | null>(null)

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
  const url = prompt('Link URL')
  if (!url) return
  document.execCommand('createLink', false, url)
  onInput()
}
function insertImage() {
  const url = prompt('Image URL')
  if (!url) return
  document.execCommand('insertImage', false, url)
  onInput()
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
      <button type="button" class="rounded-ctlSm px-2 py-1 text-[12px] font-medium text-ink-600 hover:bg-line-faint" @click="insertLink">Link</button>
      <button type="button" class="rounded-ctlSm px-2 py-1 text-[12px] font-medium text-ink-600 hover:bg-line-faint" @click="insertImage">Image</button>
      <div class="ml-auto flex items-center gap-1">
        <button type="button" class="rounded-pill border border-line-control bg-surface px-2 py-0.5 text-[11px] text-ink-muted2 hover:border-brand-tintBorder hover:bg-brand-tint hover:text-brand-text" @click="insertVariable('first_name')">First name</button>
        <button type="button" class="rounded-pill border border-line-control bg-surface px-2 py-0.5 text-[11px] text-ink-muted2 hover:border-brand-tintBorder hover:bg-brand-tint hover:text-brand-text" @click="insertVariable('last_name')">Last name</button>
        <button type="button" class="rounded-pill border border-line-control bg-surface px-2 py-0.5 text-[11px] text-ink-muted2 hover:border-brand-tintBorder hover:bg-brand-tint hover:text-brand-text" @click="insertVariable('email')">Email</button>
      </div>
    </div>
    <div
      ref="editorRef"
      contenteditable="true"
      class="min-h-[120px] px-3 py-2 text-[13.5px] text-ink-900 focus:outline-none [&_img]:max-w-full"
      @input="onInput"
    ></div>
  </div>
</template>
