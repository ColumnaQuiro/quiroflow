<script setup lang="ts">
import type { TablesUpdate } from '~/types/database.types'

// How the Growth › Leads board moves and what it is worth.
//
// Booked and Showed follow the calendar on their own (the
// leads_follow_appointments trigger); Converted does too once the clinic says
// what makes a patient -- a number of attended visits, of one appointment type
// or any. The default value is what a lead with no figure of its own counts
// as on the board and the dashboard, which is every lead a Meta form sends.

const supabase = useSupabaseClient()
const store = useAccountStore()
const t = useT()
const { showToast } = useToast()

const INPUT = 'h-8 rounded-ctl border border-line-control bg-surface px-2 text-[13px] text-ink-700 focus:border-brand focus:outline-none focus:ring-1 focus:ring-brand/20'

const defaultValue = ref('')
const autoConvert = ref(false)
const convertAfter = ref(1)
const convertTypeId = ref('')
const appointmentTypes = ref<{ id: string; name: string; archived_at: string | null }[]>([])

const loading = ref(true)
const saving = ref(false)

async function load() {
  loading.value = true
  const [{ data }, { data: types }] = await Promise.all([
    supabase.from('accounts').select('lead_default_value_cents, lead_convert_after_visits, lead_convert_appointment_type_id').eq('id', store.accountId!).maybeSingle(),
    supabase.from('appointment_types').select('id, name, archived_at').order('name'),
  ])
  defaultValue.value = data?.lead_default_value_cents == null ? '' : String(data.lead_default_value_cents / 100)
  autoConvert.value = data?.lead_convert_after_visits != null
  convertAfter.value = data?.lead_convert_after_visits ?? 1
  convertTypeId.value = data?.lead_convert_appointment_type_id ?? ''
  appointmentTypes.value = (types ?? []) as typeof appointmentTypes.value
  loading.value = false
}
onMounted(load)

// Archived types stay listed only when one is the current choice, so the
// select never shows a blank for a saved setting.
const typeOptions = computed(() => appointmentTypes.value.filter((ty) => !ty.archived_at || ty.id === convertTypeId.value))

async function save() {
  const raw = defaultValue.value.trim().replace(',', '.')
  const euros = raw === '' ? null : Number(raw)
  if (euros !== null && (!Number.isFinite(euros) || euros < 0)) {
    showToast(t('The default value has to be an amount in euros, or empty.', 'El valor por defecto tiene que ser un importe en euros, o quedar vacío.'), 'error')
    return
  }
  const visits = Math.round(Number(convertAfter.value))
  if (autoConvert.value && (!Number.isFinite(visits) || visits < 1 || visits > 50)) {
    showToast(t('The number of visits has to be between 1 and 50.', 'El número de visitas tiene que estar entre 1 y 50.'), 'error')
    return
  }
  saving.value = true
  const update: TablesUpdate<'accounts'> = {
    lead_default_value_cents: euros === null ? null : Math.round(euros * 100),
    lead_convert_after_visits: autoConvert.value ? visits : null,
    lead_convert_appointment_type_id: autoConvert.value && convertTypeId.value ? convertTypeId.value : null,
  }
  const { error } = await supabase.from('accounts').update(update).eq('id', store.accountId!)
  saving.value = false
  if (error) {
    showToast(error.message, 'error')
    return
  }
  showToast(t('Saved', 'Guardado'))
}
</script>

