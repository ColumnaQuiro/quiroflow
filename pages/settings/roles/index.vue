<script setup lang="ts">
import { displayRoleDescription, displayRoleName, roleNameTaken, summaryChips, permissionsWithDefaults, type RolePermissions } from '~/utils/rolePermissions'

// Every role at a glance: what it is for, who holds it, and the handful of
// permissions that tell it apart from the others. The old page was a bare
// list of names, so choosing a role for someone meant opening each one and
// reading thirty switches.

const supabase = useSupabaseClient()
const store = useAccountStore()
const router = useRouter()
const t = useT()
const { showToast } = useToast()

interface RoleRow {
  id: string
  name: string
  is_system: boolean
  description: string | null
  permissions: RolePermissions
}
interface Member {
  id: string
  full_name: string
  role_id: string | null
}

const roles = ref<RoleRow[]>([])
const members = ref<Member[]>([])
const ready = ref(false)

async function load() {
  const [r, m] = await Promise.all([
    supabase.from('account_roles').select('id, name, is_system, description, permissions').order('is_system', { ascending: false }).order('name'),
    supabase.from('team_members').select('id, full_name, role_id').is('deleted_at', null).order('full_name'),
  ])
  roles.value = ((r.data ?? []) as any[]).map((row) => ({ ...row, permissions: permissionsWithDefaults(row.permissions) }))
  members.value = (m.data ?? []) as Member[]
  ready.value = true
}
onMounted(load)

const membersByRole = computed(() => {
  const map = new Map<string, Member[]>()
  for (const m of members.value) {
    if (!m.role_id) continue
    map.set(m.role_id, [...(map.get(m.role_id) ?? []), m])
  }
  return map
})

// --- New role -------------------------------------------------------------------
const newOpen = ref(false)
const newName = ref('')
const copyFrom = ref<string>('')
const creating = ref(false)
const newTried = ref(false)

function openNew() {
  newName.value = ''
  // Starting from a real role is the common case -- "like Front Desk, plus
  // reports" -- and an empty role opens to thirty switches all off.
  copyFrom.value = roles.value.find((r) => r.name === 'Front Desk')?.id ?? roles.value.find((r) => !r.is_system)?.id ?? ''
  newTried.value = false
  newOpen.value = true
}

const nameEmpty = computed(() => !newName.value.trim())
const nameTaken = computed(() => roleNameTaken(newName.value, roles.value))

async function createRole() {
  newTried.value = true
  if (nameEmpty.value || nameTaken.value) return
  creating.value = true
  const source = roles.value.find((r) => r.id === copyFrom.value)
  const { data, error } = await supabase
    .from('account_roles')
    .insert({ account_id: store.accountId!, name: newName.value.trim().replace(/\s+/g, ' '), permissions: (source?.permissions ?? {}) as any })
    .select('id')
    .single()
  creating.value = false
  if (error) {
    // The database refuses a duplicate name too (another tab, another
    // admin); say it the same way the check above does.
    if (error.code === '23505') {
      await load()
      return
    }
    showToast(error.message, 'error', 8000)
    return
  }
  newOpen.value = false
  router.push(`/settings/roles/${data.id}`)
}

const TONES = ['bg-success-bg text-success-text', 'bg-warning-bg text-warning-text', 'bg-info-bg text-info-text', 'bg-brand-tint text-brand-text', 'bg-chip-bg text-ink-700']
function tone(i: number) {
  return TONES[i % TONES.length]
}
function initials(name: string) {
  return name.split(/\s+/).filter(Boolean).slice(0, 2).map((p) => p[0]?.toUpperCase()).join('') || '·'
}
function describe(r: RoleRow) {
  return displayRoleDescription(r.name, r.description, t)
}
</script>

