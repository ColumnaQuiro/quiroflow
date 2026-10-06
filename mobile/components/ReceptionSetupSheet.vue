<script setup lang="ts">
// "Firmar en recepción" on a patient's record: which forms they will fill in
// on this iPad, and -- the first time on this device -- the code that takes
// it back. The forms already waiting for them come ticked; a template can be
// added, made into their document exactly as the web's Docs tab does it
// (renderTemplateFields, prefilled from their record). Then the iPad locks
// to /reception until the team unlocks it (useReceptionLock).
import type { DocField } from '../../utils/docFields'

const props = defineProps<{ patientId: string }>()
const emit = defineEmits<{ close: [] }>()

const supabase = useSupabaseClient()
const user = useSupabaseUser()
const t = useT()
const { context } = usePractitionerContext()
const reception = useReceptionLock()

interface PendingDoc { id: string; title: string; public_token: string }
interface Template { id: string; title: string; fields: DocField[] }
interface PatientRow {
  first_name: string
  last_name: string | null
  date_of_birth: string | null
  email: string | null
  address: string | null
  city: string | null
  postal_code: string | null
  country: string | null
  national_id: string | null
  occupation: string | null
  gender: string | null
  emergency_contact: string | null
}

const loading = ref(true)
const pending = ref<PendingDoc[]>([])
const templates = ref<Template[]>([])
const patient = ref<PatientRow | null>(null)
const clinicName = ref('')
const chosenDocs = ref<Set<string>>(new Set())
const chosenTemplates = ref<Set<string>>(new Set())
const needsCode = !reception.hasCode()
const code = ref('')
const codeAgain = ref('')
const error = ref('')
const starting = ref(false)

// Once the team member's context is in: opened straight after a cold start it
// may still be on its way.
async function load() {
  if (!context.value) return
  const [d, tp, p, a] = await Promise.all([
    supabase.from('patient_docs').select('id, title, public_token').eq('patient_id', props.patientId).is('completed_at', null).order('created_at'),
    supabase.from('doc_templates').select('id, title, fields').order('title'),
    supabase.from('patients').select('first_name, last_name, date_of_birth, email, address, city, postal_code, country, national_id, occupation, gender, emergency_contact').eq('id', props.patientId).maybeSingle(),
    supabase.from('accounts').select('name').eq('id', context.value.accountId).maybeSingle(),
  ])
  pending.value = (d.data as PendingDoc[] | null) ?? []
  templates.value = (tp.data as unknown as Template[] | null) ?? []
  patient.value = p.data as PatientRow | null
  clinicName.value = (a.data as { name: string } | null)?.name ?? ''
  chosenDocs.value = new Set(pending.value.map((x) => x.id))
  loading.value = false
}
const stopLoad = watch(() => context.value?.teamMemberId, (id) => {
  if (!id) return
  load()
  nextTick(() => stopLoad())
}, { immediate: true })

function toggle(set: Set<string>, id: string) {
  if (set.has(id)) set.delete(id)
  else set.add(id)
}
const count = computed(() => chosenDocs.value.size + chosenTemplates.value.size)

async function start() {
  if (!context.value || !patient.value || starting.value) return
  error.value = ''
  if (count.value === 0) {
    error.value = t('Pick at least one form.', 'Elige al menos un formulario.')
    return
  }
  if (needsCode) {
    if (!/^\d{4,6}$/.test(code.value)) {
      error.value = t('The code is 4 to 6 digits.', 'El código tiene de 4 a 6 cifras.')
      return
    }
    if (code.value !== codeAgain.value) {
      error.value = t('The two codes do not match.', 'Los dos códigos no coinciden.')
      return
    }
  }
  starting.value = true
  const tokens = pending.value.filter((x) => chosenDocs.value.has(x.id)).map((x) => x.public_token)
  const p = patient.value
  for (const tpl of templates.value.filter((x) => chosenTemplates.value.has(x.id))) {
    const fields = renderTemplateFields(tpl.fields, {
      first_name: p.first_name ?? '',
      last_name: p.last_name ?? '',
      date_of_birth: p.date_of_birth ?? '',
      email: p.email ?? '',
      address: p.address ?? '',
      city: p.city ?? '',
      postal_code: p.postal_code ?? '',
      country: p.country ?? '',
      national_id: p.national_id ?? '',
      occupation: p.occupation ?? '',
      gender: p.gender ?? '',
      emergency_contact: p.emergency_contact ?? '',
      clinic_name: clinicName.value,
      today: new Date().toLocaleDateString(),
    })
    const { data, error: e } = await supabase
      .from('patient_docs')
      .insert({ account_id: context.value.accountId, patient_id: props.patientId, title: tpl.title, fields: fields as never, template_id: tpl.id, created_by: context.value.teamMemberId, updated_by: context.value.teamMemberId } as never)
      .select('public_token')
      .single()
    if (e || !data) {
      starting.value = false
      error.value = e?.message ?? t('Could not add the form.', 'No se ha podido añadir el formulario.')
      return
    }
    tokens.push((data as { public_token: string }).public_token)
  }
  if (needsCode) await reception.setCode(code.value)
  reception.lock({ patientId: props.patientId, firstName: p.first_name, clinicName: clinicName.value, tokens, staffEmail: user.value?.email ?? '' })
  await navigateTo(`/reception/${props.patientId}`, { replace: true })
}
</script>

