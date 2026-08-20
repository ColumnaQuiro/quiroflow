<script setup lang="ts">
const supabase = useSupabaseClient()
const route = useRoute()
const router = useRouter()
const roleId = route.params.id as string

interface Permissions {
  dashboard_scope: 'all' | 'own' | 'none'
  calendar_scope: 'all' | 'own' | 'none'
  patients_scope: 'all' | 'own' | 'none'
  calendar_read_only: boolean
  [key: string]: boolean | string
}

const DEFAULTS: Permissions = {
  dashboard_scope: 'none',
  calendar_scope: 'none',
  patients_scope: 'none',
  calendar_read_only: false,
  settings_access: false,
  roles_admin: false,
  team_admin: false,
  clinic_config: false,
  billing_config: false,
  communication_config: false,
  data_admin: false,
  billing_access: false,
  recalls_access: false,
  reports_access: false,
  reports_own_only: false,
  appointments_delete: false,
  patients_edit: false,
  patients_delete_merge: false,
  patients_tags_remove: false,
  financials_edit_all: false,
  financials_edit_same_day_only: false,
  payments_allocate: false,
  packages_edit: false,
  billing_history_view: false,
  patient_docs_delete: false,
  patient_files_delete: false,
  visit_notes_access: false,
  visit_notes_scope: 'own',
  visit_notes_edit: false,
  visit_notes_delete: false,
}

const name = ref('')
const isSystem = ref(false)
const permissions = ref<Permissions>({ ...DEFAULTS })
const loading = ref(true)
const saving = ref(false)
const saved = ref(false)
const error = ref('')
const notFound = ref(false)

async function load() {
  loading.value = true
  const { data } = await supabase.from('account_roles').select('name, is_system, permissions').eq('id', roleId).maybeSingle()
  if (!data) {
    notFound.value = true
    loading.value = false
    return
  }
  name.value = data.name
  isSystem.value = data.is_system
  permissions.value = { ...DEFAULTS, ...(data.permissions as Record<string, boolean | string>) }
  loading.value = false
}
onMounted(load)

const financialsEditMode = computed<'none' | 'same_day' | 'all'>({
  get: () => (permissions.value.financials_edit_all ? 'all' : permissions.value.financials_edit_same_day_only ? 'same_day' : 'none'),
  set: (mode) => {
    permissions.value.financials_edit_all = mode === 'all'
    permissions.value.financials_edit_same_day_only = mode === 'same_day'
  },
})

const generalToggles: { key: string; label: string; hint?: string }[] = [
  { key: 'settings_access', label: 'Settings', hint: 'Gates the whole Settings section — required for the sub-toggles below to have any effect' },
  { key: 'roles_admin', label: 'Roles & permission settings', hint: 'Requires Settings' },
  { key: 'team_admin', label: 'Team member administration', hint: 'Requires Settings' },
  { key: 'clinic_config', label: 'Clinic configuration', hint: 'Clinics, appointment types, calendar resources — requires Settings' },
  { key: 'billing_config', label: 'Billing configuration', hint: 'Services, packages, memberships, Stripe — requires Settings' },
  { key: 'communication_config', label: 'Communication configuration', hint: 'WhatsApp, document templates — requires Settings' },
  { key: 'data_admin', label: 'Data administration', hint: 'Import, migrations, webhooks — requires Settings' },
  { key: 'billing_access', label: 'Billing', hint: 'View/create invoices' },
  { key: 'recalls_access', label: 'Recalls & patient messaging' },
]

const reportsToggles: { key: string; label: string; hint?: string }[] = [
  { key: 'reports_access', label: 'Allow access to reports' },
  { key: 'reports_own_only', label: 'Only allow access to own reports', hint: 'Only meaningful when Calendar/Patients below are set to "Own only"' },
]

