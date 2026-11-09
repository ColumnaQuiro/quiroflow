<script setup lang="ts">
import { clinicDateOf } from '~/utils/clinicClock'
import { currentContract, employmentTypeLabel, type StaffContract } from '~/utils/staffContracts'

// Personal › one person's file (owners only, utils/routePermissions.ts):
// everything about someone who works at the clinic, in tabs. Perfil sums up
// their access and links to Settings › Team, which stays the one place it is
// edited; Contrato (staff_contracts) and Documentos (staff_documents) are new; Ausencias, Jornada and
// Retribución are the existing screens narrowed to this person, so a figure
// here is the same figure there. People who have left keep their file: their
// contracts and registro de jornada are records the clinic has to hold.
const supabase = useSupabaseClient()
const store = useAccountStore()
const route = useRoute()
const router = useRouter()
const t = useT()
const { preference: lang } = useLang()
const { timeZone } = useAccountTimeZone()
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

async function load() {
  if (!store.accountId) await store.load()
  const accountId = store.accountId!
  // The contract comes with the rest so the header shows how they work for
  // the clinic straight away, not only once the Contrato tab is opened.
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
onMounted(load)

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
const month = ref(clinicDateOf(new Date(), timeZone.value).slice(0, 7))

const initials = computed(() => (person.value?.full_name ?? '').split(/\s+/).filter(Boolean).slice(0, 2).map((p) => p[0]?.toUpperCase()).join('') || '·')
function roleLabel(name: string) {
  return name === 'Owner' ? t('Owner', 'Propietario') : name === 'Practitioner' ? t('Practitioner', 'Profesional') : name === 'Front Desk' ? t('Front Desk', 'Recepción') : name
}
const clinicNames = computed(() => store.clinics.filter((c) => clinicIds.value.includes(c.id)).map((c) => c.name))
const fmtDate = (iso: string) => new Date(iso).toLocaleDateString(lang.value === 'es' ? 'es-ES' : 'en-GB', { day: 'numeric', month: 'long', year: 'numeric', timeZone: timeZone.value })
const dt = 'text-[12.5px] text-ink-muted'
const dd = 'text-[14px] text-ink-900'
</script>

<template>
  <div class="flex h-full flex-col" data-cy="staff-file" :data-ready="loaded ? 'true' : undefined">
    <header class="flex shrink-0 flex-col gap-1.5 border-b border-line bg-surface px-4 pt-3 sm:px-6">
      <nav :aria-label="t('Breadcrumb', 'Ruta')" class="flex items-center gap-1.5 text-[13px] text-ink-muted">
        <NuxtLink to="/personal" class="font-semibold text-brand-text hover:underline" data-cy="staff-file-back">{{ t('Staff', 'Personal') }}</NuxtLink>
      </nav>
      <div v-if="person" class="flex flex-wrap items-center gap-3 pb-1">
        <span class="flex h-10 w-10 items-center justify-center rounded-full text-[14px] font-bold text-white" :style="{ backgroundColor: person.color }" aria-hidden="true">{{ initials }}</span>
        <h1 class="text-[18px] font-[640] tracking-tightTitle text-ink-900" data-cy="staff-file-title">{{ person.full_name }}</h1>
        <UiPill v-if="contract" tone="brand" data-cy="staff-file-type">{{ employmentTypeLabel(contract.employment_type, t) }}</UiPill>
        <UiPill v-if="person.deleted_at" tone="neutral" data-cy="staff-file-gone">{{ t(`Left ${fmtDate(person.deleted_at)}`, `Se fue el ${fmtDate(person.deleted_at)}`) }}</UiPill>
      </div>
      <div v-else-if="!loaded" class="pb-2" aria-hidden="true"><UiSkeleton class="h-10 w-56 rounded-ctl" /></div>

      <div v-if="person" role="tablist" class="-mx-1 flex gap-1 overflow-x-auto">
        <button
          v-for="tb in tabs"
          :key="tb.key"
          type="button"
          role="tab"
          :aria-selected="tab === tb.key"
          :data-cy="`staff-file-tab-${tb.key}`"
          class="-mb-px flex h-11 shrink-0 items-center border-b-2 px-3 text-[14px] font-semibold"
          :class="tab === tb.key ? 'border-brand text-ink-900' : 'border-transparent text-ink-muted hover:text-ink-700'"
          @click="tab = tb.key"
        >
          {{ tb.label }}
        </button>
      </div>
    </header>

    <div class="flex-1 overflow-y-auto bg-surface-page px-4 pb-24 pt-4 sm:px-6">
      <UiEmptyState v-if="loaded && !person" :title="t('This person is not on your team.', 'Esta persona no está en tu equipo.')" data-cy="staff-file-missing">
        <template #actions>
          <NuxtLink to="/personal" class="inline-flex h-9 items-center rounded-ctl border border-line-control bg-surface px-3.5 text-[13px] font-medium text-ink-500 hover:border-line-controlHover touch:h-11">{{ t('Back to Staff', 'Volver a Personal') }}</NuxtLink>
        </template>
      </UiEmptyState>

      <div v-else-if="person && store.accountId" class="mx-auto flex max-w-[1200px] flex-col gap-4">
        <section v-if="tab === 'profile'" class="flex max-w-[720px] flex-col gap-4 rounded-card border border-line bg-surface p-5" data-cy="staff-file-profile">
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
            {{ t('Their access — role, clinics, colour, hours, security — is changed in', 'Su acceso (rol, clínicas, color, horario, seguridad) se cambia en') }}
            <NuxtLink :to="`/settings/team/${person.id}`" class="font-semibold text-brand-text hover:underline" data-cy="staff-file-settings">{{ t('Settings › Team', 'Ajustes › Equipo') }}</NuxtLink>.
          </p>
        </section>

        <StaffFileContract v-else-if="tab === 'contract'" class="max-w-[720px]" :account-id="store.accountId" :member-id="person.id" :time-zone="timeZone" @changed="contract = $event" />

        <template v-else-if="tab === 'leave'">
          <section v-if="!person.deleted_at" class="flex max-w-[720px] flex-col gap-3 rounded-card border border-line bg-surface p-5">
            <h2 class="text-[15px] font-bold text-ink-900">{{ t('Away for a long time', 'Ausencia larga') }}</h2>
            <SettingsMemberAbsence :member-id="person.id" :name="person.full_name" :is-practitioner="person.is_practitioner" />
          </section>
          <StaffLeaveYear :account-id="store.accountId" :time-zone="timeZone" :member-id="person.id" />
        </template>

        <template v-else-if="tab === 'time'">
          <div class="flex flex-wrap items-center gap-3">
            <input v-model="month" type="month" :aria-label="t('Month', 'Mes')" class="h-9 rounded-ctl border border-line-control bg-surface px-2.5 text-[13px] text-ink-700 focus:border-brand focus:outline-none touch:h-11" data-cy="staff-file-month" />
            <NuxtLink to="/jornada" class="text-[12.5px] font-semibold text-brand-text hover:underline">{{ t('The whole team’s month, and the export to sign →', 'El mes de todo el equipo, y el informe para firmar →') }}</NuxtLink>
          </div>
          <TimeclockTeamMonth :account-id="store.accountId" :time-zone="timeZone" :month="month" :member-id="person.id" />
        </template>

        <StaffFileDocuments v-else-if="tab === 'documents'" class="max-w-[720px]" :account-id="store.accountId" :member-id="person.id" :name="person.full_name" :gone="!!person.deleted_at" />

        <StaffFilePay v-else class="max-w-[720px]" :member-id="person.id" :name="person.full_name" :time-zone="timeZone" :self-employed="contract?.employment_type === 'self_employed'" />
      </div>
    </div>
  </div>
</template>
