<script setup lang="ts">
import type { Database } from '~/types/database.types'

// The clinic's audit trail, for its owners: what changed and who changed it,
// who opened which patient's record or files, and who signed in.
//
// Everything here is read through owner-only functions
// (20261008070424_audit_trail.sql) -- the route rule is the courtesy, the
// database is the guard. A clinical note's every version and a deleted
// patient's record are on this page, which is why it is not a permission a
// role can be given.

type AuditRow = Database['public']['Functions']['get_audit_log']['Returns'][number]
type AccessRow = Database['public']['Functions']['get_patient_access_log']['Returns'][number]
type SignInRow = Database['public']['Functions']['get_auth_events']['Returns'][number]
type Tab = 'changes' | 'access' | 'signins'

const PAGE = 50

const supabase = useSupabaseClient()
const store = useAccountStore()
const t = useT()

const tab = ref<Tab>('changes')
const tabs = computed<{ key: Tab; label: string }[]>(() => [
  { key: 'changes', label: t('Changes', 'Cambios') },
  { key: 'access', label: t('Patient access', 'Acceso a pacientes') },
  { key: 'signins', label: t('Sign-ins', 'Inicios de sesión') },
])

// -- Filters -------------------------------------------------------------------
// Departed members too: what they did is exactly what an owner may come
// looking for.
const members = ref<{ id: string; full_name: string; deleted_at: string | null }[]>([])
async function loadMembers() {
  const { data } = await supabase.from('team_members').select('id, full_name, deleted_at').eq('account_id', store.accountId!).order('full_name')
  members.value = data ?? []
}
const memberFilter = ref('')

const AREAS = computed(() => [
  { key: 'clinical', label: t('Clinical notes & files', 'Notas clínicas y archivos'), types: ['visit_note', 'patient_file', 'patient_doc'] },
  { key: 'patients', label: t('Patients', 'Pacientes'), types: ['patient'] },
  { key: 'appointments', label: t('Appointments', 'Citas'), types: ['appointment'] },
  { key: 'money', label: t('Money', 'Cobros'), types: ['payment', 'invoice', 'account_credit', 'package_purchase', 'patient_membership', 'cash_shift', 'cash_movement'] },
  { key: 'access', label: t('Team & access', 'Equipo y accesos'), types: ['team_member', 'team_member_clinic', 'role', 'invite', 'api_token', 'webhook'] },
  { key: 'settings', label: t('Clinic settings', 'Ajustes de la clínica'), types: ['account', 'clinic', 'verifactu_certificate', 'verifactu_delegation', 'appointment_type', 'package', 'membership', 'service'] },
])
const areaFilter = ref('')

// -- Loading -------------------------------------------------------------------
// Shallow: each page replaces the array, nothing mutates a row, and deep
// unwrapping the recursive Json columns is more than the type checker will
// instantiate (TS2589).
const changes = shallowRef<AuditRow[]>([])
const access = shallowRef<AccessRow[]>([])
const signIns = shallowRef<SignInRow[]>([])
const loading = ref(true)
const loadingMore = ref(false)
const hasMore = ref(false)
const loadError = ref('')

function currentRows(): { created_at: string }[] {
  return tab.value === 'changes' ? changes.value : tab.value === 'access' ? access.value : signIns.value
}

// Each call awaited in its own branch: returning the three builders as one
// union is more than the type checker will instantiate (TS2589).
async function fetchPage(before: string | null): Promise<{ data: unknown[] | null; error: { message: string } | null }> {
  const member = memberFilter.value || undefined
  const common = { p_account_id: store.accountId!, p_before: before ?? undefined, p_limit: PAGE, p_team_member_id: member }
  if (tab.value === 'changes') {
    const types = AREAS.value.find((a) => a.key === areaFilter.value)?.types
    const { data, error } = await supabase.rpc('get_audit_log', { ...common, p_entity_types: types })
    return { data, error }
  }
  if (tab.value === 'access') {
    const { data, error } = await supabase.rpc('get_patient_access_log', common)
    return { data, error }
  }
  const { data, error } = await supabase.rpc('get_auth_events', common)
  return { data, error }
}

