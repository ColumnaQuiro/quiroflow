<script setup lang="ts">
import type { Tables } from '~/types/database.types'

import type { DocField } from '~/utils/docFields'
import { patientAttributeMergeVars } from '~/utils/patientAttributes'

const props = defineProps<{ patientId: string }>()

const supabase = useSupabaseClient()
const store = useAccountStore()
const t = useT()
const { formatLongDate } = useDates()
const { showToast } = useToast()
const { can } = usePermission()

// `public_token` isn't in the generated Supabase types yet -- merge it in
// locally rather than editing the generated file by hand.
type Doc = Omit<Tables<'patient_docs'>, 'fields'> & { fields: DocField[]; public_token: string }
type Template = Omit<Tables<'doc_templates'>, 'fields' | 'translations'> & { fields: DocField[]; translations: unknown }

const docs = ref<Doc[]>([])
const templates = ref<Template[]>([])
const loading = ref(true)
const activeDoc = ref<Doc | null>(null)
const title = ref('')
const fields = ref<DocField[]>([])
const saving = ref(false)
const showNewMenu = ref(false)
// Closes on a press outside it and on Escape, like the record's other menus
// (Banner.vue). It stayed open over the list until its own button was hit again.
const newMenuRoot = ref<HTMLElement | null>(null)
function onNewMenuPointerDown(event: PointerEvent) {
  if (showNewMenu.value && !newMenuRoot.value?.contains(event.target as Node)) showNewMenu.value = false
}
function onNewMenuKeydown(event: KeyboardEvent) {
  if (event.key === 'Escape') showNewMenu.value = false
}
onMounted(() => {
  document.addEventListener('pointerdown', onNewMenuPointerDown)
  document.addEventListener('keydown', onNewMenuKeydown)
})
onBeforeUnmount(() => {
  document.removeEventListener('pointerdown', onNewMenuPointerDown)
  document.removeEventListener('keydown', onNewMenuKeydown)
})
const patientPhoneDigits = ref<string | null>(null)
const copiedId = ref<string | null>(null)

async function load() {
  loading.value = true
  const [{ data: docData }, { data: templateData }] = await Promise.all([
    supabase.from('patient_docs').select('*').eq('patient_id', props.patientId).order('updated_at', { ascending: false }),
    // A translation made the old way, as a template of its own, is folded
    // into its form's translations (20261116144215); not a form to pick.
    supabase.from('doc_templates').select('*').is('translation_of', null).order('title'),
  ])
  docs.value = (docData as unknown as Doc[]) ?? []
  templates.value = (templateData as unknown as Template[]) ?? []
  loading.value = false
}
onMounted(load)

// The language a form goes out in: the patient's own when any form has a
// translation into it, which is what an automation would send them; the
// clinic's otherwise. Staff can switch it before picking the form.
const offeredLanguages = computed(() => {
  const have = new Set(templates.value.flatMap((tpl) => docLanguagesOf(tpl.translations)))
  return DOC_LANGUAGES.filter((code) => have.has(code))
})
const patientLanguage = ref<string | null>(null)
const sendLanguage = ref<string>('es')
watch([offeredLanguages, patientLanguage], () => {
  const own = patientLanguage.value
  sendLanguage.value = own && (offeredLanguages.value as readonly string[]).includes(own) ? own : 'es'
})
// Who the send dialog writes to. A minor is never written to directly: both
// senders refuse it (send-email, inboxSend), so the dialog does not offer them.
const recipient = ref<{ firstName: string; email: string | null; isMinor: boolean } | null>(null)
onMounted(async () => {
  const { data } = await supabase
    .from('patients')
    .select('preferred_language, first_name, email, is_minor')
    .eq('id', props.patientId)
    .maybeSingle<{ preferred_language: string | null; first_name: string | null; email: string | null; is_minor: boolean | null }>()
  patientLanguage.value = data?.preferred_language ?? null
  recipient.value = data ? { firstName: data.first_name ?? '', email: data.email?.trim() || null, isMinor: !!data.is_minor } : null
})
const hasLanguage = (tpl: Template) => sendLanguage.value === 'es' || !!docTranslationsOf(tpl.translations)[sendLanguage.value]

