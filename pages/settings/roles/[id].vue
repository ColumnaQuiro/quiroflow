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
const { showToast } = useToast()
const loading = ref(true)
const saving = ref(false)
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
  { key: 'developers_access', label: 'Developer API & tokens', hint: 'Create/revoke API tokens that can send WhatsApp as this clinic — requires Settings' },
  { key: 'billing_access', label: 'Billing', hint: 'View/create invoices' },
  { key: 'recalls_access', label: 'Recalls & patient messaging' },
  { key: 'inbox_access', label: 'WhatsApp Inbox', hint: 'Read and reply to patient WhatsApp conversations' },
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
  saving.value = true
  const { error: updateError } = await supabase
    .from('account_roles')
    .update({ name: name.value.trim(), permissions: permissions.value })
    .eq('id', roleId)
  saving.value = false
  if (updateError) {
    showToast(updateError.message, 'error')
    return
  }
  showToast('Saved')
}
</script>

<template>
  <div class="flex h-full flex-col">
    <PageHeader :title="name || 'Role'">
      <UiBtn v-if="!isSystem && !loading && !notFound" variant="primary" :disabled="saving" @click="save">{{ saving ? 'Saving…' : 'Save changes' }}</UiBtn>
    </PageHeader>
    <div class="flex-1 overflow-y-auto">
      <div class="flex gap-8 p-6">
        <SettingsNav />
        <div class="min-w-0 max-w-[660px] flex-1">
          <NuxtLink to="/settings/roles" class="text-[12.5px] text-ink-muted2 hover:text-ink-600">&larr; Roles</NuxtLink>

          <div v-if="loading" class="mt-4 text-[13px] text-ink-faint">Loading…</div>
          <div v-else-if="notFound" class="mt-4 text-[13px] text-ink-faint">Role not found.</div>
          <form v-else class="mt-3 space-y-8" @submit.prevent="save">
            <SettingsFieldRow label="Role name">
              <input
                v-model="name"
                type="text"
                :disabled="isSystem"
                required
                class="h-8 w-[230px] rounded-ctl border border-line-control bg-surface px-3 text-[13px] text-ink-700 focus:border-brand focus:outline-none focus:ring-1 focus:ring-brand/20 disabled:bg-surface-subtle disabled:text-ink-faint"
              />
              <template v-if="isSystem" #helper>
                This is the account owner's role — its permissions are always full and can't be changed, to
                prevent anyone (including the owner) from being locked out by mistake.
              </template>
            </SettingsFieldRow>

            <fieldset :disabled="isSystem" class="space-y-8 disabled:opacity-50">
              <div>
                <h2 class="text-[15px] font-[620] text-ink-900">Ringfencing</h2>
                <p class="mt-0.5 text-[13px] text-ink-muted2">Control what data this role can see.</p>
                <div class="mt-3 space-y-2">
                  <SettingsFieldRow label="Dashboard access">
                    <select v-model="permissions.dashboard_scope" class="h-8 w-[230px] rounded-ctl border border-line-control bg-surface px-2 text-[13px] text-ink-700 focus:border-brand focus:outline-none focus:ring-1 focus:ring-brand/20">
                      <option value="all">Full access</option>
                      <option value="own">Own only</option>
                      <option value="none">No access</option>
                    </select>
                  </SettingsFieldRow>
                  <SettingsFieldRow label="Calendar access">
                    <select v-model="permissions.calendar_scope" class="h-8 w-[230px] rounded-ctl border border-line-control bg-surface px-2 text-[13px] text-ink-700 focus:border-brand focus:outline-none focus:ring-1 focus:ring-brand/20">
                      <option value="all">All appointments</option>
                      <option value="own">Own appointments only</option>
                      <option value="none">No access</option>
                    </select>
                  </SettingsFieldRow>
                  <SettingsFieldRow label="Patient access">
                    <select v-model="permissions.patients_scope" class="h-8 w-[230px] rounded-ctl border border-line-control bg-surface px-2 text-[13px] text-ink-700 focus:border-brand focus:outline-none focus:ring-1 focus:ring-brand/20">
                      <option value="all">All patient files</option>
                      <option value="own">Own patients only</option>
                      <option value="none">No access</option>
                    </select>
                  </SettingsFieldRow>
                  <SettingsFieldRow label="Read-only calendar" helper="View appointments, but can't create, edit, or delete them.">
                    <SettingsToggle v-model="permissions.calendar_read_only" />
                  </SettingsFieldRow>
                </div>
              </div>

              <div>
                <h2 class="text-[15px] font-[620] text-ink-900">General</h2>
                <p class="mt-0.5 text-[13px] text-ink-muted2">Access to core system features.</p>
                <div class="mt-3 space-y-2">
                  <SettingsFieldRow v-for="t in generalToggles" :key="t.key" :label="t.label" :helper="t.hint">
                    <SettingsToggle v-model="permissions[t.key]" />
                  </SettingsFieldRow>
                </div>
              </div>

              <div>
                <h2 class="text-[15px] font-[620] text-ink-900">Reports</h2>
                <div class="mt-3 space-y-2">
                  <SettingsFieldRow v-for="t in reportsToggles" :key="t.key" :label="t.label" :helper="t.hint">
                    <SettingsToggle v-model="permissions[t.key]" />
                  </SettingsFieldRow>
                </div>
              </div>

              <div>
                <h2 class="text-[15px] font-[620] text-ink-900">Patients & Appointments</h2>
                <p class="mt-0.5 text-[13px] text-ink-muted2">Control access to patient data and financials.</p>
                <div class="mt-3 space-y-2">
                  <SettingsFieldRow label="Editing patient financials">
                    <select v-model="financialsEditMode" class="h-8 w-[230px] rounded-ctl border border-line-control bg-surface px-2 text-[13px] text-ink-700 focus:border-brand focus:outline-none focus:ring-1 focus:ring-brand/20">
                      <option value="none">Not allowed</option>
                      <option value="same_day">Only on the day created</option>
                      <option value="all">Always allowed</option>
                    </select>
                  </SettingsFieldRow>
                  <SettingsFieldRow v-for="t in patientToggles" :key="t.key" :label="t.label" :helper="t.hint">
                    <SettingsToggle v-model="permissions[t.key]" />
                  </SettingsFieldRow>
                </div>
              </div>

              <div>
                <h2 class="text-[15px] font-[620] text-ink-900">Clinical Information</h2>
                <p class="mt-0.5 text-[13px] text-ink-muted2">Appointment notes.</p>
                <div class="mt-3 space-y-2">
                  <SettingsFieldRow label="Editing/deleting notes">
                    <select v-model="permissions.visit_notes_scope" class="h-8 w-[230px] rounded-ctl border border-line-control bg-surface px-2 text-[13px] text-ink-700 focus:border-brand focus:outline-none focus:ring-1 focus:ring-brand/20">
                      <option value="all">Any team member's notes</option>
                      <option value="own">Only their own notes</option>
                    </select>
                  </SettingsFieldRow>
                  <SettingsFieldRow v-for="t in clinicalToggles" :key="t.key" :label="t.label" :helper="t.hint">
                    <SettingsToggle v-model="permissions[t.key]" />
                  </SettingsFieldRow>
                </div>
              </div>
            </fieldset>

          </form>
        </div>
      </div>
    </div>
  </div>
</template>
