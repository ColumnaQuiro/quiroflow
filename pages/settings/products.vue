<script setup lang="ts">
import { formatEur } from '~/utils/billing'
import { parseEurosToCents } from '~/utils/appointmentTypes'
import { PRODUCT_TAX_RATES, productMarginPct, stockStatus } from '~/utils/products'

// Productos y stock: what the clinic sells over the counter. Design: the
// "Productos y stock" row of the QuiroFlow canvas (StockProducts).
//
// A product is a services_products row with kind = 'product', its own IVA
// (21 / 10 / 4 %: goods are taxed even where the clinic's services are
// exempt), optionally counted stock with a minimum, and the unit cost of the
// last delivery for the margin. Stock moves only through a movement --
// "Receive delivery", an adjustment with its reason, or a sale from the
// patient's Money tab -- never by typing a number (adjust_product_stock,
// 20261015155217_products_and_stock.sql), so the shelf always matches the list.
interface Product {
  id: string
  name: string
  price_cents: number
  tax_rate: number
  stock_units: number | null
  min_stock: number | null
  cost_cents: number | null
}
interface Movement { id: string; product_id: string; delta: number; kind: string; reason: string | null; supplier: string | null; created_at: string; invoice_id: string | null; invoices: { patients: { first_name: string; last_name: string | null } | null } | null }

const supabase = useSupabaseClient()
const store = useAccountStore()
const t = useT()
const { preference: lang } = useLang()

const products = ref<Product[]>([])
const soldThisMonth = ref<Map<string, number>>(new Map())
const loading = ref(true)
const error = ref('')
const selected = ref<string | null>(null)
const movements = ref<Movement[]>([])

const monthStart = (() => {
  const d = new Date()
  return new Date(d.getFullYear(), d.getMonth(), 1).toISOString()
})()
const monthName = new Date().toLocaleDateString(lang.value === 'es' ? 'es-ES' : 'en-GB', { month: 'short' })

async function load() {
  const [{ data }, { data: sales }] = await Promise.all([
    supabase.from('services_products').select('id, name, price_cents, tax_rate, stock_units, min_stock, cost_cents').eq('kind', 'product').order('name'),
    // Sold less brought back, this month.
    supabase.from('product_stock_movements').select('product_id, delta').in('kind', ['sale', 'return']).gte('created_at', monthStart),
  ])
  products.value = (data as Product[] | null) ?? []
  const sold = new Map<string, number>()
  for (const s of sales ?? []) sold.set(s.product_id, (sold.get(s.product_id) ?? 0) - s.delta)
  soldThisMonth.value = sold
  loading.value = false
  if (!selected.value && products.value.length) selected.value = products.value[0]!.id
  if (!receiveFor.value && products.value.length) receiveFor.value = products.value[0]!.id
  await loadMovements()
}
async function loadMovements() {
  if (!selected.value) {
    movements.value = []
    return
  }
  const { data } = await supabase
    .from('product_stock_movements')
    .select('id, product_id, delta, kind, reason, supplier, created_at, invoice_id, invoices(patients(first_name, last_name))')
    .eq('product_id', selected.value)
    .order('created_at', { ascending: false })
    .limit(30)
  movements.value = (data as unknown as Movement[] | null) ?? []
}
onMounted(load)
watch(selected, loadMovements)

const lowCount = computed(() => products.value.filter((p) => ['low', 'out'].includes(stockStatus(p.stock_units, p.min_stock))).length)
const selectedProduct = computed(() => products.value.find((p) => p.id === selected.value) ?? null)
const dateLabel = (iso: string) => new Date(iso).toLocaleDateString(lang.value === 'es' ? 'es-ES' : 'en-GB', { day: 'numeric', month: 'short' })

