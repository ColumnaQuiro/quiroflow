<script setup lang="ts">
// The Exercises section's "By type" tab: what each patient type brings -- a
// programme given at once, and a schedule by visit -- and, after a change,
// whether the patients who already have the type should get it too. Nothing
// reaches them by surprise: a change applies to whoever is given the type
// from now on until someone presses "Update the N patients".
//
// Creating and renaming types is Settings > Patient types (clinic_config);
// this is exercises_manage. The database draws the same line
// (patient_types_guard).
const t = useT()
const store = useAccountStore()
const { can } = usePermission()
const { showToast } = useToast()
const types = usePatientTypes()
const programs = useExercisePrograms({ accountId: () => store.accountId })
const schedules = useExerciseSchedules({ accountId: () => store.accountId })
const supabase = useSupabaseClient()

const selectedId = ref<string | null>(null)
const rules = ref<{ id: string; name: string; trigger_event: string; filters: Record<string, unknown> | null; enabled: boolean }[]>([])
onMounted(async () => {
  await Promise.all([types.load(), programs.load(), schedules.load()])
  if (!selectedId.value) selectedId.value = types.active.value[0]?.id ?? null
  const { data } = await supabase.from('automation_rules').select('id, name, trigger_event, filters, enabled').in('trigger_event', ['patient.type_added', 'patient.type_removed'])
  rules.value = (data ?? []) as typeof rules.value
})
const selected = computed(() => types.types.value.find((x) => x.id === selectedId.value) ?? null)
const rulesForSelected = computed(() => rules.value.filter((r) => !r.filters?.trigger_type_id || r.filters.trigger_type_id === selectedId.value))

// The change just made to this type, waiting for "update everyone or only new ones".
const pendingSync = ref<string | null>(null)
const saving = ref(false)
const syncing = ref(false)

async function setDefault(field: 'exercise_program_id' | 'exercise_schedule_id', value: string) {
  const ty = selected.value
  if (!ty) return
  saving.value = true
  const err = await types.update(ty.id, { [field]: value || null })
  saving.value = false
  if (err) {
    showToast(err, 'error')
    return
  }
  if (ty.members > 0) pendingSync.value = ty.id
  showToast(t('Saved', 'Guardado'))
}

async function syncNow() {
  const ty = selected.value
  if (!ty) return
  syncing.value = true
  try {
    const r = await types.sync(ty.id)
    pendingSync.value = null
    showToast(
      t(`${r.patients} patients updated · ${r.exercises} exercises given · ${r.ended} ended`, `${r.patients} pacientes actualizados · ${r.exercises} ejercicios asignados · ${r.ended} finalizados`),
    )
  } catch (e) {
    showToast(serverMessage(e) ?? t('They could not be updated.', 'No se han podido actualizar.'), 'error')
  } finally {
    syncing.value = false
  }
}

const program = computed(() => programs.programs.value.find((p) => p.id === selected.value?.exercise_program_id) ?? null)
const select = 'h-9 touch:h-11 w-full rounded-ctl border border-line-control bg-surface px-3 text-[14px] text-ink-900 focus:border-brand focus:outline-none focus:ring-1 focus:ring-brand disabled:opacity-60'
const membersLabel = (n: number) => (n === 1 ? t('1 patient', '1 paciente') : t(`${n} patients`, `${n} pacientes`))
</script>

