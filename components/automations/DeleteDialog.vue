<script setup lang="ts">
import { serverMessage } from '~/utils/serverMessage'

// Deleting an automation, saying first how many people are inside -- they
// leave now and receive nothing more. The name has to be typed.

const props = defineProps<{ ruleId: string; name: string; inside: number }>()
const emit = defineEmits<{ deleted: []; cancel: [] }>()
const t = useT()
const busy = ref(false)
const error = ref('')

async function remove() {
  busy.value = true
  error.value = ''
  try {
    await useStaffFetch(`/api/automations/${props.ruleId}`, { method: 'DELETE', query: { expectedInside: props.inside } })
    emit('deleted')
  } catch (e) {
    error.value = serverMessage(e) ?? t('Could not delete it.', 'No se ha podido eliminar.')
  } finally {
    busy.value = false
  }
}
</script>

<template>
  <UiConfirmDialog
    tone="danger"
    :title="t(`Delete “${name}”`, `Eliminar «${name}»`)"
    :confirm-label="t('Delete', 'Eliminar')"
    :cancel-label="t('Cancel', 'Cancelar')"
    :confirm-word="name"
    :busy="busy"
    @confirm="remove"
    @cancel="emit('cancel')"
  >
    <p class="text-[14px] leading-relaxed text-ink-500" data-test="delete-inside">
      <template v-if="inside > 0">
        {{ t('There', 'Hay') }} <strong>{{ t(`${inside === 1 ? 'is 1 person' : `are ${inside} people`} inside`, `${inside} ${inside === 1 ? 'persona' : 'personas'} dentro`) }}</strong>.
        {{ t('They leave now and receive nothing more.', 'Salen ahora y no reciben nada más.') }}
      </template>
      {{ t('What was already sent stays in the Inbox and on their record.', 'Lo ya enviado queda en la Bandeja y en su ficha.') }}
    </p>
    <p v-if="error" class="text-[13px] text-danger-text">{{ error }}</p>
  </UiConfirmDialog>
</template>
