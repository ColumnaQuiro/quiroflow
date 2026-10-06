<script setup lang="ts">
// Recordatorios on the app: patients with nothing booked ahead, worked through
// one by one -- the web's "Por contactar" tab (pages/recalls.vue), reached
// from My Day's "Recalls due".
//
// Same rows and order as the web (recall_candidates, priority first, then the
// longest lapse), and the same writes per action:
//   WhatsApp   WhatsAppTemplateSheet -> /api/whatsapp/send, preselecting the
//              account's recall template; the route logs 'sent_whatsapp'
//   Call       the phone's dialler, then the outcome into contact_log
//   Posponer   patients.recall_snoozed_until
//   Descartar  patients.recall_status 'dismissed' (Restaurar is on the web)
// The snoozed and dismissed tabs, bulk sends and the filters stay on the web.
//
// "Mine" is default_practitioner_id, which is what My Day counts. Like the
// web page, the list opens at three weeks or more without a visit (My Day,
// like the web dashboard, counts everyone); "Ver todos" drops that.
import { formatPhoneDisplay } from '../../utils/phone'

definePageMeta({ layout: 'practitioner' })

const user = useSupabaseUser()
watch(user, (u) => { if (!u) navigateTo('/login') }, { immediate: true })

interface Recall {
  patient_id: string
  first_name: string | null
  last_name: string | null
  email: string | null
  recall_priority: boolean | null
  default_practitioner_id: string | null
  last_appointment_at: string | null
  days_since_last_appointment: number | null
  preferred_language: string | null
  last_no_show_at: string | null
}
interface ContactRow { patient_id: string; action: string; created_at: string; created_by: string | null; note: string | null }
interface Reach { phone: string | null; blocked: boolean }

const supabase = useSupabaseClient()
const t = useT()
const router = useRouter()
const { ask } = useAppConfirm()
const { context, loading: contextLoading, can, restricted, clinics } = usePractitionerContext()
const allowed = computed(() => can('recalls_access'))
const tz = computed(() => context.value?.timeZone ?? DEFAULT_CLINIC_TIMEZONE)

const scope = ref<'mine' | 'all'>('mine')
const MIN_WEEKS = 3
const everyone = ref(false)
const recalls = ref<Recall[]>([])
const lastContact = ref<Record<string, ContactRow>>({})
const reach = ref<Record<string, Reach>>({})
const team = ref<Record<string, string>>({})
const recallTemplate = ref<string | null>(null)
const loading = ref(true)
const loadingMore = ref(false)
const loadError = ref('')
const hasMore = ref(false)
const PAGE = 40

const COLUMNS = 'patient_id, first_name, last_name, email, recall_priority, default_practitioner_id, last_appointment_at, days_since_last_appointment, preferred_language, last_no_show_at'

function query(from: number) {
  let q = supabase.from('recall_candidates').select(COLUMNS)
  // As the web: a clinic's list, plus patients from before clinics were set.
  if (context.value?.clinicId && clinics.value.length > 1) q = q.or(`clinic_id.eq.${context.value.clinicId},clinic_id.is.null`)
  if (scope.value === 'mine' && context.value) q = q.eq('default_practitioner_id', context.value.teamMemberId)
  if (!everyone.value) q = q.gte('days_since_last_appointment', MIN_WEEKS * 7)
  return q
    .order('recall_priority', { ascending: false, nullsFirst: false })
    .order('days_since_last_appointment', { ascending: false })
    .order('patient_id')
    .range(from, from + PAGE)
}

