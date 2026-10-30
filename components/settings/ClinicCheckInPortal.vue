<script setup lang="ts">
import { PORTAL_LANGUAGES, PORTAL_LANGUAGE_NAMES, PORTAL_TEXT, isPortalLanguage, type PortalLanguage } from '~/utils/checkInPortalText'
import { isPortalIdentifyBy, type PortalIdentifyBy } from '~/utils/checkInPortal'

// The location's check-in portal (pages/check-in/[token].vue): a link opened
// on a tablet at the front desk, where patients type their date of birth or
// their DNI/NIE (the location's choice), or show their app's QR code, to say
// they have arrived. Turning it on makes the
// link; "New link" replaces it for a tablet that went missing; turning it off
// deletes it. The tablet's language and the clinic's own wording for its three
// screens are saved with their own button.
// (server/api/clinics/[id]/check-in-portal.*)
const props = defineProps<{ clinicId: string }>()
const authedFetch = useAuthedFetch()
const t = useT()
const { showToast } = useToast()

interface Portal { token: string | null; identifyBy: string; language: string; welcomeMessage: string; successMessage: string; notFoundMessage: string }

const loaded = ref(false)
const token = ref<string | null>(null)
const busy = ref(false)
const renewOpen = ref(false)
const offOpen = ref(false)
const copied = ref(false)
const form = ref({ identifyBy: 'birth_date' as PortalIdentifyBy, language: 'es' as PortalLanguage, welcomeMessage: '', successMessage: '', notFoundMessage: '' })
const saved = ref('')
const dirty = computed(() => JSON.stringify(form.value) !== saved.value)
const standard = computed(() => PORTAL_TEXT[form.value.language])

const url = computed(() => (token.value && import.meta.client ? `${window.location.origin}/check-in/${token.value}` : ''))

function apply(p: Portal) {
  token.value = p.token
  form.value = { identifyBy: isPortalIdentifyBy(p.identifyBy) ? p.identifyBy : 'birth_date', language: isPortalLanguage(p.language) ? p.language : 'es', welcomeMessage: p.welcomeMessage, successMessage: p.successMessage, notFoundMessage: p.notFoundMessage }
  saved.value = JSON.stringify(form.value)
}

onMounted(async () => {
  try {
    apply(await authedFetch<Portal>(`/api/clinics/${props.clinicId}/check-in-portal`))
  } finally {
    loaded.value = true
  }
})

async function call(method: 'POST' | 'DELETE' | 'PATCH', body?: object) {
  busy.value = true
  try {
    apply(await authedFetch<Portal>(`/api/clinics/${props.clinicId}/check-in-portal`, { method, body }))
    copied.value = false
    if (method === 'PATCH') showToast(t('Saved.', 'Guardado.'), 'success')
  } catch (e: any) {
    showToast(e?.data?.statusMessage ?? t("Couldn't change the check-in portal.", 'No se ha podido cambiar el portal de llegada.'), 'error')
  } finally {
    busy.value = false
    renewOpen.value = false
    offOpen.value = false
  }
}

async function copy() {
  await navigator.clipboard.writeText(url.value)
  copied.value = true
}

const textareaClass = 'min-h-[64px] resize-y rounded-ctl border border-line-control bg-surface px-3 py-2 text-[14px] font-normal leading-snug text-ink-900 focus:border-brand focus:outline-none focus:ring-1 focus:ring-brand'
</script>

