<script setup lang="ts">
// Inviting someone to the team. Two things are asked outright that used to be
// guessed from the role: whether they will see patients (a practitioner takes
// a paid seat), and which clinics they work at. Guessing made every custom
// role, and Owner, a practitioner -- see
// 20260925090000_team_invites_say_who_sees_patients.sql.
//
// With an email the link is sent; without one (someone who has no email, or
// a name imported from PracticeHub) it is only shown, to share by hand.
const props = defineProps<{
  roles: { id: string; name: string }[]
  seatsLeft: number | null
  prefillName?: string
  linkPractitionerName?: string
}>()
const emit = defineEmits<{ close: []; created: [] }>()
const supabase = useSupabaseClient()
const store = useAccountStore()
const t = useT()
const { showToast } = useToast()

const email = ref('')
const fullName = ref(props.prefillName ?? '')
const practitionerRole = props.roles.find((r) => r.name === 'Practitioner') ?? props.roles.find((r) => r.name !== 'Owner') ?? props.roles[0]
const roleId = ref(practitionerRole?.id ?? '')
const isPractitioner = ref(true)
const clinicIds = ref<string[]>(store.clinics.map((c) => c.id))
const creating = ref(false)
const error = ref('')
const result = ref<{ link: string; email: string | null; sent: 'yes' | 'no' | 'failed'; reason?: string; inviteId: string } | null>(null)

const noSeat = computed(() => isPractitioner.value && props.seatsLeft !== null && props.seatsLeft <= 0)
const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/
const emailBad = computed(() => !!email.value.trim() && !EMAIL.test(email.value.trim()))
const canCreate = computed(() => !creating.value && !emailBad.value && !!roleId.value && (!!email.value.trim() || !!fullName.value.trim()) && clinicIds.value.length > 0)

function toggleClinic(id: string) {
  clinicIds.value = clinicIds.value.includes(id) ? clinicIds.value.filter((c) => c !== id) : [...clinicIds.value, id]
}

async function send(inviteId: string, to: string) {
  try {
    await useStaffFetch('/api/invites/send', { method: 'POST', body: { inviteId } })
    return { sent: 'yes' as const }
  } catch (e: any) {
    return { sent: 'failed' as const, reason: e?.data?.statusMessage ?? e?.message ?? '' }
  }
}

async function create() {
  if (!canCreate.value || !store.accountId) return
  creating.value = true
  error.value = ''
  const to = email.value.trim() || null
  const { data, error: insertError } = await supabase
    .from('account_invites')
    .insert({
      account_id: store.accountId,
      email: to,
      full_name: fullName.value.trim() || null,
      role_id: roleId.value,
      // The legacy column is still read by older code paths; it no longer
      // decides anything the invite states itself.
      role: isPractitioner.value ? 'practitioner' : 'front_desk',
      is_practitioner: isPractitioner.value,
      clinic_ids: clinicIds.value,
      link_practitioner_name: props.linkPractitionerName ?? null,
    } as never)
    .select('id, token')
    .single()
  if (insertError || !data) {
    creating.value = false
    error.value = insertError?.message ?? t('Could not create the invite.', 'No se pudo crear la invitación.')
    return
  }
  const link = `${window.location.origin}/join?token=${(data as { token: string }).token}`
  const inviteId = (data as { id: string }).id
  const outcome = to ? await send(inviteId, to) : { sent: 'no' as const }
  creating.value = false
  result.value = { link, email: to, inviteId, ...outcome }
  emit('created')
}

async function retry() {
  if (!result.value?.email) return
  const outcome = await send(result.value.inviteId, result.value.email)
  result.value = { ...result.value, ...outcome }
}

async function copy() {
  if (!result.value) return
  try {
    await navigator.clipboard.writeText(result.value.link)
    showToast(t('Link copied', 'Enlace copiado'))
  } catch {
    showToast(t('Could not copy -- select the link and copy it by hand.', 'No se pudo copiar: selecciona el enlace y cópialo a mano.'), 'error')
  }
}

function roleLabel(name: string) {
  return name === 'Owner' ? t('Owner', 'Propietario') : name === 'Practitioner' ? t('Practitioner', 'Profesional') : name === 'Front Desk' ? t('Front Desk', 'Recepción') : name
}
</script>

