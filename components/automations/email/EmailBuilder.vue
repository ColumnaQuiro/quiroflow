<script setup lang="ts">
import {
  blockId,
  EMAIL_BLOCK_TYPES,
  EMAIL_FONTS,
  emailDesignHtml,
  emailDesignExcerpt,
  newEmailBlock,
  resolveEmailTheme,
  type EmailBlock,
  type EmailBlockType,
  type EmailDesign,
  type EmailTheme,
} from '~/utils/emailDesign'
import { HINT, LABEL } from '~/utils/automationUi'

// The full-screen email editor, opened from an email step's drawer: the
// blocks on the left, the email itself in the middle -- the real HTML a
// patient receives, at 600px or a phone's 375px, filled with the example
// patient -- and the selected block's settings on the right.
//
// Nothing here is saved on its own: every change goes into the step's
// config.design in the automation's draft, the way every other edit on the
// page does, and the page's one Save writes it. Done returns to the flow.

const props = defineProps<{ stepId: string }>()
const emit = defineEmits<{ close: [] }>()
const b = useBuilder()
const t = useT()
const supabase = useSupabaseClient()
const store = useAccountStore()
const { fields, fillHtml, fillText, clinicName, logoUrl } = useMergeSamples()

const config = computed(() => b.stepsById.value.get(props.stepId)?.config ?? {})
const design = computed<EmailDesign>(() => config.value.design ?? { version: 1, blocks: [] })
const marketing = computed(() => !!b.draft.value.rule.is_marketing)

function setDesign(next: EmailDesign) {
  b.updateStepConfig(props.stepId, { design: next })
}
function setBlocks(blocks: EmailBlock[]) {
  setDesign({ ...design.value, blocks })
}

// ---- selection and the block list

const selectedId = ref<string | null>(design.value.blocks.find((x) => x.type === 'text')?.id ?? null)
const selected = computed(() => design.value.blocks.find((x) => x.id === selectedId.value) ?? null)

function updateBlock(id: string, patch: Partial<EmailBlock>) {
  setBlocks(design.value.blocks.map((x) => (x.id === id ? ({ ...x, ...patch } as EmailBlock) : x)))
}
// A new block goes under the selected one; with nothing selected, above the
// footer if the email has one, so the footer stays last.
function addBlock(type: EmailBlockType) {
  const block = newEmailBlock(type, 'es')
  const blocks = [...design.value.blocks]
  let at = selectedId.value ? blocks.findIndex((x) => x.id === selectedId.value) + 1 : blocks.length
  if (!selectedId.value && blocks.at(-1)?.type === 'footer') at = blocks.length - 1
  blocks.splice(at, 0, block)
  setBlocks(blocks)
  selectedId.value = block.id
}
function move(id: string, delta: -1 | 1) {
  const blocks = [...design.value.blocks]
  const i = blocks.findIndex((x) => x.id === id)
  const j = i + delta
  if (i < 0 || j < 0 || j >= blocks.length) return
  ;[blocks[i], blocks[j]] = [blocks[j]!, blocks[i]!]
  setBlocks(blocks)
}
function duplicate(id: string) {
  const blocks = [...design.value.blocks]
  const i = blocks.findIndex((x) => x.id === id)
  if (i < 0) return
  const copy = { ...JSON.parse(JSON.stringify(blocks[i])), id: blockId() } as EmailBlock
  blocks.splice(i + 1, 0, copy)
  setBlocks(blocks)
  selectedId.value = copy.id
}
function remove(id: string) {
  const i = design.value.blocks.findIndex((x) => x.id === id)
  setBlocks(design.value.blocks.filter((x) => x.id !== id))
  if (selectedId.value === id) selectedId.value = design.value.blocks[Math.max(0, i - 1)]?.id ?? null
}

