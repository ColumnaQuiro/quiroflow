<script setup lang="ts">
import { clinicDateOf } from '../../../utils/clinicClock'
import { currentContract, employmentTypeLabel, type StaffContract } from '../../../utils/staffContracts'

// Personal › one person's file, in the app (owners only): the web's
// pages/personal/[id].vue with the same tabs and the same components --
// Perfil, Contrato, Ausencias, Jornada, Retribución, Documentos. Their access
// (role, clinics, colour, hours) is still changed on the web, in Settings ›
// Team, which the app does not have.
definePageMeta({ layout: 'practitioner' })

const user = useSupabaseUser()
watch(user, (u) => { if (!u) navigateTo('/login') }, { immediate: true })

const supabase = useSupabaseClient()
const route = useRoute()
const router = useRouter()
const t = useT()
const { preference: lang } = useLang()
const { context, clinics } = usePractitionerContext()
const timeZone = computed(() => context.value?.timeZone || DEFAULT_CLINIC_TIMEZONE)
const memberId = route.params.id as string

interface Person {
  id: string
  full_name: string
  color: string
  role_id: string | null
  is_practitioner: boolean
  online_booking_enabled: boolean
  is_owner: boolean
  deleted_at: string | null
  created_at: string
}
const person = ref<Person | null>(null)
const roleName = ref('')
const clinicIds = ref<string[]>([])
const twoFactor = ref<boolean | null>(null)
const loaded = ref(false)
const contract = ref<StaffContract | null>(null)

async function load(accountId: string) {
  const [m, links, tf, cs] = await Promise.all([
    supabase.from('team_members').select('id, full_name, color, role_id, is_practitioner, online_booking_enabled, is_owner, deleted_at, created_at, role:account_roles(name)').eq('account_id', accountId).eq('id', memberId).maybeSingle(),
    supabase.from('team_member_clinics').select('clinic_id').eq('team_member_id', memberId),
    supabase.rpc('team_two_factor_status', { p_account_id: accountId }),
    supabase.from('staff_contracts').select('id, team_member_id, employment_type, modality, starts_on, ends_on, weekly_hours, job_title, convenio, created_at').eq('account_id', accountId).eq('team_member_id', memberId),
  ])
  const row = m.data as (Person & { role: { name: string } | null }) | null
  person.value = row
  roleName.value = row?.role?.name ?? ''
  clinicIds.value = ((links.data as { clinic_id: string }[] | null) ?? []).map((l) => l.clinic_id)
  twoFactor.value = ((tf.data ?? []) as { team_member_id: string; enrolled: boolean }[]).some((x) => x.team_member_id === memberId && x.enrolled)
  contract.value = currentContract((cs.data as StaffContract[] | null) ?? [], clinicDateOf(new Date(), timeZone.value))
  loaded.value = true
}
watch(() => (context.value?.isOwner ? context.value.accountId : null), (id) => { if (id) load(id) }, { immediate: true })

type Tab = 'profile' | 'contract' | 'leave' | 'time' | 'pay' | 'documents'
const TAB_KEYS: Tab[] = ['profile', 'contract', 'leave', 'time', 'pay', 'documents']
const tab = computed<Tab>({
  get: () => (TAB_KEYS.includes(route.query.tab as Tab) ? (route.query.tab as Tab) : 'profile'),
  set: (v) => router.replace({ query: { ...route.query, tab: v === 'profile' ? undefined : v } }),
})
const tabs = computed(() => [
  { key: 'profile' as const, label: t('Profile', 'Perfil') },
  { key: 'contract' as const, label: t('Contract', 'Contrato') },
  { key: 'leave' as const, label: t('Leave', 'Ausencias') },
  { key: 'time' as const, label: t('Working time', 'Jornada') },
  { key: 'pay' as const, label: t('Pay', 'Retribución') },
  { key: 'documents' as const, label: t('Documents', 'Documentos') },
])
// The open tab in view: on a phone the row scrolls, and Documentos is sixth.
const tabRow = ref<HTMLElement | null>(null)
watch([tab, person], async () => {
  await nextTick()
  tabRow.value?.querySelector<HTMLElement>('[aria-selected="true"]')?.scrollIntoView({ inline: 'nearest', block: 'nearest' })
}, { immediate: true })
const month = ref(clinicDateOf(new Date(), timeZone.value).slice(0, 7))

const initials = computed(() => (person.value?.full_name ?? '').split(/\s+/).filter(Boolean).slice(0, 2).map((p) => p[0]?.toUpperCase()).join('') || '·')
function roleLabel(name: string) {
  return name === 'Owner' ? t('Owner', 'Propietario') : name === 'Practitioner' ? t('Practitioner', 'Profesional') : name === 'Front Desk' ? t('Front Desk', 'Recepción') : name
}
const clinicNames = computed(() => clinics.value.filter((c) => clinicIds.value.includes(c.id)).map((c) => c.name))
const fmtDate = (iso: string) => new Date(iso).toLocaleDateString(uiLocaleTag(lang.value), { day: 'numeric', month: 'long', year: 'numeric', timeZone: timeZone.value })
const dt = 'text-[12.5px] text-ink-muted'
const dd = 'text-[14px] text-ink-900'
</script>

