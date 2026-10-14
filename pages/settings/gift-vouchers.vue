<script setup lang="ts">
import { formatEur } from '~/utils/billing'
import { parseEurosToCents } from '~/utils/appointmentTypes'

// Bonos regalo: what the clinic sells as a gift on its public page
// (/regalo/<slug>) -- amounts, services, bonos -- and for how long they last;
// then every voucher sold, where it is, and "Reenviar". Redeeming is done
// from the patient's Money tab, or by the patient when they book.
// Settings under billing_config; the list is read under billing_access
// (gift_vouchers' RLS), as the money is.
interface Settings { enabled: boolean; amounts_cents: number[]; allow_custom_amount: boolean; package_ids: string[]; appointment_type_ids: string[]; valid_months: number }
interface Voucher { id: string; code: string; kind: string; item_name: string; value_cents: number; to_name: string; from_name: string; deliver_to: string; recipient_email: string | null; send_on: string | null; status: string; paid_at: string | null; sent_at: string | null; expires_at: string | null; redeemed_at: string | null }

const supabase = useSupabaseClient()
const store = useAccountStore()
const t = useT()
const { showToast } = useToast()
const authedFetch = useAuthedFetch()
const { can } = usePermission()

const DEFAULTS: Settings = { enabled: false, amounts_cents: [3000, 5000, 10000], allow_custom_amount: true, package_ids: [], appointment_type_ids: [], valid_months: 12 }
const settings = ref<Settings>({ ...DEFAULTS })
const packages = ref<{ id: string; name: string; price_cents: number }[]>([])
const types = ref<{ id: string; name: string; default_price_cents: number }[]>([])
const vouchers = ref<Voucher[]>([])
const slug = ref('')
const stripeReady = ref(true)
const loading = ref(true)
const saving = ref(false)
const newAmount = ref('')
const resendingId = ref<string | null>(null)

async function load() {
  const [{ data: s }, { data: p }, { data: at }, { data: v }, { data: acc }] = await Promise.all([
    supabase.from('gift_voucher_settings').select('*').maybeSingle(),
    supabase.from('packages').select('id, name, price_cents').order('name'),
    supabase.from('appointment_types').select('id, name, default_price_cents').is('archived_at', null).order('sort_order'),
    can('billing_access') ? supabase.from('gift_vouchers').select('*').neq('status', 'pending').order('created_at', { ascending: false }).limit(200) : Promise.resolve({ data: [] }),
    supabase.from('accounts').select('slug, stripe_publishable_key').eq('id', store.accountId!).maybeSingle(),
  ])
  if (s) settings.value = { ...DEFAULTS, ...(s as unknown as Settings) }
  packages.value = (p as typeof packages.value | null) ?? []
  types.value = (at as typeof types.value | null) ?? []
  vouchers.value = (v as Voucher[] | null) ?? []
  slug.value = (acc as { slug: string | null } | null)?.slug ?? ''
  stripeReady.value = !!(acc as { stripe_publishable_key: string | null } | null)?.stripe_publishable_key
  loading.value = false
}
onMounted(load)

async function save() {
  saving.value = true
  const { error } = await supabase.from('gift_voucher_settings').upsert({ account_id: store.accountId!, ...settings.value, updated_at: new Date().toISOString() } as never, { onConflict: 'account_id' })
  saving.value = false
  if (error) showToast(t("Couldn't save. Try again.", 'No se ha podido guardar. Inténtalo de nuevo.'), 'error')
  else showToast(t('Saved', 'Guardado'))
}
function addAmount() {
  const cents = parseEurosToCents(newAmount.value)
  if (!cents || cents < 100 || settings.value.amounts_cents.includes(cents)) return
  settings.value.amounts_cents = [...settings.value.amounts_cents, cents].sort((a, b) => a - b)
  newAmount.value = ''
}
function toggle(list: 'package_ids' | 'appointment_type_ids', id: string, on: boolean) {
  const cur = settings.value[list]
  settings.value[list] = on ? [...cur, id] : cur.filter((x) => x !== id)
}

async function resend(v: Voucher) {
  resendingId.value = v.id
  try {
    await authedFetch('/api/gift-vouchers/resend', { method: 'POST', body: { id: v.id } })
    showToast(t('Sent again', 'Reenviado'))
    await load()
  } catch (e: any) {
    showToast(e?.data?.statusMessage ?? t("Couldn't send it.", 'No se ha podido enviar.'), 'error')
  } finally {
    resendingId.value = null
  }
}

