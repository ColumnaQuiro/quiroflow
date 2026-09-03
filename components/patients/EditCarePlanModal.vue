<script setup lang="ts">
interface CarePlan {
  id: string
  name: string
  frequency_value: number
  frequency_unit: 'week' | 'month'
  total_visits: number
  started_at: string
}

const props = defineProps<{ patientId: string; plan?: CarePlan | null }>()
const emit = defineEmits<{ close: []; saved: [] }>()

const supabase = useSupabaseClient()
const store = useAccountStore()
const t = useT()

const name = ref(props.plan?.name ?? t('Care Plan', 'Plan de tratamiento'))
const frequencyValue = ref(props.plan?.frequency_value ?? 1)
const frequencyUnit = ref<'week' | 'month'>(props.plan?.frequency_unit ?? 'week')
const totalVisits = ref(props.plan?.total_visits ?? 10)
const startedAt = ref(props.plan?.started_at ?? new Date().toISOString().slice(0, 10))
const saving = ref(false)
const error = ref('')

async function save() {
  error.value = ''
  saving.value = true
  // Inserts a new plan rather than updating the existing one in place, so
  // progress already made under the old cadence isn't silently reattributed
  // to the changed one -- "Edit Plan" starts a fresh phase.
  const { error: insertError } = await supabase.from('care_plans').insert({
    account_id: store.accountId!,
    patient_id: props.patientId,
    name: name.value.trim() || t('Care Plan', 'Plan de tratamiento'),
    frequency_value: frequencyValue.value,
    frequency_unit: frequencyUnit.value,
    total_visits: totalVisits.value,
    started_at: startedAt.value,
    created_by: store.teamMember?.id ?? null,
  })
  saving.value = false
  if (insertError) {
    error.value = insertError.message
    return
  }
  emit('saved')
}
</script>

<template>
  <div class="fixed inset-0 z-20 flex items-center justify-center bg-ink-900/40 p-4" @click.self="emit('close')">
    <div class="w-full max-w-sm rounded-lg bg-white p-6 shadow-xl">
      <div class="flex items-center justify-between">
        <h2 class="text-lg font-semibold text-gray-900">{{ plan ? t('Edit Plan', 'Editar plan') : t('New Care Plan', 'Nuevo plan de tratamiento') }}</h2>
        <button type="button" class="text-gray-400 hover:text-gray-600" @click="emit('close')">✕</button>
      </div>

      <form class="mt-4 space-y-4" @submit.prevent="save">
        <div>
          <label class="block text-sm font-medium text-gray-700">{{ t('Name', 'Nombre') }}</label>
          <input v-model="name" type="text" class="mt-1 w-full rounded-md border border-gray-300 px-3 py-2 text-sm focus:border-indigo-500 focus:outline-none focus:ring-1 focus:ring-indigo-500" />
        </div>
        <div class="flex items-end gap-3">
          <div>
            <label class="block text-sm font-medium text-gray-700">{{ t('Visits', 'Visitas') }}</label>
            <input v-model.number="frequencyValue" type="number" min="1" class="mt-1 w-20 rounded-md border border-gray-300 px-3 py-2 text-sm focus:border-indigo-500 focus:outline-none focus:ring-1 focus:ring-indigo-500" />
          </div>
          <span class="pb-2 text-sm text-gray-500">{{ t('every', 'cada') }}</span>
          <div class="flex-1">
            <select v-model="frequencyUnit" class="mt-1 w-full rounded-md border border-gray-300 px-3 py-2 text-sm focus:border-indigo-500 focus:outline-none focus:ring-1 focus:ring-indigo-500">
              <option value="week">{{ t('week', 'semana') }}</option>
              <option value="month">{{ t('month', 'mes') }}</option>
            </select>
          </div>
        </div>
        <div>
          <label class="block text-sm font-medium text-gray-700">{{ t('Total visits in plan', 'Visitas totales en el plan') }}</label>
          <input v-model.number="totalVisits" type="number" min="1" class="mt-1 w-full rounded-md border border-gray-300 px-3 py-2 text-sm focus:border-indigo-500 focus:outline-none focus:ring-1 focus:ring-indigo-500" />
        </div>
        <div>
          <label class="block text-sm font-medium text-gray-700">{{ t('Start date', 'Fecha de inicio') }}</label>
          <input v-model="startedAt" type="date" class="mt-1 w-full rounded-md border border-gray-300 px-3 py-2 text-sm focus:border-indigo-500 focus:outline-none focus:ring-1 focus:ring-indigo-500" />
        </div>

        <p v-if="error" class="text-sm text-red-600">{{ error }}</p>

        <div class="flex justify-end gap-2 pt-2">
          <button type="button" class="rounded-md border border-gray-300 px-4 py-2 text-sm text-gray-700 hover:bg-gray-50" @click="emit('close')">{{ t('Cancel', 'Cancelar') }}</button>
          <button type="submit" :disabled="saving" class="rounded-md bg-indigo-600 px-4 py-2 text-sm font-medium text-white hover:bg-indigo-700 disabled:opacity-50">
            {{ saving ? t('Saving…', 'Guardando…') : t('Save', 'Guardar') }}
          </button>
        </div>
      </form>
    </div>
  </div>
</template>