<template>
  <div class="fixed inset-0 z-50 flex flex-col justify-end bg-black/40 md:items-center md:justify-center" data-cy="reception-setup" @click.self="emit('close')">
    <div
      class="flex max-h-[92%] w-full flex-col gap-3 overflow-y-auto rounded-t-[22px] bg-surface px-4 pt-2.5 shadow-popover md:max-w-[480px] md:rounded-[18px] md:pt-5"
      style="padding-bottom: max(env(safe-area-inset-bottom), 1.25rem)"
      role="dialog"
      aria-modal="true"
      :aria-label="t('Sign at reception', 'Firmar en recepción')"
    >
      <div class="mx-auto mb-0.5 h-1 w-[38px] shrink-0 rounded-full bg-line-control md:hidden" />
      <p class="text-[17px] font-semibold text-ink-900">{{ t('Sign at reception', 'Firmar en recepción') }}</p>
      <p class="-mt-1.5 text-[13px] leading-snug text-ink-muted">
        {{ t('Only these forms will show, one after another. Leaving needs Face ID or the reception code.', 'Solo se mostrarán estos formularios, uno tras otro. Para salir hace falta Face ID o el código de recepción.') }}
      </p>

      <template v-if="loading">
        <UiSkeleton class="h-11 rounded-card" />
        <UiSkeleton class="h-11 rounded-card" />
      </template>
      <template v-else>
        <div v-if="pending.length" class="flex flex-col gap-1.5">
          <p class="text-[11px] font-semibold uppercase tracking-[.05em] text-ink-muted">{{ t('Waiting for them', 'Pendientes') }}</p>
          <label v-for="d in pending" :key="d.id" class="flex min-h-11 cursor-pointer items-center gap-3 rounded-card border border-line-control px-3.5" data-cy="reception-pending">
            <input type="checkbox" class="h-5 w-5 accent-brand" :checked="chosenDocs.has(d.id)" @change="toggle(chosenDocs, d.id)" />
            <span class="text-[14px] text-ink-900">{{ d.title }}</span>
          </label>
        </div>
        <div v-if="templates.length" class="flex flex-col gap-1.5">
          <p class="text-[11px] font-semibold uppercase tracking-[.05em] text-ink-muted">{{ t('Add a form', 'Añadir un formulario') }}</p>
          <label v-for="tp in templates" :key="tp.id" class="flex min-h-11 cursor-pointer items-center gap-3 rounded-card border border-line-control px-3.5" data-cy="reception-template">
            <input type="checkbox" class="h-5 w-5 accent-brand" :checked="chosenTemplates.has(tp.id)" @change="toggle(chosenTemplates, tp.id)" />
            <span class="text-[14px] text-ink-900">{{ tp.title }}</span>
          </label>
        </div>
        <p v-if="!pending.length && !templates.length" class="rounded-card border border-line bg-surface shadow-card-page px-3.5 py-3 text-[13px] text-ink-muted">
          {{ t('Nothing to sign: no pending forms and no templates yet. Templates are set up on the web, in Settings.', 'No hay nada que firmar: ni formularios pendientes ni plantillas. Las plantillas se crean en la web, en Ajustes.') }}
        </p>

        <div v-if="needsCode" class="flex flex-col gap-1.5 rounded-card border border-line bg-surface shadow-card-page p-3.5">
          <p class="text-[13.5px] font-semibold text-ink-900">{{ t('Reception code for this device', 'Código de recepción de este dispositivo') }}</p>
          <p class="text-[12.5px] leading-snug text-ink-muted">{{ t('4 to 6 digits, for whoever takes the device back. Asked once on this device.', 'De 4 a 6 cifras, para quien lo recoja. Se pide una vez en este dispositivo.') }}</p>
          <div class="mt-1 grid grid-cols-2 gap-2">
            <input v-model="code" type="password" inputmode="numeric" autocomplete="off" maxlength="6" :placeholder="t('Code', 'Código')" class="h-11 rounded-ctl border border-line-control bg-surface px-3 text-center text-[18px] tracking-[.3em]" data-cy="reception-code" />
            <input v-model="codeAgain" type="password" inputmode="numeric" autocomplete="off" maxlength="6" :placeholder="t('Again', 'Repítelo')" class="h-11 rounded-ctl border border-line-control bg-surface px-3 text-center text-[18px] tracking-[.3em]" data-cy="reception-code-again" />
          </div>
        </div>
        <p class="text-[12px] leading-snug text-ink-faint">
          {{ t('Tip: turn on Guided Access (triple-click the side button) so the app cannot be left either.', 'Consejo: activa Acceso guiado (triple clic en el botón lateral) para que tampoco se pueda salir de la app.') }}
        </p>
      </template>

      <p v-if="error" role="alert" class="text-[13px] text-danger-text">{{ error }}</p>
      <button type="button" class="flex h-11 items-center justify-center rounded-card bg-brand text-[15px] font-semibold text-white disabled:opacity-50" :disabled="loading || starting || count === 0" data-cy="reception-start" @click="start">
        {{ starting ? t('Starting…', 'Preparando…') : t(`Hand it over · ${count} ${count === 1 ? 'form' : 'forms'}`, `Entregar al paciente · ${count} ${count === 1 ? 'formulario' : 'formularios'}`) }}
      </button>
      <button type="button" class="py-1 text-[13.5px] text-ink-muted" @click="emit('close')">{{ t('Cancel', 'Cancelar') }}</button>
    </div>
  </div>
</template>