const day = (iso: string | null) => (iso ? new Date(iso).toLocaleDateString(t('en-GB', 'es-ES'), { day: 'numeric', month: 'short' }) : '')
const expired = (v: Voucher) => v.status === 'paid' && !!v.expires_at && Date.parse(v.expires_at) < Date.now()
function state(v: Voucher): { text: string; cls: string } {
  if (v.status === 'redeemed') return { text: t(`Redeemed ${day(v.redeemed_at)}`, `Canjeado ${day(v.redeemed_at)}`), cls: 'bg-success-bg text-success-text' }
  if (expired(v)) return { text: t('Expired', 'Caducado'), cls: 'bg-surface-subtle text-ink-muted' }
  if (!v.sent_at) return { text: v.send_on ? t(`Goes out ${day(v.send_on)}`, `Se envía el ${day(v.send_on)}`) : t('Not sent yet', 'Sin enviar'), cls: 'bg-brand-tint text-brand-text' }
  return { text: t('Not redeemed', 'Sin canjear'), cls: 'bg-warning-bg text-warning-text' }
}
const thisMonth = computed(() => vouchers.value.filter((v) => v.paid_at && v.paid_at.slice(0, 7) === new Date().toISOString().slice(0, 7)))
const outstandingCents = computed(() => vouchers.value.filter((v) => v.status === 'paid' && !expired(v)).reduce((a, v) => a + v.value_cents, 0))
const pageUrl = computed(() => (slug.value && import.meta.client ? `${window.location.origin}/regalo/${slug.value}` : ''))
const input = 'h-9 rounded-ctl border border-line-control bg-surface px-2.5 text-[13.5px] text-ink-900'
</script>

