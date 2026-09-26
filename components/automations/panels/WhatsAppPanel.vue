<script setup lang="ts">
import { BUTTON_PARAM_SOURCES, VARIABLE_SOURCES, say } from '~/utils/automationCatalog'
import { FIELD, HINT, LABEL, LINK_BTN, NOTE, REMOVE_BTN, SECTION, WARN } from '~/utils/automationUi'
import { serverMessage } from '~/utils/serverMessage'

// A WhatsApp step: an approved Meta template, what fills each {{n}}, the
// header it declares (a file, or a location), and what each dynamic URL
// button carries -- a document to sign, the phone number, fixed text.
// Everything the Campaigns editor did, in the same config shape, so the
// sender (runAutomationActions) reads a step saved here exactly as before.

const props = defineProps<{ stepId: string }>()
const b = useBuilder()
const t = useT()

const step = computed(() => b.stepsById.value.get(props.stepId)!)
const config = computed(() => step.value.config)
const set = (patch: Record<string, any>) => b.updateStepConfig(props.stepId, patch)

const key = (name: string, language: string) => `${name}::${language}`
const current = computed(() => b.templates.value.find((x) => x.name === config.value.template_name && x.language === (config.value.template_language || 'es')) ?? null)
const currentKey = computed(() => (current.value ? key(current.value.name, current.value.language) : ''))

function selectTemplate(value: string) {
  const tpl = b.templates.value.find((x) => key(x.name, x.language) === value)
  if (!tpl) return
  set({
    template_name: tpl.name,
    template_language: tpl.language,
    variables: Array.from({ length: tpl.variableCount }, () => ({ source: 'first_name' })),
    // One document slot per dynamic URL button, or a single one (sent as the
    // last body variable) for a template with none.
    doc_template_ids: Array.from({ length: Math.max(tpl.urlButtonCount, 1) }, () => null),
    button_params: undefined,
    header: undefined,
  })
}

// ---- variables
const variables = computed<{ source: string; text?: string }[]>(() => (Array.isArray(config.value.variables) ? config.value.variables : []))
const variableRows = computed(() => {
  const n = current.value ? current.value.variableCount : variables.value.length
  return Array.from({ length: n }, (_, i) => variables.value[i] ?? { source: '' })
})
// Slots the template has that nothing fills (or a fixed value left blank).
function unassignedWarning(n: number) {
  const slot = '{' + '{' + n + '}' + '}'
  return t(`${slot} has nothing assigned, so it is sent as the person's first name. Choose what it should say.`, `${slot} no tiene nada asignado, así que se envía el nombre de la persona. Elige qué debe decir.`)
}
const unassignedSlots = computed(() => variableRows.value.map((v, i) => (!v.source || (v.source === 'text' && !(v.text ?? '').trim()) ? i + 1 : 0)).filter((n) => n > 0))
function setVariable(i: number, patch: { source?: string; text?: string }) {
  const next = [...variableRows.value.map((v) => ({ ...v }))]
  next[i] = { ...next[i]!, ...patch }
  if (next[i]!.source !== 'text') delete next[i]!.text
  set({ variables: next })
}
/** "{{1}}" -- built here because a literal "}}" ends a template interpolation. */
const slotLabel = (i: number) => `{{${i + 1}}` + '}'
function addVariable() {
  set({ variables: [...variables.value, { source: 'first_name' }] })
}
function removeVariable(i: number) {
  set({ variables: variables.value.filter((_, j) => j !== i) })
}

const preview = computed(() => {
  const body = current.value?.bodyText ?? ''
  const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
  return esc(body).replace(/\{\{(\d+)\}\}/g, (_, n: string) => {
    const v = variableRows.value[Number(n) - 1]
    const label = v?.source === 'text' ? v.text || '…' : say(t, VARIABLE_SOURCES.find((s) => s.value === v?.source)?.label ?? ['{{' + n + '}}', '{{' + n + '}}'])
    return `<strong>${esc(label)}</strong>`
  })
})

