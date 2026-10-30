<script setup lang="ts">
// Ajustes › Privacidad (owners only): how long clinical records are kept,
// the ones past that period -- kept on with a reason, or anonymised -- and
// consents about to expire (20261017182107_record_retention.sql). Nothing is
// deleted by itself: every anonymisation is an owner typing ANONIMIZAR, and
// the database re-checks the period and the owner before it does anything.

interface Row {
  patient_id: string
  first_name: string
  last_name: string
  last_activity: string
  notes: number
  files: number
  facturas: number
  kept_until: string | null
  kept_reason: string | null
}
interface Expiring { docId: string; patientId: string; name: string; title: string; signedAt: string; expiresAt: string }

const t = useT()
const supabase = useSupabaseClient()
const store = useAccountStore()
const authedFetch = useAuthedFetch()
const { showToast } = useToast()

const years = ref(5)
const savedYears = ref(5)
const rows = ref<Row[]>([])
const expiring = ref<Expiring[]>([])
const loading = ref(true)
const today = new Date().toISOString().slice(0, 10)

async function load() {
  if (!store.accountId) return
  loading.value = true
  const [{ data: account }, review] = await Promise.all([
    supabase.from('accounts').select('clinical_retention_years').eq('id', store.accountId).maybeSingle(),
    supabase.rpc('retention_review', { p_account_id: store.accountId }),
  ])
  years.value = savedYears.value = account?.clinical_retention_years ?? 5
  if (review.error) showToast(review.error.message, 'error')
  rows.value = (review.data as Row[] | null) ?? []
  await loadExpiring()
  loading.value = false
}
watch(() => store.accountId, load, { immediate: true })

// The latest signed copy of each template with a validity, per patient,
// expiring in the next 30 days or expired in the last 90.
async function loadExpiring() {
  const { data: templates } = await supabase.from('doc_templates').select('id, title, valid_months').not('valid_months', 'is', null)
  const valid = new Map(((templates as { id: string; title: string; valid_months: number }[] | null) ?? []).map((x) => [x.id, x]))
  if (!valid.size) return (expiring.value = [])
  const { data: docs } = await supabase
    .from('patient_docs')
    .select('id, patient_id, template_id, completed_at, patients(first_name, last_name, anonymized_at)')
    .in('template_id', [...valid.keys()])
    .not('completed_at', 'is', null)
    .order('completed_at', { ascending: false })
  const latest = new Map<string, Expiring>()
  const soon = new Date(Date.now() + 30 * 86400_000).toISOString()
  const since = new Date(Date.now() - 90 * 86400_000).toISOString()
  for (const d of (docs as unknown as { id: string; patient_id: string; template_id: string; completed_at: string; patients: { first_name: string | null; last_name: string | null; anonymized_at: string | null } | null }[] | null) ?? []) {
    const key = `${d.patient_id}:${d.template_id}`
    if (latest.has(key) || d.patients?.anonymized_at) continue
    const tpl = valid.get(d.template_id)!
    const exp = new Date(d.completed_at)
    exp.setMonth(exp.getMonth() + tpl.valid_months)
    latest.set(key, { docId: d.id, patientId: d.patient_id, name: `${d.patients?.first_name ?? ''} ${d.patients?.last_name ?? ''}`.trim(), title: tpl.title, signedAt: d.completed_at, expiresAt: exp.toISOString() })
  }
  expiring.value = [...latest.values()].filter((e) => e.expiresAt <= soon && e.expiresAt >= since).sort((a, b) => a.expiresAt.localeCompare(b.expiresAt))
}

const savingYears = ref(false)
async function saveYears() {
  if (!store.accountId) return
  const n = Math.round(Number(years.value))
  if (!(n >= 5 && n <= 50)) return showToast(t('Between 5 and 50 years.', 'Entre 5 y 50 años.'), 'error')
  savingYears.value = true
  const { error } = await supabase.from('accounts').update({ clinical_retention_years: n }).eq('id', store.accountId)
  savingYears.value = false
  if (error) return showToast(error.message, 'error')
  await load()
}

const due = computed(() => rows.value.filter((r) => !r.kept_until || r.kept_until < today))
const kept = computed(() => rows.value.filter((r) => r.kept_until && r.kept_until >= today))
const selected = ref<string[]>([])
const allSelected = computed(() => due.value.length > 0 && selected.value.length === due.value.length)
function toggleAll() {
  selected.value = allSelected.value ? [] : due.value.map((r) => r.patient_id)
}