<template>
  <div class="flex h-full min-h-0 flex-col bg-surface-page" data-cy="staff-file" :data-ready="loaded ? 'true' : undefined">
    <AppPageHeader :title="person?.full_name ?? t('Staff', 'Personal')" back @back="router.back()" />

    <div v-if="person" class="shrink-0 border-b border-line bg-surface px-3.5 pt-3 md:px-5">
      <div class="flex flex-wrap items-center gap-2.5 pb-1">
        <span class="flex h-9 w-9 items-center justify-center rounded-full text-[13px] font-bold text-white" :style="{ backgroundColor: person.color }" aria-hidden="true">{{ initials }}</span>
        <UiPill v-if="contract" tone="brand" data-cy="staff-file-type">{{ employmentTypeLabel(contract.employment_type, t) }}</UiPill>
        <UiPill v-if="person.deleted_at" tone="neutral" data-cy="staff-file-gone">{{ t(`Left ${fmtDate(person.deleted_at)}`, `Se fue el ${fmtDate(person.deleted_at)}`) }}</UiPill>
      </div>
      <div ref="tabRow" role="tablist" class="-mx-1 flex gap-1 overflow-x-auto [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
        <button
          v-for="tb in tabs"
          :key="tb.key"
          type="button"
          role="tab"
          :aria-selected="tab === tb.key"
          :data-cy="`staff-file-tab-${tb.key}`"
          class="-mb-px flex h-11 shrink-0 items-center border-b-2 px-3 text-[14px] font-semibold"
          :class="tab === tb.key ? 'border-brand text-ink-900' : 'border-transparent text-ink-muted'"
          @click="tab = tb.key"
        >
          {{ tb.label }}
        </button>
      </div>
    </div>

    <div class="min-h-0 flex-1 overflow-y-auto px-3.5 pb-8 pt-3 md:px-5">
      <p v-if="context && !context.isOwner" class="mx-auto mt-10 max-w-[420px] text-center text-[14px] text-ink-muted">
        {{ t('Staff is for the clinic’s owners.', 'Personal es solo para los propietarios de la clínica.') }}
      </p>
      <AppSkeletonList v-else-if="!loaded" :rows="4" />
      <p v-else-if="!person" class="mx-auto mt-10 max-w-[420px] text-center text-[14px] text-ink-muted" data-cy="staff-file-missing">
        {{ t('This person is not on your team.', 'Esta persona no está en tu equipo.') }}
      </p>

      <div v-else-if="context" class="mx-auto flex max-w-[1100px] flex-col gap-4">
        <section v-if="tab === 'profile'" class="flex max-w-[720px] flex-col gap-4 rounded-card border border-line bg-surface p-4" data-cy="staff-file-profile">
          <dl class="grid gap-x-6 gap-y-3 sm:grid-cols-2">
            <div><dt :class="dt">{{ t('Role', 'Rol') }}</dt><dd :class="dd" data-cy="staff-file-role">{{ (roleLabel(roleName) || '—') + (person.is_owner && roleName !== 'Owner' ? ` · ${t('owner', 'propietario')}` : '') }}</dd></div>
            <div><dt :class="dt">{{ t('Clinics', 'Clínicas') }}</dt><dd :class="dd">{{ clinicNames.join(', ') || '—' }}</dd></div>
            <div>
              <dt :class="dt">{{ t('Sees patients', 'Atiende pacientes') }}</dt>
              <dd :class="dd">{{ person.is_practitioner ? (person.online_booking_enabled ? t('Yes, and bookable online', 'Sí, y con reserva online') : t('Yes', 'Sí')) : t('No', 'No') }}</dd>
            </div>
            <div>
              <dt :class="dt">{{ t('Two-factor authentication', 'Verificación en dos pasos') }}</dt>
              <dd :class="[dd, twoFactor ? 'text-success-text' : 'text-warning-text']">{{ twoFactor ? t('Set up', 'Configurada') : t('Not set up', 'Sin configurar') }}</dd>
            </div>
            <div><dt :class="dt">{{ t('On QuiroFlow since', 'En QuiroFlow desde') }}</dt><dd :class="dd">{{ fmtDate(person.created_at) }}</dd></div>
          </dl>
          <p class="border-t border-line-row pt-3 text-[13px] text-ink-700">
            {{ t('Their access — role, clinics, colour, hours, security — is changed on the web, in Settings › Team.', 'Su acceso (rol, clínicas, color, horario, seguridad) se cambia en la web, en Ajustes › Equipo.') }}
          </p>
        </section>

        <StaffFileContract v-else-if="tab === 'contract'" class="max-w-[720px]" :account-id="context.accountId" :member-id="person.id" :time-zone="timeZone" @changed="contract = $event" />

        <template v-else-if="tab === 'leave'">
          <section v-if="!person.deleted_at" class="flex max-w-[720px] flex-col gap-3 rounded-card border border-line bg-surface p-4">
            <h2 class="text-[15px] font-bold text-ink-900">{{ t('Away for a long time', 'Ausencia larga') }}</h2>
            <SettingsMemberAbsence :member-id="person.id" :name="person.full_name" :is-practitioner="person.is_practitioner" />
          </section>
          <StaffLeaveYear :account-id="context.accountId" :time-zone="timeZone" :member-id="person.id" />
        </template>

        <template v-else-if="tab === 'time'">
          <input v-model="month" type="month" :aria-label="t('Month', 'Mes')" class="h-11 w-fit rounded-ctl border border-line-control bg-surface px-2.5 text-[14px] text-ink-700 focus:border-brand focus:outline-none" data-cy="staff-file-month" />
          <TimeclockTeamMonth :account-id="context.accountId" :time-zone="timeZone" :month="month" :member-id="person.id" />
        </template>

        <StaffFileDocuments v-else-if="tab === 'documents'" class="max-w-[720px]" :account-id="context.accountId" :member-id="person.id" :name="person.full_name" :gone="!!person.deleted_at" />

        <StaffFilePay v-else class="max-w-[720px]" :member-id="person.id" :name="person.full_name" :time-zone="timeZone" :self-employed="contract?.employment_type === 'self_employed'" />
      </div>
    </div>
    <UiToastContainer />
  </div>
</template>
