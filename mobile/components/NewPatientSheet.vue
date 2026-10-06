<script setup lang="ts">
// A new patient from the app: Patients' "+ Nuevo", and "Paciente nuevo" in
// the agenda's patient search. The web's Add Patient (AddPatientModal) cut
// to what the desk asks someone standing in front of it -- name, phone,
// email, date of birth -- with the same insert:
//
// - a client-made id, never .insert().select(): someone who sees only their
//   own patients cannot read back, in the inserting statement, a patient who
//   only becomes theirs with that insert;
// - the default practitioner is the visit's practitioner when booking, and
//   the signed-in one when their patients scope is 'own' (else the record
//   they have just created is one they cannot open);
// - the number in patient_contact_numbers, a typed "+44…" winning over the
//   country, and checked before anything is written.
const props = defineProps<{
  /** What was typed into the search: split into first name and surname. */
  initialName?: string
  /** Becomes their default practitioner (the visit's, when booking). */
  practitionerId?: string | null
}>()
const emit = defineEmits<{ created: [{ id: string; firstName: string; lastName: string | null }]; close: [] }>()

const supabase = useSupabaseClient()
const t = useT()
const { phoneProblem } = usePhoneValidation()
const { context } = usePractitionerContext()

const words = (props.initialName ?? '').trim().split(/\s+/).filter(Boolean)
const capital = (w: string) => (w ? w[0].toUpperCase() + w.slice(1) : '')
const firstName = ref(capital(words[0] ?? ''))
const lastName = ref(words.slice(1).map(capital).join(' '))
const phone = ref('')
const email = ref('')
const dateOfBirth = ref('')
const phoneCountry = ref('ES')
const error = ref('')
// Set when the patient was created but their number was refused: the sheet
// stays open to say so, and the button carries on without it.
const createdWithoutPhone = ref<{ id: string; firstName: string; lastName: string | null } | null>(null)
const saving = ref(false)

interface FieldConfig { visible: boolean; required: boolean }
const fieldConfig = ref<Record<string, FieldConfig>>({})
const visible = (key: string) => fieldConfig.value[key]?.visible ?? true
const required = (key: string) => fieldConfig.value[key]?.required ?? false

async function loadConfig() {
  if (!context.value) return
  const { data } = await supabase.from('accounts').select('new_patient_field_config, default_phone_country').eq('id', context.value.accountId).maybeSingle()
  const row = data as { new_patient_field_config: Record<string, FieldConfig> | null; default_phone_country: string | null } | null
  fieldConfig.value = row?.new_patient_field_config ?? {}
  phoneCountry.value = row?.default_phone_country || 'ES'
}
const stopLoad = watch(() => context.value?.accountId, (id) => {
  if (!id) return
  loadConfig()
  nextTick(() => stopLoad())
}, { immediate: true })

async function save() {
  if (createdWithoutPhone.value) {
    emit('created', createdWithoutPhone.value)
    return
  }
  if (!context.value || saving.value) return
  error.value = ''
  if (!firstName.value.trim()) {
    error.value = t('The first name is needed.', 'Falta el nombre.')
    return
  }
  const phoneError = phoneProblem(phone.value, phoneCountry.value)
  if (phoneError) {
    error.value = phoneError
    return
  }
  saving.value = true
  const id = crypto.randomUUID()
  const own = !context.value.isOwner && context.value.permissions.patients_scope === 'own'
  const first = firstName.value.trim()
  const last = lastName.value.trim() || null
  const { error: insertError } = await supabase.from('patients').insert({
    id,
    account_id: context.value.accountId,
    clinic_id: context.value.clinicId,
    first_name: first,
    last_name: last,
    email: email.value.trim() || null,
    date_of_birth: dateOfBirth.value || null,
    // Someone who sees only their own patients must be this one's
    // practitioner, whichever column the slot was held in: made a colleague's,
    // the new patient was invisible to its creator ("Patient not found").
    default_practitioner_id: own ? context.value.teamMemberId : props.practitionerId || null,
  } as never)
  if (insertError) {
    saving.value = false
    error.value = insertError.message
    return
  }
  if (phone.value.trim()) {
    const { countryCode, number } = splitDialPrefix(phone.value, phoneCountry.value)
    const { error: numberError } = await supabase.from('patient_contact_numbers').insert({ account_id: context.value.accountId, patient_id: id, country_code: countryCode, number } as never)
    // The patient exists by now, so carry on (a second tap would create them
    // twice) -- but say the number was not kept.
    if (numberError) {
      saving.value = false
      error.value = t(`Patient created, but the phone was not saved: ${numberError.message}`, `Paciente creado, pero el teléfono no se ha guardado: ${numberError.message}`)
      createdWithoutPhone.value = { id, firstName: first, lastName: last }
      return
    }
  }
  saving.value = false
  emit('created', { id, firstName: first, lastName: last })
}
</script>

