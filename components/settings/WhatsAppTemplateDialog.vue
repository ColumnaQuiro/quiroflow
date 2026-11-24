<script setup lang="ts">
import { FIELD, HINT, LABEL, LINK_BTN, SECTION, segmentBtn, SEGMENT_WRAP } from '~/utils/automationUi'
import { withServerDetail } from '~/utils/serverMessage'
import {
  APPROVED_EDIT_LIMIT,
  BODY_MAX,
  BUTTON_KIND_MAX,
  BUTTON_TEXT_MAX,
  BUTTONS_MAX,
  COPY_CODE_MAX,
  FOOTER_MAX,
  HEADER_FILES,
  HEADER_TEXT_MAX,
  TEMPLATE_LANGUAGES,
  draftFromTemplate,
  exampleCount,
  headerFileProblem,
  headerHasVariable,
  isMediaHeader,
  templateDraftProblems,
  templateNameFrom,
  type EditedTemplateResult,
  type ExistingTemplate,
  type TemplateButton,
  type TemplateButtonKind,
  type TemplateCategory,
  type TemplateDraft,
  type TemplateHeaderKind,
  type ValueSource,
} from '~/utils/whatsappTemplateDraft'

// Writes a WhatsApp message template and submits it to Meta, without leaving
// QuiroFlow: everything Meta's own builder offers that a clinic can use -- a
// heading, a PDF, an image, a video or a map at the top, and buttons that
// answer, open a link (fixed, or ending in something each send fills), call,
// copy a code or open one of the clinic's forms. Opened from Settings >
// WhatsApp and from a WhatsApp step in the automation builder.
//
// Meta has to approve it before anything can send it, so this ends at
// "submitted": the parent shows it as in review until it comes back approved.
//
// Given a `template`, it edits that one instead: the same form filled from
// what Meta has now, with the name and language fixed (Meta does not let an
// edit change them) and, once approved, the category too. The parent only
// offers it for a template templateEditBlocker allows.
//
// What a send puts in each blank -- the heading's {{1}}, the place, the end of
// a link, the code -- is chosen here too and kept beside the template, so an
// automation, a reminder and a hand-sent message all fill it the same way.

const props = defineProps<{ template?: ExistingTemplate }>()
const emit = defineEmits<{
  close: []
  created: [template: { name: string; language: string; status: string }]
  edited: [template: EditedTemplateResult]
}>()
const t = useT()
const accountStore = useAccountStore()

const editing = computed(() => !!props.template)
const start = props.template ? draftFromTemplate(props.template) : null

const title = ref('')
const name = computed(() => props.template?.name ?? templateNameFrom(title.value))
const language = ref(start?.language ?? 'es')
const category = ref<TemplateCategory>(start?.category ?? 'UTILITY')
// Meta keeps an approved template's category: changing it is refused.
const categoryLocked = computed(() => props.template?.status === 'APPROVED')
// A new one starts with nothing at the top: most messages are text alone.
const header = ref<TemplateHeaderKind>(start?.header ?? 'none')
const file = ref<File | null>(null)
const body = ref(start?.body ?? '')
const examples = ref<string[]>(start?.examples ?? [])
const footer = ref(start?.footer ?? '')

// "{{1}}" built in script: a literal "}}" in the template would end the interpolation.
const slot = (n: number) => '{{' + n + '}}'

// ---- Heading -----------------------------------------------------------------
const headerText = ref(start?.headerText ?? '')
const headerExample = ref(start?.headerExample ?? '')
const headerSourceKind = ref<'first_name' | 'text'>(start?.headerSource?.source === 'text' ? 'text' : 'first_name')
const headerSourceText = ref(start?.headerSource?.source === 'text' ? start.headerSource.text : '')
const headerHasSlot = computed(() => headerHasVariable(headerText.value))
function insertHeaderVariable() {
  if (!headerHasSlot.value) headerText.value = `${headerText.value.trimEnd()} ${slot(1)}`.trimStart()
  if (!headerExample.value) headerExample.value = 'Ana'
}

// ---- Location ----------------------------------------------------------------
// Meta takes the place with each send; this is the one QuiroFlow sends. The
// clinic's own name and address to start from, since that is nearly always it.
const location = reactive({
  latitude: start?.location ? String(start.location.latitude) : '',
  longitude: start?.location ? String(start.location.longitude) : '',
  name: start?.location?.name ?? accountStore.currentClinic?.name ?? '',
  address: start?.location?.address ?? accountStore.currentClinic?.address ?? '',
})
// "40.4168, -3.7038", as Google Maps copies it, pasted into either box.
function onCoordinates(field: 'latitude' | 'longitude', value: string) {
  const pair = value.match(/^\s*(-?\d+(?:\.\d+)?)\s*[,;\s]\s*(-?\d+(?:\.\d+)?)\s*$/)
  if (pair) {
    location.latitude = pair[1]!
    location.longitude = pair[2]!
  } else location[field] = value
}

// ---- Buttons -----------------------------------------------------------------
type EditableButton = TemplateButton & { id: number }
let nextId = 0
const buttons = ref<EditableButton[]>((start?.buttons ?? []).map((b) => ({ ...b, id: nextId++ })))

const supabase = useSupabaseClient()
const forms = ref<{ id: string; title: string }[]>([])
const formsLoaded = ref(false)
onMounted(async () => {
  // Originals only: a legacy translation row is sent through its original,
  // in the patient's language.
  const { data } = await supabase.from('doc_templates').select('id, title').is('translation_of', null).order('title')
  forms.value = (data ?? []) as { id: string; title: string }[]
  formsLoaded.value = true
})