onMounted(async () => {
  const { data } = await supabase
    .from('patient_contact_numbers')
    .select('country_code, number')
    .eq('patient_id', props.patientId)
    .order('created_at')
    .limit(1)
    .maybeSingle()
  // toE164 rather than dial+number: a number already stored with its own "+"
  // prefix would otherwise be double-prefixed into a broken wa.me link
  // ("+34" + "+34600123456" -> 3434600123456).
  if (data) patientPhoneDigits.value = toE164(data.number, data.country_code) ?? ''
})

function docLink(doc: Doc) {
  return `${window.location.origin}/doc/${doc.public_token}`
}
function openLink(doc: Doc) {
  window.open(docLink(doc), '_blank')
}
async function copyLink(doc: Doc) {
  await navigator.clipboard.writeText(docLink(doc))
  copiedId.value = doc.id
  setTimeout(() => {
    if (copiedId.value === doc.id) copiedId.value = null
  }, 2000)
}
// "Send a form" used to make the patient's copy and then open it HERE, in the
// staff editor, and send nothing: the button said send and the computer
// opened a form. Now picking a form asks how it goes to the patient, through
// the clinic's own email and WhatsApp (the senders BillingTab's direct debit
// link uses, with their guards), and filling it in at the clinic is one of
// the choices rather than the only thing that happens.
type SendChannel = 'email' | 'whatsapp'
const sendAsk = ref<Doc | null>(null)
const sendChannel = ref<SendChannel | null>(null)
const sendBusy = ref(false)
const sendError = ref('')
const sendChannels = computed<SendChannel[]>(() => {
  if (!recipient.value || recipient.value.isMinor) return []
  const out: SendChannel[] = []
  if (recipient.value.email && can('recalls_access')) out.push('email')
  if (patientPhoneDigits.value && can('inbox_access')) out.push('whatsapp')
  return out
})
function askToSend(doc: Doc) {
  sendAsk.value = doc
  sendError.value = ''
  sendChannel.value = sendChannels.value[0] ?? null
}
// What the patient reads, in the form's own language: a form sent in
// English should not arrive under a Spanish sentence.
function patientMessage(doc: Doc): { subject: string; greeting: string; body: string; text: string } {
  const name = recipient.value?.firstName?.trim() ?? ''
  const link = docLink(doc)
  const m = (() => {
    switch (doc.language) {
      case 'en':
        return { subject: `Form to fill in: ${doc.title}`, greeting: name ? `Hi ${name},` : 'Hi,', body: `We are sending you "${doc.title}" to fill in. It takes a couple of minutes, from your phone: ${link}` }
      case 'fr':
        return { subject: `Formulaire à remplir : ${doc.title}`, greeting: name ? `Bonjour ${name},` : 'Bonjour,', body: `Nous vous envoyons « ${doc.title} » à remplir. Cela prend quelques minutes, depuis votre téléphone : ${link}` }
      case 'ca':
        return { subject: `Formulari per omplir: ${doc.title}`, greeting: name ? `Hola ${name},` : 'Hola,', body: `T'enviem «${doc.title}» perquè l'omplis. Són un parell de minuts, des del mòbil: ${link}` }
      default:
        return { subject: `Formulario para rellenar: ${doc.title}`, greeting: name ? `Hola ${name},` : 'Hola,', body: `Te enviamos «${doc.title}» para que lo rellenes. Son un par de minutos, desde el móvil: ${link}` }
    }
  })()
  return { ...m, text: `${m.greeting}\n\n${m.body}` }
}
async function sendDoc() {
  const doc = sendAsk.value
  const channel = sendChannel.value
  if (!doc || !channel) return
  sendBusy.value = true
  sendError.value = ''
  const { subject, body, text } = patientMessage(doc)
  try {
    if (channel === 'email') {
      // send-email writes the "Hola <name>," itself, above the body.
      await useStaffFetch(`/api/patients/${props.patientId}/send-email`, { method: 'POST', body: { subject, body } })
    } else {
      await useStaffFetch('/api/whatsapp/inbox-send', { method: 'POST', body: { patientId: props.patientId, text } })
    }
    showToast(channel === 'email' ? t(`Form sent by email to ${recipient.value?.email}`, `Formulario enviado por email a ${recipient.value?.email}`) : t('Form sent by WhatsApp', 'Formulario enviado por WhatsApp'))
    sendAsk.value = null
  } catch (err: any) {
    // Most often WhatsApp's 24-hour window: free text only goes to someone
    // who wrote in the last day. The error says so; the fallbacks are below it.
    sendError.value = err?.data?.statusMessage ?? t('The form could not be sent.', 'No se ha podido enviar el formulario.')
  } finally {
    sendBusy.value = false
  }
}
// The fallback when the clinic's WhatsApp cannot send (outside the 24-hour
// window, or no WhatsApp connected): WhatsApp on this computer, message ready.
function waMeLink(doc: Doc) {
  return `https://wa.me/${patientPhoneDigits.value}?text=${encodeURIComponent(patientMessage(doc).text)}`
}
// With nowhere to send it, the dialog's main button copies the link instead.
async function onSendConfirm() {
  if (sendChannels.value.length) return sendDoc()
  if (sendAsk.value) await copyLink(sendAsk.value)
  showToast(t('Link copied', 'Enlace copiado'))
  sendAsk.value = null
}
function fillHere(doc: Doc) {
  sendAsk.value = null
  openLink(doc)
}

