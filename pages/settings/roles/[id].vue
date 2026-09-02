<script setup lang="ts">
const supabase = useSupabaseClient()
const route = useRoute()
const router = useRouter()
const roleId = route.params.id as string
const t = useT()

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

const generalToggles = computed<{ key: string; label: string; hint?: string }[]>(() => [
  { key: 'settings_access', label: t('Settings', 'Ajustes'), hint: t('Gates the whole Settings section — required for the sub-toggles below to have any effect', 'Bloquea toda la sección de Ajustes — necesario para que los interruptores de abajo tengan efecto') },
  { key: 'roles_admin', label: t('Roles & permission settings', 'Roles y permisos'), hint: t('Requires Settings', 'Requiere Ajustes') },
  { key: 'team_admin', label: t('Team member administration', 'Administración del equipo'), hint: t('Requires Settings', 'Requiere Ajustes') },
  { key: 'clinic_config', label: t('Clinic configuration', 'Configuración de la clínica'), hint: t('Clinics, appointment types, calendar resources — requires Settings', 'Clínicas, tipos de cita, recursos del calendario — requiere Ajustes') },
  { key: 'billing_config', label: t('Billing configuration', 'Configuración de facturación'), hint: t('Services, packages, memberships, Stripe — requires Settings', 'Servicios, bonos, membresías, Stripe — requiere Ajustes') },
  { key: 'communication_config', label: t('Communication configuration', 'Configuración de comunicación'), hint: t('WhatsApp, document templates — requires Settings', 'WhatsApp, plantillas de documentos — requiere Ajustes') },
  { key: 'data_admin', label: t('Data administration', 'Administración de datos'), hint: t('Import, migrations, webhooks — requires Settings', 'Importación, migraciones, webhooks — requiere Ajustes') },
  { key: 'developers_access', label: t('Developer API & tokens', 'API para desarrolladores y tokens'), hint: t('Create/revoke API tokens that can send WhatsApp as this clinic — requires Settings', 'Crear/revocar tokens de API que pueden enviar WhatsApp en nombre de esta clínica — requiere Ajustes') },
  { key: 'billing_access', label: t('Billing', 'Facturación'), hint: t('View/create invoices', 'Ver/crear facturas') },
  { key: 'recalls_access', label: t('Recalls & patient messaging', 'Recordatorios y mensajería a pacientes') },
  { key: 'inbox_access', label: t('WhatsApp Inbox', 'Bandeja de WhatsApp'), hint: t('Read and reply to patient WhatsApp conversations', 'Leer y responder conversaciones de WhatsApp con pacientes') },
])

const reportsToggles = computed<{ key: string; label: string; hint?: string }[]>(() => [
  { key: 'reports_access', label: t('Allow access to reports', 'Permitir acceso a informes') },
  { key: 'reports_own_only', label: t('Only allow access to own reports', 'Permitir acceso solo a informes propios'), hint: t('Only meaningful when Calendar/Patients below are set to "Own only"', 'Solo relevante cuando Calendario/Pacientes abajo están configurados como "Solo propios"') },
])

const patientToggles = computed<{ key: string; label: string; hint?: string }[]>(() => [
  { key: 'appointments_delete', label: t('Delete appointments', 'Eliminar citas') },
  { key: 'patients_edit', label: t('Edit patients', 'Editar pacientes') },
  { key: 'patients_delete_merge', label: t('Delete and merge patients', 'Eliminar y fusionar pacientes') },
  { key: 'patients_tags_remove', label: t('Remove membership/package tags from patients', 'Quitar etiquetas de membresía/bono de los pacientes') },
  { key: 'payments_allocate', label: t('Allocate payments', 'Asignar pagos') },
  { key: 'packages_edit', label: t('Edit packages', 'Editar bonos') },
  { key: 'billing_history_view', label: t('View patient billing history', 'Ver historial de facturación del paciente') },
  { key: 'patient_docs_delete', label: t('Delete patient documents', 'Eliminar documentos del paciente') },
  { key: 'patient_files_delete', label: t('Delete patient files', 'Eliminar archivos del paciente') },
])

