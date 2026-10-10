<script setup lang="ts">
import { formatEur } from '../../utils/billing'

// "Acciones" in an Inbox conversation's header: what the front desk does next
// without leaving the chat. Book them a visit, open their record, or put a
// link in the reply -- the clinic's online booking page, or a card payment
// link for one of their unpaid invoices (the same Stripe page their own
// "Pagar" opens). A link is only ever put in the reply box, never sent from
// here: it goes when they press Send, as anything they write does.
const props = defineProps<{
  accountId: string
  patientId: string | null
  /** Where the clinic's booking page lives (the web's origin; the app's deployed one). */
  baseUrl: string
  canBook: boolean
  canPay: boolean
  /** Asks the API for a payment link (the web's own fetch, or the app's). */
  payLink: (invoiceId: string) => Promise<{ url: string; remainingCents: number }>
  size?: 'sm' | 'lg'
}>()
const emit = defineEmits<{ insert: [text: string]; book: []; 'open-record': [] }>()

const t = useT()
const supabase = useSupabaseClient()
const open = ref(false)
const root = ref<HTMLElement>()
const slug = ref<string | null>(null)
const invoices = ref<{ id: string; invoice_number: string; total_cents: number }[] | null>(null)
const paying = ref<string | null>(null)
const error = ref('')
const view = ref<'menu' | 'pay'>('menu')

watch(open, async (o) => {
  if (!o) {
    view.value = 'menu'
    error.value = ''
    return
  }
  if (slug.value === null) {
    const { data } = await supabase.from('accounts').select('slug').eq('id', props.accountId).maybeSingle()
    slug.value = (data as { slug: string | null } | null)?.slug ?? ''
  }
})
const bookingUrl = computed(() => (slug.value ? `${props.baseUrl.replace(/\/$/, '')}/book/${slug.value}` : null))

function sendBookingLink() {
  if (!bookingUrl.value) return
  emit('insert', t(`You can book your visit here: ${bookingUrl.value}`, `Puedes reservar tu cita aquí: ${bookingUrl.value}`))
  open.value = false
}

async function showInvoices() {
  view.value = 'pay'
  error.value = ''
  invoices.value = null
  const { data } = await supabase.from('invoices').select('id, invoice_number, total_cents').eq('patient_id', props.patientId!).eq('status', 'unpaid').eq('is_refund', false).order('created_at', { ascending: false }).limit(10)
  invoices.value = (data as { id: string; invoice_number: string; total_cents: number }[] | null) ?? []
}
async function payLinkFor(inv: { id: string; invoice_number: string }) {
  paying.value = inv.id
  error.value = ''
  try {
    const { url, remainingCents } = await props.payLink(inv.id)
    emit('insert', t(`You can pay invoice ${inv.invoice_number} (${formatEur(remainingCents)}) here: ${url}`, `Puedes pagar la factura ${inv.invoice_number} (${formatEur(remainingCents)}) aquí: ${url}`))
    open.value = false
  } catch (e) {
    const msg = (e as { data?: { statusMessage?: string }; statusMessage?: string })?.data?.statusMessage ?? (e as { statusMessage?: string })?.statusMessage ?? ''
    error.value = /not configured/i.test(msg)
      ? t('Online payment is not set up for this clinic.', 'El pago online no está configurado en esta clínica.')
      : /settled/i.test(msg)
        ? t('That invoice is already paid.', 'Esa factura ya está pagada.')
        : t("Couldn't create the link. Try again.", 'No se ha podido crear el enlace. Inténtalo de nuevo.')
  } finally {
    paying.value = null
  }
}

function onDocClick(e: MouseEvent) {
  if (open.value && root.value && !root.value.contains(e.target as Node)) open.value = false
}
onMounted(() => document.addEventListener('click', onDocClick))
onBeforeUnmount(() => document.removeEventListener('click', onDocClick))
const item = 'flex min-h-11 w-full items-center gap-2.5 rounded-ctlSm px-2.5 text-left text-[14px] text-ink-900 hover:bg-surface-subtle disabled:opacity-50'
const btn = computed(() => (props.size === 'lg' ? 'h-11 w-11' : 'h-9 touch:h-11 w-9 touch:w-11'))
</script>

