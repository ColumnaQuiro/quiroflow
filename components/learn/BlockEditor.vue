<script setup lang="ts">
import {
  isLearnTextBlock,
  learnBlocksFromHtml,
  learnBlocksFromText,
  learnRunsFromHtml,
  learnRunsText,
  learnRunsToHtml,
  newLearnBlockId,
  type LearnBlock,
  type LearnTextBlock,
  type LearnTextBlockType,
} from '~/utils/learnContent'

// The body of an education article, edited like a Notion page
// (utils/learnContent.ts): one block per paragraph, heading, list item,
// quote, callout, divider or image.
//
//   "/"            in an empty block opens the block menu, filtered as you type
//   "# " "## "     heading, subheading;  "- " bullet;  "1. " numbered;  "> " quote
//   Enter          new block (a list continues; an empty item ends the list)
//   Shift+Enter    line break inside the block
//   Backspace      at the start: back to paragraph, then joins the block above
//   select text    bold, italic, underline, strikethrough, link (⌘B ⌘I ⌘U ⌘K)
//   paste          several paragraphs or a list become blocks; an image uploads
//   ⋮⋮             drag to reorder, click for turn into / duplicate / delete
//
// Each text block is its own contenteditable whose HTML is written only
// when the block is created or changed from here (never re-rendered by Vue
// while typing, which would move the caret); what is typed is read back
// with learnRunsFromHtml, which knows only the formats above.
//
// Images are private (learn-media): `upload` puts one there and returns its
// path, `sign` turns paths into URLs to show. `uploaded` reports each new
// path so the page can delete the ones never saved.
const props = defineProps<{
  modelValue: LearnBlock[]
  upload: (file: File) => Promise<{ path: string } | { error: string }>
  sign: (paths: string[]) => Promise<Record<string, string>>
  placeholder?: string
}>()
const emit = defineEmits<{ 'update:modelValue': [value: LearnBlock[]]; uploaded: [path: string]; error: [message: string] }>()

const t = useT()

const clone = (b: LearnBlock[]): LearnBlock[] => JSON.parse(JSON.stringify(b))
const emptyParagraph = (): LearnTextBlock => ({ id: newLearnBlockId(), type: 'paragraph', runs: [] })
const blocks = ref<LearnBlock[]>(props.modelValue.length ? clone(props.modelValue) : [emptyParagraph()])
// What was last emitted, as JSON: the parent may hand it back wrapped in a
// reactive proxy, so identity cannot tell its own value from a new one.
let lastEmitted = ''
// An image still uploading holds its place as a block of its own; it is not
// part of the article until it has a path.
const uploadingIds = ref<Set<string>>(new Set())
function commit() {
  const value = clone(blocks.value.filter((b) => !uploadingIds.value.has(b.id)))
  lastEmitted = JSON.stringify(value)
  emit('update:modelValue', value)
}
// Replaced from outside (another language, a reset): start again from it.
const generation = ref(0)
watch(
  () => props.modelValue,
  (value) => {
    if (JSON.stringify(value) === lastEmitted) return
    blocks.value = value.length ? clone(value) : [emptyParagraph()]
    els.clear()
    generation.value++
  },
)

// ---- the contenteditable elements, by block id

const els = new Map<string, HTMLElement>()
const initialised = new WeakSet<HTMLElement>()
function bindEl(id: string, el: Element | null) {
  if (!el) {
    if (els.get(id) && !els.get(id)!.isConnected) els.delete(id)
    return
  }
  const node = el as HTMLElement
  els.set(id, node)
  if (!initialised.has(node)) {
    initialised.add(node)
    const b = blocks.value.find((x) => x.id === id)
    node.innerHTML = b && isLearnTextBlock(b) ? learnRunsToHtml(b.runs) : ''
  }
}
function writeHtml(id: string) {
  const el = els.get(id)
  const b = blocks.value.find((x) => x.id === id)
  if (el && b && isLearnTextBlock(b)) el.innerHTML = learnRunsToHtml(b.runs)
}

const indexOf = (id: string) => blocks.value.findIndex((b) => b.id === id)
const textBlock = (id: string) => {
  const b = blocks.value.find((x) => x.id === id)
  return b && isLearnTextBlock(b) ? b : null
}
const isEmpty = (b: LearnBlock) => isLearnTextBlock(b) && !learnRunsText(b.runs)

// ---- caret