// The staff copy of a form, answers only (pages/patients/docs/[id].vue), for
// keeping in a tab of its own beside the visit note. The patient's link is no
// use for that: once completed it shows nothing but "Thank you".
function answersPath(doc: Doc) {
  return `/patients/docs/${doc.id}`
}
// The title is a real link so Cmd/Ctrl-click and middle-click open the
// answers in a new tab, the way every other link does; a plain click still
// opens the form here, to edit.
function onTitleClick(event: MouseEvent, doc: Doc) {
  if (event.metaKey || event.ctrlKey || event.shiftKey) return
  event.preventDefault()
  openDoc(doc)
}

function openDoc(doc: Doc) {
  activeDoc.value = doc
  title.value = doc.title
  fields.value = Array.isArray(doc.fields) ? [...doc.fields] : []
}

async function createDoc(initialTitle: string, initialFields: DocField[], templateId: string | null = null, language: string | null = null) {
  const { data, error } = await supabase
    .from('patient_docs')
    .insert({
      account_id: store.accountId!,
      patient_id: props.patientId,
      title: initialTitle,
      fields: initialFields as any,
      template_id: templateId,
      language,
      created_by: store.teamMember?.id ?? null,
      updated_by: store.teamMember?.id ?? null,
    })
    .select('*')
    .single()
  if (error || !data) {
    showToast(`${t('The form was not created.', 'No se ha creado el formulario.')}${error ? ` (${error.message})` : ''}`, 'error')
    return null
  }
  const created = data as unknown as Doc
  docs.value = [created, ...docs.value]
  return created
}

// A blank document has nothing in it yet, so it opens here to be written.
async function newBlankDoc() {
  showNewMenu.value = false
  const created = await createDoc(t('Untitled', 'Sin título'), [])
  if (created) openDoc(created)
}