// ---- header
const headerFormat = computed(() => current.value?.mediaHeaderFormat ?? (config.value.header?.type ? String(config.value.header.type).toUpperCase() : null))
const header = computed(() => config.value.header ?? {})
function setLocation(patch: Record<string, any>) {
  const next = { type: 'location', ...header.value, ...patch }
  for (const k of ['latitude', 'longitude'] as const) if (next[k] !== undefined && next[k] !== '') next[k] = Number(next[k])
  set({ header: next })
}
const uploading = ref(false)
const uploadError = ref('')
async function upload(event: Event) {
  const input = event.target as HTMLInputElement
  const file = input.files?.[0]
  if (!file || !headerFormat.value) return
  uploadError.value = ''
  uploading.value = true
  try {
    const body = new FormData()
    body.append('file', file)
    body.append('kind', headerFormat.value.toLowerCase())
    const result = await useStaffFetch<{ storage_path: string; filename: string }>('/api/whatsapp/header-media', { method: 'POST', body })
    set({ header: { type: headerFormat.value.toLowerCase(), storage_path: result.storage_path, filename: result.filename } })
  } catch (e) {
    uploadError.value = serverMessage(e) ?? t('Could not upload that file.', 'No se ha podido subir el archivo.')
  } finally {
    uploading.value = false
    input.value = ''
  }
}

// ---- buttons and documents
const dynamicButtons = computed(() => (current.value?.buttons ?? []).filter((x) => x.dynamic))
const slotCount = computed(() => (current.value ? Math.max(current.value.urlButtonCount, 1) : Math.max((config.value.doc_template_ids ?? []).length, 1)))
const bodyDocSlot = computed(() => (current.value?.urlButtonCount ?? 0) === 0)
const docIds = computed<(string | null)[]>(() => (Array.isArray(config.value.doc_template_ids) ? config.value.doc_template_ids : []))
const params = computed<({ source: string; text?: string } | null)[]>(() => (Array.isArray(config.value.button_params) ? config.value.button_params : []))

function slotSource(i: number) {
  if (docIds.value[i]) return 'doc'
  return params.value[i]?.source ?? ''
}
function setSlot(i: number, source: string) {
  const docs = Array.from({ length: slotCount.value }, (_, j) => docIds.value[j] ?? null)
  const ps = Array.from({ length: slotCount.value }, (_, j) => params.value[j] ?? null)
  if (source === 'doc') {
    docs[i] = docs[i] ?? b.docTemplates.value[0]?.id ?? null
    ps[i] = null
  } else {
    docs[i] = null
    ps[i] = source ? { source, ...(source === 'text' ? { text: ps[i]?.text ?? '' } : {}) } : null
  }
  set({ doc_template_ids: docs, button_params: ps.some(Boolean) ? ps : undefined })
}
function setSlotDoc(i: number, id: string) {
  const docs = Array.from({ length: slotCount.value }, (_, j) => docIds.value[j] ?? null)
  docs[i] = id || null
  set({ doc_template_ids: docs })
}
function setSlotText(i: number, text: string) {
  const ps = Array.from({ length: slotCount.value }, (_, j) => params.value[j] ?? null)
  ps[i] = { source: 'text', text }
  set({ button_params: ps })
}

const isMarketingTemplate = computed(() => current.value?.category === 'MARKETING')
</script>