<template>
  <div class="fixed inset-0 z-50 flex flex-col justify-end bg-black/40 md:items-center md:justify-center" data-cy="new-patient-sheet" @click.self="emit('close')">
    <form
      class="flex max-h-[92%] w-full flex-col gap-3 overflow-y-auto rounded-t-[22px] bg-surface px-4 pt-2.5 shadow-popover md:max-w-[460px] md:rounded-[18px] md:pt-5"
      style="padding-bottom: max(env(safe-area-inset-bottom), 1.25rem)"
      role="dialog"
      aria-modal="true"
      :aria-label="t('New patient', 'Paciente nuevo')"
      @submit.prevent="save"
    >
      <div class="mx-auto mb-0.5 h-1 w-[38px] shrink-0 rounded-full bg-line-control md:hidden" />
      <p class="text-[17px] font-semibold text-ink-900">{{ t('New patient', 'Paciente nuevo') }}</p>

      <div class="grid grid-cols-2 gap-2">
        <label class="flex flex-col gap-1 text-[12.5px] font-medium text-ink-muted">
          {{ t('First name', 'Nombre') }}
          <input v-model="firstName" required autocomplete="off" autocapitalize="words" class="h-11 rounded-ctl border border-line-control bg-surface px-3 text-[15px] text-ink-900 focus:border-brand focus:outline-none" data-cy="new-patient-first" />
        </label>
        <label class="flex flex-col gap-1 text-[12.5px] font-medium text-ink-muted">
          {{ t('Last name', 'Apellidos') }}
          <input v-model="lastName" autocomplete="off" autocapitalize="words" class="h-11 rounded-ctl border border-line-control bg-surface px-3 text-[15px] text-ink-900 focus:border-brand focus:outline-none" data-cy="new-patient-last" />
        </label>
      </div>
      <label class="flex flex-col gap-1 text-[12.5px] font-medium text-ink-muted">
        {{ t('Phone', 'Teléfono') }}
        <input v-model="phone" type="tel" inputmode="tel" autocomplete="off" :placeholder="phoneCountry === 'ES' ? '612 345 678' : ''" class="h-11 rounded-ctl border border-line-control bg-surface px-3 text-[15px] text-ink-900 focus:border-brand focus:outline-none" data-cy="new-patient-phone" />
      </label>
      <label v-if="visible('email')" class="flex flex-col gap-1 text-[12.5px] font-medium text-ink-muted">
        {{ t('Email', 'Correo electrónico') }}
        <input v-model="email" type="email" inputmode="email" autocomplete="off" autocapitalize="off" :required="required('email')" class="h-11 rounded-ctl border border-line-control bg-surface px-3 text-[15px] text-ink-900 focus:border-brand focus:outline-none" />
      </label>
      <label v-if="visible('date_of_birth')" class="flex flex-col gap-1 text-[12.5px] font-medium text-ink-muted">
        {{ t('Date of birth', 'Fecha de nacimiento') }}
        <input v-model="dateOfBirth" type="date" :required="required('date_of_birth')" class="h-11 rounded-ctl border border-line-control bg-surface px-3 text-[15px] text-ink-900 focus:border-brand focus:outline-none" />
      </label>
      <p class="text-[12px] leading-snug text-ink-faint">{{ t('The rest of the record can be filled in later.', 'El resto de la ficha se puede completar después.') }}</p>

      <p v-if="error" role="alert" class="text-[13px] text-danger-text">{{ error }}</p>

      <button type="submit" class="flex h-11 items-center justify-center rounded-card bg-brand text-[15px] font-semibold text-white disabled:opacity-50" :disabled="saving" data-cy="new-patient-save">
        {{ saving ? t('Saving…', 'Guardando…') : createdWithoutPhone ? t('Continue without the phone', 'Continuar sin el teléfono') : t('Create patient', 'Crear paciente') }}
      </button>
      <button type="button" class="py-1 text-[13.5px] text-ink-muted" @click="emit('close')">{{ t('Cancel', 'Cancelar') }}</button>
    </form>
  </div>
</template>