const BLOCK_LABEL: Record<EmailBlockType, readonly [string, string]> = {
  header: ['Header', 'Cabecera'],
  heading: ['Heading', 'Título'],
  text: ['Text', 'Texto'],
  image: ['Image', 'Imagen'],
  button: ['Button', 'Botón'],
  columns: ['Columns', 'Columnas'],
  divider: ['Divider', 'Separador'],
  spacer: ['Space', 'Espacio'],
  footer: ['Footer', 'Pie'],
}
// 24x18 line drawings of each block, stroke only, in the text colour.
const BLOCK_ICON: Record<EmailBlockType, string> = {
  header: 'M2 2h20v6H2zM6 12h12M8 15h8',
  heading: 'M3 4v10M13 4v10M3 9h10M17 7l2-2v9',
  text: 'M3 4h18M3 8h18M3 12h18M3 16h11',
  image: 'M2 2h20v14H2zM2 13l6-5 5 4 3-2 6 4',
  button: 'M3 5h18a2 2 0 0 1 0 8H3a2 2 0 0 1 0-8z',
  columns: 'M2 2h9v14H2zM13 2h9v14h-9z',
  divider: 'M2 9h20',
  spacer: 'M12 2v14M8 5l4-3 4 3M8 13l4 3 4-3',
  footer: 'M6 6h12M8 10h8M2 14h20',
}
function rowLabel(block: EmailBlock) {
  const name = t(...BLOCK_LABEL[block.type])
  const line = fillText(block.type === 'heading' || block.type === 'text' ? emailDesignExcerpt({ version: 1, blocks: [block] }) : block.type === 'button' ? block.text : '')
  return line ? `${name} · ${line}` : name
}

// ---- branding: the clinic's, and this email's changes to it

const clinicBranding = ref<Partial<EmailTheme> | null>(null)
const { can } = usePermission()
const canManageEmail = computed(() => can('communication_config'))
onMounted(async () => {
  const { data } = await supabase.from('accounts').select('email_branding').eq('id', store.accountId!).maybeSingle()
  clinicBranding.value = (data?.email_branding as Partial<EmailTheme> | null) ?? null
})
const theme = computed(() => resolveEmailTheme(clinicBranding.value, design.value.theme))
const ownTheme = computed(() => design.value.theme ?? {})
function setTheme(key: keyof EmailTheme, value: string) {
  setDesign({ ...design.value, theme: { ...ownTheme.value, [key]: value } })
}
const savingBranding = ref(false)
const brandingMessage = ref('')
async function saveAsClinicBranding() {
  savingBranding.value = true
  brandingMessage.value = ''
  const next = { ...(clinicBranding.value ?? {}), ...ownTheme.value }
  const { error } = await supabase.from('accounts').update({ email_branding: next }).eq('id', store.accountId!)
  savingBranding.value = false
  if (error) {
    brandingMessage.value = error.message
    return
  }
  clinicBranding.value = next
  // Now the clinic's, so this email follows it like every other.
  setDesign({ ...design.value, theme: undefined })
  brandingMessage.value = t("Saved as the clinic's branding.", 'Guardada como la marca de la clínica.')
}
const COLOR_FIELDS: { key: Exclude<keyof EmailTheme, 'font'>; label: readonly [string, string] }[] = [
  { key: 'brandColor', label: ['Buttons and links', 'Botones y enlaces'] },
  { key: 'buttonTextColor', label: ['Button text', 'Texto del botón'] },
  { key: 'headingColor', label: ['Headings', 'Títulos'] },
  { key: 'textColor', label: ['Text', 'Texto'] },
  { key: 'backgroundColor', label: ['Background', 'Fondo'] },
  { key: 'contentColor', label: ['Card', 'Tarjeta'] },
]

// ---- the canvas: the real email, in a frame

const device = ref<'desktop' | 'mobile'>('desktop')
const railTab = ref<'blocks' | 'templates' | 'brand'>('blocks')
const frame = ref<HTMLIFrameElement | null>(null)
const stage = ref<HTMLElement | null>(null)
const frameHeight = ref(600)
const stageWidth = ref(900)

const html = computed(() =>
  fillHtml(
    emailDesignHtml(design.value, {
      clinicName: clinicName.value,
      logoUrl: logoUrl.value,
      branding: clinicBranding.value,
      unsubscribe: marketing.value ? { page: '#', oneClick: '#' } : null,
      markBlocks: true,
    }),
  ),
)
const frameWidth = computed(() => (device.value === 'mobile' ? 375 : 664))
// A desktop email wider than the space left between the two panels (an iPad)
// is shown scaled down rather than cut off.
const scale = computed(() => Math.min(1, (stageWidth.value - 32) / frameWidth.value))

