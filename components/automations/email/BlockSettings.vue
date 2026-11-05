<script setup lang="ts">
import { EMAIL_LINK_KINDS, type EmailBlock, type EmailLink } from '~/utils/emailDesign'
import { FIELD, HINT, LABEL, NOTE, SEGMENT_WRAP, segmentBtn } from '~/utils/automationUi'
import type { PickerVariable } from '../VariablePicker.vue'

// The settings of the block selected on the email canvas, on the editor's
// right. Every change goes straight into the step's draft, so the canvas and
// the page's one Save both see it.

const props = defineProps<{ block: EmailBlock; variables: PickerVariable[]; hasLogo: boolean; marketing: boolean }>()
const emit = defineEmits<{ update: [patch: Partial<EmailBlock>] }>()
const t = useT()
const set = (patch: Record<string, unknown>) => emit('update', patch as Partial<EmailBlock>)

const { upload, uploading, error: uploadError } = useCampaignImageUpload()
const fileInput = ref<HTMLInputElement | null>(null)
const uploadTarget = ref<'image' | 0 | 1>('image')
function pickFile(target: 'image' | 0 | 1) {
  uploadTarget.value = target
  fileInput.value?.click()
}
async function onFile(e: Event) {
  const file = (e.target as HTMLInputElement).files?.[0]
  if (fileInput.value) fileInput.value.value = ''
  if (!file) return
  const url = await upload(file)
  if (!url) return
  if (uploadTarget.value === 'image') set({ src: url, alt: (props.block as { alt?: string }).alt || file.name.replace(/\.[^.]+$/, '') })
  else setColumn(uploadTarget.value, { image: { src: url, alt: '' } })
}

function setColumn(i: 0 | 1, patch: Record<string, unknown>) {
  if (props.block.type !== 'columns') return
  const columns = props.block.columns.map((c, j) => (j === i ? { ...c, ...patch } : c)) as typeof props.block.columns
  set({ columns })
}

function linkKind(link: EmailLink | null): string {
  return link?.kind ?? ''
}
function setLink(kind: string, current: EmailLink | null, allowNone: boolean) {
  if (!kind && allowNone) return set({ link: null })
  set({ link: kind === 'url' ? { kind: 'url', url: current?.kind === 'url' ? current.url : '' } : { kind } })
}

const TITLES: Record<EmailBlock['type'], readonly [string, string]> = {
  header: ['Header', 'Cabecera'],
  heading: ['Heading', 'Título'],
  text: ['Text', 'Texto'],
  image: ['Image', 'Imagen'],
  button: ['Button', 'Botón'],
  columns: ['Two columns', 'Dos columnas'],
  divider: ['Divider', 'Separador'],
  spacer: ['Space', 'Espacio'],
  footer: ['Footer', 'Pie'],
}
const title = computed(() => t(...TITLES[props.block.type]))
</script>

