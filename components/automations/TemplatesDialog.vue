<script setup lang="ts">
import { EMAIL_TEMPLATES, FLOW_TEMPLATES, instantiateTemplate, type AutomationTemplate } from '~/utils/automationTemplates'
import { say } from '~/utils/automationCatalog'
import { serverMessage } from '~/utils/serverMessage'

// "Start from a template": a card per automation. Choosing one creates it,
// PAUSED, with the clinic's name and address written in, and opens it in the
// builder -- these reach real patients, and one that started sending because
// someone wanted to see what the button did would be a bad way to find out.

const props = defineProps<{ existingNames: string[]; hasGrowth: boolean }>()
const emit = defineEmits<{ close: []; created: [id: string] }>()
const t = useT()
const { preference } = useLang()
const store = useAccountStore()

const creating = ref<string | null>(null)
const error = ref('')

// Matched on the name in the clinic's language, because a rule records no
// template of origin: renaming one lets it be added again, the forgiving way
// round.
const taken = computed(() => new Set(props.existingNames.map((n) => n.trim().toLowerCase())))
const isAdded = (tpl: AutomationTemplate) => taken.value.has(say(t, tpl.name).trim().toLowerCase())

async function create(tpl: AutomationTemplate) {
  if (creating.value || (tpl.growth && !props.hasGrowth)) return
  creating.value = tpl.key
  error.value = ''
  try {
    const clinic = store.clinics[0] ? { name: store.clinics[0].name, address: store.clinics[0].address } : null
    const { rule, steps } = instantiateTemplate(tpl, preference.value === 'es' ? 'es' : 'en', clinic)
    const res = await useStaffFetch<{ id: string }>('/api/automations', { method: 'POST', body: { rule, steps, enabled: false } })
    emit('created', res.id)
  } catch (e) {
    error.value = serverMessage(e) ?? t('Could not create it.', 'No se ha podido crear.')
  } finally {
    creating.value = null
  }
}
const panel = ref<HTMLElement | null>(null)
useFocusTrap(panel, () => emit('close'))
</script>

<template>
  <div class="fixed inset-0 z-50 flex items-end justify-center bg-ink-900/40 p-4 sm:items-center" @click.self="emit('close')">
    <div ref="panel" role="dialog" aria-modal="true" aria-labelledby="tpl-title" class="flex max-h-[90vh] w-full max-w-[920px] flex-col rounded-card border border-line bg-surface shadow-popover" data-test="templates-dialog">
      <div class="flex flex-col gap-1 px-6 pb-3 pt-6">
        <h2 id="tpl-title" class="text-[18px] font-bold text-ink-900">{{ t('Start from a template', 'Empezar desde una plantilla') }}</h2>
        <p class="text-[13.5px] text-ink-500">{{ t("Created paused, with your clinic's details. Change them before switching them on.", 'Se crean pausadas y con los datos de tu clínica. Las cambias antes de activarlas.') }}</p>
      </div>
      <div class="min-h-0 flex-1 overflow-y-auto px-6 pb-2">
        <div class="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          <button
            v-for="tpl in FLOW_TEMPLATES"
            :key="tpl.key"
            type="button"
            class="flex flex-col gap-1.5 rounded-card border border-line bg-surface p-4 text-left hover:border-brand-tintBorder hover:bg-brand-tint disabled:cursor-not-allowed disabled:opacity-60"
            :disabled="!!creating || (tpl.growth && !hasGrowth)"
            :data-test="`template-${tpl.key}`"
            @click="create(tpl)"
          >
            <span class="flex flex-wrap items-center gap-1.5">
              <strong class="text-[14px] text-ink-900">{{ say(t, tpl.name) }}</strong>
              <UiPill v-if="tpl.marketing" tone="warning">{{ t('Marketing', 'Marketing') }}</UiPill>
              <UiPill v-if="tpl.growth" tone="brand">Growth</UiPill>
              <UiPill v-if="isAdded(tpl)" tone="neutral">{{ t('already added', 'ya añadida') }}</UiPill>
            </span>
            <span class="text-[12.5px] leading-snug text-ink-500">{{ say(t, tpl.description) }}</span>
            <span class="mt-auto text-[11.5px] text-ink-muted">{{ creating === tpl.key ? t('Creating…', 'Creando…') : say(t, tpl.summary) }}</span>
          </button>
        </div>

        <h3 class="mt-5 text-[11px] font-bold uppercase tracking-[.06em] text-ink-faint">{{ t('Patient emails', 'Emails para pacientes') }}</h3>
        <p class="mt-1 text-[12.5px] text-ink-muted">{{ t('Written for a chiropractic clinic. None is narrowed to an appointment type -- add that yourself if you want one after a specific visit only.', 'Escritos para una clínica quiropráctica. Ninguno está limitado a un tipo de cita: añádelo tú si quieres que salga solo tras una visita concreta.') }}</p>
        <ul class="mt-2 grid gap-2 sm:grid-cols-2">
          <li v-for="tpl in EMAIL_TEMPLATES" :key="tpl.key">
            <button
              type="button"
              class="flex w-full flex-col gap-0.5 rounded-ctl border border-line-divider p-3 text-left hover:border-brand-tintBorder hover:bg-brand-tint disabled:opacity-60 touch:min-h-11"
              :disabled="!!creating"
              :data-test="`template-${tpl.key}`"
              @click="create(tpl)"
            >
              <span class="flex flex-wrap items-center gap-1.5 text-[13px] font-semibold text-ink-900">
                {{ say(t, tpl.name) }}
                <UiPill v-if="tpl.marketing" tone="warning">{{ t('marketing', 'marketing') }}</UiPill>
                <UiPill v-if="isAdded(tpl)" tone="neutral" data-test="template-added">{{ t('already added', 'ya añadida') }}</UiPill>
              </span>
              <span class="text-[12px] text-ink-muted">{{ creating === tpl.key ? t('Creating…', 'Creando…') : say(t, tpl.description) }}</span>
            </button>
          </li>
        </ul>
        <p v-if="error" class="mt-3 text-[13px] text-danger-text">{{ error }}</p>
      </div>
      <div class="flex flex-wrap justify-end gap-2 border-t border-line-divider px-6 py-4">
        <UiBtn @click="emit('close')">{{ t('Cancel', 'Cancelar') }}</UiBtn>
        <NuxtLink to="/automations/new" class="inline-flex h-9 items-center rounded-ctl bg-brand px-3.5 text-[13px] font-semibold text-surface hover:bg-brand-hover touch:h-11" data-test="template-blank">{{ t('Start blank', 'Empezar en blanco') }}</NuxtLink>
      </div>
    </div>
  </div>
</template>