// The app's indigo, carried into the frame as a variable, so the outline
// around the selected block follows the app's theme.
function editorStyle() {
  const brand = getComputedStyle(document.documentElement).getPropertyValue('--color-brand').trim()
  return `:root{--qf-brand:${brand}}[data-block]{cursor:pointer}[data-block]:hover>td{box-shadow:inset 0 0 0 1px rgb(var(--qf-brand) / .45)}` +
    (selectedId.value ? `[data-block="${CSS.escape(selectedId.value)}"]>td{box-shadow:inset 0 0 0 2px rgb(var(--qf-brand))}` : '') +
    'a{cursor:pointer}'
}
function measure() {
  const doc = frame.value?.contentDocument
  // The body's own height: the document's would be at least the frame's.
  if (doc?.body) frameHeight.value = Math.max(240, Math.ceil(doc.body.getBoundingClientRect().height))
}
// The first render loads the document; after that only the body is swapped,
// so the frame keeps its place instead of flashing white on every keystroke.
let ready = false
function onLoad() {
  const doc = frame.value?.contentDocument
  if (!doc) return
  ready = true
  const style = doc.createElement('style')
  style.id = 'qf-editor'
  style.textContent = editorStyle()
  doc.head.appendChild(style)
  doc.addEventListener('click', (e) => {
    e.preventDefault()
    const el = (e.target as Element | null)?.closest?.('[data-block]')
    if (el) selectedId.value = el.getAttribute('data-block')
  })
  measure()
}
watch(html, (next) => {
  const doc = frame.value?.contentDocument
  if (!ready || !doc?.body) return
  const parsed = new DOMParser().parseFromString(next, 'text/html')
  doc.body.setAttribute('style', parsed.body.getAttribute('style') ?? '')
  doc.body.innerHTML = parsed.body.innerHTML
  nextTick(measure)
})
watch(selectedId, () => {
  const el = frame.value?.contentDocument?.getElementById('qf-editor')
  if (el) el.textContent = editorStyle()
})
watch(device, () => nextTick(() => setTimeout(measure, 50)))
// Set once: a reactive srcdoc would reload the frame on every change.
const initialHtml = html.value

let observer: ResizeObserver | undefined
onMounted(() => {
  observer = new ResizeObserver(([entry]) => (stageWidth.value = entry!.contentRect.width))
  if (stage.value) observer.observe(stage.value)
})
onUnmounted(() => observer?.disconnect())

// ---- leaving

const panel = ref<HTMLElement | null>(null)
// Escape closes the editor, unless a picker or a field is using it.
useFocusTrap(panel, () => {
  if (!document.querySelector('[data-test="variable-picker"]')) emit('close')
})
const sendTestOpen = ref(false)

// ---- the clinic's saved templates

const { templates, loaded: templatesLoaded, error: templatesError, load: loadTemplates, save: saveTemplate, remove: removeTemplate } = useEmailTemplates()
watch(railTab, (tab) => {
  if (tab === 'templates' && !templatesLoaded.value) loadTemplates()
})
function applyTemplate(next: EmailDesign, subject: string) {
  setDesign(next)
  // The template's subject only when this email has none yet: one already
  // written is the sender's, not the template's.
  if (!String(config.value.subject ?? '').trim() && subject) b.updateStepConfig(props.stepId, { subject })
  selectedId.value = next.blocks.find((x) => x.type === 'text')?.id ?? null
  railTab.value = 'blocks'
}
const saveOpen = ref(false)
const savedNote = ref('')
const savingTemplate = ref(false)
const saveError = ref('')
async function onSaveTemplate(name: string, replaceId: string | null) {
  savingTemplate.value = true
  saveError.value = ''
  // The clinic's branding is not copied in: a template follows the clinic's
  // current branding, like any email, unless this email changed it.
  const err = await saveTemplate({ name, subject: config.value.subject ?? '', design: design.value }, replaceId)
  savingTemplate.value = false
  if (err) {
    saveError.value = err
    return
  }
  saveOpen.value = false
  // Said beside the button, not in a toast: a toast sits over this header.
  savedNote.value = t(`Saved as "${name.trim()}"`, `Guardada como «${name.trim()}»`)
  setTimeout(() => (savedNote.value = ''), 4000)
}
async function onRemoveTemplate(id: string) {
  const err = await removeTemplate(id)
  if (err) savedNote.value = err
}
async function openSave() {
  saveError.value = ''
  if (!templatesLoaded.value) await loadTemplates()
  saveOpen.value = true
}
</script>