/** The caret's position in a block, counting a <br> as one character, as runs do. */
function textLength(node: Node): number {
  if (node.nodeType === Node.TEXT_NODE) return (node.textContent ?? '').length
  if ((node as Element).tagName === 'BR') return 1
  let n = 0
  node.childNodes.forEach((c) => (n += textLength(c)))
  return n
}
function caretOffset(el: HTMLElement): number | null {
  const sel = window.getSelection()
  if (!sel?.rangeCount) return null
  const r = sel.getRangeAt(0)
  if (!el.contains(r.startContainer)) return null
  const pre = document.createRange()
  pre.selectNodeContents(el)
  pre.setEnd(r.startContainer, r.startOffset)
  return textLength(pre.cloneContents())
}
function setCaret(el: HTMLElement, offset: number | 'end') {
  el.focus()
  const sel = window.getSelection()
  if (!sel) return
  const range = document.createRange()
  let left = offset === 'end' ? Infinity : offset
  let placed = false
  const walk = (node: Node): boolean => {
    for (const c of Array.from(node.childNodes)) {
      if (c.nodeType === Node.TEXT_NODE) {
        const len = (c.textContent ?? '').length
        if (left <= len) {
          range.setStart(c, left)
          return true
        }
        left -= len
      } else if ((c as Element).tagName === 'BR') {
        if (left === 0) {
          range.setStartBefore(c)
          return true
        }
        left -= 1
      } else if (walk(c)) return true
    }
    return false
  }
  placed = offset !== 'end' && walk(el)
  if (!placed) {
    range.selectNodeContents(el)
    range.collapse(false)
  } else range.collapse(true)
  sel.removeAllRanges()
  sel.addRange(range)
}
async function focusBlock(id: string, where: number | 'start' | 'end' = 'end') {
  await nextTick()
  const el = els.get(id)
  if (el) setCaret(el, where === 'start' ? 0 : where)
  else document.querySelector<HTMLElement>(`[data-block-row="${id}"]`)?.focus()
}
function selectionCollapsed() {
  const sel = window.getSelection()
  return !sel || sel.isCollapsed
}

// ---- typing