<template>
  <div class="flex h-full flex-col">
    <PageHeader :title="t('Gift vouchers', 'Bonos regalo')">
      <UiBtn variant="primary" :disabled="saving || loading" data-cy="gift-settings-save" @click="save">{{ saving ? t('Saving…', 'Guardando…') : t('Save', 'Guardar') }}</UiBtn>
    </PageHeader>
    <div class="flex-1 overflow-y-auto">
      <div class="flex gap-8 p-4 pb-24 sm:px-6 sm:pt-6 lg:pb-6">
        <SettingsNav />
        <div class="flex min-w-0 max-w-[880px] flex-1 flex-col gap-4" data-cy="gift-settings" :data-ready="loading ? undefined : 'true'">
          <p class="text-[13.5px] text-ink-muted">
            {{ t('Sold on your public gift page, paid by card through your Stripe, emailed with a code. Redeemed when the person books online, or from their Money tab at the desk: an amount or a service becomes credit, a bono becomes that bono -- with its factura then, the way the desk records it.', 'Se venden en tu página pública de regalos, se pagan con tarjeta a través de tu Stripe y se envían por correo con un código. Se canjean al reservar online o desde la pestaña Dinero del paciente: un importe o un servicio se convierte en saldo, un bono en ese bono -- con su factura en ese momento, como lo registra recepción.') }}
          </p>
          <p v-if="!loading && !stripeReady" class="rounded-ctl bg-warning-bg px-3 py-2 text-[13px] text-warning-text">{{ t('Connect Stripe in Settings › Payments to sell them online.', 'Conecta Stripe en Ajustes › Pagos para venderlos online.') }}</p>

          <section class="rounded-card border border-line bg-surface p-4">
            <label class="flex items-center gap-3 text-[14px] font-semibold text-ink-900">
              <input v-model="settings.enabled" type="checkbox" class="h-4 w-4 accent-brand" data-cy="gift-enabled" />
              {{ t('Sell gift vouchers online', 'Vender bonos regalo online') }}
            </label>
            <p v-if="settings.enabled && pageUrl" class="mt-2 text-[13px] text-ink-muted">{{ t('Your page:', 'Tu página:') }} <a :href="pageUrl" target="_blank" class="font-medium text-brand-text" data-cy="gift-page-link">{{ pageUrl }}</a></p>
          </section>

          <div class="grid grid-cols-1 gap-4 md:grid-cols-2">
            <section class="flex flex-col gap-3 rounded-card border border-line bg-surface p-4">
              <h2 class="text-[14.5px] font-bold text-ink-900">{{ t('Amounts', 'Importes') }}</h2>
              <p class="text-[12.5px] text-ink-muted">{{ t('Become credit on the patient’s account when redeemed.', 'Se convierten en saldo a favor del paciente al canjearlos.') }}</p>
              <div class="flex flex-wrap gap-1.5">
                <span v-for="c in settings.amounts_cents" :key="c" class="inline-flex h-8 items-center gap-1.5 rounded-ctl border border-line-control px-2.5 text-[13px] font-semibold text-ink-900">
                  {{ formatEur(c) }}
                  <button type="button" class="text-ink-faint hover:text-danger-text" :aria-label="t(`Remove ${formatEur(c)}`, `Quitar ${formatEur(c)}`)" @click="settings.amounts_cents = settings.amounts_cents.filter((x) => x !== c)">×</button>
                </span>
              </div>
              <form class="flex gap-2" @submit.prevent="addAmount">
                <input v-model="newAmount" :class="[input, 'w-28']" :placeholder="t('e.g. 75', 'p. ej. 75')" :aria-label="t('Amount in euros', 'Importe en euros')" />
                <UiBtn type="submit" variant="secondary" size="sm">{{ t('Add', 'Añadir') }}</UiBtn>
              </form>
              <label class="flex items-center gap-2 text-[13px] text-ink-700"><input v-model="settings.allow_custom_amount" type="checkbox" class="h-4 w-4 accent-brand" />{{ t('Allow another amount (20 to 300 €)', 'Permitir otro importe (de 20 a 300 €)') }}</label>
            </section>

            <section class="flex flex-col gap-3 rounded-card border border-line bg-surface p-4">
              <h2 class="text-[14.5px] font-bold text-ink-900">{{ t('Services and bonos', 'Servicios y bonos') }}</h2>
              <p class="text-[12.5px] text-ink-muted">{{ t('A service becomes credit for its price; a bono becomes that bono.', 'Un servicio se convierte en saldo por su precio; un bono, en ese bono.') }}</p>
              <label v-for="ty in types" :key="ty.id" class="flex items-center gap-2 text-[13px] text-ink-700">
                <input type="checkbox" class="h-4 w-4 accent-brand" :checked="settings.appointment_type_ids.includes(ty.id)" :disabled="ty.default_price_cents < 100" @change="toggle('appointment_type_ids', ty.id, ($event.target as HTMLInputElement).checked)" />
                {{ ty.name }} <span class="text-ink-faint">· {{ ty.default_price_cents ? formatEur(ty.default_price_cents) : t('no price', 'sin precio') }}</span>
              </label>
              <label v-for="p in packages" :key="p.id" class="flex items-center gap-2 text-[13px] text-ink-700">
                <input type="checkbox" class="h-4 w-4 accent-brand" :checked="settings.package_ids.includes(p.id)" @change="toggle('package_ids', p.id, ($event.target as HTMLInputElement).checked)" />
                {{ p.name }} <span class="text-ink-faint">· {{ formatEur(p.price_cents) }}</span>
              </label>
            </section>
          </div>

          <section class="flex flex-wrap items-end gap-6 rounded-card border border-line bg-surface p-4">
            <div>
              <label for="valid" class="block text-[12.5px] font-semibold text-ink-700">{{ t('Valid for', 'Validez') }}</label>
              <select id="valid" v-model.number="settings.valid_months" :class="[input, 'mt-1']">
                <option v-for="m in [6, 12, 18, 24]" :key="m" :value="m">{{ t(`${m} months`, `${m} meses`) }}</option>
              </select>
            </div>
            <p class="max-w-[520px] text-[12.5px] text-ink-muted">{{ t('The factura is issued when a voucher is redeemed, as an amount on account or the bono it becomes. Check with your accountant that this suits a voucher for one named service.', 'La factura se emite al canjear el bono, como saldo a cuenta o como el bono en que se convierte. Confirma con tu gestoría que encaja con un bono de un servicio concreto.') }}</p>
          </section>

          <section v-if="can('billing_access')" class="overflow-hidden rounded-card border border-line bg-surface">
            <div class="flex flex-wrap items-center gap-3 border-b border-line px-4 py-3">
              <h2 class="text-[14.5px] font-bold text-ink-900">{{ t('Sold', 'Vendidos') }}</h2>
              <span class="text-[12.5px] text-ink-muted">{{ t(`${thisMonth.length} this month · ${formatEur(outstandingCents)} not yet redeemed`, `${thisMonth.length} este mes · ${formatEur(outstandingCents)} sin canjear`) }}</span>
            </div>
            <p v-if="!vouchers.length" class="px-4 py-6 text-center text-[13.5px] text-ink-muted" data-cy="gift-none-sold">{{ t('None sold yet.', 'Aún no se ha vendido ninguno.') }}</p>
            <div v-else class="overflow-x-auto">
              <table class="w-full min-w-[720px]">
                <thead class="bg-surface-subtle">
                  <tr>
                    <th v-for="h in [t('Code', 'Código'), t('Voucher', 'Bono'), t('For', 'Para'), t('From', 'De parte de'), t('Status', 'Estado'), '']" :key="h" class="px-3 py-2 text-left text-[11px] font-medium uppercase tracking-wide text-ink-muted2">{{ h }}</th>
                  </tr>
                </thead>
                <tbody class="divide-y divide-line-divider">
                  <tr v-for="v in vouchers" :key="v.id" data-cy="gift-row">
                    <td class="px-3 py-2.5 font-mono text-[12.5px] text-ink-900">{{ v.code }}</td>
                    <td class="px-3 py-2.5 text-[13px] text-ink-700">{{ v.kind === 'amount' ? formatEur(v.value_cents) : v.item_name }}</td>
                    <td class="px-3 py-2.5 text-[13px] text-ink-700">{{ v.to_name }}</td>
                    <td class="px-3 py-2.5 text-[13px] text-ink-700">{{ v.from_name }}</td>
                    <td class="px-3 py-2.5"><span class="inline-flex h-6 items-center rounded-pill px-2 text-[11.5px] font-semibold" :class="state(v).cls">{{ state(v).text }}</span></td>
                    <td class="px-3 py-2.5 text-right">
                      <UiBtn v-if="v.status === 'paid' && !expired(v)" size="sm" variant="secondary" :disabled="resendingId === v.id" data-cy="gift-resend" @click="resend(v)">{{ v.sent_at ? t('Resend', 'Reenviar') : t('Send now', 'Enviar ya') }}</UiBtn>
                    </td>
                  </tr>
                </tbody>
              </table>
            </div>
          </section>
        </div>
      </div>
    </div>
  </div>
</template>
