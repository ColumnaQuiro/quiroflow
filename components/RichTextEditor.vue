<script setup lang="ts">
import { EditorContent, useEditor } from '@tiptap/vue-3'
import StarterKit from '@tiptap/starter-kit'
import Placeholder from '@tiptap/extension-placeholder'
import Link from '@tiptap/extension-link'

const props = defineProps<{ placeholder?: string }>()

const editor = useEditor({
  content: '',
  extensions: [
    StarterKit,
    Placeholder.configure({ placeholder: props.placeholder ?? 'Start writing…' }),
    Link.configure({ openOnClick: false }),
  ],
})

function isActive(name: string, attrs?: Record<string, unknown>) {
  return editor.value?.isActive(name, attrs) ?? false
}

function setContent(json: unknown) {
  editor.value?.commands.setContent((json as any) ?? '')
}
function getJSON() {
  return editor.value?.getJSON() as any
}
function insertText(text: string) {
  editor.value?.chain().focus().insertContent(text).run()
}

defineExpose({ setContent, getJSON, insertText })
</script>

<template>
  <div>
    <div v-if="editor" class="flex flex-wrap items-center gap-1 border-b border-gray-100 pb-3">
      <button type="button" class="rounded px-2 py-1 text-sm font-bold" :class="isActive('bold') ? 'bg-gray-200' : 'hover:bg-gray-100'" @click="editor.chain().focus().toggleBold().run()">B</button>
      <button type="button" class="rounded px-2 py-1 text-sm italic" :class="isActive('italic') ? 'bg-gray-200' : 'hover:bg-gray-100'" @click="editor.chain().focus().toggleItalic().run()">I</button>
      <span class="mx-1 h-4 w-px bg-gray-200"></span>
      <button type="button" class="rounded px-2 py-1 text-sm font-semibold" :class="isActive('heading', { level: 1 }) ? 'bg-gray-200' : 'hover:bg-gray-100'" @click="editor.chain().focus().toggleHeading({ level: 1 }).run()">H1</button>
      <button type="button" class="rounded px-2 py-1 text-sm font-semibold" :class="isActive('heading', { level: 2 }) ? 'bg-gray-200' : 'hover:bg-gray-100'" @click="editor.chain().focus().toggleHeading({ level: 2 }).run()">H2</button>
      <span class="mx-1 h-4 w-px bg-gray-200"></span>
      <button type="button" class="rounded px-2 py-1 text-sm" :class="isActive('bulletList') ? 'bg-gray-200' : 'hover:bg-gray-100'" @click="editor.chain().focus().toggleBulletList().run()">&bull; List</button>
      <button type="button" class="rounded px-2 py-1 text-sm" :class="isActive('orderedList') ? 'bg-gray-200' : 'hover:bg-gray-100'" @click="editor.chain().focus().toggleOrderedList().run()">1. List</button>
      <button type="button" class="rounded px-2 py-1 text-sm" :class="isActive('blockquote') ? 'bg-gray-200' : 'hover:bg-gray-100'" @click="editor.chain().focus().toggleBlockquote().run()">Quote</button>
      <slot name="extra-toolbar" :insert-text="insertText" />
    </div>

    <EditorContent :editor="editor" class="doc-editor mt-3 min-h-[300px] text-sm text-gray-900" />
  </div>
</template>

<style scoped>
.doc-editor :deep(.ProseMirror) {
  outline: none;
}
.doc-editor :deep(h1) {
  font-size: 1.5rem;
  font-weight: 600;
  margin: 1rem 0 0.5rem;
}
.doc-editor :deep(h2) {
  font-size: 1.25rem;
  font-weight: 600;
  margin: 0.875rem 0 0.5rem;
}
.doc-editor :deep(p) {
  margin: 0.5rem 0;
  line-height: 1.6;
}
.doc-editor :deep(ul) {
  list-style: disc;
  padding-left: 1.5rem;
  margin: 0.5rem 0;
}
.doc-editor :deep(ol) {
  list-style: decimal;
  padding-left: 1.5rem;
  margin: 0.5rem 0;
}
.doc-editor :deep(blockquote) {
  border-left: 3px solid #e5e7eb;
  padding-left: 0.75rem;
  color: #6b7280;
  margin: 0.5rem 0;
}
.doc-editor :deep(a) {
  color: #4f46e5;
  text-decoration: underline;
}
.doc-editor :deep(p.is-editor-empty:first-child::before) {
  content: attr(data-placeholder);
  color: #d1d5db;
  float: left;
  height: 0;
  pointer-events: none;
}
</style>
