<script setup lang="ts">
// "Regala un bono": a clinic's gift voucher page, public like its booking
// page. The buyer picks an amount, a service or a bono (only what Settings >
// Bonos regalo offers, priced on the server), says who it is for and how it
// should arrive, and pays on Stripe's own page (public-booking/gift-voucher).
// Stripe sends them back here with ?pagado=<id>, and the page waits for the
// webhook to mark it paid.
definePageMeta({ layout: false })

const route = useRoute()
const slug = route.params.slug as string

interface Options {
  enabled: boolean
  clinicName: string
  amountsCents?: number[]
  allowCustomAmount?: boolean
  validMonths?: number
  packages?: { id: string; name: string; priceCents: number; sessions: number }[]
  services?: { id: string; name: string; priceCents: number }[]
}

const options = ref<Options | null>(null)
const loadError = ref(false)
const kind = ref<'amount' | 'item'>('amount')
const amountCents = ref<number | null>(null)
const custom = ref('')
const itemKey = ref('') // 'service:<id>' | 'package:<id>'
const toName = ref('')
const fromName = ref('')
const message = ref('')
const deliverTo = ref<'recipient' | 'buyer'>('recipient')
const recipientEmail = ref('')
const sendOn = ref('')
const buyerEmail = ref('')
const paying = ref(false)
const error = ref('')
const paidId = typeof route.query.pagado === 'string' ? route.query.pagado : null
const paid = ref<{ paid: boolean; toName: string; deliverTo: string; to: string; sendOn: string | null } | null>(null)

const euros = (c: number) => `${(c / 100).toLocaleString('es-ES', { minimumFractionDigits: c % 100 ? 2 : 0, maximumFractionDigits: 2 })} €`
const items = computed(() => [
  ...(options.value?.services ?? []).map((s) => ({ key: `service:${s.id}`, name: s.name, priceCents: s.priceCents, note: '' })),
  ...(options.value?.packages ?? []).map((p) => ({ key: `package:${p.id}`, name: p.name, priceCents: p.priceCents, note: `${p.sessions} sesiones` })),
])
const hasAmounts = computed(() => !!(options.value?.amountsCents?.length || options.value?.allowCustomAmount))
const customCents = computed(() => Math.round((parseFloat(custom.value.replace(',', '.')) || 0) * 100))
const chosen = computed<{ label: string; cents: number } | null>(() => {
  if (kind.value === 'amount') {
    const c = amountCents.value ?? (custom.value ? customCents.value : 0)
    return c > 0 ? { label: euros(c), cents: c } : null
  }
  const it = items.value.find((i) => i.key === itemKey.value)
  return it ? { label: it.name, cents: it.priceCents } : null
})
const today = new Date().toISOString().slice(0, 10)

onMounted(async () => {
  try {
    options.value = await $fetch<Options>('/api/public-booking/gift-options', { query: { slug } })
    if (!hasAmounts.value) kind.value = 'item'
    amountCents.value = options.value.amountsCents?.[1] ?? options.value.amountsCents?.[0] ?? null
  } catch {
    loadError.value = true
  }
  if (paidId) pollPaid()
})

async function pollPaid() {
  for (let i = 0; i < 15; i++) {
    try {
      paid.value = await $fetch('/api/public-booking/gift-voucher-status', { query: { id: paidId } })
      if (paid.value?.paid) return
    } catch {
      return
    }
    await new Promise((r) => setTimeout(r, 2000))
  }
}

async function pay() {
  error.value = ''
  if (!chosen.value) {
    error.value = 'Elige qué regalar.'
    return
  }
  paying.value = true
  const [itemKind, itemId] = itemKey.value.split(':')
  try {
    const r = await $fetch<{ url: string }>('/api/public-booking/gift-voucher', {
      method: 'POST',
      body: {
        slug,
        kind: kind.value === 'amount' ? 'amount' : itemKind,
        amountCents: kind.value === 'amount' ? chosen.value.cents : undefined,
        itemId: kind.value === 'item' ? itemId : undefined,
        toName: toName.value,
        fromName: fromName.value,
        message: message.value,
        deliverTo: deliverTo.value,
        recipientEmail: deliverTo.value === 'recipient' ? recipientEmail.value : undefined,
        sendOn: deliverTo.value === 'recipient' && sendOn.value ? sendOn.value : null,
        buyerEmail: buyerEmail.value,
      },
    })
    window.location.href = r.url
  } catch (e: any) {
    error.value = e?.data?.statusMessage ?? 'No se ha podido iniciar el pago. Inténtalo de nuevo.'
    paying.value = false
  }
}

const field = 'h-11 w-full rounded-ctl border border-line-control bg-surface px-3 text-[14px] text-ink-900 focus:border-brand focus:outline-none focus:ring-1 focus:ring-brand'
</script>