function movementLabel(m: Movement) {
  if (m.kind === 'sale') {
    const p = m.invoices?.patients
    return `${t('Sale', 'Venta')}${p ? ` · ${p.first_name} ${p.last_name ?? ''}`.trimEnd() : ''}`
  }
  if (m.kind === 'return') {
    const p = m.invoices?.patients
    return `${t('Returned', 'Devolución')}${p ? ` · ${p.first_name} ${p.last_name ?? ''}`.trimEnd() : ''}${m.reason ? ` · ${m.reason}` : ''}`
  }
  if (m.kind === 'receive') return `${t('Delivery', 'Entrada')} · ${m.delta} ${t('units', 'uds.')}${m.supplier ? ` · ${m.supplier}` : ''}`
  return `${t('Adjustment', 'Ajuste')} · ${m.reason ?? ''}`
}

// ---- product form (new / edit)
const editing = ref<'new' | string | null>(null)
const form = reactive({ name: '', price: '', taxRate: 21 as number, counted: true, minStock: '' })
const formError = ref('')
function startNew() {
  editing.value = 'new'
  Object.assign(form, { name: '', price: '', taxRate: 21, counted: true, minStock: '' })
  formError.value = ''
}
function startEdit(p: Product) {
  editing.value = p.id
  Object.assign(form, { name: p.name, price: (p.price_cents / 100).toFixed(2).replace('.', ','), taxRate: Number(p.tax_rate), counted: p.stock_units !== null, minStock: p.min_stock === null ? '' : String(p.min_stock) })
  formError.value = ''
}
async function saveProduct() {
  formError.value = ''
  const name = form.name.trim()
  const cents = parseEurosToCents(form.price)
  const min = form.minStock.trim() === '' ? null : Number(form.minStock)
  if (!name || cents === null || cents < 0) {
    formError.value = t('A product needs a name and a price.', 'Un producto necesita nombre y precio.')
    return
  }
  if (min !== null && (!Number.isInteger(min) || min < 0)) {
    formError.value = t('The minimum is a whole number of units.', 'El mínimo es un número entero de unidades.')
    return
  }
  const current = products.value.find((p) => p.id === editing.value)
  // Counting is switched on or off at zero; units only arrive with a delivery.
  if (current && current.stock_units !== null && current.stock_units > 0 && !form.counted) {
    formError.value = t('Adjust the stock to zero before you stop counting it.', 'Ajusta el stock a cero antes de dejar de contarlo.')
    return
  }
  const row = { name, price_cents: cents, tax_rate: form.taxRate, min_stock: form.counted ? min : null, stock_units: form.counted ? (current?.stock_units ?? 0) : null }
  const { error: e } = editing.value === 'new'
    ? await supabase.from('services_products').insert({ ...row, account_id: store.accountId!, kind: 'product' })
    : await supabase.from('services_products').update(row).eq('id', editing.value!)
  if (e) {
    formError.value = e.message
    return
  }
  editing.value = null
  await load()
}

// ---- receive a delivery
const receiveFor = ref('')
const receiveUnits = ref('')
const receiveCost = ref('')
const receiveSupplier = ref('')
const receiveError = ref('')
const receiving = ref(false)
async function receive() {
  receiveError.value = ''
  const units = Number(receiveUnits.value)
  const cost = receiveCost.value.trim() === '' ? null : parseEurosToCents(receiveCost.value)
  if (!receiveFor.value || !Number.isInteger(units) || units <= 0) {
    receiveError.value = t('Say how many units arrived.', 'Indica cuántas unidades han llegado.')
    return
  }
  receiving.value = true
  const { error: e } = await supabase.rpc('adjust_product_stock', { p_product_id: receiveFor.value, p_delta: units, p_kind: 'receive', p_unit_cost_cents: cost, p_supplier: receiveSupplier.value.trim() || null })
  receiving.value = false
  if (e) {
    receiveError.value = e.message
    return
  }
  receiveUnits.value = ''
  receiveCost.value = ''
  receiveSupplier.value = ''
  selected.value = receiveFor.value
  await load()
}

