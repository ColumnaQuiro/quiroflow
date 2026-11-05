<script setup lang="ts">
import { FIELD, HINT, LABEL, NOTE, SEGMENT_WRAP, segmentBtn } from '~/utils/automationUi'
import { automationEmailHtml, emptyBodyPlaceholderHtml, DEFAULT_BOOKING_BUTTON_TEXT } from '~/utils/automationEmail'
import { asEmailDesign, emailDesignHtml, legacyEmailDesign, type EmailTheme } from '~/utils/emailDesign'

// An email step, in the drawer beside the canvas.
//
// An email built from blocks (config.design) shows its subject, preview text
// and a thumbnail here, and is edited full screen (AutomationsEmailBuilder).
//
// An email written before the block editor existed keeps its plain editor
// and renders exactly as it always has -- subject and body, with the logo
// and booking-button switches -- until someone chooses "Switch to blocks",
// which carries the body over into a text block. Nothing converts on its own:
// some of these are recalls already sending.

const props = defineProps<{ stepId: string }>()
const b = useBuilder()
const t = useT()
const supabase = useSupabaseClient()
const store = useAccountStore()
const config = computed(() => b.stepsById.value.get(props.stepId)!.config)
const set = (patch: Record<string, any>) => b.updateStepConfig(props.stepId, patch)
const { fields, fillHtml, fillText, clinicName, logoUrl, bookingUrl } = useMergeSamples()

const design = computed(() => asEmailDesign(config.value.design))
const editing = ref(false)
onMounted(() => {
  // Straight into the editor for a step just added from the "+" -- once:
  // coming back to it after Done shows the drawer.
  if (design.value && !b.savedStep(props.stepId) && !openedOnce.has(props.stepId)) {
    openedOnce.add(props.stepId)
    editing.value = true
  }
})
function switchToBlocks() {
  set({ design: legacyEmailDesign(config.value) })
  editing.value = true
}

const clinicBranding = ref<Partial<EmailTheme> | null>(null)
onMounted(async () => {
  const { data } = await supabase.from('accounts').select('email_branding').eq('id', store.accountId!).maybeSingle()
  clinicBranding.value = (data?.email_branding as Partial<EmailTheme> | null) ?? null
})

const previewSubject = computed(() => fillText(config.value.subject ?? ''))
const unsubscribe = computed(() => (b.draft.value.rule.is_marketing ? { page: '#', oneClick: '#' } : null))
const previewHtml = computed(() => {
  if (design.value) {
    return fillHtml(emailDesignHtml(design.value, { clinicName: clinicName.value, logoUrl: logoUrl.value, branding: clinicBranding.value, unsubscribe: unsubscribe.value }))
  }
  const html = automationEmailHtml(fillHtml(config.value.body ?? '') || emptyBodyPlaceholderHtml(t('Your message appears here.', 'Aquí aparece tu mensaje.')), {
    clinicName: clinicName.value,
    // A marketing email carries the unsubscribe footer; shown so it is no surprise.
    unsubscribe: unsubscribe.value,
    logoUrl: config.value.include_logo ? logoUrl.value : null,
    button: config.value.booking_button && bookingUrl.value ? { text: config.value.booking_button_text ?? '', url: bookingUrl.value } : null,
  })
  return `<!doctype html><html><head><meta charset="utf-8"><base target="_blank"></head><body style="margin:0">${html}</body></html>`
})

// The preview at a phone's width as well, since most patients read it there.
const device = ref<'desktop' | 'mobile'>('desktop')
</script>

<script lang="ts">
// Which new steps have already been opened in the editor, for every instance
// of this panel: the drawer remounts it each time the step is selected.
const openedOnce = new Set<string>()
</script>