// "Conservar": for these, N more years, with a reason.
const keeping = ref<string[] | null>(null)
const keepYears = ref(2)
const keepReason = ref('')
async function keep() {
  if (!keeping.value || !keepReason.value.trim()) return
  const until = new Date()
  until.setFullYear(until.getFullYear() + keepYears.value)
  for (const id of keeping.value) {
    const { error } = await supabase.rpc('keep_patient_record', { p_patient_id: id, p_until: until.toISOString().slice(0, 10), p_reason: keepReason.value.trim() })
    if (error) return showToast(error.message, 'error')
  }
  keeping.value = null
  keepReason.value = ''
  selected.value = []
  await load()
}
async function unkeep(id: string) {
  const { error } = await supabase.rpc('keep_patient_record', { p_patient_id: id, p_until: null as unknown as string, p_reason: null as unknown as string })
  if (error) return showToast(error.message, 'error')
  await load()
}

const anonymizing = ref(false)
const busy = ref(false)
const selectedRows = computed(() => due.value.filter((r) => selected.value.includes(r.patient_id)))
const selectedFacturas = computed(() => selectedRows.value.reduce((n, r) => n + Number(r.facturas), 0))
async function anonymize() {
  busy.value = true
  try {
    const r = await authedFetch<{ done: string[]; refused: { id: string; reason: string }[] }>('/api/patients/anonymize', { method: 'POST', body: { patientIds: selected.value } })
    showToast(t(`${r.done.length} anonymised.`, `${r.done.length} anonimizadas.`), 'success')
    if (r.refused.length) showToast(r.refused[0]!.reason, 'error')
  } catch (e: any) {
    showToast(e?.data?.statusMessage ?? t("Couldn't anonymise them.", 'No se han podido anonimizar.'), 'error')
  } finally {
    busy.value = false
    anonymizing.value = false
    selected.value = []
    await load()
  }
}

const day = (iso: string) => new Date(iso).toLocaleDateString(t('en-GB', 'es-ES'), { day: 'numeric', month: 'short', year: 'numeric' })
const yearsAgo = (iso: string) => Math.floor((Date.now() - Date.parse(iso)) / (365.25 * 86400_000))
const th = 'px-3 py-2 text-left text-[11px] font-[640] uppercase tracking-[.05em] text-ink-muted'
const td = 'border-t border-line-row px-3 py-2.5 text-[13.5px] text-ink-900'

// Modal dialogs on this screen: focus stays inside while open, Escape closes,
// focus returns to what opened it (useFocusTrap, following each v-if).
const keepTitleId = useId()
const keepPanel = ref<HTMLElement | null>(null)
useFocusTrap(keepPanel, () => (keeping.value = null), () => !!keeping.value)
</script>