// ---- adjust (broken, expired, counted)
const adjustFor = ref<string | null>(null)
const adjustDelta = ref('')
const adjustReason = ref('')
const adjustError = ref('')
async function adjust() {
  adjustError.value = ''
  const delta = Number(adjustDelta.value)
  if (!adjustFor.value || !Number.isInteger(delta) || delta === 0 || !adjustReason.value.trim()) {
    adjustError.value = t('Units (e.g. -2) and a reason.', 'Unidades (p. ej. -2) y un motivo.')
    return
  }
  const { error: e } = await supabase.rpc('adjust_product_stock', { p_product_id: adjustFor.value, p_delta: delta, p_kind: 'adjust', p_reason: adjustReason.value.trim() })
  if (e) {
    adjustError.value = e.message
    return
  }
  selected.value = adjustFor.value
  adjustFor.value = null
  adjustDelta.value = ''
  adjustReason.value = ''
  await load()
}

const input = 'h-9 touch:h-11 rounded-ctl border border-line-control bg-surface px-3 text-[14px] text-ink-900 focus:border-brand focus:outline-none'
const label = 'flex flex-col gap-1 text-[12.5px] text-ink-muted'
const th = 'px-3 py-2 text-left text-[11px] font-[640] uppercase tracking-[.05em] text-ink-muted'
const td = 'border-t border-line-row px-3 py-2.5 text-[13.5px] text-ink-900'
const pill = 'inline-flex h-[22px] items-center rounded-pill px-2 text-[11.5px] font-semibold'
</script>