async function load(more = false) {
  if (!store.accountId) return
  const rows = currentRows()
  const before = more && rows.length ? rows[rows.length - 1]!.created_at : null
  if (more) loadingMore.value = true
  else loading.value = true
  loadError.value = ''

  const forTab = tab.value
  const { data, error } = await fetchPage(before)
  // A tab switched while this was in flight: its own load is on the way.
  if (forTab !== tab.value) return
  if (error) {
    loadError.value = error.message
  } else {
    const page = (data ?? []) as never[]
    if (forTab === 'changes') changes.value = more ? [...changes.value, ...page] : page
    else if (forTab === 'access') access.value = more ? [...access.value, ...page] : page
    else signIns.value = more ? [...signIns.value, ...page] : page
    hasMore.value = page.length === PAGE
  }
  loading.value = false
  loadingMore.value = false
}

onMounted(() => {
  loadMembers()
  load()
})
watch([tab, memberFilter, areaFilter], () => {
  expanded.value = null
  load()
})

// -- Wording -------------------------------------------------------------------
const ENTITY_LABELS = computed<Record<string, string>>(() => ({
  appointment: t('Appointment', 'Cita'),
  patient: t('Patient', 'Paciente'),
  payment: t('Payment', 'Pago'),
  visit_note: t('Clinical note', 'Nota clínica'),
  invoice: t('Charge', 'Cargo'),
  account_credit: t('Account credit', 'Saldo a favor'),
  package_purchase: t('Bono', 'Bono'),
  patient_membership: t('Membership', 'Membresía'),
  patient_file: t('Patient file', 'Archivo del paciente'),
  patient_doc: t('Patient document', 'Documento del paciente'),
  team_member: t('Team member', 'Miembro del equipo'),
  team_member_clinic: t('Clinic assignment', 'Asignación de clínica'),
  role: t('Role', 'Rol'),
  account: t('Clinic settings', 'Ajustes de la clínica'),
  clinic: t('Clinic', 'Clínica'),
  invite: t('Invitation', 'Invitación'),
  api_token: t('API token', 'Token de API'),
  webhook: t('Webhook', 'Webhook'),
  verifactu_certificate: t('VeriFactu certificate', 'Certificado VeriFactu'),
  verifactu_delegation: t('VeriFactu authorisation', 'Autorización VeriFactu'),
  cash_shift: t('Cash shift', 'Turno de caja'),
  cash_movement: t('Cash movement', 'Movimiento de caja'),
  package: t('Bono template', 'Plantilla de bono'),
  membership: t('Membership template', 'Plantilla de membresía'),
  service: t('Service / product', 'Servicio / producto'),
  appointment_type: t('Appointment type', 'Tipo de cita'),
}))

function actionLabel(action: string) {
  if (action === 'created') return t('created', 'creado')
  if (action === 'deleted') return t('deleted', 'eliminado')
  return t('changed', 'modificado')
}
function actionTone(action: string) {
  return action === 'deleted' ? 'danger' : action === 'created' ? 'success' : 'neutral'
}

function actorLabel(row: { actor?: string | null; actor_detail?: string | null; actor_name: string | null }) {
  if (row.actor === 'patient') return t('Patient (app)', 'Paciente (app)')
  if (row.actor === 'user') return row.actor_detail ?? t('Signed-in user', 'Usuario con sesión')
  if (row.actor === 'public') return t('Online booking / patient link', 'Reserva online / enlace de paciente')
  if (row.actor === 'server') return t('QuiroFlow (automatic)', 'QuiroFlow (automático)')
  if (row.actor === 'system') return `${t('System', 'Sistema')}${row.actor_detail ? ` (${row.actor_detail})` : ''}`
  if (row.actor_name) return row.actor_name
  // Rows written before 8 Oct 2026 recorded only a team member, when there
  // was one.
  return row.actor === 'staff' ? t('Former team member', 'Antiguo miembro del equipo') : t('Not recorded', 'No registrado')
}

const ACCESS_LABELS = computed<Record<string, string>>(() => ({
  record_opened: t('Opened the record', 'Abrió la ficha'),
  file_viewed: t('Viewed a file', 'Vio un archivo'),
  file_downloaded: t('Downloaded a file', 'Descargó un archivo'),
  invoice_pdf: t('Downloaded a receipt or factura', 'Descargó un recibo o factura'),
  statement_pdf: t('Downloaded the statement', 'Descargó el extracto'),
  export: t('Exported patients', 'Exportó pacientes'),
}))