const clinicalToggles = computed<{ key: string; label: string; hint?: string }[]>(() => [
  { key: 'visit_notes_access', label: t('Access appointment notes', 'Acceder a las notas de la cita') },
  { key: 'visit_notes_edit', label: t('Edit appointment notes', 'Editar notas de la cita') },
  { key: 'visit_notes_delete', label: t('Delete appointment notes', 'Eliminar notas de la cita') },
])

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
  <div class="flex h-full flex-col">
    <PageHeader :title="name || t('Role', 'Rol')">
      <UiBtn v-if="!isSystem && !loading && !notFound" variant="primary" :disabled="saving" @click="save">{{ saving ? t('Saving…', 'Guardando…') : t('Save changes', 'Guardar cambios') }}</UiBtn>
    </PageHeader>
    <div class="flex-1 overflow-y-auto">
      <div class="flex gap-8 p-6">
        <SettingsNav />
        <div class="min-w-0 max-w-[660px] flex-1">
          <NuxtLink to="/settings/roles" class="text-[12.5px] text-ink-muted2 hover:text-ink-600">&larr; {{ t('Roles', 'Roles') }}</NuxtLink>

          <div v-if="loading" class="mt-4 text-[13px] text-ink-faint">{{ t('Loading…', 'Cargando…') }}</div>
          <div v-else-if="notFound" class="mt-4 text-[13px] text-ink-faint">{{ t('Role not found.', 'Rol no encontrado.') }}</div>
          <form v-else class="mt-3 space-y-8" @submit.prevent="save">
            <SettingsFieldRow :label="t('Role name', 'Nombre del rol')">
              <input
                v-model="name"
                type="text"
                :disabled="isSystem"
                required
                class="h-8 w-[230px] rounded-ctl border border-line-control bg-surface px-3 text-[13px] text-ink-700 focus:border-brand focus:outline-none focus:ring-1 focus:ring-brand/20 disabled:bg-surface-subtle disabled:text-ink-faint"
              />
              <template v-if="isSystem" #helper>
                {{ t("This is the account owner's role — its permissions are always full and can't be changed, to prevent anyone (including the owner) from being locked out by mistake.", 'Este es el rol del propietario de la cuenta — sus permisos son siempre completos y no se pueden cambiar, para evitar que alguien (incluido el propietario) quede bloqueado por error.') }}
              </template>
            </SettingsFieldRow>

            <fieldset :disabled="isSystem" class="space-y-8 disabled:opacity-50">
              <div>
                <h2 class="text-[15px] font-[620] text-ink-900">{{ t('Ringfencing', 'Segmentación') }}</h2>
                <p class="mt-0.5 text-[13px] text-ink-muted2">{{ t('Control what data this role can see.', 'Controla qué datos puede ver este rol.') }}</p>
                <div class="mt-3 space-y-2">
                  <SettingsFieldRow :label="t('Dashboard access', 'Acceso al panel')">
                    <select v-model="permissions.dashboard_scope" class="h-8 w-[230px] rounded-ctl border border-line-control bg-surface px-2 text-[13px] text-ink-700 focus:border-brand focus:outline-none focus:ring-1 focus:ring-brand/20">
                      <option value="all">{{ t('Full access', 'Acceso completo') }}</option>
                      <option value="own">{{ t('Own only', 'Solo propio') }}</option>
                      <option value="none">{{ t('No access', 'Sin acceso') }}</option>
                    </select>
                  </SettingsFieldRow>
                  <SettingsFieldRow :label="t('Calendar access', 'Acceso al calendario')">
                    <select v-model="permissions.calendar_scope" class="h-8 w-[230px] rounded-ctl border border-line-control bg-surface px-2 text-[13px] text-ink-700 focus:border-brand focus:outline-none focus:ring-1 focus:ring-brand/20">
                      <option value="all">{{ t('All appointments', 'Todas las citas') }}</option>
                      <option value="own">{{ t('Own appointments only', 'Solo citas propias') }}</option>
                      <option value="none">{{ t('No access', 'Sin acceso') }}</option>
                    </select>
                  </SettingsFieldRow>
                  <SettingsFieldRow :label="t('Patient access', 'Acceso a pacientes')">
                    <select v-model="permissions.patients_scope" class="h-8 w-[230px] rounded-ctl border border-line-control bg-surface px-2 text-[13px] text-ink-700 focus:border-brand focus:outline-none focus:ring-1 focus:ring-brand/20">
                      <option value="all">{{ t('All patient files', 'Todos los expedientes de pacientes') }}</option>
                      <option value="own">{{ t('Own patients only', 'Solo pacientes propios') }}</option>
                      <option value="none">{{ t('No access', 'Sin acceso') }}</option>
                    </select>
                  </SettingsFieldRow>
                  <SettingsFieldRow :label="t('Read-only calendar', 'Calendario de solo lectura')" :helper="t('View appointments, but can\'t create, edit, or delete them.', 'Ver las citas, pero sin poder crearlas, editarlas ni eliminarlas.')">
                    <SettingsToggle v-model="permissions.calendar_read_only" />
                  </SettingsFieldRow>
                </div>
              </div>

              <div>
                <h2 class="text-[15px] font-[620] text-ink-900">{{ t('General', 'General') }}</h2>
                <p class="mt-0.5 text-[13px] text-ink-muted2">{{ t('Access to core system features.', 'Acceso a las funciones principales del sistema.') }}</p>
                <div class="mt-3 space-y-2">
                  <SettingsFieldRow v-for="tg in generalToggles" :key="tg.key" :label="tg.label" :helper="tg.hint">
                    <SettingsToggle v-model="permissions[tg.key]" />
                  </SettingsFieldRow>
                </div>
              </div>

              <div>
                <h2 class="text-[15px] font-[620] text-ink-900">{{ t('Reports', 'Informes') }}</h2>
                <div class="mt-3 space-y-2">
                  <SettingsFieldRow v-for="tg in reportsToggles" :key="tg.key" :label="tg.label" :helper="tg.hint">
                    <SettingsToggle v-model="permissions[tg.key]" />
                  </SettingsFieldRow>
                </div>
              </div>

              <div>
                <h2 class="text-[15px] font-[620] text-ink-900">{{ t('Patients & Appointments', 'Pacientes y Citas') }}</h2>
                <p class="mt-0.5 text-[13px] text-ink-muted2">{{ t('Control access to patient data and financials.', 'Controla el acceso a los datos y finanzas de los pacientes.') }}</p>
                <div class="mt-3 space-y-2">
                  <SettingsFieldRow :label="t('Editing patient financials', 'Edición de finanzas del paciente')">
                    <select v-model="financialsEditMode" class="h-8 w-[230px] rounded-ctl border border-line-control bg-surface px-2 text-[13px] text-ink-700 focus:border-brand focus:outline-none focus:ring-1 focus:ring-brand/20">
                      <option value="none">{{ t('Not allowed', 'No permitido') }}</option>
                      <option value="same_day">{{ t('Only on the day created', 'Solo el día en que se creó') }}</option>
                      <option value="all">{{ t('Always allowed', 'Siempre permitido') }}</option>
                    </select>
                  </SettingsFieldRow>
                  <SettingsFieldRow v-for="tg in patientToggles" :key="tg.key" :label="tg.label" :helper="tg.hint">
                    <SettingsToggle v-model="permissions[tg.key]" />
                  </SettingsFieldRow>
                </div>
              </div>

              <div>
                <h2 class="text-[15px] font-[620] text-ink-900">{{ t('Clinical Information', 'Información Clínica') }}</h2>
                <p class="mt-0.5 text-[13px] text-ink-muted2">{{ t('Appointment notes.', 'Notas de la cita.') }}</p>
                <div class="mt-3 space-y-2">
                  <SettingsFieldRow :label="t('Editing/deleting notes', 'Edición/eliminación de notas')">
                    <select v-model="permissions.visit_notes_scope" class="h-8 w-[230px] rounded-ctl border border-line-control bg-surface px-2 text-[13px] text-ink-700 focus:border-brand focus:outline-none focus:ring-1 focus:ring-brand/20">
                      <option value="all">{{ t("Any team member's notes", 'Notas de cualquier miembro del equipo') }}</option>
                      <option value="own">{{ t('Only their own notes', 'Solo sus propias notas') }}</option>
                    </select>
                  </SettingsFieldRow>
                  <SettingsFieldRow v-for="tg in clinicalToggles" :key="tg.key" :label="tg.label" :helper="tg.hint">
                    <SettingsToggle v-model="permissions[tg.key]" />
                  </SettingsFieldRow>
                </div>
              </div>
            </fieldset>

            <p v-if="saved" class="text-[12.5px] text-success-text">{{ t('Saved.', 'Guardado.') }}</p>
            <p v-if="error" class="text-[12.5px] text-danger-text">{{ error }}</p>
          </form>
        </div>
      </div>
    </div>
  </div>
</template>