<template>
  <div class="flex h-full flex-col">
    <PageHeader :title="t('Leads', 'Leads')">
      <UiBtn variant="primary" :disabled="saving || loading" data-test="save-lead-settings" @click="save">{{ saving ? t('Saving…', 'Guardando…') : t('Save changes', 'Guardar cambios') }}</UiBtn>
    </PageHeader>
    <div class="flex-1 overflow-y-auto">
      <div class="flex gap-8 p-6">
        <SettingsNav />
        <div class="min-w-0 max-w-[660px] flex-1">
          <p class="text-[13px] leading-relaxed text-ink-muted2">
            {{ t('How leads move along the pipeline in Growth › Leads, and what each one is worth.', 'Cómo avanzan los leads por el embudo en Growth › Leads, y cuánto vale cada uno.') }}
          </p>

          <div v-if="loading" class="mt-5 space-y-4">
            <div v-for="i in 3" :key="i" class="rounded-card border border-line bg-surface p-4 shadow-card">
              <UiSkeleton class="h-3.5 w-48 rounded-ctlSm" />
              <UiSkeleton class="mt-2 h-3 w-64 rounded-ctlSm" />
            </div>
          </div>
          <form v-else class="mt-5 space-y-4" @submit.prevent="save">
            <div class="rounded-card border border-line bg-surface p-4 shadow-card">
              <p class="text-[13.5px] font-[560] text-ink-700">{{ t('Automatic stages', 'Etapas automáticas') }}</p>
              <ul class="mt-2 space-y-1.5 text-[12.5px] leading-snug text-ink-muted2">
                <li>
                  <span class="font-medium text-ink-700">{{ t('Booked', 'Reservado') }}</span> —
                  {{ t("when an appointment is made for them, however it is booked: at the desk, online, in the app or through the API. The lead is matched to the patient by email or phone.", 'cuando se le reserva una cita, se reserve como se reserve: en recepción, online, en la app o por la API. El lead se asocia al paciente por email o teléfono.') }}
                </li>
                <li>
                  <span class="font-medium text-ink-700">{{ t('Showed', 'Asistió') }}</span> —
                  {{ t('when they are checked in for an appointment, or it is marked completed.', 'cuando se le hace el check-in de una cita, o se marca como completada.') }}
                </li>
              </ul>
              <p class="mt-2 text-[12px] text-ink-faint">
                {{ t('Leads only move forward, never out of Lost, and only for appointments on or after the day the lead came in.', 'Los leads solo avanzan, nunca salen de Perdido, y solo cuentan las citas del día en que llegó el lead en adelante.') }}
              </p>
            </div>

            <div class="rounded-card border border-line bg-surface p-4 shadow-card">
              <div class="flex items-center justify-between gap-4">
                <div>
                  <p class="text-[13.5px] font-[560] text-ink-700">{{ t('Convert automatically', 'Convertir automáticamente') }}</p>
                  <p class="mt-0.5 text-[12.5px] text-ink-muted2">
                    {{ t('Move a lead to Converted once they have attended enough visits. Off, Converted stays a move you make by hand.', 'Pasa un lead a Convertido cuando haya asistido a suficientes visitas. Desactivado, Convertido se sigue moviendo a mano.') }}
                  </p>
                </div>
                <SettingsToggle v-model="autoConvert" data-test="auto-convert-toggle" />
              </div>
              <div v-if="autoConvert" class="mt-4 flex flex-wrap items-center gap-2 border-t border-line-divider pt-4 text-[13px] text-ink-600">
                <span>{{ t('After', 'Tras') }}</span>
                <input v-model.number="convertAfter" type="number" min="1" max="50" :class="[INPUT, 'w-16 text-center']" data-test="convert-after" />
                <span>{{ t('attended visits of', 'visitas asistidas de') }}</span>
                <select v-model="convertTypeId" :class="[INPUT, 'min-w-[180px]']" data-test="convert-type">
                  <option value="">{{ t('any appointment type', 'cualquier tipo de cita') }}</option>
                  <option v-for="ty in typeOptions" :key="ty.id" :value="ty.id">{{ ty.name }}</option>
                </select>
              </div>
            </div>

            <div class="rounded-card border border-line bg-surface p-4 shadow-card">
              <p class="text-[13.5px] font-[560] text-ink-700">{{ t('Default estimated value', 'Valor estimado por defecto') }}</p>
              <p class="mt-0.5 text-[12.5px] text-ink-muted2">
                {{ t("What a lead is worth when it has no value of its own — leads from Meta forms never do. Used on the board's totals and the dashboard; a value set on a lead always wins.", 'Lo que vale un lead cuando no tiene un valor propio — los de formularios de Meta nunca lo traen. Se usa en los totales del tablero y en el panel; el valor puesto en un lead siempre manda.') }}
              </p>
              <div class="mt-3 flex items-center gap-2">
                <input v-model="defaultValue" inputmode="decimal" :placeholder="t('None', 'Ninguno')" :class="[INPUT, 'w-28']" data-test="default-lead-value" />
                <span class="text-[13px] text-ink-muted">€</span>
              </div>
            </div>
          </form>
        </div>
      </div>
    </div>
  </div>
</template>
