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
  <div class="rounded-md border border-gray-300">
    <div class="flex flex-wrap items-center gap-1 border-b border-gray-200 bg-gray-50 p-1.5">
      <button type="button" class="rounded px-2 py-1 text-sm font-bold text-gray-700 hover:bg-gray-200" @click="exec('bold')">B</button>
      <button type="button" class="rounded px-2 py-1 text-sm italic text-gray-700 hover:bg-gray-200" @click="exec('italic')">I</button>
      <button type="button" class="rounded px-2 py-1 text-sm underline text-gray-700 hover:bg-gray-200" @click="exec('underline')">U</button>
      <button type="button" class="rounded px-2 py-1 text-xs font-medium text-gray-700 hover:bg-gray-200" @click="insertImage">+ Image</button>
      <span class="mx-1 h-4 w-px bg-gray-300"></span>
      <button type="button" class="rounded bg-white px-2 py-1 text-xs text-gray-600 hover:bg-gray-200" @click="insertVariable('first_name')">First name</button>
      <button type="button" class="rounded bg-white px-2 py-1 text-xs text-gray-600 hover:bg-gray-200" @click="insertVariable('last_name')">Last name</button>
      <button type="button" class="rounded bg-white px-2 py-1 text-xs text-gray-600 hover:bg-gray-200" @click="insertVariable('email')">Email</button>
    </div>
    <div
      ref="editorRef"
      contenteditable="true"
      class="min-h-[140px] px-3 py-2 text-sm text-gray-900 focus:outline-none [&_img]:max-w-full"
      @input="onInput"
    ></div>
  </div>
</template>