const patientToggles: { key: string; label: string; hint?: string }[] = [
  { key: 'appointments_delete', label: 'Delete appointments' },
  { key: 'patients_edit', label: 'Edit patients' },
  { key: 'patients_delete_merge', label: 'Delete and merge patients' },
  { key: 'patients_tags_remove', label: 'Remove membership/package tags from patients' },
  { key: 'payments_allocate', label: 'Allocate payments' },
  { key: 'packages_edit', label: 'Edit packages' },
  { key: 'billing_history_view', label: 'View patient billing history' },
  { key: 'patient_docs_delete', label: 'Delete patient documents' },
  { key: 'patient_files_delete', label: 'Delete patient files' },
]

const clinicalToggles: { key: string; label: string; hint?: string }[] = [
  { key: 'visit_notes_access', label: 'Access appointment notes' },
  { key: 'visit_notes_edit', label: 'Edit appointment notes' },
  { key: 'visit_notes_delete', label: 'Delete appointment notes' },
]

async function save() {
  error.value = ''
  saved.value = false
  saving.value = true
  const { error: updateError } = await supabase
    .from('account_roles')
    .update({ name: name.value.trim(), permissions: permissions.value })
    .eq('id', roleId)
  saving.value = false
  if (updateError) {
    error.value = updateError.message
    return
  }
  saved.value = true
}
</script>