const MARKDOWN: [RegExp, LearnTextBlockType][] = [
  [/^##[\s\u00a0]/, 'subheading'],
  [/^#[\s\u00a0]/, 'heading'],
  [/^[-*•][\s\u00a0]/, 'bullet'],
  [/^1[.)][\s\u00a0]/, 'number'],
  [/^>[\s\u00a0]/, 'quote'],
]
/** Removes the first `n` characters of a block's text from the DOM, leaving the caret where it was. */
function deleteLeading(el: HTMLElement, n: number) {
  const range = document.createRange()
  range.setStart(el, 0)
  let left = n
  const walk = (node: Node): boolean => {
    for (const c of Array.from(node.childNodes)) {
      if (c.nodeType === Node.TEXT_NODE) {
        const len = (c.textContent ?? '').length
        if (left <= len) {
          range.setEnd(c, left)
          return true
        }
        left -= len
      } else if (walk(c)) return true
    }
    return false
  }
  if (walk(el)) range.deleteContents()
}

function onInput(id: string) {
  const el = els.get(id)
  const b = textBlock(id)
  if (!el || !b) return
  b.runs = learnRunsFromHtml(el.innerHTML)
  const text = learnRunsText(b.runs)
  if (b.type === 'paragraph') {
    if (text === '---') {
      replaceWithDivider(id)
      return
    }
    for (const [re, type] of MARKDOWN) {
      const m = text.match(re)
      if (m) {
        b.type = type
        // Only the prefix goes, from the DOM itself: rewriting the block
        // inside its own input event leaves Chrome's caret behind the text
        // typed next.
        deleteLeading(el, m[0].length)
        b.runs = learnRunsFromHtml(el.innerHTML)
        break
      }
    }
  }
  updateMenu(id)
  commit()
}

// ---- the block menu ("/")

interface MenuItem { key: string; label: string; hint: string; icon: string; words: string }
const MENU: MenuItem[] = [
  { key: 'paragraph', label: t('Text', 'Texto'), hint: t('Plain paragraph', 'Párrafo normal'), icon: 'Aa', words: 'texto text parrafo paragraph' },
  { key: 'heading', label: t('Heading', 'Título'), hint: t('Section title', 'Título de sección'), icon: 'H1', words: 'titulo heading h1 encabezado' },
  { key: 'subheading', label: t('Subheading', 'Subtítulo'), hint: t('Smaller title', 'Título más pequeño'), icon: 'H2', words: 'subtitulo subheading h2' },
  { key: 'bullet', label: t('Bulleted list', 'Lista'), hint: t('Simple list', 'Lista con viñetas'), icon: '•', words: 'lista bullet vinetas list' },
  { key: 'number', label: t('Numbered list', 'Lista numerada'), hint: t('1, 2, 3…', '1, 2, 3…'), icon: '1.', words: 'numerada numbered lista list pasos steps' },
  { key: 'quote', label: t('Quote', 'Cita'), hint: t('Highlighted quote', 'Cita destacada'), icon: '❝', words: 'cita quote' },
  { key: 'callout', label: t('Callout', 'Nota destacada'), hint: t('A tip in a box', 'Un consejo en un recuadro'), icon: '💡', words: 'nota callout consejo destacado tip' },
  { key: 'image', label: t('Image', 'Imagen'), hint: t('Upload a photo', 'Subir una foto'), icon: '🖼', words: 'imagen image foto photo' },
  { key: 'divider', label: t('Divider', 'Separador'), hint: t('A line between sections', 'Una línea entre secciones'), icon: '—', words: 'separador divider linea line' },
]
const fold = (s: string) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase()
const menu = ref<{ blockId: string; query: string; index: number; top: number; left: number } | null>(null)
const menuItems = computed(() => {
  const q = fold(menu.value?.query ?? '')
  return q ? MENU.filter((m) => fold(`${m.label} ${m.words}`).includes(q)) : MENU
})
const rootRef = ref<HTMLElement | null>(null)
function updateMenu(id: string) {
  const b = textBlock(id)
  const text = b ? learnRunsText(b.runs) : ''
  if (!b || !text.startsWith('/') || text.length > 24 || /\s/.test(text)) {
    if (menu.value?.blockId === id) menu.value = null
    return
  }
  const el = els.get(id)
  const root = rootRef.value
  if (!el || !root) return
  const r = el.getBoundingClientRect()
  const rr = root.getBoundingClientRect()
  menu.value = { blockId: id, query: text.slice(1), index: menu.value?.blockId === id ? Math.min(menu.value.index, 8) : 0, top: r.bottom - rr.top + 4, left: r.left - rr.left }
  if (!menuItems.value.length && text.length > 3) menu.value = null
}
function choose(item: MenuItem) {
  const id = menu.value?.blockId
  menu.value = null
  if (!id) return
  const b = textBlock(id)
  if (!b) return
  b.runs = []
  if (item.key === 'divider') return replaceWithDivider(id)
  if (item.key === 'image') {
    writeHtml(id)
    commit()
    return pickImage(id)
  }
  b.type = item.key as LearnTextBlockType
  writeHtml(id)
  commit()
  focusBlock(id, 'start')
}

// ---- structure

function insertAfter(id: string | null, ...added: LearnBlock[]) {
  const i = id ? indexOf(id) : blocks.value.length - 1
  blocks.value.splice(i + 1, 0, ...added)
}
function replaceWithDivider(id: string) {
  const i = indexOf(id)
  const next = emptyParagraph()
  blocks.value.splice(i, 1, { id: newLearnBlockId(), type: 'divider' }, next)
  commit()
  focusBlock(next.id, 'start')
}
function removeBlock(id: string) {
  const i = indexOf(id)
  if (i < 0) return
  blocks.value.splice(i, 1)
  if (!blocks.value.length) blocks.value.push(emptyParagraph())
  commit()
}
function moveBlock(id: string, to: number) {
  const i = indexOf(id)
  if (i < 0 || to < 0 || to >= blocks.value.length || to === i) return
  const [b] = blocks.value.splice(i, 1)
  blocks.value.splice(to, 0, b!)
  commit()
}
function duplicateBlock(id: string) {
  const b = blocks.value.find((x) => x.id === id)
  if (!b) return
  insertAfter(id, { ...clone([b])[0]!, id: newLearnBlockId() })
  commit()
}
function turnInto(id: string, type: LearnTextBlockType) {
  const b = textBlock(id)
  if (!b) return
  b.type = type
  commit()
  focusBlock(id, 'end')
}

/** The block's HTML from the caret on, taken out of it. */
function cutAfterCaret(el: HTMLElement): string {
  const sel = window.getSelection()
  if (!sel?.rangeCount) return ''
  const r = sel.getRangeAt(0)
  if (!r.collapsed) r.deleteContents()
  const tail = document.createRange()
  tail.setStart(r.startContainer, r.startOffset)
  tail.setEnd(el, el.childNodes.length)
  const box = document.createElement('div')
  box.appendChild(tail.extractContents())
  return box.innerHTML
}

function onKeydown(id: string, e: KeyboardEvent) {
  const el = els.get(id)
  const b = textBlock(id)
  if (!el || !b) return
  if (menu.value?.blockId === id) {
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault()
      const n = menuItems.value.length
      if (n) menu.value.index = (menu.value.index + (e.key === 'ArrowDown' ? 1 : n - 1)) % n
      return
    }
    if (e.key === 'Enter' || e.key === 'Tab') {
      const item = menuItems.value[menu.value.index]
      if (item) {
        e.preventDefault()
        choose(item)
        return
      }
    }
    if (e.key === 'Escape') {
      e.preventDefault()
      menu.value = null
      return
    }
  }
  const mod = e.metaKey || e.ctrlKey
  if (mod && e.key.toLowerCase() === 'k') {
    e.preventDefault()
    openLink()
    return
  }
  if (mod && e.shiftKey && e.key.toLowerCase() === 'x') {
    e.preventDefault()
    format('strikeThrough')
    return
  }
  if (e.key === 'Enter' && !e.shiftKey && !e.isComposing) {
    e.preventDefault()
    const isList = b.type === 'bullet' || b.type === 'number'
    if (isList && !learnRunsText(b.runs).trim()) {
      b.type = 'paragraph'
      commit()
      return
    }
    const tailHtml = cutAfterCaret(el)
    b.runs = learnRunsFromHtml(el.innerHTML)
    writeHtml(id)
    const next: LearnTextBlock = { id: newLearnBlockId(), type: isList ? b.type : 'paragraph', runs: learnRunsFromHtml(tailHtml) }
    insertAfter(id, next)
    commit()
    focusBlock(next.id, 'start')
    return
  }
  if (e.key === 'Backspace' && selectionCollapsed() && caretOffset(el) === 0) {
    if (b.type !== 'paragraph') {
      e.preventDefault()
      b.type = 'paragraph'
      commit()
      return
    }
    const i = indexOf(id)
    const prev = blocks.value[i - 1]
    if (!prev) return
    e.preventDefault()
    if (isLearnTextBlock(prev)) {
      const at = learnRunsText(prev.runs).length
      prev.runs = [...prev.runs, ...b.runs]
      blocks.value.splice(i, 1)
      writeHtml(prev.id)
      commit()
      focusBlock(prev.id, at)
    } else if (!learnRunsText(b.runs)) {
      // An empty line under an image or a divider: just the line goes.
      blocks.value.splice(i, 1)
      commit()
    } else if (prev.type === 'divider') {
      blocks.value.splice(i - 1, 1)
      commit()
      focusBlock(id, 'start')
    }
    return
  }
  if (e.key === 'Delete' && selectionCollapsed() && caretOffset(el) === learnRunsText(b.runs).length) {
    const next = blocks.value[indexOf(id) + 1]
    if (next && isLearnTextBlock(next)) {
      e.preventDefault()
      const at = learnRunsText(b.runs).length
      b.runs = [...b.runs, ...next.runs]
      blocks.value.splice(indexOf(next.id), 1)
      writeHtml(id)
      commit()
      focusBlock(id, at)
    }
    return
  }
  if ((e.key === 'ArrowUp' || e.key === 'ArrowDown') && selectionCollapsed() && !e.shiftKey) {
    const sel = window.getSelection()!
    const caret = sel.rangeCount ? sel.getRangeAt(0).getBoundingClientRect() : null
    const box = el.getBoundingClientRect()
    const up = e.key === 'ArrowUp'
    const edge = !caret || (caret.top === 0 && caret.bottom === 0) ? (up ? caretOffset(el) === 0 : caretOffset(el) === learnRunsText(b.runs).length) : up ? caret.top - box.top < 12 : box.bottom - caret.bottom < 12
    if (!edge) return
    const i = indexOf(id)
    for (let j = up ? i - 1 : i + 1; j >= 0 && j < blocks.value.length; j += up ? -1 : 1) {
      const target = blocks.value[j]!
      if (isLearnTextBlock(target)) {
        e.preventDefault()
        focusBlock(target.id, up ? 'end' : 'start')
        return
      }
    }
  }
}

