<script setup lang="ts">
import {
  displayRoleName,
  permissionGroups,
  roleNameTaken,
  rowValue,
  setFinancialsMode,
  permissionsWithDefaults,
  type FinancialsMode,
  type PermissionRow,
  type RolePermissions,
} from '~/utils/rolePermissions'

// One role: its name and what it is for, who holds it, and every permission
// in plain words grouped the way a clinic thinks about them. One Guardar for
// the page with the floating bar and leave guard from Settings > Clinics.
//
// The old page's Save button sat in the header, outside its <form>, so the
// name input's `required` never ran and a role could be saved nameless; and
// it saved a clinic's own role over the one being edited without asking even
// when the change locked the editor out of this very page.

const supabase = useSupabaseClient()
const store = useAccountStore()
const route = useRoute()
const router = useRouter()
const t = useT()
const { showToast } = useToast()
const { can } = usePermission()
const roleId = route.params.id as string

interface Form {
  name: string
  description: string
  permissions: RolePermissions
}
interface Member {
  id: string
  full_name: string
}

const loaded = ref(false)
const missing = ref(false)
const isSystem = ref(false)
const storedName = ref('')
const form = ref<Form | null>(null)
const original = ref('')
const members = ref<Member[]>([])
const pendingInvites = ref(0)
const otherRoles = ref<{ id: string; name: string; is_system: boolean }[]>([])

async function load() {
  const [r, m, all, inv] = await Promise.all([
    supabase.from('account_roles').select('id, name, description, is_system, permissions').eq('id', roleId).maybeSingle(),
    supabase.from('team_members').select('id, full_name').eq('role_id', roleId).is('deleted_at', null).order('full_name'),
    supabase.from('account_roles').select('id, name, is_system').order('is_system', { ascending: false }).order('name'),
    // Readable only with the Team permission (the invites policy); without
    // it this is 0, and delete_account_role moves them regardless.
    supabase.from('account_invites').select('id', { count: 'exact', head: true }).eq('role_id', roleId).is('accepted_at', null),
  ])
  if (r.error || !r.data) {
    missing.value = true
    loaded.value = true
    return
  }
  isSystem.value = r.data.is_system
  storedName.value = r.data.name
  form.value = { name: r.data.name, description: r.data.description ?? '', permissions: permissionsWithDefaults(r.data.permissions) }
  original.value = JSON.stringify(form.value)
  members.value = (m.data ?? []) as Member[]
  otherRoles.value = ((all.data ?? []) as { id: string; name: string; is_system: boolean }[]).filter((x) => x.id !== roleId)
  pendingInvites.value = inv.count ?? 0
  loaded.value = true
}
onMounted(load)

const groups = computed(() => permissionGroups(t))
const dirty = computed(() => !!form.value && !isSystem.value && JSON.stringify(form.value) !== original.value)
const savedForm = computed<Form | null>(() => (original.value ? JSON.parse(original.value) : null))

// Showing the stored English name for a default role would read as a
// different role to a Spanish-speaking owner; the input shows it translated
// until someone actually types a new name.
const shownTitle = computed(() => (form.value && form.value.name === storedName.value ? displayRoleName(storedName.value, t) : (form.value?.name ?? '')))
const nameInput = computed({
  get: () => (form.value && form.value.name === storedName.value ? displayRoleName(storedName.value, t) : (form.value?.name ?? '')),
  set: (v: string) => {
    if (!form.value) return
    // Typing the translated default back exactly is keeping the name.
    form.value.name = v === displayRoleName(storedName.value, t) ? storedName.value : v
  },
})
const nameEmpty = computed(() => !!form.value && !form.value.name.trim())
const nameTaken = computed(() => (form.value && form.value.name !== storedName.value ? roleNameTaken(form.value.name, otherRoles.value) : null))

function permValue(row: PermissionRow) {
  return form.value ? rowValue(form.value.permissions, row) : false
}
function setValue(row: PermissionRow, value: string | boolean) {
  if (!form.value) return
  const p = form.value.permissions
  if (row.kind === 'toggle') p[row.key] = value === true
  else if (row.key === 'financials') setFinancialsMode(p, value as FinancialsMode)
  else (p as unknown as Record<string, string>)[row.key] = value as string
}