let run = 0
async function load(more = false) {
  if (!context.value || !allowed.value) return
  const mine = ++run
  if (more) loadingMore.value = true
  else {
    loading.value = true
    loadError.value = ''
  }
  const from = more ? recalls.value.length : 0
  const [{ data, error }, tm, acct] = await Promise.all([
    query(from),
    more ? Promise.resolve(null) : supabase.from('team_members').select('id, full_name'),
    more || recallTemplate.value !== null ? Promise.resolve(null) : supabase.from('accounts').select('whatsapp_recall_template_name').eq('id', context.value.accountId).maybeSingle(),
  ])
  if (mine !== run) return
  if (error) {
    // A failed read keeps what was on screen.
    if (!more) loadError.value = t('Could not load the recalls.', 'No se han podido cargar los recordatorios.')
    loading.value = false
    loadingMore.value = false
    return
  }
  if (tm?.data) team.value = Object.fromEntries((tm.data as { id: string; full_name: string }[]).map((m) => [m.id, m.full_name]))
  if (acct?.data) recallTemplate.value = (acct.data as { whatsapp_recall_template_name: string | null }).whatsapp_recall_template_name ?? ''
  const rows = (data as Recall[] | null) ?? []
  hasMore.value = rows.length > PAGE
  const page = rows.slice(0, PAGE)
  recalls.value = more ? [...recalls.value, ...page] : page
  loading.value = false
  loadingMore.value = false
  await loadContext(page.map((r) => r.patient_id), mine)
}
watch([() => context.value?.clinicId, scope, everyone, allowed], () => load(), { immediate: true })

// Last contact, a number to call, and whether they may be messaged at all
// (a minor or do-not-contact patient is not: the send route refuses them).
async function loadContext(ids: string[], mine: number) {
  if (!ids.length) return
  const [logs, nums, pats] = await Promise.all([
    supabase.from('contact_log').select('patient_id, action, created_at, created_by, note').in('patient_id', ids).order('created_at', { ascending: false }),
    supabase.from('patient_contact_numbers').select('patient_id, number, country_code, created_at').in('patient_id', ids).order('created_at'),
    supabase.from('patients').select('id, is_minor, do_not_contact').in('id', ids),
  ])
  if (mine !== run) return
  // Newest first, so the first row seen per patient is their last contact.
  const last: Record<string, ContactRow> = {}
  for (const row of (logs.data as ContactRow[] | null) ?? []) last[row.patient_id] ??= row
  lastContact.value = { ...lastContact.value, ...last }
  const next = { ...reach.value }
  const blocked = new Map(((pats.data as { id: string; is_minor: boolean; do_not_contact: boolean }[] | null) ?? []).map((p) => [p.id, !!(p.is_minor || p.do_not_contact)]))
  for (const id of ids) next[id] = { phone: null, blocked: blocked.get(id) ?? false }
  for (const n of (nums.data as { patient_id: string; number: string; country_code: string }[] | null) ?? []) {
    const r = next[n.patient_id]
    if (r && !r.phone) r.phone = `tel:${formatPhoneDisplay(n.number, n.country_code).replace(/[^\d+]/g, '')}`
  }
  reach.value = next
}

// -- How a row reads -------------------------------------------------------------
const nameOf = (r: Recall) => `${r.first_name ?? ''} ${r.last_name ?? ''}`.trim()
const initialsOf = (r: Recall) => ((r.first_name?.[0] ?? '') + (r.last_name?.[0] ?? '')).toUpperCase() || '?'
const shortDate = (iso: string) => new Date(iso).toLocaleDateString(t('en-GB', 'es-ES'), { day: 'numeric', month: 'short', timeZone: tz.value })
function overdue(r: Recall) {
  const d = r.days_since_last_appointment ?? 0
  const w = Math.floor(d / 7)
  if (w === 0) return d === 1 ? t('1 day', '1 día') : t(`${d} days`, `${d} días`)
  return w === 1 ? t('1 week', '1 semana') : t(`${w} weeks`, `${w} semanas`)
}
const longLapse = (r: Recall) => Math.floor((r.days_since_last_appointment ?? 0) / 7) >= 8
const ACTIONS: Record<string, [string, string]> = {
  sent_whatsapp: ['WhatsApp sent', 'WhatsApp enviado'],
  called_no_answer: ['Called, no answer', 'Llamada, sin respuesta'],
  called_left_message: ['Left a message', 'Dejé un mensaje'],
  booked: ['Booked', 'Reservó cita'],
  other: ['Contacted', 'Contactado'],
}
function contactLine(r: Recall) {
  const e = lastContact.value[r.patient_id]
  if (!e) {
    const x = reach.value[r.patient_id]
    if (x && !x.phone && !r.email) return { text: t('No phone or email', 'Sin teléfono ni correo'), tone: 'warn' }
    return { text: t('Not contacted yet', 'Aún sin contacto'), tone: 'none' }
  }
  const pair = ACTIONS[e.action]
  const who = e.created_by ? team.value[e.created_by]?.split(/\s+/)[0] : e.note?.startsWith('Automation') ? t('automatic', 'automático') : null
  return { text: [pair ? t(pair[0], pair[1]) : e.action, shortDate(e.created_at), who].filter(Boolean).join(' · '), tone: 'done' }
}
function lastSeen(r: Recall) {
  const seen = r.last_appointment_at ? t(`Last visit ${shortDate(r.last_appointment_at)}`, `Última visita ${shortDate(r.last_appointment_at)}`) : ''
  // A no-show since the last attended visit is said: the clock does not count it.
  const noShow = r.last_no_show_at && r.last_appointment_at && r.last_no_show_at > r.last_appointment_at ? t(`didn't come on ${shortDate(r.last_no_show_at)}`, `no vino el ${shortDate(r.last_no_show_at)}`) : ''
  return [seen, noShow].filter(Boolean).join(' · ')
}