<template>
  <div class="flex flex-col gap-4" data-test="block-settings">
    <strong class="text-[14px] font-semibold text-ink-900">{{ title }}</strong>
    <input ref="fileInput" type="file" accept="image/*" class="hidden" @change="onFile" />

    <template v-if="block.type === 'header'">
      <p :class="HINT">{{ hasLogo ? t("The clinic's logo, from Settings > Clinics.", 'El logo de la clínica, de Ajustes > Clínicas.') : t("No logo yet, so the clinic's name is shown. Upload one in Settings > Clinics.", 'Aún no hay logo, así que se muestra el nombre de la clínica. Súbelo en Ajustes > Clínicas.') }}</p>
      <div :class="LABEL">
        {{ t('Alignment', 'Alineación') }}
        <span :class="SEGMENT_WRAP">
          <button type="button" :class="segmentBtn(block.align === 'left')" @click="set({ align: 'left' })">{{ t('Left', 'Izquierda') }}</button>
          <button type="button" :class="segmentBtn(block.align === 'center')" @click="set({ align: 'center' })">{{ t('Centre', 'Centro') }}</button>
        </span>
      </div>
    </template>

    <template v-else-if="block.type === 'heading'">
      <label :class="LABEL">
        {{ t('Words', 'Texto') }}
        <AutomationsMergeFieldInput :model-value="block.text" :variables="variables" test-id="block-heading" @update:model-value="set({ text: $event })" />
      </label>
      <div :class="LABEL">
        {{ t('Alignment', 'Alineación') }}
        <span :class="SEGMENT_WRAP">
          <button type="button" :class="segmentBtn(block.align === 'left')" @click="set({ align: 'left' })">{{ t('Left', 'Izquierda') }}</button>
          <button type="button" :class="segmentBtn(block.align === 'center')" @click="set({ align: 'center' })">{{ t('Centre', 'Centro') }}</button>
        </span>
      </div>
    </template>

    <template v-else-if="block.type === 'text' || block.type === 'footer'">
      <AutomationsRichTextEditor :key="block.id" :model-value="block.html" :variables="variables" @update:model-value="set({ html: $event })" />
      <p v-if="block.type === 'footer' && marketing" :class="NOTE">{{ t('The unsubscribe line is added under the email on its own, because this automation is marketing.', 'La línea para darse de baja se añade sola bajo el email, porque esta automatización es comercial.') }}</p>
    </template>

    <template v-else-if="block.type === 'image'">
      <div v-if="block.src" class="overflow-hidden rounded-ctl border border-line bg-surface-subtle">
        <img :src="block.src" :alt="block.alt" class="block max-h-[160px] w-full object-contain" />
      </div>
      <div class="flex flex-wrap gap-2">
        <UiBtn :disabled="uploading" data-test="block-image-upload" @click="pickFile('image')">{{ uploading ? t('Uploading…', 'Subiendo…') : block.src ? t('Replace image', 'Cambiar imagen') : t('Upload an image', 'Subir una imagen') }}</UiBtn>
      </div>
      <p v-if="uploadError" class="text-[12px] text-danger-text">{{ uploadError }}</p>
      <label :class="LABEL">
        {{ t('Or its web address', 'O su dirección web') }}
        <input :class="FIELD" :value="block.src" placeholder="https://" data-test="block-image-url" @input="set({ src: ($event.target as HTMLInputElement).value })" />
      </label>
      <label :class="LABEL">
        {{ t('Description', 'Descripción') }}
        <input :class="FIELD" :value="block.alt" :placeholder="t('What the image shows, for screen readers and blocked images', 'Lo que muestra, para lectores de pantalla e imágenes bloqueadas')" @input="set({ alt: ($event.target as HTMLInputElement).value })" />
      </label>
      <label :class="LABEL">
        {{ t('Opens when tapped', 'Al pulsarla abre') }}
        <select :class="FIELD" :value="linkKind(block.link)" @change="setLink(($event.target as HTMLSelectElement).value, block.link, true)">
          <option value="">{{ t('Nothing', 'Nada') }}</option>
          <option v-for="k in EMAIL_LINK_KINDS" :key="k.value" :value="k.value">{{ t(k.label[0], k.label[1]) }}</option>
        </select>
      </label>
      <input v-if="block.link?.kind === 'url'" :class="FIELD" :value="block.link.url" placeholder="https://" @input="set({ link: { kind: 'url', url: ($event.target as HTMLInputElement).value } })" />
    </template>

    <template v-else-if="block.type === 'button'">
      <label :class="LABEL">
        {{ t('Words on the button', 'Texto del botón') }}
        <AutomationsMergeFieldInput :model-value="block.text" :variables="variables" test-id="block-button-text" @update:model-value="set({ text: $event })" />
      </label>
      <label :class="LABEL">
        {{ t('Opens', 'Abre') }}
        <select :class="FIELD" :value="block.link.kind" data-test="block-button-link" @change="setLink(($event.target as HTMLSelectElement).value, block.link, false)">
          <option v-for="k in EMAIL_LINK_KINDS" :key="k.value" :value="k.value">{{ t(k.label[0], k.label[1]) }}</option>
        </select>
      </label>
      <input v-if="block.link.kind === 'url'" :class="FIELD" :value="block.link.url" placeholder="https://" data-test="block-button-url" @input="set({ link: { kind: 'url', url: ($event.target as HTMLInputElement).value } })" />
      <p v-else :class="HINT">{{ t("Each patient's own link, filled in when the email goes out.", 'El enlace de cada paciente, que se rellena al enviar.') }}</p>
      <div :class="LABEL">
        {{ t('Width', 'Ancho') }}
        <span :class="SEGMENT_WRAP">
          <button type="button" :class="segmentBtn(block.align === 'left')" @click="set({ align: 'left' })">{{ t('Left', 'Izquierda') }}</button>
          <button type="button" :class="segmentBtn(block.align === 'center')" @click="set({ align: 'center' })">{{ t('Centre', 'Centro') }}</button>
          <button type="button" :class="segmentBtn(block.align === 'full')" @click="set({ align: 'full' })">{{ t('Full', 'Completo') }}</button>
        </span>
      </div>
    </template>

    <template v-else-if="block.type === 'columns'">
      <section v-for="i in ([0, 1] as const)" :key="i" class="flex flex-col gap-2.5 rounded-ctl border border-line p-3">
        <span class="text-[11px] font-bold uppercase tracking-[.06em] text-ink-faint">{{ i === 0 ? t('Left', 'Izquierda') : t('Right', 'Derecha') }}</span>
        <div class="flex flex-wrap items-center gap-2">
          <img v-if="block.columns[i].image?.src" :src="block.columns[i].image!.src" alt="" class="h-12 w-16 rounded-ctlSm border border-line object-cover" />
          <UiBtn size="sm" :disabled="uploading" @click="pickFile(i)">{{ block.columns[i].image?.src ? t('Replace image', 'Cambiar imagen') : t('Add an image', 'Añadir imagen') }}</UiBtn>
          <UiBtn v-if="block.columns[i].image?.src" size="sm" variant="ghost" @click="setColumn(i, { image: null })">{{ t('Remove image', 'Quitar imagen') }}</UiBtn>
        </div>
        <AutomationsRichTextEditor :key="`${block.id}-${i}`" :model-value="block.columns[i].html" :variables="variables" @update:model-value="setColumn(i, { html: $event })" />
      </section>
      <p v-if="uploadError" class="text-[12px] text-danger-text">{{ uploadError }}</p>
      <p :class="HINT">{{ t('Side by side on a computer, one under the other on a phone.', 'Una al lado de la otra en el ordenador, una debajo de otra en el móvil.') }}</p>
    </template>

    <template v-else-if="block.type === 'spacer'">
      <div :class="LABEL">
        {{ t('Height', 'Altura') }}
        <span :class="SEGMENT_WRAP">
          <button v-for="h in [12, 24, 40, 64]" :key="h" type="button" :class="segmentBtn(block.height === h)" @click="set({ height: h })"><span class="font-mono">{{ h }}</span></button>
        </span>
      </div>
    </template>

    <p v-else-if="block.type === 'divider'" :class="HINT">{{ t('A thin line between two parts of the email, in a shade of its text colour.', 'Una línea fina entre dos partes del email, en un tono de su color de texto.') }}</p>
  </div>
</template>
