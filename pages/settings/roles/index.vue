<script setup lang="ts">
const supabase = useSupabaseClient()
const store = useAccountStore()
const router = useRouter()
const t = useT()

interface RoleRow {
  id: string
  name: string
  is_system: boolean
}

const roles = ref<RoleRow[]>([])
const loading = ref(true)
const creating = ref(false)
const error = ref('')

async function load() {
  loading.value = true
  const { data } = await supabase.from('account_roles').select('id, name, is_system').order('is_system', { ascending: false }).order('name')
  roles.value = data ?? []
  loading.value = false
}
onMounted(load)

async function createRole() {
  error.value = ''
  creating.value = true
  const { data, error: insertError } = await supabase
    .from('account_roles')
    .insert({ account_id: store.accountId!, name: 'New role', permissions: {} })
    .select('id')
    .single()
  creating.value = false
  if (insertError) {
    error.value = insertError.message
    return
  }
  router.push(`/settings/roles/${data.id}`)
}

async function deleteRole(role: RoleRow) {
  if (role.is_system) return
  if (!confirm(t(`Delete the "${role.name}" role? Team members using it will need a new role assigned.`, `¿Eliminar el rol "${role.name}"? Los miembros del equipo que lo usen necesitarán que se les asigne un rol nuevo.`))) return
  await supabase.from('account_roles').delete().eq('id', role.id)
  await load()
}
</script>

<template>
  <div class="flex h-full flex-col">
    <PageHeader :title="t('Roles & Permissions', 'Roles y Permisos')">
      <UiBtn variant="primary" :disabled="creating" @click="createRole">{{ creating ? t('Creating…', 'Creando…') : t('+ New Role', '+ Nuevo Rol') }}</UiBtn>
    </PageHeader>
    <div class="flex-1 overflow-y-auto">
      <div class="flex gap-8 p-6">
        <SettingsNav />
        <div class="min-w-0 max-w-[660px] flex-1">
          <p class="text-[13px] text-ink-muted2">
            {{ t('Control what each role can see and do. Assign a role to a team member from', 'Controla qué puede ver y hacer cada rol. Asigna un rol a un miembro del equipo desde') }}
            <NuxtLink to="/settings/team" class="text-brand-text hover:text-brand-hover">{{ t('Team Members', 'Miembros del Equipo') }}</NuxtLink>.
          </p>

          <div class="mt-4 overflow-hidden rounded-card border border-line bg-surface shadow-card">
            <table class="w-full text-[13px]">
              <thead class="border-b border-line bg-surface-subtle text-left text-[11px] font-[640] uppercase tracking-[.04em] text-ink-muted2">
                <tr>
                  <th class="px-4 py-2">{{ t('Role', 'Rol') }}</th>
                  <th class="px-4 py-2"></th>
                </tr>
              </thead>
              <tbody class="divide-y divide-line-row">
                <tr v-if="loading">
                  <td colspan="2" class="px-4 py-6 text-center text-ink-faint">{{ t('Loading…', 'Cargando…') }}</td>
                </tr>
                <tr v-else-if="roles.length === 0">
                  <td colspan="2" class="px-4 py-6 text-center text-ink-faint">{{ t('No roles yet.', 'Aún no hay roles.') }}</td>
                </tr>
                <tr v-for="r in roles" :key="r.id">
                  <td class="px-4 py-2.5">
                    <NuxtLink :to="`/settings/roles/${r.id}`" class="font-[560] text-ink-700 hover:text-brand-text">{{ r.name }}</NuxtLink>
                    <UiPill v-if="r.is_system" tone="neutral" class="ml-2">{{ t('Owner (fixed)', 'Propietario (fijo)') }}</UiPill>
                  </td>
                  <td class="px-4 py-2.5 text-right">
                    <button v-if="!r.is_system" type="button" class="text-ink-faint hover:text-danger-text" @click="deleteRole(r)">✕</button>
                  </td>
                </tr>
              </tbody>
            </table>
          </div>
          <p v-if="error" class="mt-2 text-[12.5px] text-danger-text">{{ error }}</p>
        </div>
      </div>
    </div>
  </div>
</template>