// ---- paste and drop

async function onPaste(id: string, e: ClipboardEvent) {
  const data = e.clipboardData
  if (!data) return
  const files = Array.from(data.files).filter((f) => f.type.startsWith('image/'))
  if (files.length) {
    e.preventDefault()
    for (const f of files) await addImage(f, id)
    return
  }
  const html = data.getData('text/html')
  const text = data.getData('text/plain')
  const pasted = html ? learnBlocksFromHtml(html) : learnBlocksFromText(text)
  e.preventDefault()
  const single = pasted.length === 1 && pasted[0]!.type === 'paragraph' ? (pasted[0] as LearnTextBlock) : null
  if (!pasted.length || single) {
    const runs = single?.runs ?? [{ text }]
    document.execCommand('insertHTML', false, learnRunsToHtml(runs))
    return
  }
  const el = els.get(id)
  const b = textBlock(id)
  if (!el || !b) return
  const tail = learnRunsFromHtml(cutAfterCaret(el))
  b.runs = learnRunsFromHtml(el.innerHTML)
  const added: LearnBlock[] = [...pasted]
  if (learnRunsText(tail)) added.push({ id: newLearnBlockId(), type: 'paragraph', runs: tail })
  const i = indexOf(id)
  // Pasted into an empty line: the pasted blocks take its place.
  if (!learnRunsText(b.runs)) blocks.value.splice(i, 1, ...added)
  else {
    writeHtml(id)
    insertAfter(id, ...added)
  }
  commit()
  const last = [...pasted].reverse().find(isLearnTextBlock)
  if (last) focusBlock(last.id, 'end')
}

const dropTarget = ref<{ id: string; after: boolean } | null>(null)
const dragging = ref<string | null>(null)
function onDragOver(id: string, e: DragEvent) {
  const files = e.dataTransfer?.types.includes('Files')
  if (!dragging.value && !files) return
  e.preventDefault()
  const row = (e.currentTarget as HTMLElement).getBoundingClientRect()
  dropTarget.value = { id, after: e.clientY > row.top + row.height / 2 }
}
async function onDrop(id: string, e: DragEvent) {
  const target = dropTarget.value
  dropTarget.value = null
  if (dragging.value) {
    e.preventDefault()
    const from = dragging.value
    dragging.value = null
    if (!target || from === target.id) return
    const fromIndex = indexOf(from)
    let to = indexOf(target.id) + (target.after ? 1 : 0)
    if (fromIndex < to) to--
    moveBlock(from, to)
    return
  }
  const files = Array.from(e.dataTransfer?.files ?? []).filter((f) => f.type.startsWith('image/'))
  if (!files.length) return
  e.preventDefault()
  let after = target?.after === false ? blocks.value[indexOf(id) - 1]?.id ?? null : id
  for (const f of files) after = (await addImage(f, after)) ?? after
}

// ---- images

const srcs = ref<Record<string, string>>({})
watch(
  () => blocks.value.filter((b) => b.type === 'image').map((b) => (b as { path: string }).path),
  async (paths) => {
    const missing = paths.filter((p) => !srcs.value[p])
    if (!missing.length) return
    srcs.value = { ...srcs.value, ...(await props.sign(missing)) }
  },
  { immediate: true },
)

