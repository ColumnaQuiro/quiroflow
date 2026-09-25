<script setup lang="ts">
import { displayRoleName, permissionGroups, rowValueLabel, permissionsWithDefaults, type RolePermissions } from '~/utils/rolePermissions'

// Every permission, role by role. The question owners actually ask -- "what
// can Recepción do that Profesional cannot?" -- used to mean opening two
// roles in two tabs and comparing thirty switches by eye.

const supabase = useSupabaseClient()
const t = useT()

interface RoleRow {
  id: string
  name: string
  is_system: boolean
  permissions: RolePermissions
}
const roles = ref<RoleRow[]>([])
const ready = ref(false)

onMounted(async () => {
  const { data } = await supabase.from('account_roles').select('id, name, is_system, permissions').order('is_system', { ascending: false }).order('name')
  roles.value = ((data ?? []) as any[]).map((r) => ({ ...r, permissions: permissionsWithDefaults(r.permissions) }))
  ready.value = true
})

const groups = computed(() => permissionGroups(t))

function cell(r: RoleRow, row: Parameters<typeof rowValueLabel>[1]) {
  // The Owner role's stored permissions are complete, but what it can do is
  // decided by being an owner: say that rather than whatever is stored.
  if (r.is_system) {
    if (row.kind === 'toggle') return row.key === 'calendar_read_only' || row.key === 'reports_own_only' ? '—' : t('Yes', 'Sí')
    const widest = row.options.find((o) => o.value === 'all') ?? row.options[0]
    return widest.short ?? widest.label
  }
  return rowValueLabel(r.permissions, row, t)
}
</script>

<template>
  <div class="flex h-full flex-col">
    <header class="flex shrink-0 flex-col gap-1.5 border-b border-line bg-surface px-4 py-3 sm:px-6">
      <nav :aria-label="t('Breadcrumb', 'Ruta')" class="flex items-center gap-1.5 text-[13px] text-ink-muted">
        <NuxtLink to="/settings" class="hover:underline">{{ t('Settings', 'Ajustes') }}</NuxtLink>
        <span aria-hidden="true">›</span>
        <NuxtLink to="/settings/roles" class="font-semibold text-brand-text hover:underline">{{ t('Roles and permissions', 'Roles y permisos') }}</NuxtLink>
      </nav>
      <h1 class="text-[20px] font-bold text-ink-900">{{ t('Compare roles', 'Comparar roles') }}</h1>
      <span class="text-[13px] text-ink-muted">{{ t('Every permission, role by role. Select a role to edit it.', 'Cada permiso, rol por rol. Pulsa un rol para editarlo.') }}</span>
    </header>

    <div class="flex-1 overflow-y-auto">
      <div class="flex gap-8 p-4 sm:p-6">
        <SettingsNav />
        <div class="min-w-0 flex-1" data-cy="roles-compare-page" :data-ready="ready ? 'true' : undefined">
          <UiSkeleton v-if="!ready" class="h-[480px] w-full max-w-[980px] rounded-card" />
          <!-- The table scrolls sideways inside its own frame on a phone; the
               page itself never does. -->
          <div v-else class="max-w-[980px] overflow-x-auto rounded-card border border-line bg-surface">
            <table class="w-full min-w-[560px] border-collapse text-[14px]" :aria-label="t('Role comparison', 'Comparación de roles')" data-cy="roles-compare-table">
              <thead>
                <tr class="bg-surface-subtle">
                  <th scope="col" class="sticky left-0 z-10 border-b border-line bg-surface-subtle px-4 py-3.5 text-left">
                    <span class="sr-only">{{ t('Permission', 'Permiso') }}</span>
                  </th>
                  <th v-for="r in roles" :key="r.id" scope="col" class="border-b border-line px-4 py-3.5 text-left text-[14.5px] font-bold">
                    <NuxtLink :to="`/settings/roles/${r.id}`" class="text-ink-900 hover:text-brand-text hover:underline" data-cy="roles-compare-role">{{ displayRoleName(r.name, t) }}</NuxtLink>
                  </th>
                </tr>
              </thead>
              <tbody v-for="g in groups" :key="g.id">
                <tr>
                  <th :colspan="roles.length + 1" scope="colgroup" class="px-4 pb-1.5 pt-3.5 text-left text-[12px] font-bold uppercase tracking-[.04em] text-ink-muted">{{ g.title }}</th>
                </tr>
                <tr v-for="row in g.rows" :key="row.key" data-cy="roles-compare-row" :data-key="row.key">
                  <th scope="row" class="sticky left-0 border-t border-line-row bg-surface px-4 py-2.5 text-left font-normal text-ink-900">{{ row.short ?? row.label }}</th>
                  <td
                    v-for="r in roles"
                    :key="r.id"
                    class="border-t border-line-row px-4 py-2.5"
                    :class="cell(r, row) === '—' ? 'text-ink-muted' : 'font-semibold text-ink-900'"
                    :data-role="r.name"
                  >
                    {{ cell(r, row) }}
                  </td>
                </tr>
              </tbody>
            </table>
          </div>
        </div>
      </div>
    </div>
  </div>
</template>