<template>
  <Teleport to="body">
    <div ref="panel" role="dialog" aria-modal="true" :aria-label="t('Email editor', 'Editor de email')" class="fixed inset-0 z-50 flex flex-col bg-surface-page" data-test="email-builder">
      <header class="flex shrink-0 flex-wrap items-center gap-2.5 border-b border-line bg-surface px-4 py-2.5">
        <UiBtn data-test="email-builder-back" @click="emit('close')"><UiChevron dir="left" />{{ t('Back to the flow', 'Volver al flujo') }}</UiBtn>
        <span class="min-w-0 truncate text-[12.5px] text-ink-muted">{{ b.draft.value.rule.name }} <span class="text-ink-faint3" aria-hidden="true">/</span> <strong class="text-[14px] font-semibold text-ink-900">{{ config.subject || t('Email', 'Email') }}</strong></span>
        <span class="flex-1" />
        <span class="inline-flex rounded-ctl border border-line-control bg-surface p-0.5" role="group" :aria-label="t('Preview size', 'Tamaño de la vista previa')">
          <button type="button" class="h-8 rounded-ctlSm px-3 text-[12.5px] font-semibold touch:h-10" :class="device === 'desktop' ? 'bg-brand-tint text-brand-text' : 'text-ink-muted hover:text-ink-700'" :aria-pressed="device === 'desktop'" data-test="email-builder-desktop" @click="device = 'desktop'">{{ t('Desktop', 'Escritorio') }}</button>
          <button type="button" class="h-8 rounded-ctlSm px-3 text-[12.5px] font-semibold touch:h-10" :class="device === 'mobile' ? 'bg-brand-tint text-brand-text' : 'text-ink-muted hover:text-ink-700'" :aria-pressed="device === 'mobile'" data-test="email-builder-mobile" @click="device = 'mobile'">{{ t('Mobile', 'Móvil') }}</button>
        </span>
        <span v-if="savedNote" class="text-[12.5px] text-ink-muted" role="status" data-test="email-template-saved">{{ savedNote }}</span>
        <UiBtn v-if="canManageEmail" data-test="email-builder-save-template" @click="openSave">{{ t('Save as template', 'Guardar como plantilla') }}</UiBtn>
        <UiBtn data-test="email-builder-send-test" @click="sendTestOpen = true">{{ t('Send test', 'Enviar prueba') }}</UiBtn>
        <UiBtn variant="primary" data-test="email-builder-done" @click="emit('close')">{{ t('Done', 'Hecho') }}</UiBtn>
      </header>

      <div class="grid shrink-0 gap-3 border-b border-line bg-surface px-4 py-3 md:grid-cols-[1.3fr_1fr]">
        <label :class="LABEL">
          {{ t('Subject', 'Asunto') }}
          <AutomationsMergeFieldInput :model-value="config.subject ?? ''" :variables="fields" :placeholder="t('What the patient sees in their inbox', 'Lo que el paciente ve en su bandeja')" test-id="email-builder-subject" @update:model-value="b.updateStepConfig(stepId, { subject: $event })" />
        </label>
        <label :class="LABEL">
          {{ t('Preview text', 'Texto de vista previa') }}
          <AutomationsMergeFieldInput :model-value="design.preheader ?? ''" :variables="fields" :placeholder="t('Shown after the subject in the inbox', 'Se ve tras el asunto en la bandeja')" test-id="email-builder-preheader" @update:model-value="setDesign({ ...design, preheader: $event })" />
        </label>
      </div>

      <div class="grid min-h-0 flex-1 grid-cols-[220px_minmax(0,1fr)_280px] xl:grid-cols-[248px_minmax(0,1fr)_320px]">
        <!-- left: blocks and branding -->
        <aside class="flex min-h-0 flex-col border-r border-line bg-surface">
          <nav role="tablist" class="flex shrink-0 gap-1 border-b border-line px-3">
            <button v-for="x in [{ key: 'blocks', label: t('Blocks', 'Bloques') }, { key: 'templates', label: t('Templates', 'Plantillas') }, { key: 'brand', label: t('Branding', 'Marca') }]" :key="x.key" type="button" role="tab" :aria-selected="railTab === x.key" class="-mb-px h-10 border-b-2 px-2 text-[13px] font-semibold touch:h-11" :class="railTab === x.key ? 'border-brand text-ink-900' : 'border-transparent text-ink-muted hover:text-ink-700'" :data-test="`email-tab-${x.key}`" @click="railTab = x.key as 'blocks'">{{ x.label }}</button>
          </nav>
          <div v-if="railTab === 'blocks'" class="min-h-0 flex-1 overflow-y-auto p-3">
            <p class="mb-2 text-[11px] font-bold uppercase tracking-[.06em] text-ink-faint">{{ t('Add', 'Añadir') }}</p>
            <div class="grid grid-cols-2 gap-1.5 xl:grid-cols-3">
              <button
                v-for="type in EMAIL_BLOCK_TYPES"
                :key="type"
                type="button"
                class="flex flex-col items-center gap-1 rounded-ctl border border-line bg-surface px-1 pb-1.5 pt-2 text-[11.5px] font-semibold text-ink-600 hover:border-brand-tintBorder hover:bg-brand-tint hover:text-brand-text touch:min-h-11"
                :data-test="`email-add-${type}`"
                @click="addBlock(type)"
              >
                <svg viewBox="0 0 24 18" class="h-[18px] w-6" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path :d="BLOCK_ICON[type]" /></svg>
                {{ t(...BLOCK_LABEL[type]) }}
              </button>
            </div>
            <p class="mb-2 mt-5 text-[11px] font-bold uppercase tracking-[.06em] text-ink-faint">{{ t('In this email', 'En este email') }}</p>
            <ol class="flex flex-col gap-0.5" data-test="email-block-list">
              <li
                v-for="(block, i) in design.blocks"
                :key="block.id"
                class="group flex items-center gap-1 rounded-ctlSm pl-2"
                :class="block.id === selectedId ? 'bg-brand-tint' : 'hover:bg-surface-subtle'"
              >
                <button type="button" class="min-w-0 flex-1 truncate py-1.5 text-left text-[12.5px] touch:min-h-11" :class="block.id === selectedId ? 'font-semibold text-brand-text' : 'text-ink-700'" :data-test="`email-block-${block.type}`" @click="selectedId = block.id">{{ rowLabel(block) }}</button>
                <button type="button" class="flex h-7 w-6 items-center justify-center rounded-ctlSm text-ink-muted hover:text-ink-900 disabled:opacity-30 touch:h-11 touch:w-9" :disabled="i === 0" :aria-label="t('Move up', 'Subir')" @click="move(block.id, -1)"><svg viewBox="0 0 24 24" class="h-3.5 w-3.5" fill="none" stroke="currentColor" stroke-width="1.8" aria-hidden="true"><path stroke-linecap="round" stroke-linejoin="round" d="M4.5 15.75l7.5-7.5 7.5 7.5" /></svg></button>
                <button type="button" class="flex h-7 w-6 items-center justify-center rounded-ctlSm text-ink-muted hover:text-ink-900 disabled:opacity-30 touch:h-11 touch:w-9" :disabled="i === design.blocks.length - 1" :aria-label="t('Move down', 'Bajar')" @click="move(block.id, 1)"><svg viewBox="0 0 24 24" class="h-3.5 w-3.5" fill="none" stroke="currentColor" stroke-width="1.8" aria-hidden="true"><path stroke-linecap="round" stroke-linejoin="round" d="M19.5 8.25l-7.5 7.5-7.5-7.5" /></svg></button>
              </li>
            </ol>
            <p v-if="!design.blocks.length" :class="HINT">{{ t('Empty. Add a block above.', 'Vacío. Añade un bloque arriba.') }}</p>
          </div>
          <div v-else-if="railTab === 'templates'" class="min-h-0 flex-1 overflow-y-auto p-3">
            <AutomationsEmailTemplatesPanel :current="design" :templates="templates" :loaded="templatesLoaded" :load-error="templatesError" :can-manage="canManageEmail" @apply="applyTemplate" @remove="onRemoveTemplate" />
          </div>
          <div v-else class="flex min-h-0 flex-1 flex-col gap-3 overflow-y-auto p-3" data-test="email-branding">
            <p :class="HINT">{{ t("This email follows the clinic's branding. A change here is for this email only, unless you save it for all of them.", 'Este email sigue la marca de la clínica. Lo que cambies aquí es solo para este email, salvo que lo guardes para todos.') }}</p>
            <label v-for="f in COLOR_FIELDS" :key="f.key" class="flex items-center justify-between gap-2 text-[12.5px] font-semibold text-ink-700">
              <span>{{ t(f.label[0], f.label[1]) }}<span v-if="ownTheme[f.key]" class="ml-1 font-normal text-ink-muted">· {{ t('this email', 'este email') }}</span></span>
              <span class="flex items-center gap-1.5">
                <span class="font-mono text-[11px] font-normal uppercase text-ink-muted">{{ theme[f.key] }}</span>
                <input type="color" class="h-8 w-9 cursor-pointer rounded-ctlSm border border-line-control bg-surface p-0.5 touch:h-11 touch:w-11" :value="theme[f.key]" :aria-label="t(f.label[0], f.label[1])" :data-test="`email-color-${f.key}`" @input="setTheme(f.key, ($event.target as HTMLInputElement).value)" />
              </span>
            </label>
            <label :class="LABEL">
              {{ t('Typeface', 'Tipo de letra') }}
              <select class="h-9 w-full rounded-ctl border border-line-control bg-surface px-2.5 text-[13px] font-normal text-ink-900 touch:h-11" :value="theme.font" @change="setTheme('font', ($event.target as HTMLSelectElement).value)">
                <option v-for="f in EMAIL_FONTS" :key="f.value" :value="f.value">{{ f.label }}</option>
              </select>
            </label>
            <p :class="HINT">{{ t('Fonts every mail client has, so the email looks the same everywhere.', 'Tipos que tienen todos los programas de correo, para que se vea igual en todas partes.') }}</p>
            <div v-if="Object.keys(ownTheme).length" class="flex flex-col gap-2 border-t border-line-divider pt-3">
              <UiBtn v-if="canManageEmail" :disabled="savingBranding" data-test="email-branding-save" @click="saveAsClinicBranding">{{ savingBranding ? t('Saving…', 'Guardando…') : t("Use for all the clinic's emails", 'Usar en todos los emails de la clínica') }}</UiBtn>
              <UiBtn variant="ghost" @click="setDesign({ ...design, theme: undefined })">{{ t("Back to the clinic's branding", 'Volver a la marca de la clínica') }}</UiBtn>
            </div>
            <p v-if="brandingMessage" class="text-[12px] text-ink-muted" role="status">{{ brandingMessage }}</p>
          </div>
        </aside>

        <!-- middle: the email -->
        <main ref="stage" class="min-h-0 overflow-y-auto px-4 py-6" :aria-label="t('The email', 'El email')">
          <div class="mx-auto" :style="{ width: `${frameWidth * scale}px`, height: `${frameHeight * scale}px` }">
            <iframe
              ref="frame"
              :srcdoc="initialHtml"
              sandbox="allow-same-origin"
              class="block origin-top-left border-0 bg-surface"
              :class="device === 'mobile' ? 'rounded-[22px] shadow-popover' : 'rounded-card shadow-card'"
              :style="{ width: `${frameWidth}px`, height: `${frameHeight}px`, transform: `scale(${scale})` }"
              :title="t('Email preview', 'Vista previa del email')"
              data-test="email-builder-canvas"
              @load="onLoad"
            />
          </div>
          <p class="mx-auto mt-3 max-w-[600px] text-center text-[12px] text-ink-muted">{{ t('Filled in with an example patient. Click a part of the email to change it.', 'Rellenado con un paciente de ejemplo. Pulsa una parte del email para cambiarla.') }}</p>
        </main>

        <!-- right: the selected block -->
        <aside class="flex min-h-0 flex-col border-l border-line bg-surface">
          <div class="min-h-0 flex-1 overflow-y-auto p-4">
            <AutomationsEmailBlockSettings
              v-if="selected"
              :key="selected.id"
              :block="selected"
              :variables="fields"
              :has-logo="!!logoUrl"
              :marketing="marketing"
              @update="updateBlock(selected.id, $event)"
            />
            <p v-else class="text-[13px] text-ink-muted">{{ t('Click a part of the email, or a block on the left, to change it.', 'Pulsa una parte del email, o un bloque a la izquierda, para cambiarlo.') }}</p>
          </div>
          <div v-if="selected" class="flex items-center justify-between gap-2 border-t border-line-divider px-4 py-3">
            <UiBtn size="sm" data-test="email-block-duplicate" @click="duplicate(selected.id)">{{ t('Duplicate', 'Duplicar') }}</UiBtn>
            <UiIconBtn icon="trash" tone="danger" :label="t('Remove block', 'Quitar bloque')" data-test="email-block-remove" @click="remove(selected.id)" />
          </div>
        </aside>
      </div>

      <AutomationsSendTestDialog v-if="sendTestOpen" @close="sendTestOpen = false" />
      <AutomationsEmailSaveTemplateDialog
        v-if="saveOpen"
        :suggested-name="b.draft.value.rule.name"
        :templates="templates"
        :busy="savingTemplate"
        :error="saveError"
        @save="onSaveTemplate"
        @cancel="saveOpen = false"
      />
    </div>
  </Teleport>
</template>