<template>
  <div class="flex flex-col gap-4" data-cy="exercises-type-defaults" :data-ready="types.loading.value ? undefined : 'true'">
    <p class="max-w-[640px] text-[13.5px] text-ink-muted">
      {{
        t(
          'Each patient type can bring exercises with it: a programme assigned as soon as a patient is given the type, and a schedule that moves on with their visits. Add or remove exercises on each record as usual.',
          'Cada tipo de paciente puede traer ejercicios: un programa que se asigna en cuanto se pone el tipo, y una pauta que avanza con sus visitas. En cada ficha se pueden añadir o quitar como siempre.',
        )
      }}
    </p>

    <div v-if="!types.loading.value && types.active.value.length === 0" class="rounded-card border border-line bg-surface px-[18px] py-8 text-center">
      <p class="text-[14px] text-ink-muted">{{ t('No patient types yet.', 'Aún no hay tipos de paciente.') }}</p>
      <NuxtLink v-if="can('clinic_config') && can('settings_access')" to="/settings/patient-types" class="mt-2 inline-block text-[13.5px] font-semibold text-brand-text hover:underline" data-cy="type-defaults-create">
        {{ t('Create them in Settings › Patient types', 'Créalos en Ajustes › Tipos de paciente') }}
      </NuxtLink>
      <p v-else class="mt-1 text-[12.5px] text-ink-faint">{{ t('Someone who can configure the clinic creates them in Settings.', 'Los crea en Ajustes quien puede configurar la clínica.') }}</p>
    </div>

    <div v-else class="grid gap-4 md:grid-cols-[220px_minmax(0,1fr)]">
      <nav class="flex flex-row gap-1 overflow-x-auto md:flex-col" :aria-label="t('Patient types', 'Tipos de paciente')">
        <button
          v-for="ty in types.active.value"
          :key="ty.id"
          type="button"
          :aria-current="selectedId === ty.id ? 'true' : undefined"
          class="flex shrink-0 items-center gap-2 rounded-ctl border px-3 py-2 text-left text-[13.5px]"
          :class="selectedId === ty.id ? 'border-line bg-surface font-semibold text-ink-900' : 'border-transparent text-ink-700 hover:bg-surface-subtle'"
          data-cy="type-defaults-type"
          @click="selectedId = ty.id; pendingSync = null"
        >
          <span class="h-2 w-2 shrink-0 rounded-full" :style="{ background: PATIENT_TYPE_DOT[ty.color] }" aria-hidden="true" />
          <span class="min-w-0 flex-1 truncate">{{ ty.name }}</span>
          <span class="font-mono text-[11.5px] tabular-nums text-ink-muted">{{ ty.members }}</span>
        </button>
      </nav>

      <section v-if="selected" class="flex min-w-0 flex-col gap-3">
        <div class="flex flex-wrap items-baseline justify-between gap-2">
          <h2 class="text-[17px] font-semibold text-ink-900">{{ selected.name }}</h2>
          <NuxtLink :to="{ path: '/patients', query: { types: selected.id } }" class="text-[12.5px] text-ink-muted hover:text-brand-text">{{ membersLabel(selected.members) }}</NuxtLink>
        </div>

        <div class="rounded-card border border-line bg-surface">
          <div class="border-b border-line-divider px-4 py-2.5 text-[13px] font-semibold text-ink-700">{{ t('Exercises it brings', 'Ejercicios que trae') }}</div>
          <div class="flex flex-col gap-3 px-4 py-3">
            <label class="flex flex-col gap-1 text-[12.5px] font-medium text-ink-700">
              {{ t('Programme, assigned when the type is given', 'Programa, se asigna al poner el tipo') }}
              <select :value="selected.exercise_program_id ?? ''" :class="select" :disabled="saving" data-cy="type-defaults-program" @change="setDefault('exercise_program_id', ($event.target as HTMLSelectElement).value)">
                <option value="">{{ t('None', 'Ninguno') }}</option>
                <option v-for="p in programs.programs.value" :key="p.id" :value="p.id">{{ p.name }}</option>
              </select>
            </label>
            <ul v-if="program" class="flex flex-wrap gap-1.5">
              <li v-for="i in program.exercise_program_items" :key="i.exercise_id" class="rounded-pill bg-chip-bg px-2 py-0.5 text-[12px] text-chip-text">{{ i.exercises?.name }}</li>
            </ul>
            <label class="flex flex-col gap-1 text-[12.5px] font-medium text-ink-700">
              {{ t('Schedule by visit', 'Pauta por visita') }}
              <select :value="selected.exercise_schedule_id ?? ''" :class="select" :disabled="saving" data-cy="type-defaults-schedule" @change="setDefault('exercise_schedule_id', ($event.target as HTMLSelectElement).value)">
                <option value="">{{ t('None', 'Ninguna') }}</option>
                <option v-for="s in schedules.templates.value" :key="s.id" :value="s.id">{{ s.name }}</option>
              </select>
              <span class="font-normal text-ink-faint">{{ t('Only for patients who are not already following a schedule.', 'Solo para quien no siga ya una pauta.') }}</span>
            </label>
            <p v-if="programs.programs.value.length === 0" class="text-[12.5px] text-ink-faint">
              {{ t('Make programmes and schedules in the Library tab.', 'Los programas y pautas se crean en la pestaña Biblioteca.') }}
            </p>
          </div>
        </div>

        <div v-if="pendingSync === selected.id" class="flex flex-wrap items-center gap-2 rounded-card border border-brand-tintBorder bg-brand-tint px-4 py-3 text-[13px] text-brand-text" data-cy="type-defaults-sync">
          <span class="min-w-0 flex-1">
            {{ t(`The ${membersLabel(selected.members)} who already have this type keep what they had.`, `Los ${membersLabel(selected.members)} que ya tienen este tipo siguen con lo que tenían.`) }}
          </span>
          <UiBtn variant="primary" size="sm" :disabled="syncing" data-cy="type-defaults-sync-now" @click="syncNow">{{ syncing ? t('Updating…', 'Actualizando…') : t(`Update the ${selected.members}`, `Actualizar a los ${selected.members}`) }}</UiBtn>
          <UiBtn size="sm" data-cy="type-defaults-sync-skip" @click="pendingSync = null">{{ t('Only new ones', 'Solo a los nuevos') }}</UiBtn>
        </div>
        <UiBtn v-else-if="selected.members > 0 && (selected.exercise_program_id || selected.exercise_schedule_id)" size="sm" class="self-start" :disabled="syncing" data-cy="type-defaults-resync" @click="syncNow">
          {{ t(`Bring the ${selected.members} patients up to date`, `Poner al día a los ${selected.members} pacientes`) }}
        </UiBtn>

        <div class="rounded-card border border-line bg-surface">
          <div class="border-b border-line-divider px-4 py-2.5 text-[13px] font-semibold text-ink-700">{{ t('Documents and messages', 'Documentos y mensajes') }}</div>
          <div class="flex flex-col gap-2 px-4 py-3 text-[13px] text-ink-700">
            <p class="text-ink-muted">
              {{
                t(
                  'To send forms, consents or messages to everyone given this type, make an automation that starts with "Patient type given".',
                  'Para enviar formularios, consentimientos o mensajes a quien se le ponga este tipo, crea una automatización que empiece por «Se pone un tipo de paciente».',
                )
              }}
            </p>
            <ul v-if="rulesForSelected.length" class="flex flex-col gap-1" data-cy="type-defaults-rules">
              <li v-for="r in rulesForSelected" :key="r.id" class="flex items-center gap-2">
                <span class="h-1.5 w-1.5 rounded-full" :class="r.enabled ? 'bg-success-accent' : 'bg-ink-faint3'" aria-hidden="true" />
                <NuxtLink v-if="can('communication_config')" :to="`/automations/${r.id}`" class="text-brand-text hover:underline">{{ r.name }}</NuxtLink>
                <span v-else>{{ r.name }}</span>
                <span class="text-[11.5px] text-ink-faint">{{ r.trigger_event === 'patient.type_added' ? t('when given', 'al ponerlo') : t('when taken away', 'al quitarlo') }}</span>
              </li>
            </ul>
            <NuxtLink v-if="can('communication_config')" to="/automations" class="self-start text-[12.5px] font-semibold text-brand-text hover:underline">{{ t('Go to Automations', 'Ir a Automatizaciones') }}</NuxtLink>
          </div>
        </div>
      </section>
    </div>
  </div>
</template>
