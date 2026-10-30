<script setup lang="ts">
// The location's check-in portal (pages/check-in/[token].vue): a link opened
// on a tablet at the front desk, where patients type their date of birth to
// say they have arrived. Turning it on makes the link; "New link" replaces it
// for a tablet that went missing; turning it off deletes it.
// (server/api/clinics/[id]/check-in-portal.*)
const props = defineProps<{ clinicId: string }>()
const authedFetch = useAuthedFetch()
const t = useT()
const { showToast } = useToast()

const loaded = ref(false)
const token = ref<string | null>(null)
const busy = ref(false)
const renewOpen = ref(false)
const offOpen = ref(false)
const copied = ref(false)

const url = computed(() => (token.value && import.meta.client ? `${window.location.origin}/check-in/${token.value}` : ''))

onMounted(async () => {
  try {
    token.value = (await authedFetch<{ token: string | null }>(`/api/clinics/${props.clinicId}/check-in-portal`)).token
  } finally {
    loaded.value = true
  }
})

async function call(method: 'POST' | 'DELETE', body?: { renew: boolean }) {
  busy.value = true
  try {
    token.value = (await authedFetch<{ token: string | null }>(`/api/clinics/${props.clinicId}/check-in-portal`, { method, body })).token
    copied.value = false
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
          {{ t('Open it on the tablet and leave it there, plugged in. It needs no login: the link is the key, so keep it to the tablet. Only patients with a date of birth on file, and a visit here starting within 90 minutes, are found.', 'Ábrelo en la tablet y déjalo ahí, enchufada. No necesita iniciar sesión: el enlace es la llave, así que no lo compartas fuera de la tablet. Solo encuentra a pacientes con la fecha de nacimiento en su ficha y una cita aquí en los próximos 90 minutos.') }}
        </span>
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
      <p class="text-[14px] leading-relaxed text-ink-500">{{ t('The tablet will say it is switched off. Turning it on again makes a new link.', 'La tablet dirá que está desactivado. Si lo vuelves a activar, se crea un enlace nuevo.') }}</p>
    </UiConfirmDialog>
  </div>
</template>