async function newFromTemplate(template: Template) {
  showNewMenu.value = false
  const [{ data: patient }, { data: custom }] = await Promise.all([
    supabase
      .from('patients')
      .select('first_name, last_name, date_of_birth, email, address, city, postal_code, country, national_id, occupation, gender, emergency_contact')
      .eq('id', props.patientId)
      .maybeSingle(),
    // {{attr_<key>}}: the clinic's own fields, as far as this person may read them.
    supabase.from('patient_attribute_values').select('value, patient_attributes(key, kind)').eq('patient_id', props.patientId),
  ])
  // In the language chosen in the menu, when this form has it; the
  // original otherwise (the menu says which).
  const sent = docInLanguage(template, sendLanguage.value === 'es' ? null : sendLanguage.value)
  const rendered = renderTemplateFields(sent.fields, {
    ...patientAttributeMergeVars(custom ?? []),
    first_name: patient?.first_name ?? '',
    last_name: patient?.last_name ?? '',
    date_of_birth: patient?.date_of_birth ?? '',
    email: patient?.email ?? '',
    address: patient?.address ?? '',
    city: patient?.city ?? '',
    postal_code: patient?.postal_code ?? '',
    country: patient?.country ?? '',
    national_id: patient?.national_id ?? '',
    occupation: patient?.occupation ?? '',
    gender: patient?.gender ?? '',
    emergency_contact: patient?.emergency_contact ?? '',
    clinic_name: store.accountName,
    // Lands in the patient's document: Spanish like every other date the
    // clinic sends, not whatever locale this browser happens to run in.
    today: new Date().toLocaleDateString('es-ES'),
  })
  const created = await createDoc(sent.title, rendered, template.id, sent.language)
  if (created) askToSend(created)
}

function backToList() {
  activeDoc.value = null
  load()
}

async function save() {
  if (!activeDoc.value) return
  saving.value = true
  const { error } = await supabase
    .from('patient_docs')
    .update({ title: title.value.trim() || t('Untitled', 'Sin título'), fields: fields.value as any, updated_by: store.teamMember?.id ?? null })
    .eq('id', activeDoc.value.id)
  saving.value = false
  // The error was previously dropped on the floor: a failed save left the
  // page looking unchanged and said nothing at all.
  showToast(error ? `${t('The form was not saved.', 'No se ha guardado el formulario.')} (${error.message})` : t('Saved', 'Guardado'), error ? 'error' : 'success')
}

async function toggleComplete() {
  if (!activeDoc.value) return
  const newCompletedAt = activeDoc.value.completed_at ? null : new Date().toISOString()
  const { error } = await supabase.from('patient_docs').update({ completed_at: newCompletedAt }).eq('id', activeDoc.value.id)
  if (!error) {
    activeDoc.value = { ...activeDoc.value, completed_at: newCompletedAt }
    docs.value = docs.value.map((d) => (d.id === activeDoc.value!.id ? { ...d, completed_at: newCompletedAt } : d))
  }
}

// Deleting needs patient_docs_delete (and, under own-docs scope, the form to
// be theirs), and RLS refuses otherwise by deleting nothing -- no error. So
// the rows that went are read back, as FilesTab does: the form used to
// vanish here regardless and come back on the next load.
const deleteError = ref('')
const deleteAsk = ref<Doc | null>(null)
async function removeDoc() {
  const doc = deleteAsk.value
  if (!doc) return
  deleteAsk.value = null
  deleteError.value = ''
  const { data: gone, error } = await supabase.from('patient_docs').delete().eq('id', doc.id).select('id')
  if (error || !gone?.length) {
    deleteError.value = error ? `${t('The form was not deleted.', 'No se ha eliminado el formulario.')} (${error.message})` : t('This form was not deleted: your role cannot delete it.', 'No se ha eliminado el formulario: tu rol no puede eliminarlo.')
    return
  }
  docs.value = docs.value.filter((d) => d.id !== doc.id)
  if (activeDoc.value?.id === doc.id) activeDoc.value = null
}

function statusFor(doc: Doc): { label: string; tone: 'success' | 'warning' } {
  return doc.completed_at
    ? { label: t('Completed', 'Completado'), tone: 'success' as const }
    : { label: t('Awaiting patient', 'Pendiente del paciente'), tone: 'warning' as const }
}
const senders = ref<Record<string, string>>({})
async function loadSenders() {
  const { data } = await supabase.from('team_members').select('id, full_name')
  const map: Record<string, string> = {}
  for (const m of data ?? []) map[m.id] = m.full_name
  senders.value = map
}
onMounted(loadSenders)

