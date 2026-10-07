<script setup lang="ts">
// "Editar" on a patient's record: what changes at the desk or in the room --
// phone numbers, email, red and yellow flags, the sticky note. The rest of
// the web's Details form (ID, address, channels, tags...) stays on the web.
//
// The same columns the web writes (DetailsDialog for email, FlagsPanel,
// StickyNotePanel, ContactNumbersEditor), with the same rules:
// - a number is checked (usePhoneValidation) before anything is written, a
//   typed "+44…" winning over the country (splitDialPrefix); a stored number
//   nobody touched is never re-checked, as on the web;
// - the patient update is read back: without patients_edit RLS updates
//   nothing rather than failing, and the note used to read as saved and be
//   gone on reload (StickyNotePanel);
// - only fields that changed are sent.
import { splitDialPrefix, formatPhoneDisplay } from '../../utils/phone'

const props = defineProps<{
  patientId: string
  patient: { email: string | null; red_flags: string | null; yellow_flags: string | null; sticky_note: string | null }
}>()
const emit = defineEmits<{ saved: []; close: [] }>()

const supabase = useSupabaseClient()
const t = useT()
const { phoneProblem } = usePhoneValidation()
const { context } = usePractitionerContext()

interface Row { id: string | null; number: string; country_code: string; is_whatsapp: boolean; original: { number: string; country_code: string; is_whatsapp: boolean } | null; removed: boolean }
const rows = ref<Row[]>([])
const loading = ref(true)
const loadError = ref('')
const defaultCountry = ref('ES')

const email = ref(props.patient.email ?? '')
const redFlags = ref(props.patient.red_flags ?? '')
const yellowFlags = ref(props.patient.yellow_flags ?? '')
const stickyNote = ref(props.patient.sticky_note ?? '')
const saving = ref(false)
const error = ref('')
const rowErrors = ref<Record<number, string>>({})

onMounted(async () => {
  const [nums, acct] = await Promise.all([
    supabase.from('patient_contact_numbers').select('id, number, country_code, is_whatsapp').eq('patient_id', props.patientId).order('created_at'),
    context.value ? supabase.from('accounts').select('default_phone_country').eq('id', context.value.accountId).maybeSingle() : Promise.resolve({ data: null }),
  ])
  if (nums.error) loadError.value = t('Could not load the phone numbers.', 'No se han podido cargar los teléfonos.')
  defaultCountry.value = (acct.data as { default_phone_country: string | null } | null)?.default_phone_country || 'ES'
  rows.value = ((nums.data as { id: string; number: string; country_code: string; is_whatsapp: boolean }[] | null) ?? []).map((n) => ({
    ...n,
    // Shown the way the record shows it; compared against that on save.
    number: formatPhoneDisplay(n.number, n.country_code),
    original: { number: formatPhoneDisplay(n.number, n.country_code), country_code: n.country_code, is_whatsapp: n.is_whatsapp },
    removed: false,
  }))
  loading.value = false
})

function addRow() {
  rows.value.push({ id: null, number: '', country_code: defaultCountry.value, is_whatsapp: rows.value.every((r) => r.removed || !r.is_whatsapp), original: null, removed: false })
}
function removeRow(i: number) {
  const r = rows.value[i]
  if (r.id) r.removed = !r.removed
  else rows.value.splice(i, 1)
}

const emailProblem = computed(() => (email.value.trim() && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.value.trim()) ? t('That email does not look right.', 'Ese correo no parece correcto.') : ''))
const numberChanged = (r: Row) => !r.original || r.number.trim() !== r.original.number
const rowChanged = (r: Row) => !r.original || numberChanged(r) || r.is_whatsapp !== r.original.is_whatsapp