// --- Whose role is this? ----------------------------------------------------------
const isMine = computed(() => !!store.teamMember && members.value.some((m) => m.id === store.teamMember!.id))
// Would saving take away the viewer's own way back into this page? Owners
// pass every check whatever their role says, so it cannot lock them out.
const locksMeOut = computed(() => {
  if (!isMine.value || store.isOwner || !form.value || !savedForm.value) return false
  const before = savedForm.value.permissions
  const after = form.value.permissions
  return (before.roles_admin && !after.roles_admin) || (before.settings_access && !after.settings_access)
})

// --- Save / discard -------------------------------------------------------------
const saving = ref(false)
const tried = ref(false)
const selfOpen = ref(false)

function save() {
  if (!form.value) return
  tried.value = true
  if (nameEmpty.value || nameTaken.value) {
    showToast(t('The name needs fixing before this can be saved.', 'Hay que corregir el nombre antes de guardar.'), 'error')
    return
  }
  if (locksMeOut.value) {
    selfOpen.value = true
    return
  }
  doSave()
}

async function doSave() {
  if (!form.value) return
  selfOpen.value = false
  saving.value = true
  const lockingOut = locksMeOut.value
  const values = {
    name: form.value.name.trim().replace(/\s+/g, ' '),
    description: form.value.description.trim() || null,
    permissions: form.value.permissions as any,
  }
  const { error } = await supabase.from('account_roles').update(values).eq('id', roleId).select('id').single()
  saving.value = false
  if (error) {
    if (error.code === '23505') {
      showToast(t(`A role called "${values.name}" already exists.`, `Ya hay un rol llamado «${values.name}».`), 'error', 8000)
      return
    }
    showToast(error.message, 'error', 8000)
    return
  }
  form.value.name = values.name
  storedName.value = values.name
  form.value.description = values.description ?? ''
  original.value = JSON.stringify(form.value)
  tried.value = false
  // Permissions are read from the store everywhere in the app; after
  // changing their own role, the viewer should get the new ones now rather
  // than on their next full page load.
  if (isMine.value) await store.load()
  showToast(t('Saved', 'Guardado'))
  if (lockingOut) {
    pendingLeave.value = '/dashboard'
    router.push('/dashboard')
  }
}

function discard() {
  if (!savedForm.value) return
  form.value = JSON.parse(original.value)
  tried.value = false
}

// --- Leaving with unsaved changes -------------------------------------------------
const pendingLeave = ref<string | null>(null)
onBeforeRouteLeave((to) => {
  if (!dirty.value || pendingLeave.value === to.fullPath) return true
  pendingLeave.value = to.fullPath
  leaveOpen.value = true
  return false
})
const leaveOpen = ref(false)
function leaveAnyway() {
  const to = pendingLeave.value
  leaveOpen.value = false
  if (to) router.push(to)
}
function stayHere() {
  leaveOpen.value = false
  pendingLeave.value = null
}
function onBeforeUnload(e: BeforeUnloadEvent) {
  if (dirty.value) e.preventDefault()
}
onMounted(() => window.addEventListener('beforeunload', onBeforeUnload))
onUnmounted(() => window.removeEventListener('beforeunload', onBeforeUnload))

// --- Delete -----------------------------------------------------------------------
// People first: a role deleted from under someone leaves them with no role at
// all, and no role is no permissions -- the next page load shows them an empty
// app. delete_account_role moves them (and pending invites) in the same
// transaction as the delete.
const deleteOpen = ref(false)
const deleting = ref(false)
const moveTo = ref('')
const moveTargets = computed(() => otherRoles.value.filter((r) => !r.is_system))
const hasHolders = computed(() => members.value.length > 0 || pendingInvites.value > 0)
const deleteBlocked = computed(() => {
  if (!hasHolders.value) return ''
  if (!can('team_admin')) return t('Moving people to another role needs the Team permission. Ask an owner or a team admin.', 'Pasar a personas a otro rol necesita el permiso de Equipo. Pídeselo a un propietario o a quien lleve el equipo.')
  if (isMine.value && !store.isOwner) return t('You have this role yourself, and only an owner can change your role.', 'Tienes este rol tú mismo, y solo un propietario puede cambiarte de rol.')
  if (moveTargets.value.length === 0) return t('There is no other role to move them to. Create one first.', 'No hay otro rol al que pasarlas. Crea uno antes.')
  return ''
})