<template>
  <div ref="root" class="relative shrink-0">
    <button
      type="button"
      class="flex shrink-0 items-center justify-center rounded-ctl border border-line-control bg-surface text-ink-700 hover:bg-surface-subtle"
      :class="btn"
      :aria-label="t('Actions', 'Acciones')"
      :title="t('Actions', 'Acciones')"
      :aria-expanded="open"
      data-cy="thread-actions"
      @click="open = !open"
    >
      <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M13 3L4 14h7l-1 7 9-11h-7z" /></svg>
    </button>
    <div v-if="open" role="menu" :aria-label="t('Actions', 'Acciones')" class="absolute right-0 top-[calc(100%+4px)] z-30 w-72 rounded-card border border-line bg-surface p-1.5 shadow-popover" data-cy="thread-actions-menu">
      <template v-if="view === 'menu'">
        <button v-if="patientId && canBook" type="button" role="menuitem" :class="item" data-cy="thread-action-book" @click="open = false; emit('book')">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" aria-hidden="true"><rect x="3" y="5" width="18" height="16" rx="2" /><path d="M8 3v4M16 3v4M3 10h18M12 13v5M9.5 15.5h5" /></svg>
          {{ t('Book a visit', 'Reservar cita') }}
        </button>
        <button type="button" role="menuitem" :class="item" :disabled="!bookingUrl" data-cy="thread-action-booking-link" @click="sendBookingLink">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" aria-hidden="true"><path d="M10 14a4 4 0 005.7 0l3-3a4 4 0 00-5.7-5.7l-1 1M14 10a4 4 0 00-5.7 0l-3 3a4 4 0 005.7 5.7l1-1" /></svg>
          <span class="min-w-0 flex-1">
            {{ t('Put the booking link in the reply', 'Poner el enlace de reserva en la respuesta') }}
            <span v-if="slug === ''" class="block text-[11.5px] text-ink-faint">{{ t('Online booking has no address yet (Settings).', 'La reserva online aún no tiene dirección (Ajustes).') }}</span>
          </span>
        </button>
        <button v-if="patientId && canPay" type="button" role="menuitem" :class="item" data-cy="thread-action-pay-link" @click="showInvoices">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" aria-hidden="true"><rect x="2.5" y="5" width="19" height="14" rx="2" /><path d="M2.5 10h19M6.5 15h3" /></svg>
          {{ t('Put a payment link in the reply', 'Poner un enlace de pago en la respuesta') }}
        </button>
        <button v-if="patientId" type="button" role="menuitem" :class="item" data-cy="thread-action-record" @click="open = false; emit('open-record')">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" aria-hidden="true"><circle cx="12" cy="8" r="3.5" /><path d="M5 20c0-3.5 3.1-5.5 7-5.5s7 2 7 5.5" /></svg>
          {{ t('Open their record', 'Abrir su ficha') }}
        </button>
        <p class="px-2.5 pb-1 pt-1.5 text-[11.5px] leading-snug text-ink-faint">{{ t('Links go in the reply box; nothing is sent until you press Send.', 'Los enlaces van al cuadro de respuesta; no se envía nada hasta que pulses Enviar.') }}</p>
      </template>
      <template v-else>
        <button type="button" class="mb-1 flex h-9 items-center gap-1 px-1.5 text-[13px] font-medium text-brand-text" @click="view = 'menu'">‹ {{ t('Back', 'Volver') }}</button>
        <p class="px-2.5 pb-1 text-[12.5px] font-semibold text-ink-muted">{{ t('Which invoice?', '¿Qué factura?') }}</p>
        <p v-if="invoices === null" class="px-2.5 py-2 text-[13px] text-ink-faint">{{ t('Loading…', 'Cargando…') }}</p>
        <p v-else-if="invoices.length === 0" class="px-2.5 py-2 text-[13px] text-ink-muted" data-cy="thread-action-no-invoices">{{ t('Nothing unpaid.', 'No tiene nada pendiente.') }}</p>
        <button v-for="inv in invoices ?? []" :key="inv.id" type="button" role="menuitem" :class="item" :disabled="!!paying" data-cy="thread-action-invoice" @click="payLinkFor(inv)">
          <span class="flex-1">{{ inv.invoice_number }}</span>
          <span class="text-[13px] text-ink-muted">{{ paying === inv.id ? '…' : formatEur(inv.total_cents) }}</span>
        </button>
        <p v-if="error" class="px-2.5 py-1.5 text-[12.5px] text-danger-text" data-cy="thread-action-error">{{ error }}</p>
      </template>
    </div>
  </div>
</template>