<template>
  <div class="flex h-full flex-col">
    <header class="flex shrink-0 flex-wrap items-end gap-3 border-b border-line bg-surface px-4 py-3 sm:px-6">
      <div class="flex min-w-0 flex-1 flex-col gap-1">
        <nav :aria-label="t('Breadcrumb', 'Ruta')" class="flex items-center gap-1.5 text-[13px] text-ink-muted">
          <NuxtLink to="/settings" class="hover:underline">{{ t('Settings', 'Ajustes') }}</NuxtLink>
        </nav>
        <h1 class="text-[20px] font-bold text-ink-900">{{ t('Roles and permissions', 'Roles y permisos') }}</h1>
        <span class="text-[13px] text-ink-muted">{{ t('What each person on the team can see and do.', 'Qué puede ver y hacer cada persona del equipo.') }}</span>
      </div>
      <div class="flex gap-2">
        <NuxtLink
          to="/settings/roles/compare"
          data-cy="roles-compare"
          class="inline-flex h-9 touch:h-11 items-center rounded-ctl border border-line-control bg-surface px-3.5 text-[14px] font-semibold text-ink-700 hover:bg-surface-subtle"
        >
          {{ t('Compare roles', 'Comparar roles') }}
        </NuxtLink>
        <button type="button" data-cy="roles-new" class="h-9 touch:h-11 rounded-ctl bg-brand px-4 text-[14px] font-bold text-surface hover:bg-brand-hover" @click="openNew">
          {{ t('New role', 'Nuevo rol') }}
        </button>
      </div>
    </header>

    <div class="flex-1 overflow-y-auto">
      <div class="flex gap-8 p-4 sm:p-6">
        <SettingsNav />
        <div class="flex min-w-0 max-w-[820px] flex-1 flex-col gap-4" data-cy="roles-page" :data-ready="ready ? 'true' : undefined">
          <p class="rounded-ctl border border-line bg-surface-subtle px-3.5 py-3 text-[13.5px] leading-snug text-ink-700">
            {{ t('A role is a set of permissions. Each person is given one from their page in', 'Un rol es un conjunto de permisos. Se asigna a cada persona desde su ficha en') }}
            <NuxtLink to="/settings/team" class="font-semibold text-brand-text hover:underline">{{ t('Team', 'Equipo') }}</NuxtLink>.
            {{ t('Owners can do everything, whatever role they have.', 'Los propietarios lo pueden todo, tengan el rol que tengan.') }}
          </p>

          <div v-if="!ready" class="grid grid-cols-1 gap-3.5 md:grid-cols-2">
            <UiSkeleton v-for="i in 4" :key="i" class="h-[150px] rounded-card" />
          </div>
          <div v-else class="grid grid-cols-1 gap-3.5 md:grid-cols-2">
            <NuxtLink
              v-for="r in roles"
              :key="r.id"
              :to="`/settings/roles/${r.id}`"
              data-cy="role-card"
              :data-role-name="r.name"
              class="flex flex-col gap-2.5 rounded-card border border-line bg-surface px-5 py-4 hover:border-line-controlHover"
            >
              <div class="flex items-center gap-2.5">
                <strong class="flex-1 text-[16px] text-ink-900" data-cy="role-card-name">{{ displayRoleName(r.name, t) }}</strong>
                <span v-if="r.is_system" class="rounded-pill bg-chip-bg px-2.5 py-0.5 text-[12px] font-bold text-chip-text">{{ t('Fixed', 'Fijo') }}</span>
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="text-ink-muted" aria-hidden="true"><path d="M9 6l6 6-6 6" /></svg>
              </div>
              <span v-if="describe(r)" class="text-[13.5px] leading-snug text-ink-500">{{ describe(r) }}</span>
              <div class="flex flex-wrap gap-1.5">
                <template v-if="r.is_system">
                  <span class="rounded-pill bg-brand-tint px-2.5 py-0.5 text-[12px] font-bold text-brand-text">{{ t('Everything', 'Todo') }}</span>
                </template>
                <span v-for="chip in summaryChips(r.permissions, t)" v-else :key="chip" class="rounded-pill bg-chip-bg px-2.5 py-0.5 text-[12px] font-bold text-chip-text">{{ chip }}</span>
              </div>
              <div class="flex items-center gap-2" data-cy="role-card-people">
                <div class="flex gap-1">
                  <span
                    v-for="(m, i) in (membersByRole.get(r.id) ?? []).slice(0, 4)"
                    :key="m.id"
                    :title="m.full_name"
                    class="inline-flex h-[30px] w-[30px] items-center justify-center rounded-full text-[12px] font-bold"
                    :class="tone(i)"
                    data-cy="role-card-avatar"
                  >
                    {{ initials(m.full_name) }}
                  </span>
                </div>
                <span v-if="(membersByRole.get(r.id) ?? []).length" class="text-[13px] text-ink-500" data-cy="role-card-count">
                  {{ (membersByRole.get(r.id) ?? []).length === 1 ? t('1 person', '1 persona') : t(`${(membersByRole.get(r.id) ?? []).length} people`, `${(membersByRole.get(r.id) ?? []).length} personas`) }}
                </span>
                <span v-else class="text-[13px] text-ink-muted" data-cy="role-card-count">{{ t('Nobody has this role', 'Nadie tiene este rol') }}</span>
              </div>
            </NuxtLink>
          </div>
        </div>
      </div>
    </div>

    <UiConfirmDialog
      v-if="newOpen"
      :title="t('New role', 'Nuevo rol')"
      :confirm-label="creating ? t('Creating…', 'Creando…') : t('Create and edit', 'Crear y editar')"
      :cancel-label="t('Cancel', 'Cancelar')"
      :busy="creating"
      @confirm="createRole"
      @cancel="newOpen = false"
    >
      <form class="flex flex-col gap-4" data-cy="role-new-form" @submit.prevent="createRole">
        <label class="flex flex-col gap-1.5 text-[13px] font-semibold text-ink-700">
          {{ t('Name', 'Nombre') }}
          <input
            v-model="newName"
            data-cy="role-new-name"
            type="text"
            maxlength="60"
            autocomplete="off"
            class="h-9 touch:h-11 rounded-ctl border bg-surface px-3 text-[15px] font-normal text-ink-900 focus:border-brand focus:outline-none focus:ring-1 focus:ring-brand"
            :class="newTried && (nameEmpty || nameTaken) ? 'border-danger-text' : 'border-line-control'"
            :aria-invalid="newTried && (nameEmpty || nameTaken) ? 'true' : undefined"
            aria-describedby="role-new-name-error"
          />
          <span v-if="newTried && nameEmpty" id="role-new-name-error" class="text-[12.5px] font-semibold text-danger-text" data-cy="role-new-error">{{ t('A role needs a name.', 'El rol necesita un nombre.') }}</span>
          <span v-else-if="nameTaken" id="role-new-name-error" class="text-[12.5px] font-semibold text-danger-text" data-cy="role-new-error">
            {{ t(`"${displayRoleName(nameTaken.name, t)}" already exists. Choose another name, for example "${newName.trim()} (afternoons)".`, `«${displayRoleName(nameTaken.name, t)}» ya existe. Elige otro nombre, por ejemplo «${newName.trim()} de tarde».`) }}
          </span>
        </label>
        <label class="flex flex-col gap-1.5 text-[13px] font-semibold text-ink-700">
          {{ t('Start with the permissions of', 'Empezar con los permisos de') }}
          <select
            v-model="copyFrom"
            data-cy="role-new-copy"
            class="h-9 touch:h-11 rounded-ctl border border-line-control bg-surface px-3 text-[15px] font-normal text-ink-900 focus:border-brand focus:outline-none focus:ring-1 focus:ring-brand"
          >
            <option v-for="r in roles" :key="r.id" :value="r.id">{{ displayRoleName(r.name, t) }}</option>
            <option value="">{{ t('None', 'Ninguno') }}</option>
          </select>
          <span class="text-[12.5px] font-normal leading-snug text-ink-muted">{{ t('You adjust them afterwards. "None" starts with no permissions.', 'Luego los ajustas. «Ninguno» empieza sin permisos.') }}</span>
        </label>
      </form>
    </UiConfirmDialog>
  </div>
</template>
