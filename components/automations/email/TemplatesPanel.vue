<script setup lang="ts">
import { EMAIL_STARTERS } from '~/utils/emailStarters'
import { blockId, emailDesignHasContent, type EmailDesign } from '~/utils/emailDesign'
import { HINT } from '~/utils/automationUi'
import type { EmailTemplate } from '~/composables/useEmailTemplates'

// The email editor's Templates tab: the clinic's saved templates, then
// QuiroFlow's. Picking one copies it into this email -- new block ids, so the
// two never share anything -- after asking, if the email already has words
// in it that would be lost.

const props = defineProps<{ current: EmailDesign; templates: EmailTemplate[]; loaded: boolean; loadError: string; canManage: boolean }>()
const emit = defineEmits<{ apply: [design: EmailDesign, subject: string]; remove: [id: string] }>()
const t = useT()

const pending = ref<{ key: string; name: string; design: EmailDesign; subject: string } | null>(null)
const removing = ref<string | null>(null)

function choose(key: string, name: string, design: EmailDesign, subject: string) {
  const copy: EmailDesign = JSON.parse(JSON.stringify(design))
  copy.blocks = copy.blocks.map((b) => ({ ...b, id: blockId() }))
  if (emailDesignHasContent(props.current) && pending.value?.key !== key) {
    pending.value = { key, name, design: copy, subject }
    return
  }
  pending.value = null
  emit('apply', copy, subject)
}
const confirm = () => {
  if (pending.value) emit('apply', pending.value.design, pending.value.subject)
  pending.value = null
}
const ROW = 'flex w-full items-start gap-2.5 rounded-ctlSm px-2 py-2 text-left hover:bg-surface-subtle touch:min-h-11'
</script>

<template>
  <div class="flex flex-col gap-2" data-test="email-templates">
    <div v-if="pending" class="flex flex-col gap-2 rounded-ctl border border-warning-border bg-warning-bg p-2.5 text-[12.5px] text-warning-text" role="alertdialog" data-test="email-template-confirm">
      {{ t(`Replace this email with "${pending.name}"? What it says now is lost.`, `¿Cambiar este email por «${pending.name}»? Lo que dice ahora se pierde.`) }}
      <span class="flex gap-2">
        <UiBtn size="sm" variant="primary" data-test="email-template-confirm-yes" @click="confirm">{{ t('Replace', 'Cambiar') }}</UiBtn>
        <UiBtn size="sm" @click="pending = null">{{ t('Keep mine', 'Dejar el mío') }}</UiBtn>
      </span>
    </div>

    <p class="text-[11px] font-bold uppercase tracking-[.06em] text-ink-faint">{{ t("The clinic's", 'De la clínica') }}</p>
    <p v-if="loadError" class="text-[12px] text-danger-text">{{ loadError }}</p>
    <p v-else-if="loaded && !templates.length" :class="HINT">{{ t('None yet. "Save as template" keeps this email to start others from.', 'Aún ninguna. «Guardar como plantilla» guarda este email para empezar otros.') }}</p>
    <ul class="flex flex-col">
      <li v-for="tpl in templates" :key="tpl.id" class="group flex items-center gap-1">
        <button type="button" :class="ROW" :data-test="`email-template-${tpl.id}`" @click="choose(tpl.id, tpl.name, tpl.design, tpl.subject)">
          <span class="min-w-0 flex-1">
            <span class="block truncate text-[13px] font-semibold text-ink-900">{{ tpl.name }}</span>
            <span class="block truncate text-[12px] text-ink-muted">{{ tpl.subject || t('No subject', 'Sin asunto') }}</span>
          </span>
        </button>
        <template v-if="canManage">
          <UiBtn v-if="removing === tpl.id" size="sm" class="!text-danger-text" data-test="email-template-remove-yes" @click="emit('remove', tpl.id); removing = null">{{ t('Delete', 'Borrar') }}</UiBtn>
          <UiIconBtn v-else icon="trash" tone="danger" :label="t(`Delete template ${tpl.name}`, `Borrar la plantilla ${tpl.name}`)" data-test="email-template-remove" @click="removing = tpl.id" />
        </template>
      </li>
    </ul>

    <p class="mt-3 text-[11px] font-bold uppercase tracking-[.06em] text-ink-faint">QuiroFlow</p>
    <ul class="flex flex-col">
      <li v-for="s in EMAIL_STARTERS" :key="s.key">
        <button type="button" :class="ROW" :data-test="`email-starter-${s.key}`" @click="choose(s.key, t(s.name[0], s.name[1]), s.design(), s.subject)">
          <span class="min-w-0 flex-1">
            <span class="block text-[13px] font-semibold text-ink-900">{{ t(s.name[0], s.name[1]) }}</span>
            <span class="block text-[12px] leading-snug text-ink-muted">{{ t(s.description[0], s.description[1]) }}</span>
          </span>
        </button>
      </li>
    </ul>
    <p :class="HINT">{{ t('A template is copied into the email. Changing the template later does not change emails already written with it.', 'La plantilla se copia en el email. Cambiarla después no cambia los emails ya escritos con ella.') }}</p>
  </div>
</template>