/** Uploads an image and puts it after `afterId` (or in place of an empty line). Its block id. */
async function addImage(file: File, afterId: string | null): Promise<string | null> {
  const placeholderId = newLearnBlockId()
  const after = afterId ? blocks.value.find((b) => b.id === afterId) : null
  const replacing = after && isEmpty(after)
  uploadingIds.value = new Set([...uploadingIds.value, placeholderId])
  const temp: LearnBlock = { id: placeholderId, type: 'divider' }
  if (replacing) blocks.value.splice(indexOf(after.id), 1, temp)
  else insertAfter(afterId, temp)
  const result = await props.upload(file)
  const rest = new Set(uploadingIds.value)
  rest.delete(placeholderId)
  uploadingIds.value = rest
  const i = indexOf(placeholderId)
  if ('error' in result) {
    if (i >= 0) blocks.value.splice(i, 1)
    if (!blocks.value.length) blocks.value.push(emptyParagraph())
    commit()
    emit('error', result.error)
    return null
  }
  emit('uploaded', result.path)
  const image: LearnBlock = { id: placeholderId, type: 'image', path: result.path }
  if (i >= 0) blocks.value.splice(i, 1, image)
  else blocks.value.push(image)
  // Somewhere to keep writing underneath.
  if (!blocks.value[indexOf(placeholderId) + 1]) blocks.value.push(emptyParagraph())
  commit()
  return placeholderId
}
const fileInput = ref<HTMLInputElement | null>(null)
let pickingFor: { afterId: string | null; replaceId?: string } | null = null
function pickImage(afterId: string | null, replaceId?: string) {
  pickingFor = { afterId, replaceId }
  fileInput.value?.click()
}
async function onFile(e: Event) {
  const input = e.target as HTMLInputElement
  const files = Array.from(input.files ?? [])
  input.value = ''
  const target = pickingFor
  pickingFor = null
  if (!files.length || !target) return
  if (target.replaceId) {
    const old = blocks.value.find((b) => b.id === target.replaceId)
    const id = await addImage(files[0]!, target.replaceId)
    if (id && old) removeBlock(old.id)
    return
  }
  let after = target.afterId
  for (const f of files) after = (await addImage(f, after)) ?? after
}
function setCaption(id: string, caption: string) {
  const b = blocks.value.find((x) => x.id === id)
  if (b?.type !== 'image') return
  if (caption) b.caption = caption.slice(0, 500)
  else delete b.caption
  commit()
}

// ---- the format bar, over a selection

const bar = ref<{ top: number; left: number; linking: boolean; href: string } | null>(null)
let savedRange: Range | null = null
function selectionInEditor(): Range | null {
  const sel = window.getSelection()
  if (!sel?.rangeCount || sel.isCollapsed) return null
  const r = sel.getRangeAt(0)
  const host = (r.commonAncestorContainer.nodeType === Node.ELEMENT_NODE ? (r.commonAncestorContainer as Element) : r.commonAncestorContainer.parentElement)?.closest('[data-learn-text]')
  return host && rootRef.value?.contains(host) ? r : null
}
function onSelectionChange() {
  if (bar.value?.linking) return
  const r = selectionInEditor()
  const root = rootRef.value
  if (!r || !root) {
    bar.value = null
    return
  }
  const rect = r.getBoundingClientRect()
  const rr = root.getBoundingClientRect()
  bar.value = { top: rect.top - rr.top - 44, left: Math.max(0, rect.left - rr.left + rect.width / 2 - 110), linking: false, href: '' }
}
onMounted(() => {
  document.addEventListener('selectionchange', onSelectionChange)
  document.execCommand('styleWithCSS', false, 'false')
})
onUnmounted(() => document.removeEventListener('selectionchange', onSelectionChange))

function format(command: 'bold' | 'italic' | 'underline' | 'strikeThrough') {
  document.execCommand(command)
}
const linkInput = ref<HTMLInputElement | null>(null)
function openLink() {
  const r = selectionInEditor()
  if (!r) return
  savedRange = r.cloneRange()
  const a = (r.startContainer.parentElement as Element | null)?.closest('a')
  if (!bar.value) onSelectionChange()
  if (bar.value) {
    bar.value.linking = true
    bar.value.href = a?.getAttribute('href') ?? ''
  }
  nextTick(() => linkInput.value?.focus())
}
function applyLink() {
  const href = bar.value?.href.trim() ?? ''
  const range = savedRange
  bar.value = null
  savedRange = null
  if (!range) return
  const host = (range.commonAncestorContainer.nodeType === Node.ELEMENT_NODE ? (range.commonAncestorContainer as Element) : range.commonAncestorContainer.parentElement)?.closest<HTMLElement>('[data-learn-text]')
  if (!host) return
  host.focus()
  const sel = window.getSelection()!
  sel.removeAllRanges()
  sel.addRange(range)
  if (href) document.execCommand('createLink', false, /^(https?:|mailto:|tel:)/i.test(href) ? href : `https://${href}`)
  else document.execCommand('unlink')
  const id = host.dataset.learnText
  if (id) onInput(id)
}

// ---- the ⋮⋮ menu of one block

const blockMenu = ref<string | null>(null)
const TURN_INTO: LearnTextBlockType[] = ['paragraph', 'heading', 'subheading', 'bullet', 'number', 'quote', 'callout']
const typeLabel = (type: string) => MENU.find((m) => m.key === type)?.label ?? type
function closeBlockMenu() {
  blockMenu.value = null
}
function onDocClick(e: MouseEvent) {
  if (blockMenu.value && !(e.target as Element).closest('[data-block-menu]')) closeBlockMenu()
  if (menu.value && !(e.target as Element).closest('[data-slash-menu]') && !(e.target as Element).closest('[data-learn-text]')) menu.value = null
}
onMounted(() => document.addEventListener('mousedown', onDocClick))
onUnmounted(() => document.removeEventListener('mousedown', onDocClick))