<template>
  <div class="flex flex-col gap-4">
    <p v-if="b.templatesError.value" :class="WARN" data-test="templates-error">{{ b.templatesError.value }}</p>
    <label v-else :class="LABEL">
      {{ t('Template approved by Meta', 'Plantilla aprobada por Meta') }}
      <select :class="FIELD" :value="currentKey" data-test="template-select" @change="selectTemplate(($event.target as HTMLSelectElement).value)">
        <option value="" disabled>{{ b.templates.value.length === 0 ? t('No approved templates found', 'No hay plantillas aprobadas') : t('Choose a template…', 'Elige una plantilla…') }}</option>
        <option v-for="tpl in b.templates.value" :key="key(tpl.name, tpl.language)" :value="key(tpl.name, tpl.language)">{{ tpl.name }} · {{ tpl.language }} · {{ tpl.category === 'MARKETING' ? t('Marketing', 'Marketing') : tpl.category === 'UTILITY' ? t('Utility', 'Servicio') : tpl.category }}</option>
      </select>
    </label>
    <p v-if="config.template_name && !current && !b.templatesError.value" :class="WARN">
      {{ t(`Set to "${config.template_name}" (${config.template_language || 'es'}), which is not in the approved list any more.`, `Configurada con «${config.template_name}» (${config.template_language || 'es'}), que ya no está entre las aprobadas.`) }}
    </p>

    <div v-if="current?.bodyText" class="flex flex-col gap-1.5">
      <span :class="SECTION">{{ t('Preview', 'Vista previa') }}</span>
      <!-- eslint-disable-next-line vue/no-v-html -- escaped above; only <strong> is added -->
      <div class="whitespace-pre-line rounded-card rounded-tl-[3px] border border-success-border bg-success-bg px-3 py-2.5 text-[13px] leading-relaxed text-ink-900" data-test="template-preview" v-html="preview" />
    </div>

    <!-- Only when the template declares a header that needs filling: Meta
    rejects the whole send if a required header is missing. -->
    <div v-if="headerFormat === 'LOCATION'" class="flex flex-col gap-2 rounded-ctl border border-line bg-surface-subtle p-3" data-test="header-location">
      <span class="text-[12px] font-semibold text-ink-700">{{ t('Location shown at the top of the message', 'Ubicación al principio del mensaje') }}</span>
      <div class="grid grid-cols-2 gap-2">
        <input :class="FIELD" inputmode="decimal" :value="header.latitude ?? ''" :placeholder="t('Latitude', 'Latitud')" @input="setLocation({ latitude: ($event.target as HTMLInputElement).value })" />
        <input :class="FIELD" inputmode="decimal" :value="header.longitude ?? ''" :placeholder="t('Longitude', 'Longitud')" @input="setLocation({ longitude: ($event.target as HTMLInputElement).value })" />
      </div>
      <input :class="FIELD" :value="header.name ?? ''" :placeholder="t('Place name', 'Nombre del sitio')" @input="setLocation({ name: ($event.target as HTMLInputElement).value })" />
      <input :class="FIELD" :value="header.address ?? ''" :placeholder="t('Street address', 'Dirección')" @input="setLocation({ address: ($event.target as HTMLInputElement).value })" />
    </div>
    <div v-else-if="headerFormat" class="flex flex-col gap-1.5 rounded-ctl border border-line bg-surface-subtle p-3" data-test="header-media">
      <span class="text-[12px] font-semibold text-ink-700">{{ t('File shown at the top of the message', 'Archivo al principio del mensaje') }} ({{ headerFormat.toLowerCase() }})</span>
      <span v-if="header.filename" class="text-[12px] text-ink-700" data-test="header-media-name">{{ header.filename }}</span>
      <input type="file" class="block w-full text-[12px] text-ink-muted file:mr-2 file:rounded-ctl file:border-0 file:bg-chip-bg file:px-2.5 file:py-1.5 file:text-[12px] file:text-ink-700" :disabled="uploading" data-test="header-media-input" @change="upload" />
      <span v-if="uploading" :class="HINT">{{ t('Uploading…', 'Subiendo…') }}</span>
      <span v-if="uploadError" class="text-[12px] text-danger-text">{{ uploadError }}</span>
      <span :class="HINT">{{ t('Stored privately and attached at send time.', 'Se guarda de forma privada y se adjunta al enviar.') }}</span>
    </div>

    <div v-if="variableRows.length > 0 || !current" class="flex flex-col gap-2">
      <span :class="SECTION">{{ t('Variables', 'Variables') }}</span>
      <div v-for="(v, i) in variableRows" :key="i" class="flex items-center gap-2" :data-test="`variable-${i + 1}`">
        <span class="w-10 shrink-0 font-mono text-[12px] text-ink-muted" v-text="slotLabel(i)" />
        <select :class="FIELD" :value="v.source" :aria-label="t(`Variable ${i + 1}`, `Variable ${i + 1}`)" @change="setVariable(i, { source: ($event.target as HTMLSelectElement).value })">
          <option value="" disabled>{{ t('Choose…', 'Elige…') }}</option>
          <option v-for="s in VARIABLE_SOURCES" :key="s.value" :value="s.value">{{ say(t, s.label) }}</option>
        </select>
        <input v-if="v.source === 'text'" :class="FIELD" :value="v.text ?? ''" :placeholder="t('Fixed value', 'Valor fijo')" @input="setVariable(i, { text: ($event.target as HTMLInputElement).value })" />
        <button v-if="!current" type="button" :class="REMOVE_BTN" :aria-label="t('Remove variable', 'Quitar variable')" @click="removeVariable(i)">✕</button>
      </div>
      <!-- An empty slot is not left empty: the sender fills it with the first
      name so Meta does not refuse the message (runAutomationActions.ts). Say
      so, or "por lo de" + slot 2 quietly goes out as "por lo de Martín". -->
      <p v-for="n in unassignedSlots" :key="`unassigned-${n}`" class="rounded-ctl border border-warning-border bg-warning-bg px-3 py-2 text-[12.5px] leading-snug text-warning-text" :data-test="`variable-${n}-unassigned`">
        {{ unassignedWarning(n) }}
      </p>
      <button v-if="!current" type="button" :class="LINK_BTN" @click="addVariable">+ {{ t('Add variable', 'Añadir variable') }}</button>
      <p :class="HINT">{{ t("Filled in from each patient's details or their appointment.", 'Se rellenan con los datos de cada paciente o de su cita.') }}</p>
    </div>

    <div class="flex flex-col gap-2">
      <span :class="SECTION">{{ bodyDocSlot ? t('Document', 'Documento') : t('Buttons', 'Botones') }}</span>
      <div v-for="i in slotCount" :key="i" class="flex flex-col gap-1.5" :data-test="`button-slot-${i - 1}`">
        <label v-if="!bodyDocSlot" :class="LABEL">
          {{ t(`Button "${dynamicButtons[i - 1]?.text || i}"`, `Botón «${dynamicButtons[i - 1]?.text || i}»`) }}
          <select :class="FIELD" :value="slotSource(i - 1)" @change="setSlot(i - 1, ($event.target as HTMLSelectElement).value)">
            <option v-for="s in BUTTON_PARAM_SOURCES" :key="s.value" :value="s.value">{{ say(t, s.label) }}</option>
          </select>
        </label>
        <select
          v-if="bodyDocSlot || slotSource(i - 1) === 'doc'"
          :class="FIELD"
          :value="docIds[i - 1] ?? ''"
          :aria-label="t('Document', 'Documento')"
          data-test="doc-select"
          @change="setSlotDoc(i - 1, ($event.target as HTMLSelectElement).value)"
        >
          <option value="">{{ t('No document', 'Sin documento') }}</option>
          <option v-for="d in b.docTemplates.value" :key="d.id" :value="d.id">{{ d.title }}</option>
        </select>
        <input v-if="!bodyDocSlot && slotSource(i - 1) === 'text'" :class="FIELD" :value="params[i - 1]?.text ?? ''" :placeholder="t('What goes at the end of the link', 'Lo que va al final del enlace')" @input="setSlotText(i - 1, ($event.target as HTMLInputElement).value)" />
      </div>
      <p v-if="bodyDocSlot" :class="HINT">{{ t('Sent as the last variable, after the ones above.', 'Se envía como la última variable, después de las de arriba.') }}</p>
    </div>

    <p v-if="b.draft.value.rule.is_marketing" :class="NOTE">
      {{ t('This automation is marked as marketing: only patients who accepted marketing WhatsApp receive it. The rest carry on without being sent anything.', 'Esta automatización es comercial: solo la reciben los pacientes que aceptaron WhatsApp comercial. Los demás siguen sin que se les envíe nada.') }}
    </p>
    <p v-else-if="isMarketingTemplate" :class="WARN">
      {{ t('Meta classes this template as marketing. If the message is promotional, mark the automation as marketing in Settings so only patients who accepted it receive it.', 'Meta clasifica esta plantilla como marketing. Si el mensaje es promocional, marca la automatización como comercial en Ajustes para que solo la reciban quienes lo aceptaron.') }}
    </p>
  </div>
</template>