const BUTTON_KINDS: { kind: TemplateButtonKind; en: string; es: string; icon: string }[] = [
  { kind: 'quick_reply', en: 'Quick reply', es: 'Respuesta rápida', icon: '↩' },
  { kind: 'url', en: 'Link', es: 'Enlace', icon: '↗' },
  { kind: 'phone', en: 'Call', es: 'Llamar', icon: '☎' },
  { kind: 'copy_code', en: 'Copy code', es: 'Copiar código', icon: '⧉' },
  { kind: 'form', en: 'Opens a form', es: 'Abre un formulario', icon: '↗' },
]
const kindOf = (kind: TemplateButtonKind) => BUTTON_KINDS.find((b) => b.kind === kind)!
const kindLabel = (kind: TemplateButtonKind) => t(kindOf(kind).en, kindOf(kind).es)

/** Whether one more of this kind would still be within Meta's limits. */
function canAdd(kind: TemplateButtonKind): boolean {
  if (buttons.value.length >= BUTTONS_MAX) return false
  const of = (k: string) => buttons.value.filter((b) => (b.kind === 'form' ? 'url' : b.kind) === k).length
  if (kind === 'form') return !buttons.value.some((b) => b.kind === 'form') && of('url') < BUTTON_KIND_MAX.url
  return of(kind) < BUTTON_KIND_MAX[kind]
}

function addButton(kind: TemplateButtonKind) {
  if (!canAdd(kind)) return
  const id = nextId++
  const fresh: Record<TemplateButtonKind, () => EditableButton> = {
    quick_reply: () => ({ id, kind: 'quick_reply', text: '' }),
    url: () => ({ id, kind: 'url', text: '', url: 'https://', dynamic: false, example: '', suffix: { source: 'phone' } }),
    phone: () => ({ id, kind: 'phone', text: t('Call us', 'Llámanos'), phone: '' }),
    copy_code: () => ({ id, kind: 'copy_code', code: '' }),
    form: () => ({ id, kind: 'form', text: t('Fill in the form', 'Rellenar formulario'), docTemplateId: forms.value.length === 1 ? forms.value[0]!.id : '' }),
  }
  const button = fresh[kind]()
  // Meta wants the quick replies together, before or after the rest: a new
  // button joins its own group rather than splitting the other one.
  const list = [...buttons.value]
  const isQuick = (b: EditableButton) => b.kind === 'quick_reply'
  const quickAtEnd = list.length > 0 && isQuick(list.at(-1)!) && list.some((b) => !isQuick(b))
  if (kind === 'quick_reply') {
    const last = list.map(isQuick).lastIndexOf(true)
    list.splice(last === -1 ? list.length : last + 1, 0, button)
  } else if (quickAtEnd) {
    list.splice(list.findIndex(isQuick), 0, button)
  } else {
    list.push(button)
  }
  buttons.value = list
}
function removeButton(id: number) {
  buttons.value = buttons.value.filter((b) => b.id !== id)
}
function moveButton(index: number, by: -1 | 1) {
  const list = [...buttons.value]
  const target = index + by
  if (target < 0 || target >= list.length) return
  ;[list[index], list[target]] = [list[target]!, list[index]!]
  buttons.value = list
}

/** The source a select shows for a link's end, and setting it back. */
const sourceKind = (s: ValueSource | null | undefined): 'first_name' | 'phone' | 'text' => s?.source ?? 'phone'
function setSuffixKind(b: EditableButton, kind: string) {
  if (b.kind !== 'url') return
  b.suffix = kind === 'text' ? { source: 'text', text: b.suffix?.source === 'text' ? b.suffix.text : '' } : { source: kind === 'first_name' ? 'first_name' : 'phone' }
}
function setSuffixText(b: EditableButton, text: string) {
  if (b.kind === 'url') b.suffix = { source: 'text', text }
}

// The file a template made in QuiroFlow already has: it goes to Meta again
// unless another is attached, so it need not be chosen a second time.
const keptFile = computed(() => (props.template?.headerMedia && header.value === start?.header ? props.template.headerMedia : null))

const placeholder = computed(() =>
  t(
    `Hi ${slot(1)}, here is the exercise guide we talked about in your visit. Any questions, just reply to this message.`,
    `Hola ${slot(1)}, aquí tienes la guía de ejercicios que comentamos en consulta. Cualquier duda, responde a este mensaje.`,
  ),
)

const needed = computed(() => exampleCount(body.value))
watch(needed, (n) => {
  const next = examples.value.slice(0, n)
  while (next.length < n) next.push(next.length === 0 ? 'Ana' : '')
  examples.value = next
}, { immediate: true })

const bodyField = ref<HTMLTextAreaElement | null>(null)
const footerField = ref<HTMLInputElement | null>(null)
function insertVariable() {
  const el = bodyField.value
  const token = slot(needed.value + 1)
  if (!el) {
    body.value += token
    return
  }
  const start = el.selectionStart ?? body.value.length
  const end = el.selectionEnd ?? start
  body.value = body.value.slice(0, start) + token + body.value.slice(end)
  nextTick(() => {
    el.focus()
    el.setSelectionRange(start + token.length, start + token.length)
  })
}