async function save() {
  if (saving.value || !context.value) return
  error.value = ''
  rowErrors.value = {}
  if (emailProblem.value) {
    error.value = emailProblem.value
    return
  }
  // Every number first, so nothing is half-saved over one typo.
  const problems: Record<number, string> = {}
  rows.value.forEach((r, i) => {
    if (r.removed || !numberChanged(r)) return
    if (!r.number.trim()) {
      if (r.id) problems[i] = t('Empty: use ✕ to remove a number.', 'Vacío: usa ✕ para quitar un número.')
      return
    }
    const p = phoneProblem(r.number, r.country_code)
    if (p) problems[i] = p
  })
  if (Object.keys(problems).length) {
    rowErrors.value = problems
    return
  }

  saving.value = true
  const patch: Record<string, string | null> = {}
  const norm = (v: string) => v.trim() || null
  if (norm(email.value) !== (props.patient.email ?? null)) patch.email = norm(email.value)
  if (norm(redFlags.value) !== (props.patient.red_flags?.trim() || null)) patch.red_flags = norm(redFlags.value)
  if (norm(yellowFlags.value) !== (props.patient.yellow_flags?.trim() || null)) patch.yellow_flags = norm(yellowFlags.value)
  if (norm(stickyNote.value) !== (props.patient.sticky_note?.trim() || null)) patch.sticky_note = norm(stickyNote.value)
  if (Object.keys(patch).length) {
    const { data, error: e } = await supabase.from('patients').update(patch as never).eq('id', props.patientId).select('id')
    if (e || !data?.length) {
      saving.value = false
      error.value = e?.message ?? t('Not saved: your role cannot edit this patient.', 'No se ha guardado: tu rol no puede editar este paciente.')
      return
    }
  }

  // Each row is marked as stored the moment its write succeeds, so Save
  // pressed again after a later row failed does not write it a second time
  // (a new number used to be inserted twice: nothing unique stops it).
  for (const r of rows.value) {
    let failed: { message: string } | null = null
    if (r.removed && r.id) {
      failed = (await supabase.from('patient_contact_numbers').delete().eq('id', r.id)).error
      if (!failed) r.id = null
    } else if (!r.removed && rowChanged(r) && r.number.trim()) {
      const { countryCode, number } = numberChanged(r) ? splitDialPrefix(r.number, r.country_code) : { countryCode: r.country_code, number: null }
      if (r.id) {
        const update: Record<string, unknown> = { is_whatsapp: r.is_whatsapp }
        if (number !== null) Object.assign(update, { number, country_code: countryCode })
        failed = (await supabase.from('patient_contact_numbers').update(update as never).eq('id', r.id)).error
      } else {
        const inserted = await supabase.from('patient_contact_numbers').insert({ account_id: context.value.accountId, patient_id: props.patientId, country_code: countryCode, number, is_whatsapp: r.is_whatsapp } as never).select('id').single()
        failed = inserted.error
        if (!failed) r.id = (inserted.data as { id: string }).id
      }
      if (!failed) r.original = { number: r.number.trim(), country_code: countryCode, is_whatsapp: r.is_whatsapp }
    }
    if (failed) {
      saving.value = false
      // What was already written stays written; the record reloads behind.
      error.value = t(`A phone number was not saved: ${failed.message}`, `Un teléfono no se ha guardado: ${failed.message}`)
      emit('saved')
      return
    }
  }
  saving.value = false
  emit('saved')
  emit('close')
}

const field = 'rounded-ctl border border-line-control bg-surface px-3 text-[15px] text-ink-900 focus:border-brand focus:outline-none'
</script>