// -- Actions ---------------------------------------------------------------------
// Listing templates needs communication_config (as in the Inbox); the send
// route goes to the WhatsApp-flagged number or else the first one, so any
// number on file will do.
const canTemplate = computed(() => can('communication_config'))
const canWhatsApp = (r: Recall) => canTemplate.value && !!reach.value[r.patient_id]?.phone && !reach.value[r.patient_id]?.blocked
const sendingTo = ref<Recall | null>(null)
const menuFor = ref<Recall | null>(null)
const calledFor = ref<Recall | null>(null)
const busy = ref(false)
const notice = ref('')
let noticeTimer: ReturnType<typeof setTimeout> | undefined
function say(m: string) {
  notice.value = m
  clearTimeout(noticeTimer)
  noticeTimer = setTimeout(() => (notice.value = ''), 3500)
}

async function refreshLast(patientId: string) {
  const { data } = await supabase.from('contact_log').select('patient_id, action, created_at, created_by, note').eq('patient_id', patientId).order('created_at', { ascending: false }).limit(1).maybeSingle()
  if (data) lastContact.value = { ...lastContact.value, [patientId]: data as ContactRow }
}
function onSent() {
  const r = sendingTo.value
  sendingTo.value = null
  if (r) {
    refreshLast(r.patient_id)
    say(t('WhatsApp sent.', 'WhatsApp enviado.'))
  }
}
// Dialling leaves the app; the outcome is asked for when it is back.
function call(r: Recall) {
  const href = reach.value[r.patient_id]?.phone
  if (!href) return
  calledFor.value = r
  window.location.href = href
}
async function logCall(r: Recall, action: 'called_no_answer' | 'called_left_message' | 'booked') {
  if (busy.value || !context.value) return
  busy.value = true
  const { error } = await supabase.from('contact_log').insert({ account_id: context.value.accountId, patient_id: r.patient_id, action, created_by: context.value.teamMemberId } as never)
  busy.value = false
  calledFor.value = null
  menuFor.value = null
  if (error) {
    say(t('Could not save it.', 'No se ha podido guardar.'))
    return
  }
  await refreshLast(r.patient_id)
  say(action === 'booked' ? t('Logged as booked.', 'Registrado: reservó cita.') : t('Call logged.', 'Llamada registrada.'))
}