function accessDetail(row: AccessRow) {
  const d = (row.detail ?? {}) as Record<string, unknown>
  if (row.kind === 'export') {
    const which = d.export === 'recalls' ? t('recalls list', 'lista de recordatorios') : d.export === 'patient_list' ? t('patient list', 'lista de pacientes') : t('data export', 'exportación de datos')
    return `${which} · ${d.rows ?? '?'} ${t('rows', 'filas')}`
  }
  return String(d.file ?? d.invoice ?? d.factura ?? '')
}

const SIGNIN_LABELS = computed<Record<string, string>>(() => ({
  signed_in: t('Signed in', 'Inició sesión'),
  two_factor_verified: t('Entered the two-factor code', 'Introdujo el código de verificación'),
  two_factor_enabled: t('Turned on two-factor login', 'Activó la verificación en dos pasos'),
  two_factor_removed: t('Removed two-factor login', 'Quitó la verificación en dos pasos'),
  password_changed: t('Changed their password', 'Cambió su contraseña'),
  password_reset_requested: t('Asked for a password reset', 'Pidió restablecer la contraseña'),
  email_changed: t('Changed their email', 'Cambió su correo'),
}))

/** "Chrome · Mac", from a user agent; enough to tell a phone from a desk. */
function device(ua: string | null) {
  if (!ua) return ''
  const os = /iPhone/.test(ua) ? 'iPhone' : /iPad/.test(ua) ? 'iPad' : /Android/.test(ua) ? 'Android' : /Mac OS X/.test(ua) ? 'Mac' : /Windows/.test(ua) ? 'Windows' : /Linux/.test(ua) ? 'Linux' : ''
  const browser = /Edg\//.test(ua) ? 'Edge' : /Firefox\//.test(ua) ? 'Firefox' : /Chrome\//.test(ua) ? 'Chrome' : /Safari\//.test(ua) ? 'Safari' : /QuiroFlow|Capacitor/i.test(ua) ? 'App' : ''
  return [browser, os].filter(Boolean).join(' · ')
}

function when(iso: string) {
  return new Date(iso).toLocaleString('es-ES', { dateStyle: 'short', timeStyle: 'short' })
}

// -- Detail of one change ------------------------------------------------------
const expanded = ref<string | null>(null)

function fieldName(key: string) {
  return key.replace(/_/g, ' ')
}
function show(value: unknown): string {
  if (value === null || value === undefined || value === '') return '—'
  if (typeof value === 'string') return value
  // Tags, channels, clinic ids: a list, not a JSON literal.
  if (Array.isArray(value) && value.every((v) => typeof v !== 'object' || v === null)) return value.length ? value.join(', ') : '—'
  return JSON.stringify(value)
}
function isLong(value: unknown) {
  return typeof value === 'string' && (value.length > 80 || value.includes('\n'))
}

function changeList(row: AuditRow) {
  const changes = (row.changes ?? {}) as Record<string, { from: unknown; to: unknown }>
  return Object.entries(changes).map(([key, c]) => ({ key, from: c.from, to: c.to }))
}
// A created or deleted row's own fields, minus the plumbing nobody reads.
function snapshotList(row: AuditRow) {
  const snapshot = (row.snapshot ?? {}) as Record<string, unknown>
  return Object.entries(snapshot)
    .filter(([key, value]) => value !== null && value !== '' && !(Array.isArray(value) && value.length === 0) && key !== 'account_id' && key !== 'id')
    .map(([key, value]) => ({ key, value }))
}
function hasDetail(row: AuditRow) {
  return changeList(row).length > 0 || snapshotList(row).length > 0
}
</script>