function chooseHeader(kind: TemplateHeaderKind) {
  header.value = kind
  file.value = null
}
function onFile(event: Event) {
  file.value = (event.target as HTMLInputElement).files?.[0] ?? null
}

const coordinate = (v: string) => (v.trim() === '' ? Number.NaN : Number(v.trim().replace(',', '.')))
const draft = computed<TemplateDraft>(() => ({
  name: name.value,
  language: language.value,
  category: category.value,
  header: header.value,
  headerText: header.value === 'text' ? headerText.value : '',
  headerExample: header.value === 'text' && headerHasSlot.value ? headerExample.value : '',
  headerSource: header.value === 'text' && headerHasSlot.value ? (headerSourceKind.value === 'text' ? { source: 'text', text: headerSourceText.value } : { source: 'first_name' }) : null,
  location: header.value === 'location' ? { latitude: coordinate(location.latitude), longitude: coordinate(location.longitude), name: location.name, address: location.address } : null,
  body: body.value,
  examples: examples.value,
  footer: footer.value,
  buttons: buttons.value.map(({ id: _id, ...b }) => b as TemplateButton),
}))
const problems = computed(() => {
  const list = templateDraftProblems(draft.value, { editing: editing.value })
  const fileProblem = !file.value && keptFile.value ? null : headerFileProblem(header.value, file.value ? { type: file.value.type, size: file.value.size } : null)
  return fileProblem ? [...list, fileProblem] : list
})
// Problems show once they have tried to submit: red under a half-written
// message is noise, not help.
const attempted = ref(false)
const busy = ref(false)
const error = ref('')

// ---- Preview: what the patient sees ------------------------------------------
const previewBody = computed(() => (body.value.trim() || placeholder.value).replace(/\{\{\s*(\d+)\s*\}\}/g, (_, n: string) => examples.value[Number(n) - 1] || slot(Number(n))))
const previewHeading = computed(() => headerText.value.trim().replace(/\{\{\s*1\s*\}\}/g, headerExample.value.trim() || slot(1)))
const fileLabel = computed(() => (header.value === 'document' ? 'PDF' : header.value === 'image' ? t('Image', 'Imagen') : t('Video', 'Vídeo')))
const previewButtonText = (b: EditableButton) =>
  b.kind === 'copy_code' ? t('Copy code', 'Copiar código') : b.text.trim() || (b.kind === 'form' ? t('Fill in the form', 'Rellenar formulario') : kindLabel(b.kind))
// WhatsApp shows up to three buttons; past that, two and "See all options".
const previewButtons = computed(() => (buttons.value.length > 3 ? buttons.value.slice(0, 2) : buttons.value))
const formTitle = (id: string) => forms.value.find((f) => f.id === id)?.title ?? '…'
/** Where a button leads, said under the preview: the link with its example, the number, the code, the form. */
const previewTarget = (b: EditableButton): string => {
  if (b.kind === 'url') return `${b.url.trim()}${b.dynamic ? b.example?.trim() || slot(1) : ''}`
  if (b.kind === 'form') return t(`Opens “${formTitle(b.docTemplateId)}”`, `Abre «${formTitle(b.docTemplateId)}»`)
  if (b.kind === 'phone') return b.phone.trim()
  if (b.kind === 'copy_code') return b.code.trim()
  return ''
}
const targets = computed(() => buttons.value.filter((b) => previewTarget(b)))

async function submit() {
  attempted.value = true
  error.value = ''
  if (problems.value.length > 0 || busy.value) return
  busy.value = true
  try {
    const form = new FormData()
    form.append('draft', JSON.stringify(draft.value))
    if (isMediaHeader(header.value) && file.value) form.append('file', file.value)
    if (props.template?.id) {
      const edited = await useStaffFetch<EditedTemplateResult>(`/api/whatsapp/templates/${encodeURIComponent(props.template.id)}`, { method: 'POST', body: form })
      emit('edited', edited)
    } else {
      const created = await useStaffFetch<{ name: string; language: string; status: string }>('/api/whatsapp/templates', { method: 'POST', body: form })
      emit('created', created)
    }
  } catch (e) {
    error.value = withServerDetail(
      editing.value ? t('Meta did not accept the change.', 'Meta no ha aceptado el cambio.') : t('Meta did not accept the template.', 'Meta no ha aceptado la plantilla.'),
      e,
      t('Detail:', 'Detalle:'),
    )
  } finally {
    busy.value = false
  }
}

const panel = ref<HTMLElement | null>(null)
useFocusTrap(panel, () => emit('close'))
const titleId = `tpl-${Math.random().toString(36).slice(2, 9)}`
// The body's box draws its border around the toolbar too, so the textarea has none of its own.
const BODY_TEXTAREA = 'block w-full min-w-0 resize-y rounded-b-ctl border-0 bg-transparent px-2.5 py-2 text-[13px] font-normal leading-relaxed text-ink-900 focus:outline-none'
const COUNTER = 'self-end text-[12px] tabular-nums'
const ICON_BTN = 'flex h-7 w-7 items-center justify-center rounded-ctlSm text-[13px] text-ink-muted hover:bg-surface disabled:opacity-30 touch:h-11 touch:w-11'
const HEADER_CHOICES: { kind: TemplateHeaderKind; en: string; es: string }[] = [
  { kind: 'none', en: 'Nothing', es: 'Nada' },
  { kind: 'text', en: 'Heading', es: 'Título' },
  { kind: 'document', en: 'PDF', es: 'PDF' },
  { kind: 'image', en: 'Image', es: 'Imagen' },
  { kind: 'video', en: 'Video', es: 'Vídeo' },
  { kind: 'location', en: 'Location', es: 'Ubicación' },
]
</script>