const SNOOZES = computed(() => [
  { days: 7, label: t('1 week', '1 semana') },
  { days: 14, label: t('2 weeks', '2 semanas') },
  { days: 30, label: t('1 month', '1 mes') },
  { days: 91, label: t('3 months', '3 meses') },
])
function drop(r: Recall) {
  recalls.value = recalls.value.filter((x) => x.patient_id !== r.patient_id)
}
async function snooze(r: Recall, days: number) {
  if (busy.value) return
  busy.value = true
  const until = addDaysToDate(clinicDateOf(new Date(), tz.value), days)
  const { data, error } = await supabase.from('patients').update({ recall_snoozed_until: until } as never).eq('id', r.patient_id).select('id')
  busy.value = false
  menuFor.value = null
  if (error || !data?.length) {
    say(t('Could not snooze.', 'No se ha podido posponer.'))
    return
  }
  drop(r)
  say(t(`Snoozed until ${shortDate(`${until}T12:00:00Z`)}.`, `Pospuesto hasta el ${shortDate(`${until}T12:00:00Z`)}.`))
}
async function dismiss(r: Recall) {
  menuFor.value = null
  const ok = await ask({
    title: t(`Dismiss ${nameOf(r)}?`, `¿Descartar a ${nameOf(r)}?`),
    body: t('They leave the list until they come again and lapse. You can restore them on the web.', 'Sale de la lista hasta que vuelva y deje de venir otra vez. Se puede restaurar desde la web.'),
    confirmLabel: t('Dismiss', 'Descartar'),
    danger: true,
  })
  if (!ok) return
  const { data, error } = await supabase.from('patients').update({ recall_status: 'dismissed', recall_dismissed_at: new Date().toISOString() } as never).eq('id', r.patient_id).select('id')
  if (error || !data?.length) {
    say(t('Could not dismiss.', 'No se ha podido descartar.'))
    return
  }
  drop(r)
  say(t('Dismissed from recalls.', 'Descartado de recordatorios.'))
}
// As the record's Book button.
const canBook = computed(() => !!context.value && !restricted('calendar_read_only') && (context.value.isOwner || context.value.permissions.calendar_scope !== 'none'))
</script>