<template>
  <div class="flex flex-col gap-4">
    <label :class="LABEL">
      {{ t('Subject', 'Asunto') }}
      <AutomationsMergeFieldInput
        :model-value="config.subject ?? ''"
        :variables="fields"
        :placeholder="t('What the patient sees in their inbox', 'Lo que el paciente ve en su bandeja')"
        test-id="email-subject"
        @update:model-value="set({ subject: $event })"
      />
    </label>

    <!-- Built from blocks -->
    <template v-if="design">
      <label :class="LABEL">
        {{ t('Preview text', 'Texto de vista previa') }}
        <AutomationsMergeFieldInput
          :model-value="design.preheader ?? ''"
          :variables="fields"
          :placeholder="t('Shown after the subject in the inbox', 'Se ve tras el asunto en la bandeja')"
          test-id="email-preheader"
          @update:model-value="set({ design: { ...design, preheader: $event } })"
        />
      </label>
      <div class="grid items-start gap-4 sm:grid-cols-[200px_minmax(0,1fr)]">
        <button type="button" class="group relative h-[240px] overflow-hidden rounded-ctl border border-line bg-surface-subtle text-left" :aria-label="t('Edit email', 'Editar email')" data-test="email-thumbnail" @click="editing = true">
          <!-- 600px of email shown at a third of its size. -->
          <iframe :srcdoc="previewHtml" sandbox="" tabindex="-1" aria-hidden="true" class="pointer-events-none absolute left-0 top-0 h-[720px] w-[600px] origin-top-left scale-[.3333] border-0" />
        </button>
        <div class="flex flex-col gap-3">
          <UiBtn variant="primary" class="self-start" data-test="email-edit" @click="editing = true">{{ t('Edit email', 'Editar email') }}</UiBtn>
          <p :class="HINT">{{ t('Opens the email editor: blocks, branding, and a preview on a computer and a phone.', 'Abre el editor del email: bloques, marca y vista previa en ordenador y móvil.') }}</p>
          <UiPill tone="neutral" class="self-start">{{ t(`${design.blocks.length} block${design.blocks.length === 1 ? '' : 's'}`, `${design.blocks.length} bloque${design.blocks.length === 1 ? '' : 's'}`) }}</UiPill>
        </div>
      </div>
      <AutomationsEmailBuilder v-if="editing" :step-id="stepId" @close="editing = false" />
    </template>

    <!-- Written in the plain editor -->
    <template v-else>
      <div :class="LABEL">
        {{ t('Message', 'Mensaje') }}
        <AutomationsRichTextEditor :key="stepId" :model-value="config.body ?? ''" :variables="fields" @update:model-value="set({ body: $event })" />
      </div>

      <div class="grid gap-2.5 sm:grid-cols-2" data-test="email-blocks">
        <label class="flex items-start justify-between gap-3 rounded-ctl border border-line px-3 py-2.5 text-[13px] text-ink-700">
          <span>{{ t("Clinic logo on top", 'Logo de la clínica arriba') }}<span v-if="!logoUrl" class="block text-[12px] text-ink-muted">{{ t('Upload one in Settings > Clinics.', 'Súbelo en Ajustes > Clínicas.') }}</span></span>
          <input type="checkbox" class="mt-0.5" :checked="!!config.include_logo" :disabled="!logoUrl" data-test="email-include-logo" @change="set({ include_logo: ($event.target as HTMLInputElement).checked })" />
        </label>
        <div class="flex flex-col gap-2 rounded-ctl border border-line px-3 py-2.5">
          <label class="flex items-center justify-between gap-3 text-[13px] text-ink-700">
            <span>{{ t('Button to book online', 'Botón para reservar online') }}</span>
            <input type="checkbox" :checked="!!config.booking_button" data-test="email-booking-button" @change="set({ booking_button: ($event.target as HTMLInputElement).checked })" />
          </label>
          <input v-if="config.booking_button" :class="FIELD" :value="config.booking_button_text ?? ''" :placeholder="DEFAULT_BOOKING_BUTTON_TEXT" :aria-label="t('Button text', 'Texto del botón')" data-test="email-booking-button-text" @input="set({ booking_button_text: ($event.target as HTMLInputElement).value })" />
        </div>
      </div>

      <div class="flex flex-wrap items-center justify-between gap-3 rounded-ctl border border-brand-tintBorder bg-brand-tint px-3 py-2.5" data-test="email-switch">
        <span class="min-w-0 flex-1 text-[12.5px] leading-snug text-brand-text">{{ t('Build it from blocks instead: images, columns, buttons and the clinic\'s colours. Your message comes along as it is.', 'Constrúyelo con bloques: imágenes, columnas, botones y los colores de la clínica. Tu mensaje pasa tal cual.') }}</span>
        <UiBtn size="sm" data-test="email-switch-blocks" @click="switchToBlocks">{{ t('Switch to blocks', 'Pasar a bloques') }}</UiBtn>
      </div>
    </template>

    <div :class="LABEL">
      <span class="flex items-center justify-between gap-3">
        {{ t('Preview', 'Vista previa') }}
        <span :class="SEGMENT_WRAP" role="group" :aria-label="t('Preview size', 'Tamaño de la vista previa')">
          <button type="button" :class="segmentBtn(device === 'desktop')" :aria-pressed="device === 'desktop'" data-test="email-preview-desktop" @click="device = 'desktop'">{{ t('Desktop', 'Escritorio') }}</button>
          <button type="button" :class="segmentBtn(device === 'mobile')" :aria-pressed="device === 'mobile'" data-test="email-preview-mobile" @click="device = 'mobile'">{{ t('Mobile', 'Móvil') }}</button>
        </span>
      </span>
      <div class="overflow-hidden rounded-ctl border border-line bg-surface-subtle" data-test="email-preview">
        <div class="space-y-0.5 border-b border-line bg-surface px-3 py-2 text-[12px] font-normal text-ink-700">
          <p><span class="text-ink-muted">{{ t('From', 'De') }}:</span> {{ clinicName }}</p>
          <p class="truncate"><span class="text-ink-muted">{{ t('Subject', 'Asunto') }}:</span> <span data-test="email-preview-subject">{{ previewSubject || '—' }}</span></p>
        </div>
        <div class="flex justify-center" :class="device === 'mobile' ? 'py-4' : ''">
          <iframe
            :srcdoc="previewHtml"
            sandbox="allow-popups"
            class="block bg-surface-subtle"
            :class="device === 'mobile' ? 'h-[560px] w-[375px] max-w-full rounded-[18px] border border-line-control' : 'h-[460px] w-full'"
            :title="t('Email preview', 'Vista previa del email')"
          />
        </div>
      </div>
      <p :class="HINT">{{ t('Filled in with an example patient; each patient gets their own details.', 'Rellenada con un paciente de ejemplo; cada paciente recibe sus propios datos.') }}</p>
    </div>
    <p v-if="b.draft.value.rule.is_marketing" :class="NOTE">{{ t('This automation is marketing: only patients who accepted marketing email receive it.', 'Esta automatización es comercial: solo la reciben los pacientes que aceptaron email comercial.') }}</p>
  </div>
</template>
