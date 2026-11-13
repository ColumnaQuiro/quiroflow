<script setup lang="ts">
import { FIELD, HINT, LABEL, LINK_BTN, SECTION, segmentBtn, SEGMENT_WRAP } from '~/utils/automationUi'
import { withServerDetail } from '~/utils/serverMessage'
import {
  BODY_MAX,
  FOOTER_MAX,
  HEADER_FILES,
  TEMPLATE_LANGUAGES,
  exampleCount,
  headerFileProblem,
  templateDraftProblems,
  templateNameFrom,
  type TemplateCategory,
  type TemplateDraft,
  type TemplateHeaderKind,
} from '~/utils/whatsappTemplateDraft'

// Writes a WhatsApp message template and submits it to Meta, without leaving
// QuiroFlow -- above all one with a PDF, an image or a video at the top, which
// is how a clinic sends a patient a guide. Opened from Settings > WhatsApp and
// from a WhatsApp step in the automation builder.
//
// Meta has to approve it before anything can send it, so this ends at
// "submitted": the parent shows it as in review until it comes back approved.

const emit = defineEmits<{ close: []; created: [template: { name: string; language: string; status: string }] }>()
const t = useT()

const title = ref('')
const name = computed(() => templateNameFrom(title.value))
const language = ref('es')
const category = ref<TemplateCategory>('UTILITY')
const header = ref<TemplateHeaderKind>('document')
const file = ref<File | null>(null)
const body = ref('')
const examples = ref<string[]>([])
const footer = ref('')

// "{{1}}" built in script: a literal "}}" in the template would end the interpolation.
const slot = (n: number) => '{{' + n + '}}'
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

const draft = computed<TemplateDraft>(() => ({
  name: name.value,
  language: language.value,
  category: category.value,
  header: header.value,
  body: body.value,
  examples: examples.value,
  footer: footer.value,
}))
const problems = computed(() => {
  const list = templateDraftProblems(draft.value)
  const fileProblem = headerFileProblem(header.value, file.value ? { type: file.value.type, size: file.value.size } : null)
  return fileProblem ? [...list, fileProblem] : list
})
// Problems show once they have tried to submit: red under a half-written
// message is noise, not help.
const attempted = ref(false)
const busy = ref(false)
const error = ref('')

// What the patient will see: the examples in place of each {{n}}.
const previewBody = computed(() => (body.value.trim() || placeholder.value).replace(/\{\{\s*(\d+)\s*\}\}/g, (_, n: string) => examples.value[Number(n) - 1] || slot(Number(n))))
const fileLabel = computed(() => (header.value === 'document' ? 'PDF' : header.value === 'image' ? t('Image', 'Imagen') : t('Video', 'Vídeo')))

async function submit() {
  attempted.value = true
  error.value = ''
  if (problems.value.length > 0 || busy.value) return
  busy.value = true
  try {
    const form = new FormData()
    form.append('draft', JSON.stringify(draft.value))
    if (header.value !== 'none' && file.value) form.append('file', file.value)
    const created = await useStaffFetch<{ name: string; language: string; status: string }>('/api/whatsapp/templates', { method: 'POST', body: form })
    emit('created', created)
  } catch (e) {
    error.value = withServerDetail(t('Meta did not accept the template.', 'Meta no ha aceptado la plantilla.'), e, t('Detail:', 'Detalle:'))
  } finally {
    busy.value = false
  }
}