<template>
  <UiConfirmDialog
    v-if="!result"
    :title="t('Invite to the team', 'Invitar al equipo')"
    :confirm-label="creating ? t('Creating…', 'Creando…') : t('Create invite', 'Crear invitación')"
    :cancel-label="t('Cancel', 'Cancelar')"
    :busy="!canCreate"
    @confirm="create"
    @cancel="emit('close')"
  >
    <div class="flex flex-col gap-4" data-cy="invite-dialog">
      <label class="flex flex-col gap-1.5 text-[13px] font-semibold text-ink-700">
        {{ t('Email', 'Email') }}
        <input v-model="email" data-cy="invite-email" type="email" autocomplete="off" placeholder="nombre@ejemplo.com" class="h-11 rounded-ctl border bg-surface px-3 text-[15px] font-normal text-ink-900 focus:border-brand focus:outline-none" :class="emailBad ? 'border-danger-text' : 'border-line-control'" />
        <span class="text-[12.5px] font-normal text-ink-muted">{{ t('We email them the link. No email? Leave it empty and share the link yourself (on WhatsApp, say).', 'Le enviamos el enlace. Si no tiene email, déjalo vacío y compártelo tú (por WhatsApp, por ejemplo).') }}</span>
      </label>
      <label class="flex flex-col gap-1.5 text-[13px] font-semibold text-ink-700">
        {{ t('Name (optional)', 'Nombre (opcional)') }}
        <input v-model="fullName" data-cy="invite-name" type="text" class="h-11 rounded-ctl border border-line-control bg-surface px-3 text-[15px] font-normal text-ink-900 focus:border-brand focus:outline-none" />
      </label>
      <label class="flex flex-col gap-1.5 text-[13px] font-semibold text-ink-700">
        {{ t('Role', 'Rol') }}
        <select v-model="roleId" data-cy="invite-role" class="h-11 rounded-ctl border border-line-control bg-surface px-3 text-[15px] font-normal text-ink-900 focus:border-brand focus:outline-none">
          <option v-for="r in roles" :key="r.id" :value="r.id">{{ roleLabel(r.name) }}</option>
        </select>
        <span class="text-[12.5px] font-normal text-ink-muted">{{ t('What they can do. You can change it any time from their page.', 'Qué puede hacer. Puedes cambiarlo cuando quieras desde su ficha.') }}</span>
      </label>
      <label class="flex items-start gap-3 rounded-ctl border border-line px-3.5 py-3">
        <input v-model="isPractitioner" data-cy="invite-practitioner" type="checkbox" class="mt-0.5 h-5 w-5 shrink-0" />
        <span class="flex flex-col gap-0.5">
          <span class="text-[14px] font-semibold text-ink-900">{{ t('Will see patients', 'Atenderá pacientes') }}</span>
          <span class="text-[13px] text-ink-500">
            {{ seatsLeft === null ? t('Shows in the calendar. No seat limit on your plan right now.', 'Aparecerá en el calendario. Tu plan ahora no tiene límite de plazas.') : t(`Shows in the calendar and takes a seat when they accept. ${seatsLeft} left.`, `Aparecerá en el calendario y ocupará una plaza al aceptar. Te quedan ${seatsLeft}.`) }}
          </span>
        </span>
      </label>
      <p v-if="noSeat" class="rounded-ctl border border-warning-border bg-warning-bg px-3.5 py-3 text-[13.5px] text-warning-text" data-cy="invite-no-seat">
        {{ t('No practitioner seats left. They would be refused when accepting. Untick "Will see patients", or', 'No quedan plazas de profesional: al aceptar se le rechazaría. Desmarca «Atenderá pacientes», o') }}
        <NuxtLink to="/subscription" class="font-bold underline">{{ t('add a seat', 'añade una plaza') }}</NuxtLink>.
      </p>
      <div v-if="store.clinics.length > 1" class="flex flex-col gap-2">
        <span class="text-[13px] font-semibold text-ink-700">{{ t('Clinics', 'Sedes') }}</span>
        <div class="flex flex-wrap gap-2">
          <label v-for="c in store.clinics" :key="c.id" class="flex h-11 items-center gap-2.5 rounded-ctl border px-3.5 text-[14px] font-semibold" :class="clinicIds.includes(c.id) ? 'border-brand bg-brand-tint text-brand-text' : 'border-line-control text-ink-700'">
            <input type="checkbox" class="h-[18px] w-[18px]" :checked="clinicIds.includes(c.id)" @change="toggleClinic(c.id)" />{{ c.name }}
          </label>
        </div>
      </div>
      <p v-if="error" class="text-[13px] font-semibold text-danger-text">{{ error }}</p>
    </div>
  </UiConfirmDialog>

  <UiConfirmDialog
    v-else
    :title="t('Invite created', 'Invitación creada')"
    :confirm-label="t('Done', 'Hecho')"
    :cancel-label="result.sent === 'failed' ? t('Retry email', 'Reintentar email') : t('Close', 'Cerrar')"
    @confirm="emit('close')"
    @cancel="result.sent === 'failed' ? retry() : emit('close')"
  >
    <div class="flex flex-col gap-3" data-cy="invite-result">
      <p v-if="result.sent === 'yes'" class="rounded-ctl border border-success-border bg-success-bg px-3.5 py-3 text-[13.5px] text-success-text" data-cy="invite-sent">
        <strong>{{ t(`Email sent to ${result.email}.`, `Email enviado a ${result.email}.`) }}</strong> {{ t('You can also share the link directly.', 'También puedes compartir el enlace directamente.') }}
      </p>
      <p v-else-if="result.sent === 'failed'" class="rounded-ctl border border-warning-border bg-warning-bg px-3.5 py-3 text-[13.5px] text-warning-text" data-cy="invite-send-failed">
        <strong>{{ t('The email could not be sent', 'No se pudo enviar el email') }}</strong><template v-if="result.reason"> ({{ result.reason }})</template>. {{ t('The invite does exist: share the link.', 'La invitación sí está creada: comparte el enlace.') }}
      </p>
      <p v-else class="text-[14px] text-ink-500">{{ t('Share this link with them. Whoever opens it joins with this role.', 'Comparte este enlace. Quien lo abra entra con este rol.') }}</p>
      <div class="flex gap-2">
        <input readonly :value="result.link" data-cy="invite-link" class="h-11 min-w-0 flex-1 rounded-ctl border border-line-control bg-surface-subtle px-3 font-mono text-[13px] text-ink-700" @focus="($event.target as HTMLInputElement).select()" />
        <button type="button" class="h-11 shrink-0 rounded-ctl border border-line-control bg-surface px-3.5 text-[14px] font-semibold text-ink-700 hover:bg-surface-subtle" @click="copy">{{ t('Copy', 'Copiar') }}</button>
      </div>
    </div>
  </UiConfirmDialog>
</template>