<template>
  <div class="flex gap-8">
    <SettingsNav />
    <div class="min-w-0 max-w-3xl flex-1">
      <NuxtLink to="/settings/roles" class="text-sm text-gray-500 hover:text-gray-700">&larr; Roles</NuxtLink>

      <div v-if="loading" class="mt-4 text-sm text-gray-400">Loading…</div>
      <div v-else-if="notFound" class="mt-4 text-sm text-gray-400">Role not found.</div>
      <form v-else class="mt-2 space-y-8" @submit.prevent="save">
        <div>
          <label class="block text-sm font-medium text-gray-700">Role name</label>
          <input
            v-model="name"
            type="text"
            :disabled="isSystem"
            required
            class="mt-1 w-full max-w-sm rounded-md border border-gray-300 px-3 py-2 text-sm focus:border-indigo-500 focus:outline-none focus:ring-1 focus:ring-indigo-500 disabled:bg-gray-50 disabled:text-gray-400"
          />
          <p v-if="isSystem" class="mt-1 text-xs text-gray-400">
            🔒 This is the account owner's role — its permissions are always full and can't be changed, to prevent
            anyone (including the owner) from being locked out by mistake.
          </p>
        </div>

        <fieldset :disabled="isSystem" class="space-y-6 disabled:opacity-50">
          <div>
            <h2 class="text-sm font-semibold text-gray-900">Ringfencing</h2>
            <p class="mt-0.5 text-xs text-gray-500">Control what data this role can see.</p>
            <div class="mt-3 grid max-w-lg grid-cols-2 gap-x-4 gap-y-3">
              <label class="text-sm text-gray-700">Dashboard access</label>
              <select v-model="permissions.dashboard_scope" class="rounded-md border border-gray-300 px-2 py-1 text-sm">
                <option value="all">Full access</option>
                <option value="own">Own only</option>
                <option value="none">No access</option>
              </select>
              <label class="text-sm text-gray-700">Calendar access</label>
              <select v-model="permissions.calendar_scope" class="rounded-md border border-gray-300 px-2 py-1 text-sm">
                <option value="all">All appointments</option>
                <option value="own">Own appointments only</option>
                <option value="none">No access</option>
              </select>
              <label class="text-sm text-gray-700">Patient access</label>
              <select v-model="permissions.patients_scope" class="rounded-md border border-gray-300 px-2 py-1 text-sm">
                <option value="all">All patient files</option>
                <option value="own">Own patients only</option>
                <option value="none">No access</option>
              </select>
            </div>
            <label class="mt-3 flex items-center gap-2 text-sm text-gray-700">
              <input v-model="permissions.calendar_read_only" type="checkbox" class="rounded border-gray-300 text-indigo-600 focus:ring-indigo-500" />
              Read-only calendar (view but can't create/edit/delete appointments)
            </label>
          </div>

          <div>
            <h2 class="text-sm font-semibold text-gray-900">General</h2>
            <p class="mt-0.5 text-xs text-gray-500">Access to core system features.</p>
            <div class="mt-3 space-y-2">
              <label v-for="t in generalToggles" :key="t.key" class="flex items-start gap-2 text-sm text-gray-700">
                <input v-model="permissions[t.key]" type="checkbox" class="mt-0.5 rounded border-gray-300 text-indigo-600 focus:ring-indigo-500" />
                <span>{{ t.label }}<span v-if="t.hint" class="block text-xs text-gray-400">{{ t.hint }}</span></span>
              </label>
            </div>
          </div>

          <div>
            <h2 class="text-sm font-semibold text-gray-900">Reports</h2>
            <div class="mt-3 space-y-2">
              <label v-for="t in reportsToggles" :key="t.key" class="flex items-start gap-2 text-sm text-gray-700">
                <input v-model="permissions[t.key]" type="checkbox" class="mt-0.5 rounded border-gray-300 text-indigo-600 focus:ring-indigo-500" />
                <span>{{ t.label }}<span v-if="t.hint" class="block text-xs text-gray-400">{{ t.hint }}</span></span>
              </label>
            </div>
          </div>

          <div>
            <h2 class="text-sm font-semibold text-gray-900">Patients & Appointments</h2>
            <p class="mt-0.5 text-xs text-gray-500">Control access to patient data and financials.</p>
            <div class="mt-3 max-w-sm">
              <label class="block text-sm text-gray-700">Editing patient financials</label>
              <select v-model="financialsEditMode" class="mt-1 w-full rounded-md border border-gray-300 px-2 py-1 text-sm">
                <option value="none">Not allowed</option>
                <option value="same_day">Only on the day created</option>
                <option value="all">Always allowed</option>
              </select>
            </div>
            <div class="mt-3 space-y-2">
              <label v-for="t in patientToggles" :key="t.key" class="flex items-start gap-2 text-sm text-gray-700">
                <input v-model="permissions[t.key]" type="checkbox" class="mt-0.5 rounded border-gray-300 text-indigo-600 focus:ring-indigo-500" />
                <span>{{ t.label }}<span v-if="t.hint" class="block text-xs text-gray-400">{{ t.hint }}</span></span>
              </label>
            </div>
          </div>

          <div>
            <h2 class="text-sm font-semibold text-gray-900">Clinical Information</h2>
            <p class="mt-0.5 text-xs text-gray-500">Appointment notes.</p>
            <div class="mt-3 max-w-sm">
              <label class="block text-sm text-gray-700">Editing/deleting notes</label>
              <select v-model="permissions.visit_notes_scope" class="mt-1 w-full rounded-md border border-gray-300 px-2 py-1 text-sm">
                <option value="all">Any team member's notes</option>
                <option value="own">Only their own notes</option>
              </select>
            </div>
            <div class="mt-3 space-y-2">
              <label v-for="t in clinicalToggles" :key="t.key" class="flex items-start gap-2 text-sm text-gray-700">
                <input v-model="permissions[t.key]" type="checkbox" class="mt-0.5 rounded border-gray-300 text-indigo-600 focus:ring-indigo-500" />
                <span>{{ t.label }}<span v-if="t.hint" class="block text-xs text-gray-400">{{ t.hint }}</span></span>
              </label>
            </div>
          </div>
        </fieldset>

        <div v-if="!isSystem" class="flex items-center gap-3">
          <button type="submit" :disabled="saving" class="rounded-md bg-indigo-600 px-4 py-2 text-sm font-medium text-white hover:bg-indigo-700 disabled:opacity-50">
            {{ saving ? 'Saving…' : 'Save' }}
          </button>
          <span v-if="saved" class="text-sm text-green-600">Saved.</span>
        </div>
        <p v-if="error" class="text-sm text-red-600">{{ error }}</p>
      </form>
    </div>
  </div>
</template>