const panel = ref<HTMLElement | null>(null)
useFocusTrap(panel, () => emit('close'))
const titleId = `tpl-${Math.random().toString(36).slice(2, 9)}`
const TEXTAREA = 'w-full min-w-0 resize-y rounded-ctl border border-line-control bg-surface px-2.5 py-2 text-[13px] font-normal leading-relaxed text-ink-900 focus:border-brand focus:outline-none focus:ring-1 focus:ring-brand'
const HEADER_CHOICES: { kind: TemplateHeaderKind; en: string; es: string }[] = [
  { kind: 'document', en: 'PDF', es: 'PDF' },
  { kind: 'image', en: 'Image', es: 'Imagen' },
  { kind: 'video', en: 'Video', es: 'Vídeo' },
  { kind: 'none', en: 'Text only', es: 'Solo texto' },
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
      class="flex max-h-full w-full max-w-[860px] flex-col overflow-hidden rounded-card border border-line bg-surface shadow-popover"
    >
      <div class="flex items-start gap-3 border-b border-line-row px-6 pb-4 pt-5">
        <div class="flex-1">
          <h2 :id="titleId" class="text-[18px] font-bold text-ink-900">{{ t('New WhatsApp template', 'Nueva plantilla de WhatsApp') }}</h2>
          <p class="mt-1 text-[13px] leading-snug text-ink-muted">
            {{ t('Meta reviews every template before it can be sent. It usually takes a few minutes, sometimes up to 24 hours.', 'Meta revisa cada plantilla antes de que se pueda enviar. Suele tardar unos minutos, a veces hasta 24 horas.') }}
          </p>
        </div>
        <button type="button" class="flex h-9 w-9 shrink-0 items-center justify-center rounded-ctl text-ink-muted hover:bg-surface-subtle touch:h-11 touch:w-11" :aria-label="t('Close', 'Cerrar')" @click="emit('close')"><UiCloseIcon /></button>
      </div>

      <div class="grid min-h-0 flex-1 grid-cols-1 overflow-y-auto md:grid-cols-[1fr_300px]">
        <div class="flex flex-col gap-4 px-6 py-5">
          <label :class="LABEL">
            {{ t('Name', 'Nombre') }}
            <input v-model="title" :class="FIELD" :placeholder="t('Post-adjustment guide', 'Guía después del ajuste')" data-cy="template-title" />
            <span v-if="name" :class="HINT">{{ t('Saved at Meta as', 'Se guarda en Meta como') }} <span class="font-mono text-ink-700" data-cy="template-name">{{ name }}</span></span>
          </label>

          <div class="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <label :class="LABEL">
              {{ t('Language', 'Idioma') }}
              <select v-model="language" :class="FIELD" data-cy="template-language">
                <option v-for="l in TEMPLATE_LANGUAGES" :key="l.code" :value="l.code">{{ t(l.label.en, l.label.es) }}</option>
              </select>
            </label>
            <div :class="LABEL">
              <span id="tpl-category">{{ t('Category', 'Categoría') }}</span>
              <div :class="SEGMENT_WRAP" role="radiogroup" aria-labelledby="tpl-category">
                <button type="button" role="radio" :aria-checked="category === 'UTILITY'" :class="segmentBtn(category === 'UTILITY')" data-cy="template-category-utility" @click="category = 'UTILITY'">{{ t('Service', 'Servicio') }}</button>
                <button type="button" role="radio" :aria-checked="category === 'MARKETING'" :class="segmentBtn(category === 'MARKETING')" data-cy="template-category-marketing" @click="category = 'MARKETING'">{{ t('Marketing', 'Marketing') }}</button>
              </div>
            </div>
          </div>
          <p :class="HINT" class="-mt-2">
            {{ category === 'UTILITY'
              ? t('About their care or their appointment: a guide, instructions, a follow-up. The cheaper kind. If Meta finds it promotional, it moves it to Marketing.', 'Sobre su tratamiento o su cita: una guía, unas instrucciones, un seguimiento. Es la más barata. Si Meta la ve promocional, la pasa a Marketing.')
              : t('Offers, promotions, bringing people back. Costs more, and should only go to people who accepted marketing messages.', 'Ofertas, promociones, captación. Cuesta más, y solo debe ir a quien aceptó mensajes comerciales.') }}
          </p>

          <div class="flex flex-col gap-1.5">
            <span :class="SECTION" id="tpl-header">{{ t('At the top', 'Arriba del mensaje') }}</span>
            <div :class="SEGMENT_WRAP" role="radiogroup" aria-labelledby="tpl-header" class="self-start">
              <button v-for="c in HEADER_CHOICES" :key="c.kind" type="button" role="radio" :aria-checked="header === c.kind" :class="segmentBtn(header === c.kind)" :data-cy="`template-header-${c.kind}`" @click="chooseHeader(c.kind)">{{ t(c.en, c.es) }}</button>
            </div>
            <template v-if="header !== 'none'">
              <input
                :key="header"
                type="file"
                :accept="HEADER_FILES[header].accept"
                class="block w-full text-[12.5px] text-ink-muted file:mr-2 file:rounded-ctl file:border-0 file:bg-chip-bg file:px-2.5 file:py-1.5 file:text-[12.5px] file:text-ink-700"
                data-cy="template-file"
                @change="onFile"
              />
              <span :class="HINT">{{ t('Meta reviews the template with this file, and your automations send it unless a step attaches a different one.', 'Meta revisa la plantilla con este archivo, y tus automatizaciones lo envían salvo que un paso adjunte otro.') }}</span>
            </template>
          </div>

          <label :class="LABEL">
            {{ t('Message', 'Mensaje') }}
            <textarea ref="bodyField" v-model="body" rows="6" :class="TEXTAREA" :placeholder="placeholder" data-cy="template-body" />
          </label>
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

          <label :class="LABEL">
            <span>{{ t('Footer', 'Pie') }} <span class="font-normal text-ink-faint">{{ t('(optional)', '(opcional)') }}</span></span>
            <input v-model="footer" :class="FIELD" :placeholder="t('Your clinic', 'Tu clínica')" data-cy="template-footer" />
          </label>
          <span class="-mt-3 self-end text-[12px] tabular-nums" :class="footer.trim().length > FOOTER_MAX ? 'text-danger-text' : 'text-ink-faint'">{{ footer.trim().length }}/{{ FOOTER_MAX }}</span>
        </div>

        <!-- What the patient sees, beside what the clinic writes. -->
        <div class="border-line-row bg-surface-subtle px-5 py-5 max-md:border-t md:border-l">
          <div class="flex flex-col gap-2 md:sticky md:top-0">
            <span :class="SECTION">{{ t('Preview', 'Vista previa') }}</span>
            <div class="flex flex-col gap-1.5 rounded-card rounded-tl-[3px] border border-success-border bg-success-bg p-2 text-[13px] leading-relaxed text-ink-900" data-cy="template-preview">
              <div v-if="header !== 'none'" class="flex items-center gap-2 rounded-ctl bg-surface px-2.5 py-2 text-[12.5px] text-ink-700">
                <span class="rounded-ctlSm bg-chip-bg px-1.5 py-0.5 text-[11px] font-bold text-ink-500">{{ fileLabel }}</span>
                <span class="min-w-0 truncate">{{ file?.name ?? t('Your file', 'Tu archivo') }}</span>
              </div>
              <p class="whitespace-pre-line px-1" :class="body.trim() ? '' : 'text-ink-faint'">{{ previewBody }}</p>
              <p v-if="footer.trim()" class="px-1 text-[12px] text-ink-muted">{{ footer.trim() }}</p>
            </div>
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
          <UiBtn variant="primary" :disabled="busy" data-cy="template-submit" @click="submit">{{ busy ? t('Sending to Meta…', 'Enviando a Meta…') : t('Send to Meta for review', 'Enviar a Meta para revisión') }}</UiBtn>
        </div>
      </div>
    </div>
  </div>
</template>