function addBelow(id: string) {
  const b = blocks.value.find((x) => x.id === id)
  // An empty line is used as it is; otherwise a new one under it.
  if (b && isEmpty(b)) {
    const tb = b as LearnTextBlock
    tb.runs = [{ text: '/' }]
    writeHtml(id)
    commit()
    focusBlock(id, 'end').then(() => updateMenu(id))
    return
  }
  const next: LearnTextBlock = { id: newLearnBlockId(), type: 'paragraph', runs: [{ text: '/' }] }
  insertAfter(id, next)
  commit()
  focusBlock(next.id, 'end').then(() => updateMenu(next.id))
}

defineExpose({ uploading: computed(() => uploadingIds.value.size > 0) })

const textClass: Record<LearnTextBlockType, string> = {
  paragraph: 'text-[15.5px] leading-relaxed',
  heading: 'mt-3 text-[21px] font-bold leading-snug text-ink-900',
  subheading: 'mt-1.5 text-[17.5px] font-semibold leading-snug text-ink-900',
  bullet: 'text-[15.5px] leading-relaxed',
  number: 'text-[15.5px] leading-relaxed',
  quote: 'border-l-[3px] border-line-control pl-4 text-[15.5px] leading-relaxed text-ink-700',
  callout: 'text-[15.5px] leading-relaxed text-ink-900',
}
const placeholderOf = (b: LearnTextBlock, i: number) =>
  b.type === 'heading' ? t('Heading', 'Título') : b.type === 'subheading' ? t('Subheading', 'Subtítulo') : b.type === 'bullet' || b.type === 'number' ? t('List', 'Lista') : b.type === 'quote' ? t('Quote', 'Cita') : b.type === 'callout' ? t('A tip worth highlighting', 'Un consejo para destacar') : i === 0 && blocks.value.length === 1 ? (props.placeholder ?? t("Write, or press '/' for headings, lists, images…", 'Escribe, o pulsa «/» para títulos, listas, imágenes…')) : t("Press '/' for blocks", 'Pulsa «/» para insertar')
// The number a numbered item shows: its place in the run of numbered items it belongs to.
const numberOf = (i: number) => {
  let n = 1
  for (let j = i - 1; j >= 0 && blocks.value[j]!.type === 'number'; j--) n++
  return n
}
</script>