<template>
  <div class="min-h-screen bg-surface-page" data-cy="gift-page">
    <header class="flex h-16 items-center gap-3 border-b border-line bg-surface px-4 sm:px-10">
      <span class="text-[16px] font-bold text-ink-900">{{ options?.clinicName ?? '' }}</span>
      <span class="flex-1" />
      <NuxtLink :to="`/book/${slug}`" class="text-[13px] font-semibold text-brand-text">Reservar cita</NuxtLink>
    </header>

    <main class="mx-auto max-w-[1060px] px-4 py-8 sm:px-6">
      <p v-if="loadError" class="py-16 text-center text-sm text-danger-text">Esta página no está disponible.</p>
      <p v-else-if="!options" class="py-16 text-center text-sm text-ink-faint">Cargando…</p>
      <p v-else-if="!options.enabled" class="py-16 text-center text-sm text-ink-muted" data-cy="gift-disabled">{{ options.clinicName }} no vende bonos regalo online.</p>

      <div v-else-if="paidId" class="mx-auto max-w-md rounded-card border border-line bg-surface p-8 text-center shadow-card" data-cy="gift-paid">
        <template v-if="paid?.paid">
          <div class="mx-auto flex h-12 w-12 items-center justify-center rounded-full bg-success-bg text-2xl text-success-text">✓</div>
          <h1 class="mt-4 text-lg font-semibold text-ink-900">¡Bono regalo pagado!</h1>
          <p class="mt-2 text-sm text-ink-muted">
            <template v-if="paid.deliverTo === 'recipient'">Lo enviaremos a {{ paid.to }}{{ paid.sendOn ? ` el ${new Date(paid.sendOn).toLocaleDateString('es-ES', { day: 'numeric', month: 'long' })}` : ' ahora mismo' }}, y te mandaremos una copia.</template>
            <template v-else>Te lo hemos enviado a {{ paid.to }} para que se lo des a {{ paid.toName }}.</template>
          </p>
        </template>
        <p v-else class="text-sm text-ink-muted">Confirmando el pago…</p>
      </div>

      <div v-else class="grid items-start gap-7 lg:grid-cols-[minmax(0,1fr)_360px]">
        <div class="flex flex-col gap-4">
          <div>
            <h1 class="text-[26px] font-bold text-ink-900">Regala un bono</h1>
            <p class="mt-1 text-[14px] text-ink-muted">Para usar en {{ options.clinicName }} durante {{ options.validMonths }} meses. Lo enviamos por correo el día que elijas.</p>
          </div>

          <section class="rounded-card border border-line bg-surface p-4 shadow-card">
            <div v-if="hasAmounts && items.length" class="grid grid-cols-2 gap-1 rounded-ctl bg-surface-subtle p-1" role="tablist" aria-label="Tipo de bono">
              <button type="button" role="tab" :aria-selected="kind === 'amount'" class="h-9 rounded-ctlSm text-[13.5px] font-semibold" :class="kind === 'amount' ? 'bg-surface text-ink-900 shadow-card' : 'text-ink-muted'" data-cy="gift-kind-amount" @click="kind = 'amount'">Un importe</button>
              <button type="button" role="tab" :aria-selected="kind === 'item'" class="h-9 rounded-ctlSm text-[13.5px] font-semibold" :class="kind === 'item' ? 'bg-surface text-ink-900 shadow-card' : 'text-ink-muted'" data-cy="gift-kind-item" @click="kind = 'item'">Un servicio o bono</button>
            </div>

            <div v-if="kind === 'amount'" class="mt-3">
              <div class="grid grid-cols-2 gap-2 sm:grid-cols-4">
                <button
                  v-for="c in options.amountsCents"
                  :key="c"
                  type="button"
                  :aria-pressed="amountCents === c"
                  class="h-12 rounded-ctl border text-[16px] font-semibold text-ink-900"
                  :class="amountCents === c ? 'border-brand ring-2 ring-brand/20' : 'border-line-control'"
                  :data-cy="`gift-amount-${c}`"
                  @click="amountCents = c; custom = ''"
                >
                  {{ euros(c) }}
                </button>
              </div>
              <div v-if="options.allowCustomAmount" class="mt-3 max-w-[220px]">
                <label for="custom" class="text-[12.5px] font-semibold text-ink-700">Otro importe (de 20 a 300 €)</label>
                <input id="custom" v-model="custom" inputmode="decimal" :class="[field, 'mt-1']" placeholder="€" data-cy="gift-amount-custom" @input="amountCents = null" />
              </div>
              <p class="mt-2 text-[12.5px] text-ink-muted">Quien lo recibe lo gasta en lo que quiera de la clínica.</p>
            </div>

            <fieldset v-else class="mt-3 flex flex-col gap-2">
              <legend class="sr-only">Servicio o bono</legend>
              <label v-for="it in items" :key="it.key" class="flex cursor-pointer items-center gap-3 rounded-ctl border px-3 py-2.5 text-[14px] text-ink-900" :class="itemKey === it.key ? 'border-brand bg-brand-tint' : 'border-line-control'">
                <input v-model="itemKey" type="radio" name="item" :value="it.key" :data-cy="`gift-item-${it.key}`" />
                <span class="flex-1">{{ it.name }}<span v-if="it.note" class="ml-1 text-[12.5px] text-ink-muted">· {{ it.note }}</span></span>
                <span class="font-mono text-[13px] font-semibold">{{ euros(it.priceCents) }}</span>
              </label>
            </fieldset>
          </section>

          <section class="grid gap-3 rounded-card border border-line bg-surface p-4 shadow-card sm:grid-cols-2">
            <div><label for="to" class="text-[12.5px] font-semibold text-ink-700">Para</label><input id="to" v-model="toName" maxlength="80" :class="[field, 'mt-1']" data-cy="gift-to" /></div>
            <div><label for="from" class="text-[12.5px] font-semibold text-ink-700">De parte de</label><input id="from" v-model="fromName" maxlength="80" :class="[field, 'mt-1']" data-cy="gift-from" /></div>
            <div class="sm:col-span-2"><label for="msg" class="text-[12.5px] font-semibold text-ink-700">Mensaje (opcional)</label><textarea id="msg" v-model="message" rows="2" maxlength="300" class="mt-1 w-full resize-none rounded-ctl border border-line-control bg-surface px-3 py-2 text-[14px] text-ink-900" /></div>
            <fieldset class="flex flex-wrap gap-4 sm:col-span-2">
              <legend class="mb-1.5 text-[12.5px] font-semibold text-ink-700">Cómo llega</legend>
              <label class="flex items-center gap-2 text-[14px] text-ink-900"><input v-model="deliverTo" type="radio" value="recipient" data-cy="gift-deliver-recipient" />Por correo a quien lo recibe</label>
              <label class="flex items-center gap-2 text-[14px] text-ink-900"><input v-model="deliverTo" type="radio" value="buyer" data-cy="gift-deliver-buyer" />A mí, para darlo yo</label>
            </fieldset>
            <template v-if="deliverTo === 'recipient'">
              <div><label for="remail" class="text-[12.5px] font-semibold text-ink-700">Su correo</label><input id="remail" v-model="recipientEmail" type="email" :class="[field, 'mt-1']" data-cy="gift-recipient-email" /></div>
              <div><label for="when" class="text-[12.5px] font-semibold text-ink-700">Fecha de envío (opcional)</label><input id="when" v-model="sendOn" type="date" :min="today" :class="[field, 'mt-1']" data-cy="gift-send-on" /></div>
            </template>
          </section>
        </div>

        <aside class="flex flex-col gap-4 rounded-card border border-line bg-surface p-4 shadow-card lg:sticky lg:top-6">
          <div class="flex flex-col gap-4 rounded-card bg-brand p-5 text-white">
            <div class="flex justify-between text-[12.5px] font-semibold opacity-90"><span>{{ options.clinicName }}</span><span>Bono regalo</span></div>
            <div class="text-[28px] font-bold leading-tight" data-cy="gift-preview">{{ chosen?.label ?? '—' }}</div>
            <div class="text-[13px] opacity-95">{{ toName ? `Para ${toName}` : 'Para …' }}{{ fromName ? `, de parte de ${fromName}` : '' }}</div>
          </div>
          <div class="flex justify-between text-[14px]"><span>Total</span><strong class="font-mono">{{ chosen ? euros(chosen.cents) : '—' }}</strong></div>
          <div><label for="bemail" class="text-[12.5px] font-semibold text-ink-700">Tu correo, para el recibo</label><input id="bemail" v-model="buyerEmail" type="email" :class="[field, 'mt-1']" data-cy="gift-buyer-email" /></div>
          <p v-if="error" role="alert" class="text-[13px] text-danger-text" data-cy="gift-error">{{ error }}</p>
          <UiBtn variant="primary" class="h-12 w-full" :disabled="paying || !chosen" data-cy="gift-pay" @click="pay">{{ paying ? 'Preparando el pago…' : 'Pagar con tarjeta' }}</UiBtn>
          <p class="text-[12px] text-ink-muted">Pago seguro con Stripe. Válido {{ options.validMonths }} meses desde la compra. No se devuelve en efectivo.</p>
        </aside>
      </div>
    </main>
  </div>
</template>
