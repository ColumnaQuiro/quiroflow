<script setup lang="ts">
import { FIELD, HINT, LABEL } from '~/utils/automationUi'

// Tell someone on the team: a whole role, one person, or the practitioner of
// the appointment the run is about -- a notification on their devices and,
// unless switched off, a task in their My Day with the patient linked. A role
// gets ONE shared task anyone in it can tick; a person gets their own.
//
// config: { to: { team_member_id? | role_id? | practitioner_of_appointment? },
//           title, create_task (anything but false is on), due_in_minutes? }

const props = defineProps<{ stepId: string }>()
const b = useBuilder()
const t = useT()
const config = computed(() => b.stepsById.value.get(props.stepId)!.config)
const set = (patch: Record<string, any>) => b.updateStepConfig(props.stepId, patch)

const to = computed(() => (config.value.to ?? {}) as { team_member_id?: string; role_id?: string; practitioner_of_appointment?: boolean })
const who = computed(() => (to.value.role_id ? `role:${to.value.role_id}` : to.value.team_member_id ? `member:${to.value.team_member_id}` : to.value.practitioner_of_appointment ? 'practitioner' : ''))
function setWho(value: string) {
  if (value === 'practitioner') set({ to: { practitioner_of_appointment: true } })
  else if (value.startsWith('role:')) set({ to: { role_id: value.slice(5) } })
  else if (value.startsWith('member:')) set({ to: { team_member_id: value.slice(7) } })
  else set({ to: {} })
}
const createsTask = computed(() => config.value.create_task !== false)
const hasDue = computed(() => Number(config.value.due_in_minutes) > 0)
function setDue(on: boolean) {
  set({ due_in_minutes: on ? 1440 : undefined })
}
</script>

<template>
  <div class="flex flex-col gap-4">
    <label :class="LABEL">
      {{ t('Who', 'A quién') }}
      <select :class="FIELD" :value="who" data-test="notify-who" @change="setWho(($event.target as HTMLSelectElement).value)">
        <option value="" disabled>{{ t('Choose…', 'Elige…') }}</option>
        <option value="practitioner">{{ t("The appointment's practitioner", 'El profesional de la cita') }}</option>
        <optgroup :label="t('A whole role', 'Todo un rol')">
          <option v-for="r in b.lookup.value.roles" :key="r.id" :value="`role:${r.id}`">{{ t(`Everyone in ${r.name} (role)`, `Todo ${r.name} (rol)`) }}</option>
        </optgroup>
        <optgroup :label="t('One person', 'Una persona')">
          <option v-for="m in b.lookup.value.members" :key="m.id" :value="`member:${m.id}`">{{ m.full_name }}</option>
        </optgroup>
      </select>
    </label>
    <p :class="HINT">{{ t('A role gets one shared task that anyone in it can tick; a person gets their own.', 'Un rol recibe una tarea compartida que cualquiera puede marcar; una persona, la suya.') }}</p>

    <label :class="LABEL">
      {{ t('Task', 'Tarea') }}
      <input :class="FIELD" :value="config.title ?? ''" :placeholder="t('Call {{first_name}} about their check-up', 'Llamar a {{first_name}} para su revisión')" data-test="notify-title" @input="set({ title: ($event.target as HTMLInputElement).value })" />
      <span :class="HINT" v-text="t('{{first_name}} and {{last_name}} are filled in with the patient\'s name.', '{{first_name}} y {{last_name}} se rellenan con el nombre del paciente.')" />
    </label>

    <label class="flex items-center gap-2 text-[13px] text-ink-700 touch:min-h-11">
      <input type="checkbox" class="h-4 w-4 accent-brand" :checked="createsTask" data-test="notify-task" @change="set({ create_task: ($event.target as HTMLInputElement).checked })" />
      {{ t('Also create a task in their My Day', 'También crear una tarea en su Mi día') }}
    </label>
    <template v-if="createsTask">
      <label class="flex items-center gap-2 text-[13px] text-ink-700 touch:min-h-11">
        <input type="checkbox" class="h-4 w-4 accent-brand" :checked="hasDue" data-test="notify-due-toggle" @change="setDue(($event.target as HTMLInputElement).checked)" />
        {{ t('Due in…', 'Para dentro de…') }}
      </label>
      <AutomationsDurationInput v-if="hasDue" :model-value="Number(config.due_in_minutes)" :label="t('Due in', 'Para dentro de')" test-id="notify-due" @update:model-value="set({ due_in_minutes: $event })" />
    </template>
    <p :class="HINT">{{ t("It appears in their My Day with the patient linked, and arrives as a notification on their phone.", 'Aparece en su Mi día con el paciente enlazado, y llega como aviso al móvil.') }}</p>
  </div>
</template>
