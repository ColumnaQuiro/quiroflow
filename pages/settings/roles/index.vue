<script setup lang="ts">
const supabase = useSupabaseClient()
const store = useAccountStore()
const router = useRouter()

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
  if (!confirm(`Delete the "${role.name}" role? Team members using it will need a new role assigned.`)) return
  await supabase.from('account_roles').delete().eq('id', role.id)
  await load()
}
</script>

<template>
  <div class="flex gap-8">
    <SettingsNav />
    <div class="min-w-0 flex-1">
      <h1 class="text-xl font-semibold text-gray-900">Roles & Permissions</h1>
      <p class="mt-1 text-sm text-gray-500">
        Control what each role can see and do. Assign a role to a team member from
        <NuxtLink to="/settings/team" class="text-indigo-600 hover:text-indigo-700">Team Members</NuxtLink>.
      </p>

      <div class="mt-4 overflow-hidden rounded-lg border border-gray-200 bg-white">
        <table class="w-full text-sm">
          <thead class="border-b border-gray-200 bg-gray-50 text-left text-xs font-medium uppercase tracking-wide text-gray-500">
            <tr>
              <th class="px-4 py-2">Role</th>
              <th class="px-4 py-2"></th>
            </tr>
          </thead>
          <tbody class="divide-y divide-gray-100">
            <tr v-if="loading">
              <td colspan="2" class="px-4 py-6 text-center text-gray-400">Loading…</td>
            </tr>
            <tr v-else-if="roles.length === 0">
              <td colspan="2" class="px-4 py-6 text-center text-gray-400">No roles yet.</td>
            </tr>
            <tr v-for="r in roles" :key="r.id">
              <td class="px-4 py-2.5">
                <NuxtLink :to="`/settings/roles/${r.id}`" class="font-medium text-gray-900 hover:text-indigo-600">{{ r.name }}</NuxtLink>
                <span v-if="r.is_system" class="ml-2 rounded bg-gray-100 px-1.5 py-0.5 text-xs text-gray-500">🔒 Owner (fixed)</span>
              </td>
              <td class="px-4 py-2.5 text-right">
                <button v-if="!r.is_system" type="button" class="text-gray-400 hover:text-red-600" @click="deleteRole(r)">✕</button>
              </td>
            </tr>
          </tbody>
        </table>
      </div>

      <button
        type="button"
        :disabled="creating"
        class="mt-4 rounded-md bg-indigo-600 px-4 py-2 text-sm font-medium text-white hover:bg-indigo-700 disabled:opacity-50"
        @click="createRole"
      >
        {{ creating ? 'Creating…' : '+ New Role' }}
      </button>
      <p v-if="error" class="mt-2 text-sm text-red-600">{{ error }}</p>
    </div>
  </div>
</template>
