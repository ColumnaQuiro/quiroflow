<script setup lang="ts">
import { LEARN_TAGS, suggestArticles, tagsForComplaint } from '../../utils/learn'

// "Lecturas" on a patient's record, in the web app and the staff app, beside
// "Ejercicios en casa": what has been sent and whether it was opened, and
// sending another from the clinic's library -- those that match the
// patient's motivo de consulta first (utils/learn.ts). Delivery is the
// server's (api/learn/send): their app, else email, else a link to copy.
// Shared with mobile/, so relative imports and no account store.
const props = defineProps<{ accountId: string; patientId: string; complaint?: string | null; diagnosis?: string | null }>()

const t = useT()
const supabase = useSupabaseClient()
const authedFetch = useAuthedFetch()

interface Article { id: string; title: string; tags: string[]; minutes: number | null }
interface Sent { id: string; sent_at: string; channel: string | null; opened_at: string | null; learn_articles: { title: string } | null }
const articles = ref<Article[]>([])
const sent = ref<Sent[]>([])
const visits = ref(0)
const loading = ref(true)
const loadError = ref(false)

async function load() {
  loading.value = true
  loadError.value = false
  const [a, s, v] = await Promise.all([
    supabase.from('learn_articles').select('id, title, tags, minutes').eq('account_id', props.accountId).is('archived_at', null).order('title'),
    supabase.from('learn_sends').select('id, sent_at, channel, opened_at, learn_articles(title)').eq('patient_id', props.patientId).order('sent_at', { ascending: false }).limit(20),
    supabase.from('appointments').select('id', { count: 'exact', head: true }).eq('patient_id', props.patientId).is('deleted_at', null).lte('starts_at', new Date().toISOString()).not('status', 'in', '(cancelled,no_show)'),
  ])
  if (a.error || s.error) loadError.value = true
  articles.value = (a.data as Article[] | null) ?? []
  sent.value = (s.data as unknown as Sent[] | null) ?? []
  visits.value = v.count ?? 0
  loading.value = false
}
watch(() => props.patientId, load, { immediate: true })

const patientTags = computed(() => tagsForComplaint(props.complaint, props.diagnosis))
const offered = computed(() => suggestArticles(articles.value, patientTags.value, { firstVisit: visits.value <= 1 }))
const open = ref(false)
// What is chosen: the top suggestion until someone picks another.
const picked = ref('')
const pick = computed({
  get: () => (offered.value.some((a) => a.id === picked.value) ? picked.value : (offered.value[0]?.id ?? '')),
  set: (v: string) => (picked.value = v),
})

const sending = ref(false)
const result = ref<{ channel: string; url: string } | null>(null)
const error = ref('')
const copied = ref(false)
async function send() {
  if (!pick.value || sending.value) return
  sending.value = true
  error.value = ''
  result.value = null
  copied.value = false
  try {
    const r = await authedFetch<{ channel: string; url: string }>('/api/learn/send', { method: 'POST', body: { patientId: props.patientId, articleId: pick.value } })
    result.value = r
    open.value = false
    picked.value = ''
    await load()
  } catch (e: any) {
    error.value = e?.data?.statusMessage ?? t("Couldn't send it.", 'No se ha podido enviar.')
  } finally {
    sending.value = false
  }
}
async function copy() {
  if (!result.value) return
  try {
    await navigator.clipboard.writeText(result.value.url)
    copied.value = true
  } catch {
    copied.value = false
  }
}
const channelLabel = (c: string | null) => (c === 'app' ? t('app', 'app') : c === 'email' ? t('email', 'email') : t('link', 'enlace'))
const day = (iso: string) => new Date(iso).toLocaleDateString(t('en-GB', 'es-ES'), { day: 'numeric', month: 'short' })
const tagLine = (a: Article) => a.tags.map((x) => LEARN_TAGS[x] ?? x).join(' · ')
const input = 'h-10 w-full rounded-ctl border border-line-control bg-surface px-3 text-[14px] text-ink-900 focus:border-brand focus:outline-none'
</script>