function metaFor(doc: Doc) {
  if (doc.completed_at) {
    const ip = doc.completed_ip ? ` ${t('from', 'desde')} ${doc.completed_ip}` : ''
    return `${t('Signed', 'Firmado')} ${formatLongDate(doc.completed_at)}${ip}`
  }
  // Who sent it as well as when: created_by has always been written and
  // never read back, so a form nobody recognised had no one to ask about it.
  const who = doc.created_by ? senders.value[doc.created_by] : null
  const sent = `${t('Sent', 'Enviado')} ${formatLongDate(doc.updated_at)}`
  return who ? `${sent} ${t('by', 'por')} ${who}` : sent
}
</script>

<template>
  <div class="rounded-card border border-line bg-surface shadow-card">
    <template v-if="!activeDoc">
      <div class="flex items-center justify-between border-b border-line-divider px-4 py-3">
        <p class="text-[13.5px] font-semibold text-ink-700">
          {{ t('Forms sent to the patient', 'Formularios enviados al paciente') }}
          <span v-if="!loading" class="ml-1 font-normal text-ink-faint" data-cy="docs-count">{{ docs.length }}</span>
        </p>
        <div ref="newMenuRoot" class="relative">
          <UiBtn size="sm" :aria-expanded="showNewMenu" @click="showNewMenu = !showNewMenu">{{ t('Send a form', 'Enviar un formulario') }}</UiBtn>
          <div v-if="showNewMenu" class="absolute right-0 z-10 mt-1 w-56 rounded-ctl border border-line bg-surface py-1 shadow-popover">
            <button type="button" class="block w-full px-3 py-1.5 touch:py-3 text-left text-[13px] text-ink-600 hover:bg-surface-subtle" @click="newBlankDoc">
              {{ t('Blank document', 'Documento en blanco') }}
            </button>
            <template v-if="templates.length > 0">
              <p class="mt-1 border-t border-line-divider px-3 pt-1.5 text-[11px] font-[640] uppercase tracking-[.07em] text-ink-faint">{{ t('From template', 'Desde plantilla') }}</p>
              <div v-if="offeredLanguages.length" class="flex flex-wrap gap-1 px-3 pb-1 pt-1.5" role="group" :aria-label="t('Language of the form', 'Idioma del formulario')" data-cy="doc-send-language">
                <button
                  v-for="code in ['es', ...offeredLanguages]"
                  :key="code"
                  type="button"
                  :aria-pressed="sendLanguage === code"
                  :data-cy="`doc-send-language-${code}`"
                  class="rounded-pill border px-2 py-0.5 text-[12px] touch:py-1.5"
                  :class="sendLanguage === code ? 'border-brand bg-brand-tint font-semibold text-brand-text' : 'border-line text-ink-600 hover:bg-surface-subtle'"
                  @click="sendLanguage = code"
                >
                  {{ docLanguageName(code, t) }}
                </button>
              </div>
              <button
                v-for="tpl in templates"
                :key="tpl.id"
                type="button"
                class="block w-full px-3 py-1.5 touch:py-3 text-left text-[13px] text-ink-600 hover:bg-surface-subtle"
                data-cy="doc-send-template"
                @click="newFromTemplate(tpl)"
              >
                {{ tpl.title }}
                <span v-if="!hasLanguage(tpl)" class="block text-[11.5px] text-ink-faint">{{ t('Not translated: goes in Spanish', 'Sin traducir: se envía en español') }}</span>
              </button>
            </template>
          </div>
        </div>
      </div>
      <p v-if="deleteError" role="alert" class="px-4 pt-3 text-[13px] text-danger-text" data-cy="docs-error">{{ deleteError }}</p>
      <div v-if="loading" class="divide-y divide-line-row">
        <div v-for="i in 3" :key="i" class="flex items-center gap-3 px-4 py-3">
          <UiSkeleton class="h-[26px] w-[26px] shrink-0 rounded-ctlSm" />
          <div class="min-w-0 flex-1 space-y-1.5">
            <UiSkeleton class="h-3.5 w-40 rounded-ctlSm" />
            <UiSkeleton class="h-3 w-24 rounded-ctlSm" />
          </div>
        </div>
      </div>
      <div v-else-if="docs.length === 0" class="p-8 text-center text-[13px] text-ink-faint">
        {{ t('No forms sent yet. Send one with Send a form, for example a data protection consent.', 'Aún no se ha enviado ningún formulario. Envía uno con Enviar un formulario, por ejemplo un consentimiento de protección de datos.') }}
      </div>
      <ul v-else class="divide-y divide-line-row">
        <!-- On a phone the status and the four actions take a line of their
             own under the title; beside it they squeezed the title and the
             date down to a column one word wide. -->
        <li v-for="doc in docs" :key="doc.id" class="flex flex-wrap items-center gap-x-3 gap-y-2 px-4 py-3 sm:flex-nowrap">
          <svg width="26" height="26" viewBox="0 0 26 26" fill="none" class="shrink-0 text-ink-faint2">
            <path d="M7 3h8l4 4v15a1 1 0 01-1 1H7a1 1 0 01-1-1V4a1 1 0 011-1z" stroke="currentColor" stroke-width="1.3" />
            <path d="M15 3v4h4" stroke="currentColor" stroke-width="1.3" />
          </svg>
          <div class="min-w-0 flex-1 basis-[calc(100%-38px)] sm:basis-0">
            <a :href="answersPath(doc)" class="block w-full text-left outline-none focus-visible:shadow-focus" @click="onTitleClick($event, doc)">
              <p class="truncate text-[13px] font-medium text-ink-700 hover:text-brand-text">{{ doc.title }}</p>
              <p class="text-[11.5px] text-ink-faint">{{ metaFor(doc) }}</p>
            </a>
            <!-- The patient's own link, on screen. It is the thing staff read
                 out on the phone, and a Copy button for a link you cannot see
                 gives you no way to check you are sending the right one. -->
            <p class="mt-1 flex items-center gap-1.5">
              <span class="min-w-0 truncate rounded-ctlSm bg-surface-subtle2 px-1.5 py-0.5 font-mono text-[11px] text-ink-muted2">{{ docLink(doc) }}</span>
              <button
                type="button"
                class="shrink-0 text-[11px] font-medium text-brand-text outline-none hover:text-brand-hover focus-visible:shadow-focus"
                @click="copyLink(doc)"
              >
                {{ copiedId === doc.id ? t('Copied!', '¡Copiado!') : t('Copy', 'Copiar') }}
              </button>
            </p>
          </div>
          <div class="flex w-full flex-wrap items-center gap-x-3 gap-y-1 pl-[38px] sm:w-auto sm:flex-nowrap sm:pl-0">
          <UiPill v-if="doc.language" data-cy="doc-sent-language">{{ docLanguageName(doc.language, t) }}</UiPill>
          <UiPill :tone="statusFor(doc).tone">{{ statusFor(doc).label }}</UiPill>
          <div class="flex flex-wrap items-center gap-x-2.5 gap-y-1">
            <a
              v-if="doc.completed_at"
              :href="answersPath(doc)"
              target="_blank"
              class="inline-flex items-center gap-1 text-[11.5px] font-medium text-brand-text hover:text-brand-hover touch:min-h-11"
              :title="t('Open the answers in a new tab', 'Abrir las respuestas en una pestaña nueva')"
              data-cy="doc-view-answers"
            >
              {{ t('View answers', 'Ver respuestas') }}
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true" class="h-3 w-3 shrink-0"><path stroke-linecap="round" stroke-linejoin="round" d="M4.5 19.5l15-15m0 0H8.25m11.25 0v11.25" /></svg>
            </a>
            <button v-else type="button" class="text-[11.5px] font-medium text-brand-text hover:text-brand-hover touch:min-h-11" :title="t('Open patient link in a new tab', 'Abrir el enlace del paciente en una pestaña nueva')" @click="openLink(doc)">
              {{ t('Open', 'Abrir') }}
            </button>
            <button type="button" class="text-[11.5px] font-medium text-brand-text hover:text-brand-hover touch:min-h-11" :title="t('Copy patient link', 'Copiar el enlace del paciente')" @click="copyLink(doc)">
              {{ copiedId === doc.id ? t('Copied!', '¡Copiado!') : t('Copy link', 'Copiar enlace') }}
            </button>
            <button
              v-if="!doc.completed_at"
              type="button"
              class="text-[11.5px] font-medium text-success-text hover:text-success-deep touch:min-h-11"
              :title="t('Send the patient their link by email or WhatsApp', 'Enviar al paciente su enlace por email o WhatsApp')"
              data-cy="doc-send"
              @click="askToSend(doc)"
            >
              {{ t('Send', 'Enviar') }}
            </button>
            <UiIconBtn v-if="can('patient_docs_delete')" icon="trash" tone="danger" data-cy="doc-delete" :label="t('Delete', 'Eliminar')" @click="deleteAsk = doc" />
          </div>
          </div>
        </li>
      </ul>
    </template>

    <template v-else>
      <div class="flex items-center justify-between border-b border-line-divider px-4 py-3">
        <button type="button" class="-ml-1 inline-flex h-8 items-center gap-1 rounded-ctlSm pl-0.5 pr-1.5 text-[13px] text-ink-muted outline-none hover:text-ink-700 focus-visible:shadow-focus touch:h-11" @click="backToList"><UiChevron />{{ t('Documents', 'Documentos') }}</button>
        <div class="flex items-center gap-3">
          <UiBtn size="sm" :aria-pressed="!!activeDoc?.completed_at" :class="activeDoc?.completed_at ? '!border-success-border !bg-success-bg !text-success-text' : ''" @click="toggleComplete">
            <svg v-if="activeDoc?.completed_at" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" aria-hidden="true" class="h-3.5 w-3.5 shrink-0"><path stroke-linecap="round" stroke-linejoin="round" d="M4.5 12.75l6 6 9-13.5" /></svg>
            {{ activeDoc?.completed_at ? t('Completed', 'Completado') : t('Mark as completed', 'Marcar como completado') }}
          </UiBtn>
          <UiBtn variant="primary" size="sm" :disabled="saving" @click="save">{{ saving ? t('Saving…', 'Guardando…') : t('Save', 'Guardar') }}</UiBtn>
        </div>
      </div>

      <div class="p-4">
        <input
          v-model="title"
          type="text"
          :placeholder="t('Untitled', 'Sin título')"
          class="mb-4 w-full border-none text-[20px] font-semibold text-ink-900 placeholder-ink-faint2 focus:outline-none focus:ring-0"
        />
        <DocBlocks :fields="fields" mode="fill" @update:fields="fields = $event" />
      </div>
    </template>

    <UiConfirmDialog
      v-if="sendAsk"
      :title="recipient?.firstName ? t(`Send ${sendAsk.title} to ${recipient.firstName}`, `Enviar ${sendAsk.title} a ${recipient.firstName}`) : t(`Send ${sendAsk.title}`, `Enviar ${sendAsk.title}`)"
      :confirm-label="sendChannels.length ? (sendBusy ? t('Sending…', 'Enviando…') : t('Send', 'Enviar')) : t('Copy link', 'Copiar enlace')"
      :cancel-label="t('Not now', 'Ahora no')"
      :busy="sendBusy"
      :disabled="sendChannels.length > 0 && !sendChannel"
      data-cy="doc-send-dialog"
      @confirm="onSendConfirm"
      @cancel="sendAsk = null"
    >
      <fieldset v-if="sendChannels.length" class="flex flex-col gap-1.5">
        <legend class="mb-1 text-[13px] text-ink-muted">{{ t('It reaches them as a link to fill in from their phone.', 'Le llega como un enlace para rellenarlo desde el móvil.') }}</legend>
        <label v-for="channel in sendChannels" :key="channel" class="flex cursor-pointer items-center gap-2.5 rounded-ctl border px-3 py-2 text-[14px] touch:py-3" :class="sendChannel === channel ? 'border-brand bg-brand-tint' : 'border-line hover:bg-surface-subtle'">
          <input v-model="sendChannel" type="radio" name="doc-send-channel" :value="channel" class="accent-brand" :data-cy="`doc-send-channel-${channel}`" />
          <span class="font-semibold text-ink-900">{{ channel === 'email' ? t('By email', 'Por email') : t('By WhatsApp', 'Por WhatsApp') }}</span>
          <span class="min-w-0 truncate text-ink-muted">{{ channel === 'email' ? recipient?.email : `+${patientPhoneDigits}` }}</span>
        </label>
      </fieldset>
      <p v-else class="text-[13.5px] leading-snug text-ink-700">
        {{ recipient?.isMinor
          ? t('This patient is under age, so QuiroFlow does not write to them directly. Copy the link for their guardian, or fill it in here.', 'Es menor de edad, así que QuiroFlow no le escribe directamente. Copia el enlace para su tutor, o rellénalo aquí.')
          : t('There is no email or WhatsApp to send it to from here. Copy the link, or fill it in here.', 'No hay email ni WhatsApp al que enviarlo desde aquí. Copia el enlace, o rellénalo aquí.') }}
      </p>
      <div v-if="sendError" role="alert" class="rounded-ctl border border-danger-border bg-danger-bg px-3 py-2 text-[13px] text-danger-text" data-cy="doc-send-error">
        {{ sendError }}
        <a
          v-if="sendChannel === 'whatsapp' && patientPhoneDigits"
          :href="waMeLink(sendAsk)"
          target="_blank"
          rel="noopener"
          class="mt-1 block font-semibold underline"
        >{{ t('Open it in WhatsApp on this computer instead', 'Abrirlo en WhatsApp en este ordenador') }}</a>
      </div>
      <div class="flex flex-wrap items-center gap-x-4 gap-y-1 border-t border-line-divider pt-3 text-[13px]">
        <button v-if="sendChannels.length" type="button" class="font-medium text-brand-text hover:text-brand-hover touch:min-h-11" @click="copyLink(sendAsk)">
          {{ copiedId === sendAsk.id ? t('Copied!', '¡Copiado!') : t('Copy link', 'Copiar enlace') }}
        </button>
        <button type="button" class="font-medium text-brand-text hover:text-brand-hover touch:min-h-11" :title="t('Opens the patient’s form in a new tab, to fill in at the clinic', 'Abre el formulario del paciente en una pestaña nueva, para rellenarlo en la clínica')" data-cy="doc-fill-here" @click="fillHere(sendAsk)">
          {{ t('They are here: fill it in on this screen', 'Está aquí: rellenarlo en esta pantalla') }}
        </button>
      </div>
    </UiConfirmDialog>

    <UiConfirmDialog
      v-if="deleteAsk"
      tone="danger"
      :title="t(`Delete ${deleteAsk.title}?`, `¿Eliminar ${deleteAsk.title}?`)"
      :confirm-label="t('Delete', 'Eliminar')"
      :cancel-label="t('Cancel', 'Cancelar')"
      @confirm="removeDoc"
      @cancel="deleteAsk = null"
    >
      <p class="text-[14px] leading-snug text-ink-700">{{ t('It is removed from this patient for everyone, and cannot be recovered.', 'Se elimina de este paciente para todos, y no se puede recuperar.') }}</p>
    </UiConfirmDialog>
  </div>
</template>
