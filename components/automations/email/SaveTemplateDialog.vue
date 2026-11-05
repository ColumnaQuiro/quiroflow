<script setup lang="ts">
import { FIELD, LABEL } from '~/utils/automationUi'
import type { EmailTemplate } from '~/composables/useEmailTemplates'

// "Save as template": a name for it, or one of the clinic's templates to
// overwrite. Saved straight away -- a template is the clinic's, not part of
// this automation's draft.

const props = defineProps<{ suggestedName: string; templates: EmailTemplate[]; busy: boolean; error: string }>()
const emit = defineEmits<{ save: [name: string, replaceId: string | null]; cancel: [] }>()
const t = useT()

const name = ref(props.suggestedName)
const replaceId = ref<string>('')
watch(replaceId, (id) => {
  const tpl = props.templates.find((x) => x.id === id)
  if (tpl) name.value = tpl.name
})
</script>

<template>
  <UiConfirmDialog
    :title="t('Save as template', 'Guardar como plantilla')"
    :confirm-label="replaceId ? t('Replace template', 'Sustituir plantilla') : t('Save template', 'Guardar plantilla')"
    :cancel-label="t('Cancel', 'Cancelar')"
    :busy="busy"
    :disabled="!name.trim()"
    @confirm="emit('save', name, replaceId || null)"
    @cancel="emit('cancel')"
  >
    <p class="text-[14px] leading-relaxed text-ink-500">{{ t("Its blocks, branding and subject, for anyone at the clinic to start an email from.", 'Sus bloques, su marca y su asunto, para que cualquiera de la clínica empiece un email con ella.') }}</p>
    <label :class="LABEL">
      {{ t('Name', 'Nombre') }}
      <input v-model="name" :class="FIELD" maxlength="120" data-test="email-template-name" />
    </label>
    <label v-if="templates.length" :class="LABEL">
      {{ t('Or replace', 'O sustituir') }}
      <select v-model="replaceId" :class="FIELD" data-test="email-template-replace">
        <option value="">{{ t('Nothing, a new template', 'Nada, una plantilla nueva') }}</option>
        <option v-for="tpl in templates" :key="tpl.id" :value="tpl.id">{{ tpl.name }}</option>
      </select>
    </label>
    <p v-if="error" class="text-[13px] text-danger-text" role="alert">{{ error }}</p>
  </UiConfirmDialog>
</template>