<template>
  <section class="rounded-card border border-line bg-surface px-3.5 py-3 shadow-card" data-cy="learn-staff" :data-ready="loading ? undefined : 'true'">
    <div class="flex items-center justify-between gap-2">
      <h2 class="text-[11px] font-semibold uppercase tracking-[.05em] text-ink-muted">{{ t('Reading', 'Lecturas') }}</h2>
      <button v-if="!open && articles.length" type="button" class="text-[12.5px] font-medium text-brand-text" data-cy="learn-send-open" @click="open = true">{{ t('+ Send', '+ Enviar') }}</button>
    </div>

    <div v-if="loading" class="mt-2"><UiSkeleton class="h-4 w-40 rounded-ctlSm" /></div>
    <p v-else-if="loadError" class="mt-2 text-[12.5px] text-danger-text">
      {{ t("Couldn't load them.", 'No se han podido cargar.') }}
      <button type="button" class="ml-1 font-semibold text-brand-text" @click="load">{{ t('Try again', 'Reintentar') }}</button>
    </p>
    <template v-else>
      <p v-if="!articles.length" class="mt-1.5 text-[13px] text-ink-faint" data-cy="learn-empty-library">
        {{ t('The clinic has no articles yet: add them in Settings › Education.', 'La clínica aún no tiene lecturas: añádelas en Ajustes › Educación.') }}
      </p>
      <ul v-if="sent.length" class="mt-1.5 divide-y divide-line-row">
        <li v-for="s in sent" :key="s.id" class="flex items-center gap-3 py-2" data-cy="learn-sent-row">
          <span class="min-w-0 flex-1 truncate text-[14px] text-ink-900">{{ s.learn_articles?.title }}</span>
          <span class="shrink-0 text-[12px] text-ink-muted">{{ day(s.sent_at) }} · {{ channelLabel(s.channel) }}</span>
          <UiPill :tone="s.opened_at ? 'success' : 'neutral'" data-cy="learn-sent-status">{{ s.opened_at ? t('Read', 'Vista') : t('Not opened', 'Sin abrir') }}</UiPill>
        </li>
      </ul>
      <p v-else-if="articles.length && !open" class="mt-1.5 text-[13px] text-ink-faint">{{ t('Nothing sent yet.', 'Aún no se le ha enviado ninguna.') }}</p>
    </template>

    <div v-if="result" class="mt-2 rounded-ctl border border-success-border bg-success-bg px-3 py-2 text-[13px] text-success-text" data-cy="learn-sent-result" :data-channel="result.channel">
      <template v-if="result.channel === 'app'">{{ t('Sent to their app.', 'Enviada a su app.') }}</template>
      <template v-else-if="result.channel === 'email'">{{ t('They have no app: sent by email.', 'No tiene la app: enviada por email.') }}</template>
      <template v-else>
        {{ t('No app and no email: copy the link and send it by WhatsApp.', 'Sin app ni email: copia el enlace y envíaselo por WhatsApp.') }}
        <button type="button" class="ml-1 font-semibold underline" data-cy="learn-copy-link" @click="copy">{{ copied ? t('Copied', 'Copiado') : t('Copy link', 'Copiar enlace') }}</button>
      </template>
    </div>

    <form v-if="open" class="mt-3 space-y-2.5 border-t border-line-row pt-3" data-cy="learn-send-form" @submit.prevent="send">
      <label class="block text-[12.5px] font-medium text-ink-700">
        {{ t('Article', 'Lectura') }}
        <select v-model="pick" :class="[input, 'mt-1']" data-cy="learn-pick">
          <option v-for="a in offered" :key="a.id" :value="a.id">{{ a.suggested ? '★ ' : '' }}{{ a.title }}{{ a.tags.length ? ` — ${tagLine(a)}` : '' }}</option>
        </select>
      </label>
      <p v-if="patientTags.length" class="text-[12px] text-ink-muted">{{ t('★ Suggested for their reason for visit.', '★ Sugeridas por su motivo de consulta.') }}</p>
      <p v-if="error" role="alert" class="text-[12.5px] text-danger-text">{{ error }}</p>
      <div class="flex gap-2">
        <UiBtn type="submit" variant="primary" :disabled="!pick || sending" data-cy="learn-send">{{ sending ? t('Sending…', 'Enviando…') : t('Send', 'Enviar') }}</UiBtn>
        <UiBtn type="button" variant="secondary" @click="open = false">{{ t('Cancel', 'Cancelar') }}</UiBtn>
      </div>
    </form>
  </section>
</template>