<template>
  <div ref="rootRef" class="learn-editor relative" data-cy="learn-editor">
    <input ref="fileInput" type="file" accept="image/jpeg,image/png,image/webp,image/gif" multiple class="hidden" data-cy="learn-image-input" @change="onFile" />
    <div :key="generation" class="flex flex-col">
      <div
        v-for="(b, i) in blocks"
        :key="b.id"
        :data-block-row="b.id"
        class="group relative -ml-14 flex items-start pl-14"
        :class="[dropTarget?.id === b.id ? (dropTarget.after ? 'shadow-[0_2px_0_0_rgb(var(--color-brand))]' : 'shadow-[0_-2px_0_0_rgb(var(--color-brand))]') : '', dragging === b.id ? 'opacity-40' : '']"
        :tabindex="isLearnTextBlock(b) ? undefined : -1"
        @dragover="onDragOver(b.id, $event)"
        @dragleave="dropTarget = null"
        @drop="onDrop(b.id, $event)"
      >
        <!-- Gutter: + and ⋮⋮, on hover. -->
        <div class="absolute left-0 top-1 flex h-7 items-center gap-0.5 opacity-0 transition-opacity focus-within:opacity-100 group-hover:opacity-100" :class="b.type === 'heading' ? 'top-4' : ''">
          <button type="button" class="flex h-6 w-6 items-center justify-center rounded-ctlSm text-[17px] leading-none text-ink-faint hover:bg-surface-subtle hover:text-ink-700" :aria-label="t('Add a block below', 'Añadir un bloque debajo')" data-cy="learn-block-add" @click="addBelow(b.id)">+</button>
          <button
            type="button"
            draggable="true"
            class="flex h-6 w-5 cursor-grab items-center justify-center rounded-ctlSm text-ink-faint hover:bg-surface-subtle hover:text-ink-700 active:cursor-grabbing"
            :aria-label="t('Drag to move, click for options', 'Arrastra para mover, pulsa para opciones')"
            data-cy="learn-block-handle"
            @click="blockMenu = blockMenu === b.id ? null : b.id"
            @dragstart="(e) => { dragging = b.id; e.dataTransfer?.setData('text/plain', b.id); if (e.dataTransfer) e.dataTransfer.effectAllowed = 'move' }"
            @dragend="dragging = null; dropTarget = null"
          >
            <svg width="10" height="14" viewBox="0 0 10 14" fill="currentColor" aria-hidden="true"><circle cx="2.5" cy="2.5" r="1.3" /><circle cx="7.5" cy="2.5" r="1.3" /><circle cx="2.5" cy="7" r="1.3" /><circle cx="7.5" cy="7" r="1.3" /><circle cx="2.5" cy="11.5" r="1.3" /><circle cx="7.5" cy="11.5" r="1.3" /></svg>
          </button>
        </div>
        <div v-if="blockMenu === b.id" data-block-menu class="absolute left-6 top-8 z-30 w-56 overflow-hidden rounded-card border border-line bg-surface py-1 shadow-lg" data-cy="learn-block-menu">
          <template v-if="isLearnTextBlock(b)">
            <p class="px-3 pb-1 pt-1.5 text-[11.5px] font-semibold uppercase tracking-[.04em] text-ink-muted">{{ t('Turn into', 'Convertir en') }}</p>
            <button v-for="type in TURN_INTO" :key="type" type="button" class="flex w-full items-center justify-between px-3 py-1.5 text-left text-[13.5px] text-ink-800 hover:bg-surface-subtle" @click="turnInto(b.id, type); closeBlockMenu()">
              {{ typeLabel(type) }}<span v-if="b.type === type" class="text-brand-text">✓</span>
            </button>
            <div class="my-1 border-t border-line-row" />
          </template>
          <button v-if="b.type === 'image'" type="button" class="block w-full px-3 py-1.5 text-left text-[13.5px] text-ink-800 hover:bg-surface-subtle" @click="pickImage(b.id, b.id); closeBlockMenu()">{{ t('Replace image', 'Cambiar imagen') }}</button>
          <button type="button" class="block w-full px-3 py-1.5 text-left text-[13.5px] text-ink-800 hover:bg-surface-subtle" @click="duplicateBlock(b.id); closeBlockMenu()">{{ t('Duplicate', 'Duplicar') }}</button>
          <button type="button" class="block w-full px-3 py-1.5 text-left text-[13.5px] text-ink-800 hover:bg-surface-subtle disabled:text-ink-faint" :disabled="i === 0" @click="moveBlock(b.id, i - 1); closeBlockMenu()">{{ t('Move up', 'Subir') }}</button>
          <button type="button" class="block w-full px-3 py-1.5 text-left text-[13.5px] text-ink-800 hover:bg-surface-subtle disabled:text-ink-faint" :disabled="i === blocks.length - 1" @click="moveBlock(b.id, i + 1); closeBlockMenu()">{{ t('Move down', 'Bajar') }}</button>
          <button type="button" class="block w-full px-3 py-1.5 text-left text-[13.5px] text-danger-text hover:bg-surface-subtle" data-cy="learn-block-delete" @click="removeBlock(b.id); closeBlockMenu()">{{ t('Delete', 'Eliminar') }}</button>
        </div>

        <!-- The block. -->
        <div class="min-w-0 flex-1 py-[3px]">
          <template v-if="isLearnTextBlock(b)">
            <div class="flex items-start gap-2" :class="b.type === 'callout' ? 'rounded-card bg-brand-tint px-3.5 py-2.5' : ''">
              <span v-if="b.type === 'bullet'" class="w-5 shrink-0 select-none pt-[1px] text-center text-[15.5px] leading-relaxed text-ink-muted" aria-hidden="true">•</span>
              <span v-else-if="b.type === 'number'" class="w-5 shrink-0 select-none pt-[1px] text-right text-[15.5px] leading-relaxed text-ink-muted" aria-hidden="true">{{ numberOf(i) }}.</span>
              <span v-else-if="b.type === 'callout'" class="shrink-0 select-none leading-relaxed" aria-hidden="true">💡</span>
              <div
                :ref="(el) => bindEl(b.id, el as Element | null)"
                contenteditable="true"
                role="textbox"
                aria-multiline="true"
                spellcheck="true"
                :data-learn-text="b.id"
                :data-type="b.type"
                :data-placeholder="placeholderOf(b, i)"
                class="min-w-0 flex-1 whitespace-pre-wrap break-words text-ink-800 outline-none"
                :class="[textClass[b.type], !learnRunsText(b.runs) ? 'is-empty' : '', i === 0 && blocks.length === 1 ? 'is-only' : '']"
                data-cy="learn-block-text"
                @input="onInput(b.id)"
                @keydown="onKeydown(b.id, $event)"
                @paste="onPaste(b.id, $event)"
              />
            </div>
          </template>
          <hr v-else-if="b.type === 'divider' && !uploadingIds.has(b.id)" class="my-3 border-line" data-cy="learn-block-divider" />
          <div v-else-if="uploadingIds.has(b.id)" class="flex aspect-[16/9] w-full items-center justify-center rounded-card bg-surface-subtle text-[13px] text-ink-muted">{{ t('Uploading image…', 'Subiendo imagen…') }}</div>
          <figure v-else-if="b.type === 'image'" class="my-1 flex flex-col gap-1" data-cy="learn-block-image">
            <img v-if="srcs[b.path]" :src="srcs[b.path]" :alt="b.caption ?? ''" class="max-h-[520px] w-full rounded-card bg-surface-subtle object-contain" />
            <div v-else class="aspect-[16/9] w-full animate-pulse rounded-card bg-surface-subtle" />
            <input
              type="text"
              :value="b.caption ?? ''"
              :placeholder="t('Add a caption (optional)', 'Añade un pie de foto (opcional)')"
              class="w-full bg-transparent text-center text-[13px] text-ink-muted placeholder:text-ink-faint focus:outline-none"
              @change="setCaption(b.id, ($event.target as HTMLInputElement).value.trim())"
            />
          </figure>
        </div>
      </div>
    </div>

    <!-- Click below the last block to keep writing. -->
    <button type="button" class="block h-10 w-full cursor-text" :aria-label="t('Add a line at the end', 'Añadir una línea al final')" @click="isEmpty(blocks[blocks.length - 1]!) ? focusBlock(blocks[blocks.length - 1]!.id) : (insertAfter(null, emptyParagraph()), commit(), focusBlock(blocks[blocks.length - 1]!.id))" />

    <!-- "/" menu -->
    <div v-if="menu && menuItems.length" data-slash-menu class="absolute z-40 max-h-80 w-72 overflow-y-auto rounded-card border border-line bg-surface py-1 shadow-lg" :style="{ top: `${menu.top}px`, left: `${menu.left}px` }" data-cy="learn-slash-menu">
      <p class="px-3 pb-1 pt-1.5 text-[11.5px] font-semibold uppercase tracking-[.04em] text-ink-muted">{{ t('Blocks', 'Bloques') }}</p>
      <button
        v-for="(item, k) in menuItems"
        :key="item.key"
        type="button"
        class="flex w-full items-center gap-3 px-3 py-1.5 text-left"
        :class="k === menu.index ? 'bg-surface-subtle' : ''"
        :data-cy="`learn-slash-${item.key}`"
        @mousedown.prevent="choose(item)"
        @mouseenter="menu.index = k"
      >
        <span class="flex h-9 w-9 shrink-0 items-center justify-center rounded-ctl border border-line bg-surface text-[13px] font-semibold text-ink-700">{{ item.icon }}</span>
        <span class="min-w-0"><span class="block text-[13.5px] font-medium text-ink-900">{{ item.label }}</span><span class="block text-[12px] text-ink-muted">{{ item.hint }}</span></span>
      </button>
    </div>

    <!-- Format bar over a selection -->
    <div v-if="bar" class="absolute z-40 flex items-center gap-0.5 rounded-ctl border border-line bg-surface p-1 shadow-lg" :style="{ top: `${bar.top}px`, left: `${bar.left}px` }" data-cy="learn-format-bar" @mousedown="!bar.linking && $event.preventDefault()">
      <template v-if="!bar.linking">
        <button type="button" class="h-7 w-8 rounded-ctlSm text-[14px] font-bold text-ink-800 hover:bg-surface-subtle" :title="t('Bold (⌘B)', 'Negrita (⌘B)')" data-cy="learn-format-bold" @click="format('bold')">B</button>
        <button type="button" class="h-7 w-8 rounded-ctlSm text-[14px] italic text-ink-800 hover:bg-surface-subtle" :title="t('Italic (⌘I)', 'Cursiva (⌘I)')" data-cy="learn-format-italic" @click="format('italic')">I</button>
        <button type="button" class="h-7 w-8 rounded-ctlSm text-[14px] text-ink-800 underline hover:bg-surface-subtle" :title="t('Underline (⌘U)', 'Subrayado (⌘U)')" @click="format('underline')">U</button>
        <button type="button" class="h-7 w-8 rounded-ctlSm text-[14px] text-ink-800 line-through hover:bg-surface-subtle" :title="t('Strikethrough (⌘⇧X)', 'Tachado (⌘⇧X)')" @click="format('strikeThrough')">S</button>
        <span class="mx-0.5 h-5 w-px bg-line" />
        <button type="button" class="h-7 rounded-ctlSm px-2 text-[13px] font-medium text-ink-800 hover:bg-surface-subtle" :title="t('Link (⌘K)', 'Enlace (⌘K)')" data-cy="learn-format-link" @click="openLink">{{ t('Link', 'Enlace') }}</button>
      </template>
      <form v-else class="flex items-center gap-1" @submit.prevent="applyLink">
        <input ref="linkInput" v-model="bar.href" type="text" inputmode="url" placeholder="https://" class="h-7 w-56 rounded-ctlSm border border-line-control px-2 text-[13px] focus:border-brand focus:outline-none" data-cy="learn-link-input" @keydown.esc.prevent="bar = null" />
        <button type="submit" class="h-7 rounded-ctlSm px-2 text-[13px] font-semibold text-brand-text hover:bg-surface-subtle">{{ bar.href.trim() ? t('Apply', 'Aplicar') : t('Remove', 'Quitar') }}</button>
      </form>
    </div>
  </div>
</template>

<style scoped>
.learn-editor [data-learn-text].is-empty:focus::before,
.learn-editor [data-learn-text].is-empty.is-only::before,
.learn-editor [data-learn-text].is-empty[data-type='heading']::before,
.learn-editor [data-learn-text].is-empty[data-type='subheading']::before {
  content: attr(data-placeholder);
  color: rgb(var(--color-ink-faint));
  pointer-events: none;
  position: absolute;
}
.learn-editor [data-learn-text] {
  position: relative;
}
.learn-editor [data-learn-text] :deep(a) {
  color: rgb(var(--color-brand-text));
  text-decoration: underline;
}
.learn-editor [data-learn-text] :deep(code) {
  border-radius: 4px;
  background: rgb(var(--color-surface-subtle));
  padding: 0 4px;
  font-size: 0.9em;
}
</style>