function openDelete() {
  moveTo.value = moveTargets.value.find((r) => r.name === 'Front Desk')?.id ?? moveTargets.value[0]?.id ?? ''
  deleteOpen.value = true
}

async function remove() {
  deleting.value = true
  const { error } = await supabase.rpc('delete_account_role', { p_role_id: roleId, p_move_to_role_id: hasHolders.value ? moveTo.value : undefined })
  deleting.value = false
  if (error) {
    showToast(error.message, 'error', 8000)
    return
  }
  deleteOpen.value = false
  showToast(t('Role deleted', 'Rol eliminado'))
  pendingLeave.value = '/settings/roles'
  router.push('/settings/roles')
}

const peopleLabel = computed(() => {
  const n = members.value.length
  if (n === 0) return t('Nobody has this role', 'Nadie tiene este rol')
  return n === 1 ? t('1 person has this role', '1 persona con este rol') : t(`${n} people have this role`, `${n} personas con este rol`)
})
const holdersSentence = computed(() => {
  const names = members.value.map((m) => m.full_name)
  const people = names.length === 0 ? '' : names.length <= 3 ? names.join(', ') : `${names.slice(0, 3).join(', ')}…`
  const parts: string[] = []
  if (names.length) parts.push(t(`${names.length === 1 ? '1 person' : `${names.length} people`}: ${people}`, `${names.length === 1 ? '1 persona' : `${names.length} personas`}: ${people}`))
  if (pendingInvites.value) parts.push(t(`${pendingInvites.value} pending invite${pendingInvites.value === 1 ? '' : 's'}`, `${pendingInvites.value} invitación${pendingInvites.value === 1 ? '' : 'es'} pendiente${pendingInvites.value === 1 ? '' : 's'}`))
  return parts.join(t(' and ', ' y '))
})

const TONES = ['bg-success-bg text-success-text', 'bg-warning-bg text-warning-text', 'bg-info-bg text-info-text', 'bg-brand-tint text-brand-text', 'bg-chip-bg text-ink-700']
function initials(name: string) {
  return name.split(/\s+/).filter(Boolean).slice(0, 2).map((p) => p[0]?.toUpperCase()).join('') || '·'
}
const inputClass = 'h-11 rounded-ctl border bg-surface px-3 text-[15px] font-normal text-ink-900 focus:border-brand focus:outline-none focus:ring-1 focus:ring-brand disabled:bg-surface-subtle disabled:text-ink-muted'
const hint = 'text-[12.5px] font-normal leading-snug text-ink-muted'
</script>