<template>
  <div class="flex h-full flex-col">
    <PageHeader :title="t('Products & stock', 'Productos y stock')">
      <span v-if="lowCount" :class="pill" class="bg-warning-bg text-warning-text" data-cy="products-low-count">{{ t(`${lowCount} low on stock`, `${lowCount} con stock bajo`) }}</span>
      <UiBtn variant="primary" data-cy="product-new" @click="startNew">{{ t('New product', 'Nuevo producto') }}</UiBtn>
    </PageHeader>
    <div class="flex-1 overflow-y-auto">
      <div class="flex gap-8 p-4 pb-24 sm:px-6 sm:pt-6 lg:pb-6">
        <SettingsNav />
        <div class="flex min-w-0 max-w-[980px] flex-1 flex-col gap-4" data-cy="products-settings" :data-ready="loading ? undefined : 'true'">
          <p class="text-[13.5px] text-ink-muted">
            {{ t('What you sell over the counter. Sold from the patient\'s Money tab, which takes it from stock and issues the factura at the product\'s own IVA -- goods are taxed even when your services are exempt.', 'Lo que vendes en mostrador. Se vende desde la pestaña Dinero del paciente, que lo descuenta del stock y emite la factura con el IVA del producto: los productos llevan IVA aunque tus servicios estén exentos.') }}
          </p>
          <p v-if="error" role="alert" class="text-[12.5px] text-danger-text">{{ error }}</p>

          <form v-if="editing" class="flex flex-wrap items-end gap-3 rounded-card border border-brand-tintBorder bg-brand-tint px-4 py-3" data-cy="product-form" @submit.prevent="saveProduct">
            <label :class="label" class="min-w-[200px] flex-1">{{ t('Name', 'Nombre') }}<input v-model="form.name" :class="input" data-cy="product-name" /></label>
            <label :class="label">{{ t('Price, IVA incl. (€)', 'Precio, IVA incl. (€)') }}<input v-model="form.price" inputmode="decimal" :class="input" class="w-28 text-right" data-cy="product-price" /></label>
            <label :class="label">{{ t('IVA', 'IVA') }}
              <select v-model.number="form.taxRate" :class="input" data-cy="product-tax">
                <option v-for="r in PRODUCT_TAX_RATES" :key="r" :value="r">{{ r }} %</option>
              </select>
            </label>
            <label class="flex h-9 items-center gap-2 text-[13px] text-ink-700 touch:h-11"><input v-model="form.counted" type="checkbox" data-cy="product-counted" />{{ t('Count stock', 'Contar stock') }}</label>
            <label v-if="form.counted" :class="label">{{ t('Minimum', 'Mínimo') }}<input v-model="form.minStock" inputmode="numeric" :class="input" class="w-20 text-right" data-cy="product-min" /></label>
            <UiBtn variant="primary" type="submit" data-cy="product-save">{{ t('Save', 'Guardar') }}</UiBtn>
            <UiBtn variant="ghost" @click="editing = null">{{ t('Cancel', 'Cancelar') }}</UiBtn>
            <p v-if="formError" role="alert" class="w-full text-[12.5px] font-semibold text-danger-text">{{ formError }}</p>
          </form>

          <section class="overflow-x-auto rounded-card border border-line bg-surface">
            <table class="w-full border-collapse">
              <thead>
                <tr>
                  <th :class="th">{{ t('Product', 'Producto') }}</th>
                  <th :class="th" class="text-right">{{ t('Price', 'Precio') }}</th>
                  <th :class="th">{{ t('IVA', 'IVA') }}</th>
                  <th :class="th" class="text-right">{{ t('Stock', 'Stock') }}</th>
                  <th :class="th" class="text-right">{{ t('Minimum', 'Mínimo') }}</th>
                  <th :class="th" class="text-right">{{ t(`Sold (${monthName})`, `Vendidos (${monthName})`) }}</th>
                  <th :class="th" class="text-right">{{ t('Margin', 'Margen') }}</th>
                  <th :class="th" />
                </tr>
              </thead>
              <tbody>
                <tr v-if="!loading && !products.length"><td :class="td" colspan="8" class="text-center text-ink-muted">{{ t('No products yet.', 'Todavía no hay productos.') }}</td></tr>
                <tr v-for="p in products" :key="p.id" class="cursor-pointer" :class="selected === p.id ? 'bg-brand-tint' : 'hover:bg-surface-subtle'" data-cy="product-row" :data-name="p.name" @click="selected = p.id">
                  <td :class="td"><strong>{{ p.name }}</strong></td>
                  <td :class="td" class="text-right font-mono">{{ formatEur(p.price_cents) }}</td>
                  <td :class="td">{{ Number(p.tax_rate) }} %</td>
                  <td :class="td" class="text-right font-mono" data-cy="product-stock">
                    <span v-if="p.stock_units === null" class="font-sans text-[12.5px] text-ink-muted">{{ t('Not counted (to order)', 'Sin stock (bajo pedido)') }}</span>
                    <strong v-else :class="{ 'text-warning-text': stockStatus(p.stock_units, p.min_stock) === 'low', 'text-danger-text': stockStatus(p.stock_units, p.min_stock) === 'out' }">{{ p.stock_units }}</strong>
                  </td>
                  <td :class="td" class="text-right font-mono">{{ p.min_stock ?? '' }}</td>
                  <td :class="td" class="text-right font-mono" data-cy="product-sold">{{ soldThisMonth.get(p.id) ?? 0 }}</td>
                  <td :class="td" class="text-right font-mono" data-cy="product-margin">{{ productMarginPct(p.price_cents, Number(p.tax_rate), p.cost_cents) === null ? '—' : `${productMarginPct(p.price_cents, Number(p.tax_rate), p.cost_cents)} %` }}</td>
                  <td :class="td" class="whitespace-nowrap text-right">
                    <span v-if="stockStatus(p.stock_units, p.min_stock) === 'out'" :class="pill" class="mr-1.5 bg-danger-bg text-danger-text">{{ t('Out of stock', 'Agotado') }}</span>
                    <span v-else-if="stockStatus(p.stock_units, p.min_stock) === 'low'" :class="pill" class="mr-1.5 bg-warning-bg text-warning-text">{{ t('Low stock', 'Stock bajo') }}</span>
                    <UiBtn v-if="p.stock_units !== null" size="sm" data-cy="product-adjust" @click.stop="adjustFor = p.id">{{ t('Adjust', 'Ajustar') }}</UiBtn>
                    <UiBtn size="sm" variant="ghost" data-cy="product-edit" @click.stop="startEdit(p)">{{ t('Edit', 'Editar') }}</UiBtn>
                  </td>
                </tr>
              </tbody>
            </table>
          </section>

          <form v-if="adjustFor" class="flex flex-wrap items-end gap-3 rounded-card border border-line bg-surface px-4 py-3" data-cy="adjust-form" @submit.prevent="adjust">
            <p class="w-full text-[14px] font-bold text-ink-900">{{ t('Adjust', 'Ajustar') }} · {{ products.find((p) => p.id === adjustFor)?.name }}</p>
            <label :class="label">{{ t('Units (+/−)', 'Unidades (+/−)') }}<input v-model="adjustDelta" inputmode="numeric" placeholder="-2" :class="input" class="w-24 text-right" data-cy="adjust-delta" /></label>
            <label :class="label" class="min-w-[200px] flex-1">{{ t('Reason', 'Motivo') }}<input v-model="adjustReason" :placeholder="t('Expired, broken, counted…', 'Caducado, roto, recuento…')" :class="input" data-cy="adjust-reason" /></label>
            <UiBtn variant="primary" type="submit" data-cy="adjust-save">{{ t('Adjust stock', 'Ajustar stock') }}</UiBtn>
            <UiBtn variant="ghost" @click="adjustFor = null">{{ t('Cancel', 'Cancelar') }}</UiBtn>
            <p v-if="adjustError" role="alert" class="w-full text-[12.5px] font-semibold text-danger-text">{{ adjustError }}</p>
          </form>

          <div v-if="products.length" class="grid gap-4 md:grid-cols-2">
            <form class="flex flex-col gap-2.5 rounded-card border border-line bg-surface px-4 py-3.5" data-cy="receive-form" @submit.prevent="receive">
              <h2 class="text-[14.5px] font-bold text-ink-900">{{ t('Receive a delivery', 'Recibir mercancía') }}</h2>
              <label :class="label">{{ t('Product', 'Producto') }}
                <select v-model="receiveFor" :class="input" data-cy="receive-product">
                  <option v-for="p in products" :key="p.id" :value="p.id">{{ p.name }}</option>
                </select>
              </label>
              <div class="flex gap-2.5">
                <label :class="label" class="flex-1">{{ t('Units', 'Unidades') }}<input v-model="receiveUnits" inputmode="numeric" :class="input" data-cy="receive-units" /></label>
                <label :class="label" class="flex-1">{{ t('Cost per unit (€, optional)', 'Coste por unidad (€, opcional)') }}<input v-model="receiveCost" inputmode="decimal" :class="input" data-cy="receive-cost" /></label>
              </div>
              <label :class="label">{{ t('Supplier (optional)', 'Proveedor (opcional)') }}<input v-model="receiveSupplier" :class="input" data-cy="receive-supplier" /></label>
              <p v-if="receiveError" role="alert" class="text-[12.5px] font-semibold text-danger-text">{{ receiveError }}</p>
              <UiBtn variant="primary" type="submit" class="self-start" :disabled="receiving" data-cy="receive-save">{{ t('Add to stock', 'Sumar al stock') }}</UiBtn>
            </form>

            <section class="rounded-card border border-line bg-surface px-4 py-3.5" data-cy="movements">
              <h2 class="text-[14.5px] font-bold text-ink-900">{{ t('Movements', 'Movimientos') }}<template v-if="selectedProduct"> · {{ selectedProduct.name }}</template></h2>
              <p v-if="!movements.length" class="mt-2 text-[13px] text-ink-muted">{{ t('Nothing yet.', 'Nada todavía.') }}</p>
              <table v-else class="mt-1.5 w-full border-collapse">
                <tbody>
                  <tr v-for="m in movements" :key="m.id" data-cy="movement-row" :data-kind="m.kind">
                    <td class="border-t border-line-row py-2 pr-2 text-[12.5px] text-ink-muted">{{ dateLabel(m.created_at) }}</td>
                    <td class="border-t border-line-row py-2 pr-2 text-[13px] text-ink-900">{{ movementLabel(m) }}</td>
                    <td class="border-t border-line-row py-2 text-right font-mono text-[13px]" :class="m.delta < 0 ? 'text-ink-900' : 'text-success-text'">{{ m.delta > 0 ? `+${m.delta}` : `−${-m.delta}` }}</td>
                  </tr>
                </tbody>
              </table>
            </section>
          </div>
        </div>
      </div>
    </div>
  </div>
</template>