<template>
  <div class="flex flex-col gap-4" data-cy="clinic-check-in-portal" :data-ready="loaded ? 'true' : undefined">
    <div v-if="loaded && !token" class="flex flex-wrap items-center gap-4 rounded-ctl border border-line px-4 py-3.5">
      <span class="min-w-[240px] flex-1 text-[13.5px] leading-snug text-ink-500">{{ t('Off. Patients check in from the app, or at the desk.', 'Desactivado. Los pacientes registran su llegada desde la app o en recepción.') }}</span>
      <UiBtn variant="primary" :disabled="busy" data-cy="clinic-check-in-portal-on" @click="call('POST')">{{ t('Turn on', 'Activar') }}</UiBtn>
    </div>

    <template v-else-if="token">
      <div class="flex flex-col gap-1.5">
        <span class="text-[13px] font-semibold text-ink-700">{{ t('Link for the tablet', 'Enlace para la tablet') }}</span>
        <div class="flex items-center gap-2">
          <code class="flex h-9 touch:h-11 min-w-0 flex-1 items-center truncate rounded-ctl border border-line bg-surface-page px-3 font-mono text-[13px] text-ink-700" data-cy="clinic-check-in-portal-url">{{ url }}</code>
          <UiBtn data-cy="clinic-check-in-portal-copy" @click="copy">{{ copied ? t('Copied', 'Copiado') : t('Copy', 'Copiar') }}</UiBtn>
          <a :href="url" target="_blank" rel="noopener" class="inline-flex h-9 touch:h-11 items-center rounded-ctl border border-line-control bg-surface px-3.5 text-[13px] font-medium text-ink-500 hover:border-line-controlHover" data-cy="clinic-check-in-portal-open">{{ t('Open', 'Abrir') }}</a>
        </div>
        <span class="text-[12.5px] leading-snug text-ink-muted">
          {{ t('Open it on the tablet and leave it there, plugged in. It needs no login: the link is the key, so keep it to the tablet. It only finds patients with a visit here starting within 90 minutes. A USB or Bluetooth QR scanner works plugged into the tablet; without one, the tablet uses its own camera.', 'Ábrelo en la tablet y déjalo ahí, enchufada. No necesita iniciar sesión: el enlace es la llave, así que no lo compartas fuera de la tablet. Solo encuentra a pacientes con una cita aquí en los próximos 90 minutos. Un lector de QR USB o Bluetooth funciona conectado a la tablet; sin lector, la tablet usa su propia cámara.') }}
        </span>
      </div>

      <div class="flex flex-col gap-4 rounded-ctl border border-line px-4 py-4">
        <div class="flex flex-col gap-1.5">
          <span id="identify-label" class="text-[13px] font-semibold text-ink-700">{{ t('Patients identify themselves with', 'Los pacientes se identifican con') }}</span>
          <div role="radiogroup" aria-labelledby="identify-label" class="flex flex-wrap gap-1.5">
            <button
              v-for="o in [{ value: 'birth_date', label: t('Date of birth', 'Fecha de nacimiento') }, { value: 'national_id', label: t('DNI / NIE', 'DNI / NIE') }]"
              :key="o.value"
              type="button"
              role="radio"
              :aria-checked="form.identifyBy === o.value"
              class="h-9 touch:h-11 rounded-ctl px-3.5 text-[14px] font-semibold"
              :class="form.identifyBy === o.value ? 'border-[1.5px] border-brand bg-brand-tint text-brand-text' : 'border border-line-control bg-surface text-ink-700 hover:bg-surface-subtle'"
              :data-cy="`clinic-check-in-portal-identify-${o.value}`"
              @click="form.identifyBy = o.value as PortalIdentifyBy"
            >
              {{ o.label }}
            </button>
          </div>
          <span class="text-[12.5px] leading-snug text-ink-muted">
            {{ form.identifyBy === 'national_id'
              ? t('Matched against the DNI/NIE in their record, so patients without one are not found: they can use the QR code or tell the front desk. Harder to guess than a date of birth.', 'Se compara con el DNI/NIE de su ficha, así que no encuentra a quien no lo tenga: pueden usar el código QR o avisar en recepción. Más difícil de adivinar que una fecha de nacimiento.')
              : t('Typed as six digits, DDMMYY, matched against the date of birth in their record. Two patients due at once with the same birthday pick theirs from their initials.', 'Se escribe con seis cifras, DDMMAA, y se compara con la fecha de nacimiento de su ficha. Si dos pacientes con cita a la vez cumplen el mismo día, eligen el suyo por las iniciales.') }}
          </span>
        </div>
        <label class="flex flex-col gap-1.5 text-[13px] font-semibold text-ink-700">
          {{ t("Tablet's language", 'Idioma de la tablet') }}
          <select v-model="form.language" class="h-9 touch:h-11 max-w-[240px] rounded-ctl border border-line-control bg-surface px-3 text-[14px] font-normal text-ink-900" data-cy="clinic-check-in-portal-language">
            <option v-for="l in PORTAL_LANGUAGES" :key="l" :value="l">{{ PORTAL_LANGUAGE_NAMES[l] }}</option>
          </select>
          <span class="text-[12.5px] font-normal leading-snug text-ink-muted">{{ t('Patients can switch it on the tablet; it goes back to this one after each of them.', 'Los pacientes pueden cambiarlo en la tablet; vuelve a este después de cada uno.') }}</span>
        </label>

        <p class="text-[12.5px] leading-snug text-ink-muted">{{ t("Your own wording for the tablet's screens, in its language. Leave one blank for the standard text, shown in grey. A patient who switches language sees the standard text in theirs.", 'Vuestro propio texto para las pantallas de la tablet, en su idioma. Deja uno en blanco para el texto estándar, en gris. Un paciente que cambia de idioma ve el texto estándar en el suyo.') }}</p>
        <label class="flex flex-col gap-1.5 text-[13px] font-semibold text-ink-700">
          {{ t('Welcome', 'Bienvenida') }}
          <textarea v-model="form.welcomeMessage" maxlength="300" rows="2" :placeholder="standard.welcomeTitle" :class="textareaClass" data-cy="clinic-check-in-portal-welcome" />
        </label>
        <label class="flex flex-col gap-1.5 text-[13px] font-semibold text-ink-700">
          {{ t('Checked in', 'Llegada registrada') }}
          <textarea v-model="form.successMessage" maxlength="300" rows="2" :placeholder="standard.arrived" :class="textareaClass" data-cy="clinic-check-in-portal-success" />
        </label>
        <label class="flex flex-col gap-1.5 text-[13px] font-semibold text-ink-700">
          {{ t('Appointment not found', 'Cita no encontrada') }}
          <textarea v-model="form.notFoundMessage" maxlength="300" rows="2" :placeholder="standard.notFoundText" :class="textareaClass" data-cy="clinic-check-in-portal-not-found" />
        </label>
        <div class="flex justify-end">
          <UiBtn variant="primary" :disabled="busy || !dirty" data-cy="clinic-check-in-portal-save" @click="call('PATCH', form)">{{ t('Save', 'Guardar') }}</UiBtn>
        </div>
      </div>

      <div class="flex flex-wrap gap-2">
        <UiBtn :disabled="busy" data-cy="clinic-check-in-portal-renew" @click="renewOpen = true">{{ t('New link…', 'Nuevo enlace…') }}</UiBtn>
        <UiBtn variant="ghost" :disabled="busy" data-cy="clinic-check-in-portal-off" @click="offOpen = true">{{ t('Turn off…', 'Desactivar…') }}</UiBtn>
      </div>
    </template>

    <UiConfirmDialog
      v-if="renewOpen"
      :title="t('Make a new link?', '¿Crear un enlace nuevo?')"
      :confirm-label="t('New link', 'Nuevo enlace')"
      :cancel-label="t('Cancel', 'Cancelar')"
      :busy="busy"
      @confirm="call('POST', { renew: true })"
      @cancel="renewOpen = false"
    >
      <p class="text-[14px] leading-relaxed text-ink-500">{{ t('The current link stops working at once, on every tablet that has it. Use it if a tablet went missing or the link was shared.', 'El enlace actual deja de funcionar al momento, en todas las tablets que lo tengan. Úsalo si se ha perdido una tablet o el enlace se ha compartido.') }}</p>
    </UiConfirmDialog>
    <UiConfirmDialog
      v-if="offOpen"
      :title="t('Turn off the check-in portal?', '¿Desactivar el portal de llegada?')"
      :confirm-label="t('Turn off', 'Desactivar')"
      :cancel-label="t('Cancel', 'Cancelar')"
      :busy="busy"
      @confirm="call('DELETE')"
      @cancel="offOpen = false"
    >
      <p class="text-[14px] leading-relaxed text-ink-500">{{ t('The tablet will say it is switched off. Turning it on again makes a new link, with the standard wording.', 'La tablet dirá que está desactivado. Si lo vuelves a activar, se crea un enlace nuevo, con el texto estándar.') }}</p>
    </UiConfirmDialog>
  </div>
</template>