<template>
  <div class="relative flex h-full flex-col">
    <header class="flex shrink-0 flex-col gap-1.5 border-b border-line bg-surface px-4 py-3 sm:px-6">
      <nav :aria-label="t('Breadcrumb', 'Ruta')" class="flex items-center gap-1.5 text-[13px] text-ink-muted">
        <NuxtLink to="/settings" class="hover:underline">{{ t('Settings', 'Ajustes') }}</NuxtLink>
        <span aria-hidden="true">›</span>
        <NuxtLink to="/settings/roles" class="font-semibold text-brand-text hover:underline" data-cy="role-back">{{ t('Roles and permissions', 'Roles y permisos') }}</NuxtLink>
      </nav>
      <div v-if="form" class="flex flex-wrap items-center gap-3">
        <h1 class="text-[20px] font-bold text-ink-900" data-cy="role-title">{{ shownTitle || t('Untitled', 'Sin nombre') }}</h1>
        <span v-if="isSystem" class="rounded-pill bg-chip-bg px-2.5 py-0.5 text-[12.5px] font-bold text-chip-text">{{ t('Fixed', 'Fijo') }}</span>
      </div>
      <span v-if="form" class="text-[13px] text-ink-muted" data-cy="role-people-count">{{ peopleLabel }}</span>
    </header>

    <div class="flex-1 overflow-y-auto">
      <div class="flex gap-8 p-4 pb-32 sm:p-6 sm:pb-32">
        <SettingsNav />
        <p v-if="loaded && missing" class="text-[14px] text-ink-muted" data-cy="role-missing">
          {{ t('This role does not exist, or is not yours.', 'Este rol no existe o no es tuyo.') }}
          <NuxtLink to="/settings/roles" class="text-brand-text hover:underline">{{ t('Back to roles', 'Volver a roles') }}</NuxtLink>
        </p>
        <template v-else-if="form">
          <nav :aria-label="t('Sections', 'Secciones')" class="sticky top-0 hidden w-[180px] shrink-0 flex-col gap-0.5 self-start 2xl:flex">
            <a href="#rol" class="flex min-h-10 items-center rounded-ctlSm px-3 text-[14px] text-ink-700 hover:bg-surface-subtle">{{ t('The role', 'El rol') }}</a>
            <a href="#personas" class="flex min-h-10 items-center rounded-ctlSm px-3 text-[14px] text-ink-700 hover:bg-surface-subtle">{{ t('People', 'Personas') }}</a>
            <a v-for="g in groups" :key="g.id" :href="`#${g.id}`" class="flex min-h-10 items-center rounded-ctlSm px-3 text-[14px] text-ink-700 hover:bg-surface-subtle">{{ g.title }}</a>
          </nav>

          <main class="flex min-w-0 max-w-[820px] flex-1 flex-col gap-5" data-cy="role-page" :data-ready="loaded ? 'true' : undefined">
            <p v-if="isSystem" class="rounded-ctl border border-line bg-surface-subtle px-3.5 py-3 text-[13.5px] leading-snug text-ink-700" data-cy="role-owner-note">
              {{ t("This is the account owner's role and it cannot be edited. An owner can do everything whatever role they hold -- what decides it is being an owner, not the role -- so nobody, the owner included, can be locked out by mistake here. Owners are made from their page in Team.", 'Este es el rol del propietario de la cuenta y no se puede editar. Un propietario lo puede todo tenga el rol que tenga -- lo que lo decide es ser propietario, no el rol --, así que nadie, ni el propio propietario, puede quedarse sin acceso por error desde aquí. Los propietarios se nombran desde su ficha en Equipo.') }}
            </p>

            <!-- El rol -->
            <section id="rol" aria-labelledby="h-rol" class="flex scroll-mt-4 flex-col gap-4 rounded-card border border-line bg-surface p-5 sm:p-6">
              <h2 id="h-rol" class="text-[16px] font-bold text-ink-900">{{ t('The role', 'El rol') }}</h2>
              <label class="flex flex-col gap-1.5 text-[13px] font-semibold text-ink-700">
                {{ t('Name', 'Nombre') }}
                <input
                  v-model="nameInput"
                  data-cy="role-name"
                  type="text"
                  maxlength="60"
                  autocomplete="off"
                  :disabled="isSystem"
                  :aria-invalid="(tried && nameEmpty) || nameTaken ? 'true' : undefined"
                  :class="[inputClass, (tried && nameEmpty) || nameTaken ? 'border-danger-text' : 'border-line-control']"
                />
                <span v-if="tried && nameEmpty" class="text-[12.5px] font-semibold text-danger-text" data-cy="role-name-error">{{ t('A role needs a name.', 'El rol necesita un nombre.') }}</span>
                <span v-else-if="nameTaken" class="text-[12.5px] font-semibold text-danger-text" data-cy="role-name-error">
                  {{ t(`"${displayRoleName(nameTaken.name, t)}" already exists. Choose another name.`, `«${displayRoleName(nameTaken.name, t)}» ya existe. Elige otro nombre.`) }}
                </span>
              </label>
              <label class="flex flex-col gap-1.5 text-[13px] font-semibold text-ink-700">
                {{ t('Description (optional)', 'Descripción (opcional)') }}
                <textarea
                  v-model="form.description"
                  data-cy="role-description"
                  rows="2"
                  maxlength="300"
                  :disabled="isSystem"
                  :class="[inputClass, 'h-[72px] resize-y border-line-control py-2.5 leading-snug']"
                />
                <span :class="hint">{{ t("Shown on the roles list and when choosing someone's role.", 'Se ve en la lista de roles y al elegir el rol de alguien.') }}</span>
              </label>
            </section>

            <!-- Personas -->
            <section id="personas" aria-labelledby="h-personas" class="flex scroll-mt-4 flex-col gap-4 rounded-card border border-line bg-surface p-5 sm:p-6">
              <div class="flex flex-col gap-1">
                <h2 id="h-personas" class="text-[16px] font-bold text-ink-900">{{ t(`People with this role · ${members.length}`, `Personas con este rol · ${members.length}`) }}</h2>
                <p class="text-[13px] text-ink-muted">{{ t("Changed from each person's page.", 'Se cambia desde la ficha de cada persona.') }}</p>
              </div>
              <div v-if="members.length" class="flex flex-wrap gap-2.5">
                <NuxtLink
                  v-for="(m, i) in members"
                  :key="m.id"
                  :to="`/settings/team/${m.id}`"
                  data-cy="role-member"
                  class="flex h-11 items-center gap-2.5 rounded-pill border border-line pl-1.5 pr-3.5 text-[14px] font-semibold text-ink-900 hover:bg-surface-subtle"
                >
                  <span class="inline-flex h-8 w-8 items-center justify-center rounded-full text-[12px] font-bold" :class="TONES[i % TONES.length]" aria-hidden="true">{{ initials(m.full_name) }}</span>
                  {{ m.full_name }}
                </NuxtLink>
              </div>
              <p v-else class="text-[13.5px] text-ink-muted">{{ t('Nobody has this role yet.', 'Todavía nadie tiene este rol.') }}</p>
            </section>

            <!-- Permisos -->
            <section
              v-for="g in groups"
              :id="g.id"
              :key="g.id"
              :aria-labelledby="`h-${g.id}`"
              class="flex scroll-mt-4 flex-col gap-1 rounded-card border border-line bg-surface p-5 sm:p-6"
              data-cy="role-group"
            >
              <div class="flex flex-col gap-1 pb-3">
                <h2 :id="`h-${g.id}`" class="text-[16px] font-bold text-ink-900">{{ g.title }}</h2>
                <p v-if="g.subtitle" class="text-[13px] leading-snug text-ink-muted">{{ g.subtitle }}</p>
              </div>
              <SettingsRolePermissionRow
                v-for="row in g.rows"
                :key="row.key"
                :row="row"
                :model-value="permValue(row)"
                :disabled="isSystem"
                @update:model-value="setValue(row, $event)"
              />
            </section>

            <p v-if="isMine && !store.isOwner" class="rounded-ctl border border-warning-border bg-warning-bg px-3.5 py-3 text-[13.5px] leading-snug text-warning-text" data-cy="role-is-mine">
              {{ t('This is your own role: what you change here applies to you as soon as it is saved.', 'Es tu propio rol: lo que cambies aquí se te aplica en cuanto guardes.') }}
            </p>

            <!-- Eliminar -->
            <section v-if="!isSystem" id="eliminar" aria-labelledby="h-eliminar" class="flex scroll-mt-4 flex-col gap-3 rounded-card border border-line bg-surface p-5 sm:p-6">
              <h2 id="h-eliminar" class="text-[16px] font-bold text-ink-900">{{ t('Delete the role', 'Eliminar el rol') }}</h2>
              <div class="flex flex-wrap items-center gap-3.5">
                <span class="min-w-[240px] flex-1 text-[13.5px] leading-snug text-ink-500">
                  <template v-if="hasHolders">{{ t(`Its ${holdersSentence} move to another role first, so nobody is left without permissions.`, `Primero hay que pasar a otro rol a ${holdersSentence}, para que nadie se quede sin permisos.`) }}</template>
                  <template v-else>{{ t('Nobody has it, so it can be deleted straight away.', 'Nadie lo tiene, así que se puede eliminar directamente.') }}</template>
                </span>
                <button
                  type="button"
                  data-cy="role-delete"
                  class="h-11 shrink-0 rounded-ctl border border-danger-border bg-surface px-3.5 text-[14px] font-semibold text-danger-text hover:bg-danger-bg"
                  @click="openDelete"
                >
                  {{ t('Delete…', 'Eliminar…') }}
                </button>
              </div>
            </section>
          </main>
        </template>
      </div>
    </div>

    <!-- One save for the whole page. -->
    <div
      v-if="dirty"
      role="region"
      :aria-label="t('Unsaved changes', 'Cambios sin guardar')"
      data-cy="role-save-bar"
      class="absolute bottom-6 left-1/2 flex w-[min(820px,calc(100%-32px))] -translate-x-1/2 items-center gap-2.5 rounded-card bg-ink-900 py-3 pl-5 pr-3 text-surface-page shadow-popover"
    >
      <span class="flex-1 text-[14px] font-semibold">{{ t('Unsaved changes', 'Cambios sin guardar') }}</span>
      <button type="button" data-cy="role-discard" class="h-11 rounded-ctl border border-surface-page/30 px-3.5 text-[14px] font-semibold" @click="discard">
        {{ t('Discard', 'Descartar') }}
      </button>
      <button type="button" data-cy="role-save" :disabled="saving" class="h-11 rounded-ctl bg-brand px-4 text-[14px] font-bold text-surface disabled:opacity-70" @click="save">
        {{ saving ? t('Saving…', 'Guardando…') : t('Save changes', 'Guardar cambios') }}
      </button>
    </div>

    <UiConfirmDialog
      v-if="selfOpen && form"
      :title="form.permissions.roles_admin ? t('Take away your own access to Settings?', '¿Quitarte a ti mismo el acceso a Ajustes?') : t('Take away your own \'Roles and permissions\'?', '¿Quitarte a ti mismo «Roles y permisos»?')"
      :confirm-label="t('Save anyway', 'Guardar igualmente')"
      :cancel-label="t('Cancel', 'Cancelar')"
      :busy="saving"
      @confirm="doSave"
      @cancel="selfOpen = false"
    >
      <p class="text-[14px] leading-relaxed text-ink-500" data-cy="role-self-warning">
        {{ t('This is your own role. Once saved you will no longer be able to open this page, and only an owner or someone else with this permission can give it back to you.', 'Es tu propio rol. Al guardar dejarás de poder entrar en esta página, y solo un propietario u otra persona con este permiso podrá devolvértelo.') }}
      </p>
    </UiConfirmDialog>

    <UiConfirmDialog
      v-if="deleteOpen && form"
      tone="danger"
      :title="t(`Delete the ${shownTitle} role?`, `¿Eliminar el rol ${shownTitle}?`)"
      :confirm-label="hasHolders ? t('Move and delete', 'Pasar y eliminar') : t('Delete role', 'Eliminar rol')"
      :cancel-label="t('Cancel', 'Cancelar')"
      :busy="deleting"
      :disabled="!!deleteBlocked || (hasHolders && !moveTo)"
      @confirm="remove"
      @cancel="deleteOpen = false"
    >
      <template v-if="hasHolders">
        <p class="text-[14px] leading-relaxed text-ink-500">
          {{ t(`It has ${holdersSentence}. Move them to another role so they are not left without permissions.`, `Tiene ${holdersSentence}. Pásalas a otro rol para que no se queden sin permisos.`) }}
        </p>
        <p v-if="deleteBlocked" class="rounded-ctl border border-warning-border bg-warning-bg px-3.5 py-3 text-[13.5px] leading-snug text-warning-text" data-cy="role-delete-blocked">{{ deleteBlocked }}</p>
        <label v-else class="flex flex-col gap-1.5 text-[13px] font-semibold text-ink-700">
          {{ t('Move them to the role', 'Pasar a sus personas al rol') }}
          <select v-model="moveTo" data-cy="role-delete-target" :class="[inputClass, 'border-line-control']">
            <option v-for="r in moveTargets" :key="r.id" :value="r.id">{{ displayRoleName(r.name, t) }}</option>
          </select>
        </label>
      </template>
      <p v-else class="text-[14px] leading-relaxed text-ink-500">{{ t('Nobody has this role. This cannot be undone.', 'Nadie tiene este rol. Esto no se puede deshacer.') }}</p>
    </UiConfirmDialog>

    <UiConfirmDialog
      v-if="leaveOpen"
      :title="t('Leave without saving?', '¿Salir sin guardar?')"
      :confirm-label="t('Leave without saving', 'Salir sin guardar')"
      :cancel-label="t('Keep editing', 'Seguir editando')"
      @confirm="leaveAnyway"
      @cancel="stayHere"
    >
      <p class="text-[14px] leading-relaxed text-ink-500">{{ t(`The changes to the permissions of "${shownTitle}" have not been saved.`, `Los cambios en los permisos de «${shownTitle}» no se han guardado.`) }}</p>
    </UiConfirmDialog>
  </div>
</template>