<template>
  <div class="fixed inset-0 z-50 flex items-end justify-center bg-scrim/40 p-4 sm:items-center" @click.self="emit('close')">
    <div
      ref="panel"
      role="dialog"
      aria-modal="true"
      :aria-labelledby="titleId"
      data-cy="template-dialog"
      class="flex max-h-full w-full max-w-[920px] flex-col overflow-hidden rounded-card border border-line bg-surface shadow-popover"
    >
      <div class="flex items-start gap-3 border-b border-line-row px-6 pb-4 pt-5">
        <div class="flex-1">
          <h2 :id="titleId" class="text-[18px] font-bold text-ink-900">{{ editing ? t('Edit WhatsApp template', 'Editar plantilla de WhatsApp') : t('New WhatsApp template', 'Nueva plantilla de WhatsApp') }}</h2>
          <p class="mt-1 text-[13px] leading-snug text-ink-muted">
            <template v-if="categoryLocked">{{ t(APPROVED_EDIT_LIMIT.en, APPROVED_EDIT_LIMIT.es) }}</template>
            <template v-else-if="editing">{{ t('Meta reviews the change before it can be sent. It usually takes a few minutes, sometimes up to 24 hours.', 'Meta revisa el cambio antes de que se pueda enviar. Suele tardar unos minutos, a veces hasta 24 horas.') }}</template>
            <template v-else>{{ t('Meta reviews every template before it can be sent. It usually takes a few minutes, sometimes up to 24 hours.', 'Meta revisa cada plantilla antes de que se pueda enviar. Suele tardar unos minutos, a veces hasta 24 horas.') }}</template>
          </p>
        </div>
        <button type="button" class="flex h-9 w-9 shrink-0 items-center justify-center rounded-ctl text-ink-muted hover:bg-surface-subtle touch:h-11 touch:w-11" :aria-label="t('Close', 'Cerrar')" @click="emit('close')"><UiCloseIcon /></button>
      </div>

      <div class="grid min-h-0 flex-1 grid-cols-1 overflow-y-auto md:grid-cols-[1fr_300px]">
        <div class="flex min-w-0 flex-col gap-4 px-6 py-5">
          <!-- An edit cannot rename it or change its language at Meta, so they are shown, not offered. -->
          <div v-if="editing" class="flex flex-col gap-1" data-cy="template-fixed">
            <span :class="SECTION">{{ t('Template', 'Plantilla') }}</span>
            <span class="text-[14px] text-ink-900"><span class="font-mono" data-cy="template-name">{{ name }}</span> <span class="text-ink-muted">· {{ language }}</span></span>
            <span :class="HINT">{{ t('Meta does not let a template change its name or language. For another language, create it again.', 'Meta no deja cambiar el nombre ni el idioma de una plantilla. Para otro idioma, créala de nuevo.') }}</span>
          </div>
          <label v-else :class="LABEL">
            {{ t('Name', 'Nombre') }}
            <input v-model="title" :class="FIELD" :placeholder="t('Post-adjustment guide', 'Guía después del ajuste')" data-cy="template-title" />
            <span v-if="name" :class="HINT">{{ t('Saved at Meta as', 'Se guarda en Meta como') }} <span class="font-mono text-ink-700" data-cy="template-name">{{ name }}</span></span>
          </label>

          <div class="grid grid-cols-1 gap-4" :class="editing ? '' : 'sm:grid-cols-2'">
            <label v-if="!editing" :class="LABEL">
              {{ t('Language', 'Idioma') }}
              <select v-model="language" :class="FIELD" data-cy="template-language">
                <option v-for="l in TEMPLATE_LANGUAGES" :key="l.code" :value="l.code">{{ t(l.label.en, l.label.es) }}</option>
              </select>
            </label>
            <div :class="LABEL">
              <span id="tpl-category">{{ t('Category', 'Categoría') }}</span>
              <div :class="SEGMENT_WRAP" role="radiogroup" aria-labelledby="tpl-category">
                <button type="button" role="radio" :aria-checked="category === 'UTILITY'" :disabled="categoryLocked && category !== 'UTILITY'" :class="segmentBtn(category === 'UTILITY')" data-cy="template-category-utility" @click="category = 'UTILITY'">{{ t('Service', 'Servicio') }}</button>
                <button type="button" role="radio" :aria-checked="category === 'MARKETING'" :disabled="categoryLocked && category !== 'MARKETING'" :class="segmentBtn(category === 'MARKETING')" data-cy="template-category-marketing" @click="category = 'MARKETING'">{{ t('Marketing', 'Marketing') }}</button>
              </div>
            </div>
          </div>
          <p v-if="categoryLocked" :class="HINT" class="-mt-2" data-cy="template-category-locked">
            {{ t('Meta keeps the category of an approved template. For the other one, create it again.', 'Meta no deja cambiar la categoría de una plantilla aprobada. Para la otra, créala de nuevo.') }}
          </p>
          <p v-else :class="HINT" class="-mt-2">
            {{ category === 'UTILITY'
              ? t('About their care or their appointment: a guide, instructions, a follow-up. The cheaper kind. If Meta finds it promotional, it moves it to Marketing.', 'Sobre su tratamiento o su cita: una guía, unas instrucciones, un seguimiento. Es la más barata. Si Meta la ve promocional, la pasa a Marketing.')
              : t('Offers, promotions, bringing people back. Costs more, and should only go to people who accepted marketing messages.', 'Ofertas, promociones, captación. Cuesta más, y solo debe ir a quien aceptó mensajes comerciales.') }}
          </p>

          <!-- At the top -->
          <div class="flex flex-col gap-1.5">
            <span id="tpl-header" :class="SECTION">{{ t('At the top', 'Arriba del mensaje') }}</span>
            <div :class="SEGMENT_WRAP" role="radiogroup" aria-labelledby="tpl-header" class="flex-wrap self-start">
              <button v-for="c in HEADER_CHOICES" :key="c.kind" type="button" role="radio" :aria-checked="header === c.kind" :class="segmentBtn(header === c.kind)" :data-cy="`template-header-${c.kind}`" @click="chooseHeader(c.kind)">{{ t(c.en, c.es) }}</button>
            </div>

            <template v-if="isMediaHeader(header)">
              <input
                :key="header"
                type="file"
                :accept="HEADER_FILES[header].accept"
                class="block w-full text-[12.5px] text-ink-muted file:mr-2 file:rounded-ctl file:border-0 file:bg-chip-bg file:px-2.5 file:py-1.5 file:text-[12.5px] file:text-ink-700"
                data-cy="template-file"
                @change="onFile"
              />
              <span v-if="keptFile && !file" :class="HINT" data-cy="template-kept-file">
                {{ t(`Keeps ${keptFile.filename}. Choose another file only to replace it: your automations then send the new one.`, `Mantiene ${keptFile.filename}. Elige otro archivo solo para cambiarlo: tus automatizaciones enviarán el nuevo.`) }}
              </span>
              <span v-else-if="editing && !file" :class="HINT">{{ t('Meta needs the file again to review the change.', 'Meta necesita el archivo otra vez para revisar el cambio.') }}</span>
              <span v-else :class="HINT">{{ t('Meta reviews the template with this file, and every send attaches it unless a step attaches a different one.', 'Meta revisa la plantilla con este archivo, y cada envío lo adjunta salvo que un paso adjunte otro.') }}</span>
            </template>

            <div v-else-if="header === 'text'" class="flex flex-col gap-2" data-cy="template-heading">
              <input v-model="headerText" :class="FIELD" :placeholder="t('Your appointment is confirmed', 'Tu cita está confirmada')" :aria-label="t('Heading', 'Título')" data-cy="template-heading-text" />
              <div class="-mt-1 flex items-center gap-3">
                <button v-if="!headerHasSlot" type="button" :class="LINK_BTN" data-cy="template-heading-add-variable" @click="insertHeaderVariable">+ {{ t('Insert a variable', 'Insertar una variable') }}</button>
                <span class="ml-auto" :class="[COUNTER, headerText.trim().length > HEADER_TEXT_MAX ? 'text-danger-text' : 'text-ink-faint']">{{ headerText.trim().length }}/{{ HEADER_TEXT_MAX }}</span>
              </div>
              <div v-if="headerHasSlot" class="grid grid-cols-1 gap-2 sm:grid-cols-2">
                <label :class="LABEL">
                  {{ t('Example for Meta', 'Ejemplo para Meta') }}
                  <input v-model="headerExample" :class="FIELD" data-cy="template-heading-example" />
                </label>
                <label :class="LABEL">
                  {{ t('Each send puts', 'En cada envío va') }}
                  <select v-model="headerSourceKind" :class="FIELD" data-cy="template-heading-source">
                    <option value="first_name">{{ t('Their first name', 'Su nombre') }}</option>
                    <option value="text">{{ t('A fixed text', 'Un texto fijo') }}</option>
                  </select>
                </label>
                <input v-if="headerSourceKind === 'text'" v-model="headerSourceText" :class="FIELD" class="sm:col-span-2" :aria-label="t('Fixed text', 'Texto fijo')" data-cy="template-heading-source-text" />
              </div>
            </div>

            <div v-else-if="header === 'location'" class="flex flex-col gap-2" data-cy="template-location">
              <div class="grid grid-cols-1 gap-2 sm:grid-cols-2">
                <label :class="LABEL">
                  {{ t('Place name', 'Nombre del sitio') }}
                  <input v-model="location.name" :class="FIELD" data-cy="template-location-name" />
                </label>
                <label :class="LABEL">
                  {{ t('Address', 'Dirección') }}
                  <input v-model="location.address" :class="FIELD" data-cy="template-location-address" />
                </label>
                <label :class="LABEL">
                  {{ t('Latitude', 'Latitud') }}
                  <input :value="location.latitude" inputmode="decimal" :class="FIELD" placeholder="40.4168" data-cy="template-location-latitude" @input="onCoordinates('latitude', ($event.target as HTMLInputElement).value)" />
                </label>
                <label :class="LABEL">
                  {{ t('Longitude', 'Longitud') }}
                  <input :value="location.longitude" inputmode="decimal" :class="FIELD" placeholder="-3.7038" data-cy="template-location-longitude" @input="onCoordinates('longitude', ($event.target as HTMLInputElement).value)" />
                </label>
              </div>
              <span :class="HINT">{{ t('WhatsApp shows it as a map that opens in their maps app. In Google Maps, right-click the place to copy both numbers, and paste them in either box.', 'WhatsApp lo muestra como un mapa que se abre en su app de mapas. En Google Maps, haz clic derecho en el sitio para copiar los dos números y pégalos en cualquiera de las casillas.') }}</span>
            </div>
          </div>

          <div :class="LABEL">
            <label :for="`${titleId}-body`">{{ t('Message', 'Mensaje') }}</label>
            <!-- Bold, italic, lists, emoji: what WhatsApp draws from the markers in the text. -->
            <div class="rounded-ctl border border-line-control bg-surface focus-within:border-brand focus-within:ring-1 focus-within:ring-brand">
              <SettingsWhatsAppFormatToolbar v-model="body" :field="bodyField" class="border-b border-line-row px-1 py-1" />
              <textarea :id="`${titleId}-body`" ref="bodyField" v-model="body" rows="6" :class="BODY_TEXTAREA" :placeholder="placeholder" data-cy="template-body" />
            </div>
          </div>
          <div class="-mt-2 flex items-center gap-3">
            <button type="button" :class="LINK_BTN" data-cy="template-add-variable" @click="insertVariable">+ {{ t('Insert a variable', 'Insertar una variable') }}</button>
            <span class="ml-auto text-[12px] tabular-nums" :class="body.trim().length > BODY_MAX ? 'text-danger-text' : 'text-ink-faint'">{{ body.trim().length }}/{{ BODY_MAX }}</span>
          </div>
          <p :class="HINT" class="-mt-2">{{ t('A variable is what changes with each send, like the name. The automation chooses what fills it.', 'Una variable es lo que cambia en cada envío, como el nombre. La automatización elige con qué se rellena.') }}</p>

          <div v-if="needed > 0" class="flex flex-col gap-2">
            <span :class="SECTION">{{ t('Examples for Meta', 'Ejemplos para Meta') }}</span>
            <div v-for="(_, i) in examples" :key="i" class="flex items-center gap-2" :data-cy="`template-example-${i + 1}`">
              <span class="w-10 shrink-0 font-mono text-[12px] text-ink-muted" v-text="slot(i + 1)" />
              <input v-model="examples[i]" :class="FIELD" :aria-label="t(`Example for variable ${i + 1}`, `Ejemplo para la variable ${i + 1}`)" />
            </div>
          </div>

          <div :class="LABEL">
            <label :for="`${titleId}-footer`">{{ t('Footer', 'Pie') }} <span class="font-normal text-ink-faint">{{ t('(optional)', '(opcional)') }}</span></label>
            <!-- A footer takes emoji, but no formatting and no variables. -->
            <div class="flex items-center gap-1">
              <input :id="`${titleId}-footer`" ref="footerField" v-model="footer" :class="FIELD" :placeholder="t('Your clinic', 'Tu clínica')" data-cy="template-footer" />
              <SettingsWhatsAppFormatToolbar v-model="footer" :field="footerField" :formatting="false" />
            </div>
          </div>
          <span class="-mt-3" :class="[COUNTER, footer.trim().length > FOOTER_MAX ? 'text-danger-text' : 'text-ink-faint']">{{ footer.trim().length }}/{{ FOOTER_MAX }}</span>

          <!-- Buttons -->
          <div class="flex flex-col gap-2">
            <div class="flex items-baseline gap-2">
              <span :class="SECTION">{{ t('Buttons', 'Botones') }}</span>
              <span class="ml-auto text-[12px] tabular-nums text-ink-faint" data-cy="template-button-count">{{ buttons.length }}/{{ BUTTONS_MAX }}</span>
            </div>
            <p v-if="!buttons.length" :class="HINT" data-cy="template-buttons-empty">{{ t('No buttons. Add one below: up to 10, two of them links and one a call.', 'Sin botones. Añade uno abajo: hasta 10, dos de ellos enlaces y uno de llamada.') }}</p>

            <div
              v-for="(b, i) in buttons"
              :key="b.id"
              class="flex flex-col gap-2 rounded-card border border-line bg-surface-subtle px-3 py-2.5"
              :data-cy="`template-button-${i}`"
              :data-kind="b.kind"
            >
              <div class="flex items-center gap-2">
                <span class="text-[12.5px] font-semibold text-ink-700"><span aria-hidden="true">{{ kindOf(b.kind).icon }}</span> {{ kindLabel(b.kind) }}</span>
                <div class="ml-auto flex items-center gap-0.5">
                  <button type="button" :class="ICON_BTN" :disabled="i === 0" :aria-label="t('Move up', 'Subir')" @click="moveButton(i, -1)">↑</button>
                  <button type="button" :class="ICON_BTN" :disabled="i === buttons.length - 1" :aria-label="t('Move down', 'Bajar')" @click="moveButton(i, 1)">↓</button>
                  <button type="button" :class="ICON_BTN" :aria-label="t('Remove the button', 'Quitar el botón')" data-cy="template-button-remove" @click="removeButton(b.id)">✕</button>
                </div>
              </div>

              <template v-if="b.kind !== 'copy_code'">
                <label :class="LABEL">
                  {{ t('Button text', 'Texto del botón') }}
                  <input v-model="b.text" :class="FIELD" data-cy="template-button-text" />
                </label>
                <span class="-mt-1" :class="[COUNTER, b.text.trim().length > BUTTON_TEXT_MAX ? 'text-danger-text' : 'text-ink-faint']">{{ b.text.trim().length }}/{{ BUTTON_TEXT_MAX }}</span>
              </template>

              <span v-if="b.kind === 'quick_reply'" :class="HINT">{{ t('A tap answers with this text, and the reply lands in the Inbox like any other.', 'Al tocarlo responde con este texto, y la respuesta llega al Inbox como cualquier otra.') }}</span>

              <template v-else-if="b.kind === 'url'">
                <label :class="LABEL">
                  {{ t('Link', 'Enlace') }}
                  <input v-model="b.url" type="url" inputmode="url" :class="FIELD" placeholder="https://" data-cy="template-button-url" />
                </label>
                <div :class="SEGMENT_WRAP" role="radiogroup" :aria-label="t('Link', 'Enlace')" class="flex-wrap self-start">
                  <button type="button" role="radio" :aria-checked="!b.dynamic" :class="segmentBtn(!b.dynamic)" data-cy="template-button-static" @click="b.dynamic = false">{{ t('Always the same', 'Siempre el mismo') }}</button>
                  <button type="button" role="radio" :aria-checked="!!b.dynamic" :class="segmentBtn(!!b.dynamic)" data-cy="template-button-dynamic" @click="b.dynamic = true">{{ t('Changes with each send', 'Cambia en cada envío') }}</button>
                </div>
                <template v-if="b.dynamic">
                  <span :class="HINT">{{ t('Each send adds something to the end of the link. Meta reviews it with the example.', 'Cada envío añade algo al final del enlace. Meta lo revisa con el ejemplo.') }}</span>
                  <div class="grid grid-cols-1 gap-2 sm:grid-cols-2">
                    <label :class="LABEL">
                      {{ t('At the end goes', 'Al final va') }}
                      <select :value="sourceKind(b.suffix)" :class="FIELD" data-cy="template-button-suffix" @change="setSuffixKind(b, ($event.target as HTMLSelectElement).value)">
                        <option value="phone">{{ t('Their phone number', 'Su teléfono') }}</option>
                        <option value="first_name">{{ t('Their first name', 'Su nombre') }}</option>
                        <option value="text">{{ t('A fixed text', 'Un texto fijo') }}</option>
                      </select>
                    </label>
                    <label :class="LABEL">
                      {{ t('Example for Meta', 'Ejemplo para Meta') }}
                      <input v-model="b.example" :class="FIELD" placeholder="34600000000" data-cy="template-button-example" />
                    </label>
                    <input
                      v-if="b.suffix?.source === 'text'"
                      :value="b.suffix.text"
                      :class="FIELD"
                      class="sm:col-span-2"
                      :aria-label="t('Fixed text', 'Texto fijo')"
                      data-cy="template-button-suffix-text"
                      @input="setSuffixText(b, ($event.target as HTMLInputElement).value)"
                    />
                  </div>
                  <span class="break-all font-mono text-[11.5px] text-ink-muted" data-cy="template-button-url-preview">{{ b.url.trim() }}<span class="text-brand-text">{{ b.example?.trim() || slot(1) }}</span></span>
                </template>
              </template>

              <label v-else-if="b.kind === 'phone'" :class="LABEL">
                {{ t('Phone number', 'Teléfono') }}
                <input v-model="b.phone" type="tel" inputmode="tel" :class="FIELD" placeholder="+34 600 000 000" data-cy="template-button-phone" />
              </label>

              <template v-else-if="b.kind === 'copy_code'">
                <label :class="LABEL">
                  {{ t('Code it copies', 'Código que copia') }}
                  <input v-model="b.code" :class="FIELD" placeholder="BIENVENIDA10" data-cy="template-button-code" />
                </label>
                <span class="-mt-1" :class="[COUNTER, b.code.trim().length > COPY_CODE_MAX ? 'text-danger-text' : 'text-ink-faint']">{{ b.code.trim().length }}/{{ COPY_CODE_MAX }}</span>
                <span :class="HINT">{{ t('WhatsApp labels the button itself ("Copy code"). Meta reviews it with this code, and every send copies this one.', 'WhatsApp pone el texto del botón («Copiar código»). Meta la revisa con este código, y cada envío copia este.') }}</span>
              </template>

              <template v-else-if="b.kind === 'form'">
                <label :class="LABEL">
                  {{ t('Form', 'Formulario') }}
                  <select v-model="b.docTemplateId" :class="FIELD" data-cy="template-button-form-select">
                    <option value="" disabled>{{ t('Choose a form…', 'Elige un formulario…') }}</option>
                    <option v-for="f in forms" :key="f.id" :value="f.id">{{ f.title }}</option>
                  </select>
                </label>
                <span v-if="formsLoaded && !forms.length" :class="HINT" class="text-warning-text">{{ t('This clinic has no forms yet. Create one in Settings > Forms first.', 'Esta clínica aún no tiene formularios. Crea uno antes en Ajustes > Formularios.') }}</span>
                <span v-else-if="editing && !b.docTemplateId" :class="HINT" class="text-warning-text" data-cy="template-button-form-unknown">{{ t('QuiroFlow does not know which form this button opens. Choose it.', 'QuiroFlow no sabe qué formulario abre este botón. Elígelo.') }}</span>
                <span :class="HINT">{{ t('Each send creates the patient\'s own copy of the form and the button opens it. It can only be sent to patients, not to leads.', 'Cada envío crea la copia del formulario para ese paciente y el botón la abre. Solo se puede enviar a pacientes, no a leads.') }}</span>
              </template>
            </div>

            <div class="flex flex-wrap gap-1.5" data-cy="template-add-buttons">
              <button
                v-for="k in BUTTON_KINDS"
                :key="k.kind"
                type="button"
                class="rounded-ctl border border-line-control bg-surface px-2.5 py-1.5 text-[12.5px] font-semibold text-ink-700 hover:bg-surface-subtle disabled:cursor-not-allowed disabled:opacity-40 touch:min-h-11"
                :disabled="!canAdd(k.kind)"
                :data-cy="`template-add-button-${k.kind}`"
                @click="addButton(k.kind)"
              >
                + {{ t(k.en, k.es) }}
              </button>
            </div>
          </div>
        </div>

        <!-- What the patient sees, beside what the clinic writes. -->
        <div class="border-line-row bg-surface-subtle px-5 py-5 max-md:border-t md:border-l">
          <div class="flex flex-col gap-1 md:sticky md:top-0">
            <span :class="SECTION" class="mb-1">{{ t('Preview', 'Vista previa') }}</span>
            <div class="flex flex-col gap-1.5 rounded-card rounded-tl-[3px] border border-success-border bg-success-bg p-2 text-[13px] leading-relaxed text-ink-900" data-cy="template-preview">
              <div v-if="isMediaHeader(header)" class="flex items-center gap-2 rounded-ctl bg-surface px-2.5 py-2 text-[12.5px] text-ink-700" data-cy="template-preview-header">
                <span class="rounded-ctlSm bg-chip-bg px-1.5 py-0.5 text-[11px] font-bold text-ink-500">{{ fileLabel }}</span>
                <span class="min-w-0 truncate">{{ file?.name ?? keptFile?.filename ?? t('Your file', 'Tu archivo') }}</span>
              </div>
              <div v-else-if="header === 'location'" class="flex flex-col overflow-hidden rounded-ctl bg-surface text-[12.5px]" data-cy="template-preview-header">
                <div class="flex h-20 items-center justify-center bg-chip-bg text-[22px]" aria-hidden="true">📍</div>
                <div class="px-2.5 py-1.5">
                  <p class="font-semibold text-ink-900">{{ location.name.trim() || t('Place name', 'Nombre del sitio') }}</p>
                  <p class="text-ink-muted">{{ location.address.trim() }}</p>
                </div>
              </div>
              <p v-else-if="header === 'text'" class="px-1 font-bold" :class="headerText.trim() ? '' : 'text-ink-faint'" data-cy="template-preview-header">{{ previewHeading || t('Heading', 'Título') }}</p>
              <SettingsWhatsAppFormattedText :text="previewBody" class="px-1" :class="body.trim() ? '' : 'text-ink-faint'" data-cy="template-preview-body" />
              <p v-if="footer.trim()" class="px-1 text-[12px] text-ink-muted">{{ footer.trim() }}</p>
            </div>
            <div
              v-for="b in previewButtons"
              :key="b.id"
              class="flex items-center justify-center gap-1.5 rounded-card border border-success-border bg-success-bg px-2 py-2 text-[13px] font-semibold text-brand-text"
              data-cy="template-preview-button"
            >
              <span aria-hidden="true">{{ kindOf(b.kind).icon }}</span>{{ previewButtonText(b) }}
            </div>
            <template v-if="buttons.length > 3">
              <div class="flex items-center justify-center gap-1.5 rounded-card border border-success-border bg-success-bg px-2 py-2 text-[13px] font-semibold text-brand-text" data-cy="template-preview-all-options">
                <span aria-hidden="true">☰</span>{{ t('See all options', 'Ver todas las opciones') }}
              </div>
              <span :class="HINT">{{ t('With more than three buttons, WhatsApp shows two and puts the rest behind “See all options”.', 'Con más de tres botones, WhatsApp muestra dos y el resto en «Ver todas las opciones».') }}</span>
            </template>
            <ul v-if="targets.length" class="mt-1 flex flex-col gap-0.5" data-cy="template-preview-targets">
              <li v-for="b in targets" :key="b.id" class="truncate text-[11.5px] text-ink-muted">
                <span aria-hidden="true">{{ kindOf(b.kind).icon }}</span> {{ previewTarget(b) }}
              </li>
            </ul>
          </div>
        </div>
      </div>

      <div class="flex flex-col gap-3 border-t border-line-row px-6 py-4">
        <ul v-if="attempted && problems.length" class="flex flex-col gap-1 rounded-ctl border border-warning-border bg-warning-bg px-3 py-2 text-[12.5px] leading-snug text-warning-text" data-cy="template-problems">
          <li v-for="p in problems" :key="p.en">{{ t(p.en, p.es) }}</li>
        </ul>
        <p v-if="error" class="text-[13px] font-semibold text-danger-text" data-cy="template-error">{{ error }}</p>
        <div class="flex flex-wrap justify-end gap-2">
          <UiBtn @click="emit('close')">{{ t('Cancel', 'Cancelar') }}</UiBtn>
          <UiBtn variant="primary" :disabled="busy" data-cy="template-submit" @click="submit">{{ busy ? t('Sending to Meta…', 'Enviando a Meta…') : editing ? t('Send the change to Meta', 'Enviar el cambio a Meta') : t('Send to Meta for review', 'Enviar a Meta para revisión') }}</UiBtn>
        </div>
      </div>
    </div>
  </div>
</template>