<template>
  <div class="flex h-full min-h-0 flex-col bg-surface-page" data-cy="recalls">
    <AppPageHeader :title="t('Recalls', 'Recordatorios')" back @back="router.back()" />

    <p v-if="!contextLoading && !allowed" class="m-4 rounded-card border border-line bg-surface px-3.5 py-3 text-[13.5px] text-ink-muted">{{ t('Your role does not include recalls.', 'Tu rol no incluye los recordatorios.') }}</p>
    <template v-else>
      <div class="shrink-0 border-b border-line bg-surface px-3 pb-2 pt-2 md:px-5">
        <div class="mx-auto max-w-[760px]">
        <div role="tablist" class="grid grid-cols-2 gap-1 rounded-ctl bg-chip-bg p-[3px] md:max-w-[360px]">
          <button v-for="s in (['mine', 'all'] as const)" :key="s" type="button" role="tab" :aria-selected="scope === s" class="h-8 rounded-ctlSm text-[13px] font-semibold" :class="scope === s ? 'bg-surface text-ink-900 shadow-card' : 'text-ink-muted'" :data-cy="`recalls-scope-${s}`" @click="scope = s">
            {{ s === 'mine' ? t('My patients', 'Mis pacientes') : t('Whole clinic', 'Toda la clínica') }}
          </button>
        </div>
        <button type="button" role="switch" :aria-checked="everyone" class="mt-1.5 flex min-h-9 w-full items-center justify-between gap-3 text-left md:max-w-[360px]" data-cy="recalls-everyone" @click="everyone = !everyone">
          <span class="text-[12.5px] text-ink-muted">{{ everyone ? t('Everyone with nothing booked', 'Todos los que no tienen cita') : t(`No visit for ${MIN_WEEKS} weeks or more`, `Sin venir desde hace ${MIN_WEEKS} semanas o más`) }}</span>
          <span class="text-[12.5px] font-semibold text-brand-text">{{ everyone ? t(`${MIN_WEEKS}+ weeks only`, `Solo ${MIN_WEEKS}+ semanas`) : t('Show everyone', 'Ver todos') }}</span>
        </button>
        </div>
      </div>

      <div class="min-h-0 flex-1 overflow-y-auto px-3 py-3 md:px-5" style="padding-bottom: max(env(safe-area-inset-bottom), 1rem)">
        <AppSkeletonList v-if="contextLoading || loading" :rows="6" />
        <p v-else-if="loadError" class="rounded-card border border-danger-border bg-danger-bg px-3.5 py-3 text-[13.5px] text-danger-text">
          {{ loadError }} <button type="button" class="ml-1 font-semibold underline" @click="load()">{{ t('Try again', 'Reintentar') }}</button>
        </p>
        <p v-else-if="!recalls.length" class="mt-10 text-center text-[14px] text-ink-muted" data-cy="recalls-empty">{{ everyone ? t('Nobody to recall. Everyone has something booked.', 'Nadie por contactar. Todos tienen cita.') : t(`Nobody without a visit for ${MIN_WEEKS} weeks.`, `Nadie lleva ${MIN_WEEKS} semanas sin venir.`) }}</p>
        <div v-else class="mx-auto flex max-w-[760px] flex-col gap-2">
          <article v-for="r in recalls" :key="r.patient_id" class="rounded-card border border-line bg-surface px-3.5 py-3 shadow-card" data-cy="recall-row">
            <div class="flex items-start gap-3">
              <NuxtLink :to="`/patients/${r.patient_id}`" class="flex min-w-0 flex-1 items-start gap-3">
                <span class="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-brand-tint text-[12px] font-bold text-brand-text">{{ initialsOf(r) }}</span>
                <span class="min-w-0">
                  <span class="flex items-center gap-1.5">
                    <span v-if="r.recall_priority" class="text-[12px] text-warning-text" :title="t('Priority', 'Prioritario')" aria-hidden="true">★</span>
                    <span class="truncate text-[15px] font-semibold text-ink-900">{{ nameOf(r) }}</span>
                  </span>
                  <span class="block truncate text-[12.5px] text-ink-muted">{{ lastSeen(r) }}</span>
                  <span class="block truncate text-[12.5px]" :class="contactLine(r).tone === 'done' ? 'text-success-text' : contactLine(r).tone === 'warn' ? 'text-warning-text' : 'text-ink-muted'" data-cy="recall-last-contact">{{ contactLine(r).text }}</span>
                </span>
              </NuxtLink>
              <span class="shrink-0 rounded-full px-2 py-0.5 text-[11.5px] font-semibold" :class="longLapse(r) ? 'border border-warning-border bg-warning-bg text-warning-text' : 'bg-chip-bg text-chip-text'">{{ overdue(r) }}</span>
            </div>
            <div class="mt-2.5 flex gap-2">
              <button v-if="canWhatsApp(r)" type="button" class="flex h-10 flex-1 items-center justify-center gap-1.5 rounded-ctl bg-brand text-[13.5px] font-semibold text-white" data-cy="recall-whatsapp" @click="sendingTo = r">
                <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M21 11.5a8.4 8.4 0 01-12.3 7.5L3 21l2-5.5A8.5 8.5 0 1121 11.5z" /></svg>
                WhatsApp
              </button>
              <button v-if="reach[r.patient_id]?.phone" type="button" class="flex h-10 flex-1 items-center justify-center gap-1.5 rounded-ctl border border-line-control bg-surface text-[13.5px] font-medium text-ink-700" data-cy="recall-call" @click="call(r)">
                <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M5 4h4l2 5-2.5 1.5a11 11 0 005 5L15 13l5 2v4a2 2 0 01-2 2A16 16 0 013 6a2 2 0 012-2z" /></svg>
                {{ t('Call', 'Llamar') }}
              </button>
              <button type="button" class="flex h-10 w-11 shrink-0 items-center justify-center rounded-ctl border border-line-control bg-surface text-ink-700" :aria-label="t(`More for ${nameOf(r)}`, `Más opciones para ${nameOf(r)}`)" data-cy="recall-more" @click="menuFor = r">
                <svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><circle cx="5" cy="12" r="1.8" /><circle cx="12" cy="12" r="1.8" /><circle cx="19" cy="12" r="1.8" /></svg>
              </button>
            </div>
          </article>
          <button v-if="hasMore" type="button" class="mt-1 h-11 rounded-card border border-line-control bg-surface text-[14px] font-medium text-ink-700 disabled:opacity-50" :disabled="loadingMore" data-cy="recalls-more" @click="load(true)">
            {{ loadingMore ? t('Loading…', 'Cargando…') : t('Show more', 'Ver más') }}
          </button>
        </div>
      </div>
    </template>

    <div v-if="notice" class="pointer-events-none fixed inset-x-0 bottom-24 z-40 flex justify-center px-4 md:bottom-6" role="status">
      <span class="rounded-full bg-ink-900 px-4 py-2 text-[13px] font-medium text-surface shadow-popover" data-cy="recalls-notice">{{ notice }}</span>
    </div>

    <!-- More: log a call, book, snooze, dismiss; and, back from a call, how it went -->
    <div v-if="menuFor || calledFor" class="fixed inset-0 z-50 flex flex-col justify-end bg-black/40 md:items-center md:justify-center" data-cy="recall-sheet" @click.self="menuFor = null; calledFor = null">
      <div class="flex max-h-[92%] w-full flex-col gap-1 overflow-y-auto rounded-t-[22px] bg-surface px-4 pt-2.5 shadow-popover md:max-w-[440px] md:rounded-[18px] md:pt-5" style="padding-bottom: max(env(safe-area-inset-bottom), 1.25rem)" role="dialog" aria-modal="true" :aria-label="nameOf((menuFor ?? calledFor)!)">
        <div class="mx-auto mb-1.5 h-1 w-[38px] shrink-0 rounded-full bg-line-control md:hidden" />
        <p class="px-1 text-[16px] font-semibold text-ink-900">{{ nameOf((menuFor ?? calledFor)!) }}</p>
        <p class="px-1 pb-1 text-[11px] font-semibold uppercase tracking-[.05em] text-ink-muted">{{ calledFor ? t('How did the call go?', '¿Cómo ha ido la llamada?') : t('Log a call', 'Registrar llamada') }}</p>
        <div class="grid grid-cols-1 gap-1.5">
          <button v-for="a in (['called_no_answer', 'called_left_message', 'booked'] as const)" :key="a" type="button" class="flex min-h-11 items-center rounded-ctl border border-line-control px-3.5 text-left text-[14px] text-ink-900 disabled:opacity-50" :disabled="busy" :data-cy="`recall-log-${a}`" @click="logCall((menuFor ?? calledFor)!, a)">
            {{ t(ACTIONS[a][0], ACTIONS[a][1]) }}
          </button>
        </div>
        <template v-if="menuFor">
          <NuxtLink v-if="canBook" :to="`/patients/${menuFor.patient_id}?book=1`" class="mt-2 flex h-11 items-center justify-center rounded-card bg-brand text-[14.5px] font-semibold text-white" data-cy="recall-book">{{ t('Book a visit', 'Reservar cita') }}</NuxtLink>
          <p class="px-1 pb-1 pt-3 text-[11px] font-semibold uppercase tracking-[.05em] text-ink-muted">{{ t('Snooze', 'Posponer') }}</p>
          <div class="grid grid-cols-4 gap-1.5">
            <button v-for="s in SNOOZES" :key="s.days" type="button" class="h-10 rounded-ctl border border-line-control text-[13px] font-medium text-ink-700 disabled:opacity-50" :disabled="busy" :data-cy="`recall-snooze-${s.days}`" @click="snooze(menuFor, s.days)">{{ s.label }}</button>
          </div>
          <button type="button" class="mt-3 flex min-h-11 items-center justify-center rounded-ctl text-[14px] font-medium text-danger-text" data-cy="recall-dismiss" @click="dismiss(menuFor)">{{ t('Dismiss from recalls', 'Descartar de recordatorios') }}</button>
        </template>
        <button type="button" class="flex min-h-11 items-center justify-center text-[13.5px] text-ink-muted" @click="menuFor = null; calledFor = null">{{ calledFor ? t('Not now', 'Ahora no') : t('Close', 'Cerrar') }}</button>
      </div>
    </div>

    <WhatsAppTemplateSheet
      v-if="sendingTo"
      :patient-id="sendingTo.patient_id"
      :patient-first-name="sendingTo.first_name ?? ''"
      :default-template-name="recallTemplate"
      :patient-preferred-language="sendingTo.preferred_language"
      @close="sendingTo = null"
      @sent="onSent"
    />
  </div>
</template>