<template>
  <div class="fixed inset-0 z-50 flex flex-col justify-end bg-black/40 md:items-center md:justify-center" data-cy="edit-patient-sheet" @click.self="emit('close')">
    <form
      class="flex max-h-[92%] w-full flex-col gap-3 overflow-y-auto rounded-t-[22px] bg-surface px-4 pt-2.5 shadow-popover md:max-w-[500px] md:rounded-[18px] md:pt-5"
      style="padding-bottom: max(env(safe-area-inset-bottom), 1.25rem)"
      role="dialog"
      aria-modal="true"
      :aria-label="t('Edit patient', 'Editar paciente')"
      @submit.prevent="save"
    >
      <div class="mx-auto mb-0.5 h-1 w-[38px] shrink-0 rounded-full bg-line-control md:hidden" />
      <p class="text-[17px] font-semibold text-ink-900">{{ t('Edit patient', 'Editar paciente') }}</p>

      <div>
        <p class="text-[12.5px] font-medium text-ink-muted">{{ t('Phone numbers', 'Teléfonos') }}</p>
        <UiSkeleton v-if="loading" class="mt-1.5 h-11 rounded-ctl" />
        <p v-else-if="loadError" class="mt-1.5 text-[13px] text-danger-text">{{ loadError }}</p>
        <template v-else>
          <div v-for="(r, i) in rows" :key="r.id ?? `new-${i}`" class="mt-1.5" data-cy="edit-phone-row">
            <div class="flex items-center gap-2">
              <input
                v-model="r.number"
                type="tel"
                inputmode="tel"
                autocomplete="off"
                :disabled="r.removed"
                :placeholder="r.country_code === 'ES' ? '612 345 678' : ''"
                class="h-11 min-w-0 flex-1 disabled:opacity-40"
                :class="[field, r.removed ? 'line-through' : '']"
                :aria-label="t('Phone number', 'Teléfono')"
                data-cy="edit-phone"
              />
              <button type="button" role="switch" :aria-checked="r.is_whatsapp" :disabled="r.removed" class="flex h-11 shrink-0 items-center gap-1.5 rounded-ctl border px-2.5 text-[12.5px] font-medium disabled:opacity-40" :class="r.is_whatsapp ? 'border-success-border bg-success-bg text-success-text' : 'border-line-control text-ink-muted'" data-cy="edit-phone-whatsapp" @click="r.is_whatsapp = !r.is_whatsapp">
                WhatsApp
              </button>
              <button type="button" class="flex h-11 w-10 shrink-0 items-center justify-center rounded-ctl text-ink-muted" :aria-label="r.removed ? t('Keep this number', 'Mantener este número') : t('Remove this number', 'Quitar este número')" data-cy="edit-phone-remove" @click="removeRow(i)">
                <svg v-if="!r.removed" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true"><path d="M6 6l12 12M18 6L6 18" /></svg>
                <span v-else class="text-[12px] font-semibold text-brand-text">{{ t('Undo', 'Deshacer') }}</span>
              </button>
            </div>
            <p v-if="rowErrors[i]" class="mt-1 text-[12.5px] text-danger-text">{{ rowErrors[i] }}</p>
          </div>
          <button type="button" class="mt-1.5 flex h-10 items-center gap-1.5 text-[13.5px] font-semibold text-brand-text" data-cy="edit-phone-add" @click="addRow">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" aria-hidden="true"><path d="M12 5v14M5 12h14" /></svg>
            {{ t('Add a number', 'Añadir un número') }}
          </button>
        </template>
      </div>

      <label class="flex flex-col gap-1 text-[12.5px] font-medium text-ink-muted">
        {{ t('Email', 'Correo electrónico') }}
        <input v-model="email" type="email" inputmode="email" autocomplete="off" autocapitalize="off" class="h-11" :class="field" data-cy="edit-email" />
      </label>

      <label class="flex flex-col gap-1 text-[12.5px] font-medium text-danger-text">
        {{ t('Red flags', 'Señales rojas') }}
        <textarea v-model="redFlags" rows="2" class="py-2 leading-snug" :class="field" data-cy="edit-red-flags" />
      </label>
      <label class="flex flex-col gap-1 text-[12.5px] font-medium text-warning-text">
        {{ t('Yellow flags', 'Señales amarillas') }}
        <textarea v-model="yellowFlags" rows="2" class="py-2 leading-snug" :class="field" data-cy="edit-yellow-flags" />
      </label>
      <label class="flex flex-col gap-1 text-[12.5px] font-medium text-ink-muted">
        {{ t('Sticky note', 'Nota fija') }}
        <textarea v-model="stickyNote" rows="2" class="py-2 leading-snug" :class="field" :placeholder="t('Shown on the record and the visit', 'Se ve en la ficha y en la cita')" data-cy="edit-sticky-note" />
      </label>

      <p v-if="error" role="alert" class="text-[13px] text-danger-text" data-cy="edit-patient-error">{{ error }}</p>
      <button type="submit" class="flex h-11 items-center justify-center rounded-card bg-brand text-[15px] font-semibold text-white disabled:opacity-50" :disabled="saving || loading" data-cy="edit-patient-save">
        {{ saving ? t('Saving…', 'Guardando…') : t('Save', 'Guardar') }}
      </button>
      <button type="button" class="flex min-h-11 items-center justify-center text-[13.5px] text-ink-muted" @click="emit('close')">{{ t('Cancel', 'Cancelar') }}</button>
    </form>
  </div>
</template>