<template>
  <div class="flex h-full flex-col">
    <PageHeader :title="t('Activity log', 'Registro de actividad')" />
    <div class="flex-1 overflow-y-auto">
      <div class="flex gap-8 p-4 pb-24 sm:px-6 sm:pt-6 lg:pb-6">
        <SettingsNav />
        <div class="flex min-w-0 max-w-[1100px] flex-1 flex-col gap-4" data-cy="activity-log" :data-ready="loading ? undefined : 'true'">
          <p class="text-[13.5px] text-ink-muted">
            {{ t('Every change to patients, clinical notes, money, the team and the clinic’s settings, with who made it; every time someone opens a patient’s record or files, or exports patients; and every sign-in. Only owners see this page. Nothing on it can be edited or deleted.', 'Cada cambio en pacientes, notas clínicas, cobros, el equipo y los ajustes de la clínica, con quién lo hizo; cada vez que alguien abre la ficha o los archivos de un paciente, o exporta pacientes; y cada inicio de sesión. Solo los propietarios ven esta página. Nada de lo que aparece se puede editar ni borrar.') }}
          </p>

          <section class="overflow-hidden rounded-card border border-line bg-surface">
            <div role="tablist" class="flex gap-1 overflow-x-auto border-b border-line px-[18px]">
              <button
                v-for="tb in tabs"
                :key="tb.key"
                type="button"
                role="tab"
                :aria-selected="tab === tb.key"
                :data-cy="`activity-tab-${tb.key}`"
                class="-mb-px flex h-12 shrink-0 items-center border-b-2 px-3 text-[14px] font-semibold"
                :class="tab === tb.key ? 'border-brand text-ink-900' : 'border-transparent text-ink-muted hover:text-ink-700'"
                @click="tab = tb.key"
              >
                {{ tb.label }}
              </button>
            </div>

            <div class="flex flex-wrap items-center gap-2 px-[18px] py-3">
              <select v-model="memberFilter" :aria-label="t('Person', 'Persona')" data-cy="activity-member" class="h-9 rounded-ctl border border-line-control bg-surface px-3 text-[13.5px] text-ink-900 focus:outline-none touch:h-11">
                <option value="">{{ t('Everyone', 'Todos') }}</option>
                <option v-for="m in members" :key="m.id" :value="m.id">{{ m.full_name }}{{ m.deleted_at ? ` (${t('former', 'antiguo')})` : '' }}</option>
              </select>
              <select v-if="tab === 'changes'" v-model="areaFilter" :aria-label="t('Area', 'Área')" data-cy="activity-area" class="h-9 rounded-ctl border border-line-control bg-surface px-3 text-[13.5px] text-ink-900 focus:outline-none touch:h-11">
                <option value="">{{ t('Everything', 'Todo') }}</option>
                <option v-for="a in AREAS" :key="a.key" :value="a.key">{{ a.label }}</option>
              </select>
              <UiBtn size="sm" class="ml-auto" @click="load()">{{ t('Refresh', 'Actualizar') }}</UiBtn>
            </div>

            <div v-if="loading" class="flex flex-col gap-2 border-t border-line-row p-[18px]">
              <UiSkeleton v-for="i in 6" :key="i" class="h-4 w-full rounded-ctlSm" />
            </div>
            <p v-else-if="loadError" class="border-t border-line-row px-[18px] py-8 text-center text-[13.5px] text-danger-text">{{ loadError }}</p>

            <!-- Changes -->
            <template v-else-if="tab === 'changes'">
              <p v-if="changes.length === 0" class="border-t border-line-row px-[18px] py-8 text-center text-[13.5px] text-ink-muted">{{ t('Nothing recorded yet.', 'Todavía no hay nada registrado.') }}</p>
              <ul v-else class="border-t border-line-row">
                <li v-for="row in changes" :key="row.id" class="border-b border-line-row last:border-b-0" data-cy="activity-change">
                  <button
                    type="button"
                    data-cy="activity-change-toggle"
                    class="flex w-full flex-col gap-1 px-[18px] py-2.5 text-left hover:bg-surface-subtle sm:flex-row sm:items-start sm:gap-4"
                    :aria-expanded="expanded === row.id"
                    :disabled="!hasDetail(row)"
                    @click="expanded = expanded === row.id ? null : row.id"
                  >
                    <span class="w-[118px] shrink-0 whitespace-nowrap text-[13px] text-ink-muted">{{ when(row.created_at) }}</span>
                    <span class="w-[170px] shrink-0 truncate text-[13.5px] font-semibold text-ink-900">{{ actorLabel(row) }}</span>
                    <span class="flex min-w-0 flex-1 flex-wrap items-center gap-1.5 text-[13.5px] text-ink-700">
                      <span class="font-semibold text-ink-900">{{ ENTITY_LABELS[row.entity_type] ?? row.entity_type }}</span>
                      <UiPill :tone="actionTone(row.action)">{{ actionLabel(row.action) }}</UiPill>
                      <span v-if="row.action === 'updated' && row.changes" class="truncate text-ink-muted">{{ Object.keys(row.changes as object).map(fieldName).join(', ') }}</span>
                      <span v-else-if="row.entity_type === 'appointment' && row.action === 'updated'" class="truncate text-ink-muted">{{ row.summary }}</span>
                    </span>
                    <NuxtLink v-if="row.patient_id && row.patient_name" :to="`/patients/${row.patient_id}`" class="shrink-0 truncate text-[13px] font-medium text-brand-text hover:text-brand-hover sm:max-w-[200px]" @click.stop>{{ row.patient_name }}</NuxtLink>
                  </button>

                  <div v-if="expanded === row.id" class="flex flex-col gap-2 bg-surface-subtle px-[18px] py-3" data-cy="activity-change-detail">
                    <template v-if="changeList(row).length">
                      <div v-for="c in changeList(row)" :key="c.key" class="grid gap-1 text-[13px] sm:grid-cols-[160px_1fr]">
                        <span class="font-semibold text-ink-700">{{ fieldName(c.key) }}</span>
                        <div v-if="isLong(c.from) || isLong(c.to)" class="flex flex-col gap-1.5">
                          <p class="whitespace-pre-wrap rounded-ctl border border-danger-border bg-danger-bg px-2.5 py-1.5 text-ink-900"><span class="sr-only">{{ t('Before:', 'Antes:') }} </span>{{ show(c.from) }}</p>
                          <p class="whitespace-pre-wrap rounded-ctl border border-success-border bg-success-bg px-2.5 py-1.5 text-ink-900"><span class="sr-only">{{ t('After:', 'Después:') }} </span>{{ show(c.to) }}</p>
                        </div>
                        <span v-else class="break-words text-ink-900">
                          <span class="text-ink-muted line-through">{{ show(c.from) }}</span>
                          <span class="mx-1.5 text-ink-faint" aria-hidden="true">→</span>
                          <span class="sr-only">{{ t('now', 'ahora') }} </span>{{ show(c.to) }}
                        </span>
                      </div>
                    </template>
                    <template v-else>
                      <p class="text-[12px] font-semibold uppercase tracking-[.05em] text-ink-faint">{{ row.action === 'deleted' ? t('As it was when deleted', 'Tal como estaba al eliminarse') : t('As created', 'Tal como se creó') }}</p>
                      <div v-for="f in snapshotList(row)" :key="f.key" class="grid gap-1 text-[13px] sm:grid-cols-[160px_1fr]">
                        <span class="font-semibold text-ink-700">{{ fieldName(f.key) }}</span>
                        <span class="break-words text-ink-900" :class="isLong(f.value) ? 'whitespace-pre-wrap' : ''">{{ show(f.value) }}</span>
                      </div>
                    </template>
                  </div>
                </li>
              </ul>
            </template>

            <!-- Patient access -->
            <template v-else-if="tab === 'access'">
              <p v-if="access.length === 0" class="border-t border-line-row px-[18px] py-8 text-center text-[13.5px] text-ink-muted">{{ t('Nothing recorded yet.', 'Todavía no hay nada registrado.') }}</p>
              <div v-else class="overflow-x-auto border-t border-line-row">
                <table class="w-full min-w-[640px] border-collapse">
                  <thead>
                    <tr class="border-b border-line text-left text-[11.5px] font-semibold uppercase tracking-[.05em] text-ink-faint">
                      <th class="py-2 pl-[18px] pr-3.5 font-semibold">{{ t('When', 'Cuándo') }}</th>
                      <th class="px-3.5 py-2 font-semibold">{{ t('Who', 'Quién') }}</th>
                      <th class="px-3.5 py-2 font-semibold">{{ t('What', 'Qué') }}</th>
                      <th class="py-2 pl-3.5 pr-[18px] font-semibold">{{ t('Patient', 'Paciente') }}</th>
                    </tr>
                  </thead>
                  <tbody>
                    <tr v-for="row in access" :key="row.id" class="border-b border-line-row align-top last:border-b-0" data-cy="activity-access">
                      <td class="whitespace-nowrap py-2.5 pl-[18px] pr-3.5 text-[13px] text-ink-muted">{{ when(row.created_at) }}</td>
                      <td class="px-3.5 py-2.5 text-[13.5px] font-semibold text-ink-900">{{ row.actor_name ?? t('Former team member', 'Antiguo miembro del equipo') }}</td>
                      <td class="px-3.5 py-2.5 text-[13.5px] text-ink-700">
                        {{ ACCESS_LABELS[row.kind] ?? row.kind }}
                        <span v-if="accessDetail(row)" class="block text-[12.5px] text-ink-muted">{{ accessDetail(row) }}</span>
                      </td>
                      <td class="py-2.5 pl-3.5 pr-[18px] text-[13.5px]">
                        <NuxtLink v-if="row.patient_id && row.patient_name" :to="`/patients/${row.patient_id}`" class="font-medium text-brand-text hover:text-brand-hover">{{ row.patient_name }}</NuxtLink>
                        <span v-else class="text-ink-faint">—</span>
                      </td>
                    </tr>
                  </tbody>
                </table>
              </div>
            </template>

            <!-- Sign-ins -->
            <template v-else>
              <p v-if="signIns.length === 0" class="border-t border-line-row px-[18px] py-8 text-center text-[13.5px] text-ink-muted">{{ t('Nothing recorded yet.', 'Todavía no hay nada registrado.') }}</p>
              <div v-else class="overflow-x-auto border-t border-line-row">
                <table class="w-full min-w-[640px] border-collapse">
                  <thead>
                    <tr class="border-b border-line text-left text-[11.5px] font-semibold uppercase tracking-[.05em] text-ink-faint">
                      <th class="py-2 pl-[18px] pr-3.5 font-semibold">{{ t('When', 'Cuándo') }}</th>
                      <th class="px-3.5 py-2 font-semibold">{{ t('Who', 'Quién') }}</th>
                      <th class="px-3.5 py-2 font-semibold">{{ t('What', 'Qué') }}</th>
                      <th class="py-2 pl-3.5 pr-[18px] font-semibold">{{ t('From', 'Desde') }}</th>
                    </tr>
                  </thead>
                  <tbody>
                    <tr v-for="row in signIns" :key="row.id" class="border-b border-line-row align-top last:border-b-0" data-cy="activity-signin">
                      <td class="whitespace-nowrap py-2.5 pl-[18px] pr-3.5 text-[13px] text-ink-muted">{{ when(row.created_at) }}</td>
                      <td class="px-3.5 py-2.5 text-[13.5px] font-semibold text-ink-900">{{ row.actor_name ?? t('Former team member', 'Antiguo miembro del equipo') }}</td>
                      <td class="px-3.5 py-2.5 text-[13.5px] text-ink-700">
                        <UiPill v-if="row.event === 'two_factor_removed'" tone="warning">{{ SIGNIN_LABELS[row.event] }}</UiPill>
                        <template v-else>{{ SIGNIN_LABELS[row.event] ?? row.event }}</template>
                      </td>
                      <td class="py-2.5 pl-3.5 pr-[18px] text-[13px] text-ink-muted">
                        <span v-if="row.ip" class="font-mono">{{ row.ip }}</span>
                        <span v-if="device(row.user_agent)" class="block">{{ device(row.user_agent) }}</span>
                        <span v-if="!row.ip && !device(row.user_agent)" class="text-ink-faint">—</span>
                      </td>
                    </tr>
                  </tbody>
                </table>
              </div>
              <p class="border-t border-line-row px-[18px] py-3 text-[12.5px] text-ink-muted">
                {{ t('Failed password attempts are not listed here; they never create a session.', 'Los intentos fallidos de contraseña no aparecen aquí: nunca llegan a crear una sesión.') }}
              </p>
            </template>

            <div v-if="!loading && !loadError && hasMore" class="flex justify-center border-t border-line-row p-3">
              <UiBtn size="sm" :disabled="loadingMore" data-cy="activity-more" @click="load(true)">{{ loadingMore ? t('Loading…', 'Cargando…') : t('Show older', 'Ver anteriores') }}</UiBtn>
            </div>
          </section>
        </div>
      </div>
    </div>
  </div>
</template>