<template>
  <div class="flex h-full flex-col">
    <PageHeader :title="t('Privacy', 'Privacidad')" :meta="t('Owners only', 'Solo propietarios')" />
    <div class="flex-1 overflow-y-auto">
      <div class="flex gap-8 p-4 pb-24 sm:px-6 sm:pt-6 lg:pb-6">
        <SettingsNav />
        <div class="flex min-w-0 max-w-[920px] flex-1 flex-col gap-4" data-cy="privacy" :data-ready="loading ? undefined : 'true'">
          <section class="flex flex-col gap-2.5 rounded-card border border-line bg-surface p-[18px]">
            <h2 class="text-[16px] font-bold text-ink-900">{{ t('How long records are kept', 'Plazo de conservación') }}</h2>
            <div class="flex flex-wrap items-center gap-2">
              <label for="retention-years" class="text-[13.5px] text-ink-700">{{ t('Years since the last visit, note, file or payment', 'Años desde la última visita, nota, archivo o pago') }}</label>
              <input id="retention-years" v-model="years" type="number" min="5" max="50" class="h-9 w-[80px] rounded-ctl border border-line-control bg-surface px-2.5 font-mono text-[14px] text-ink-900" data-cy="retention-years" />
              <UiBtn size="sm" :disabled="savingYears || Number(years) === savedYears" data-cy="retention-years-save" @click="saveYears">{{ t('Save', 'Guardar') }}</UiBtn>
            </div>
            <p class="text-[12.5px] text-ink-muted">{{ t('Spanish law (Ley 41/2002) asks for at least 5 years from discharge; some regions ask for more. Check yours.', 'La ley estatal (41/2002) pide al menos 5 años desde el alta; algunas comunidades piden más. Consulta la tuya.') }}</p>
            <p class="text-[12.5px] text-ink-muted">
              {{ t('Where the data is kept, how it is protected and which providers process it:', 'Dónde se guardan los datos, cómo se protegen y qué proveedores los tratan:') }}
              <NuxtLink to="/legal/security" target="_blank" class="font-medium text-brand-text hover:text-brand-hover" data-cy="privacy-security-link">{{ t('Security & data protection', 'Seguridad y protección de datos') }}</NuxtLink>
            </p>
          </section>

          <section class="overflow-hidden rounded-card border border-line bg-surface" data-cy="retention-due">
            <div class="flex flex-wrap items-baseline gap-3 px-[18px] pb-2 pt-4">
              <h2 class="flex-1 text-[16px] font-bold text-ink-900">{{ t(`Records past their period · ${due.length}`, `Historias fuera de plazo · ${due.length}`) }}</h2>
              <button v-if="due.length" type="button" class="text-[12.5px] font-semibold text-brand-text" @click="toggleAll">{{ allSelected ? t('Select none', 'Ninguna') : t('Select all', 'Seleccionar todas') }}</button>
            </div>
            <p v-if="!loading && !due.length" class="px-[18px] pb-4 text-[13.5px] text-ink-muted">{{ t('None. Nothing is past its period.', 'Ninguna. Nada ha pasado el plazo.') }}</p>
            <div v-else class="overflow-x-auto">
              <table class="w-full min-w-[640px] border-collapse">
                <thead><tr><th :class="th" class="w-9"><span class="sr-only">{{ t('Select', 'Elegir') }}</span></th><th :class="th">{{ t('Patient', 'Paciente') }}</th><th :class="th">{{ t('Last activity', 'Último movimiento') }}</th><th :class="th">{{ t('Holds', 'Contiene') }}</th><th :class="th">{{ t('Facturas', 'Facturas') }}</th><th :class="th"></th></tr></thead>
                <tbody>
                  <tr v-for="r in due" :key="r.patient_id" data-cy="retention-row" :data-id="r.patient_id">
                    <td :class="td"><input v-model="selected" type="checkbox" :value="r.patient_id" :aria-label="`${r.first_name} ${r.last_name}`" data-cy="retention-select" /></td>
                    <td :class="td"><NuxtLink :to="`/patients/${r.patient_id}`" class="font-semibold hover:underline">{{ r.first_name }} {{ r.last_name }}</NuxtLink></td>
                    <td :class="td">{{ day(r.last_activity) }} <span class="text-ink-muted">· {{ t(`${yearsAgo(r.last_activity)} years`, `${yearsAgo(r.last_activity)} años`) }}</span></td>
                    <td :class="td" class="text-ink-muted">{{ t(`${r.notes} notes · ${r.files} files`, `${r.notes} notas · ${r.files} archivos`) }}</td>
                    <td :class="td" class="text-ink-muted">{{ t(`${r.facturas}, kept`, `${r.facturas}, se conservan`) }}</td>
                    <td :class="td" class="text-right"><UiBtn size="sm" data-cy="retention-keep-one" @click="keeping = [r.patient_id]">{{ t('Keep', 'Conservar') }}</UiBtn></td>
                  </tr>
                </tbody>
              </table>
            </div>
            <div v-if="selected.length" class="flex flex-wrap items-center gap-2 border-t border-line-row bg-surface-subtle px-[18px] py-3">
              <span class="flex-1 text-[13px] text-ink-muted">{{ t(`${selected.length} selected`, `${selected.length} elegidas`) }}</span>
              <UiBtn size="sm" data-cy="retention-keep" @click="keeping = [...selected]">{{ t(`Keep ${selected.length}`, `Conservar ${selected.length}`) }}</UiBtn>
              <button type="button" class="h-8 rounded-ctl bg-danger-text px-3 text-[13px] font-bold text-surface" data-cy="retention-anonymize" @click="anonymizing = true">{{ t(`Anonymise ${selected.length}`, `Anonimizar ${selected.length}`) }}</button>
            </div>
          </section>

          <section v-if="kept.length" class="rounded-card border border-line bg-surface px-[18px] py-3" data-cy="retention-kept">
            <h2 class="text-[14.5px] font-bold text-ink-900">{{ t('Being kept', 'Se conservan') }}</h2>
            <div v-for="r in kept" :key="r.patient_id" class="flex flex-wrap items-center gap-2 border-b border-line-divider py-2 text-[13.5px] last:border-b-0" data-cy="retention-kept-row">
              <span class="font-semibold">{{ r.first_name }} {{ r.last_name }}</span>
              <UiPill>{{ t(`until ${day(r.kept_until!)}`, `hasta ${day(r.kept_until!)}`) }}</UiPill>
              <span class="flex-1 text-ink-muted">{{ r.kept_reason }}</span>
              <button type="button" class="text-[12.5px] font-semibold text-ink-muted" @click="unkeep(r.patient_id)">{{ t('Stop keeping', 'Dejar de conservar') }}</button>
            </div>
          </section>

          <section class="overflow-hidden rounded-card border border-line bg-surface" data-cy="consents-expiring">
            <div class="px-[18px] pb-2 pt-4">
              <h2 class="text-[16px] font-bold text-ink-900">{{ t('Consents about to expire', 'Consentimientos que caducan') }}</h2>
              <p class="text-[12.5px] text-ink-muted">{{ t('Within 30 days, by the validity set on each template in Settings › Docs.', 'En los próximos 30 días, según la validez de cada plantilla en Ajustes › Documentos.') }}</p>
            </div>
            <p v-if="!loading && !expiring.length" class="px-[18px] pb-4 text-[13.5px] text-ink-muted">{{ t('None.', 'Ninguno.') }}</p>
            <div v-for="e in expiring" :key="e.docId" class="flex flex-wrap items-center gap-3 border-t border-line-row px-[18px] py-2.5 text-[13.5px]" data-cy="consent-expiring">
              <span class="font-semibold">{{ e.name }}</span>
              <span class="flex-1 text-ink-700">{{ e.title }} · {{ t(`signed ${day(e.signedAt)}`, `firmado ${day(e.signedAt)}`) }}</span>
              <UiPill :tone="e.expiresAt < new Date().toISOString() ? 'danger' : 'warning'">{{ e.expiresAt < new Date().toISOString() ? t(`expired ${day(e.expiresAt)}`, `caducó ${day(e.expiresAt)}`) : t(`expires ${day(e.expiresAt)}`, `caduca ${day(e.expiresAt)}`) }}</UiPill>
              <NuxtLink :to="`/patients/${e.patientId}?tab=docs`" class="text-[12.5px] font-semibold text-brand-text">{{ t('Renew', 'Renovar') }}</NuxtLink>
            </div>
          </section>
        </div>
      </div>
    </div>

    <div v-if="keeping" class="fixed inset-0 z-30 flex items-center justify-center bg-scrim/40 p-4">
      <form ref="keepPanel" role="dialog" aria-modal="true" :aria-labelledby="keepTitleId" class="flex w-full max-w-[440px] flex-col gap-3 rounded-card bg-surface p-5 shadow-popover" data-cy="retention-keep-form" @submit.prevent="keep">
        <h2 :id="keepTitleId" class="text-[17px] font-bold text-ink-900">{{ t(`Keep ${keeping.length} more`, `Conservar ${keeping.length} más tiempo`) }}</h2>
        <label class="flex flex-col gap-1 text-[13px] font-semibold text-ink-700">
          {{ t('For', 'Durante') }}
          <select v-model.number="keepYears" class="h-9 rounded-ctl border border-line-control bg-surface px-2.5 text-[14px] font-normal">
            <option v-for="n in [1, 2, 3, 5, 10]" :key="n" :value="n">{{ t(`${n} years`, `${n} años`) }}</option>
          </select>
        </label>
        <label class="flex flex-col gap-1 text-[13px] font-semibold text-ink-700">
          {{ t('Why', 'Motivo') }}
          <input v-model="keepReason" type="text" :placeholder="t('e.g. treatment likely to resume', 'p. ej. tratamiento previsible')" class="h-9 rounded-ctl border border-line-control bg-surface px-2.5 text-[14px] font-normal" data-cy="retention-keep-reason" />
        </label>
        <div class="flex justify-end gap-2">
          <UiBtn type="button" @click="keeping = null">{{ t('Cancel', 'Cancelar') }}</UiBtn>
          <UiBtn type="submit" variant="primary" :disabled="!keepReason.trim()" data-cy="retention-keep-save">{{ t('Keep', 'Conservar') }}</UiBtn>
        </div>
      </form>
    </div>

    <UiConfirmDialog
      v-if="anonymizing"
      tone="danger"
      confirm-word="ANONIMIZAR"
      :busy="busy"
      :title="t(`Anonymise ${selected.length} records`, `Anonimizar ${selected.length} historias`)"
      :confirm-label="t('Anonymise', 'Anonimizar')"
      :cancel-label="t('Cancel', 'Cancelar')"
      @confirm="anonymize"
      @cancel="anonymizing = false"
    >
      <p class="text-[14px] leading-snug text-ink-700">{{ t('Their clinical notes, files, photos, documents, messages and contact details are deleted for good, and the Activity log keeps who did what but no longer what the record said. The name becomes “Paciente anonimizado”.', 'Se borran para siempre sus notas clínicas, archivos, fotos, documentos, mensajes y datos de contacto, y el registro de actividad conserva quién hizo qué pero ya no lo que decía la historia. El nombre pasa a «Paciente anonimizado».') }}</p>
      <p class="text-[14px] leading-snug text-ink-700">{{ t(`Their visits and their ${selectedFacturas} facturas, invoices and payments stay as they are: tax law and VeriFactu need them kept separately.`, `Sus visitas y sus ${selectedFacturas} facturas, recibos y pagos se quedan como están: Hacienda y VeriFactu los piden aparte.`) }}</p>
    </UiConfirmDialog>
  </div>
</template>
