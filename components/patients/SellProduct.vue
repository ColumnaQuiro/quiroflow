<script setup lang="ts">
import { formatEur } from '../../utils/billing'
import { stockStatus } from '../../utils/products'

// "Vender producto" on the patient's Money tab. Design: StockSale on the
// QuiroFlow canvas. The products and quantities, how it was paid, and one
// button: /api/products/sell takes the stock, records the payment and issues
// the factura at each product's own IVA. Paid there and then -- spending the
// patient's credit is not offered, since that money already has its factura.
const props = defineProps<{ patientId: string }>()
const emit = defineEmits<{ sold: [] }>()

interface Product { id: string; name: string; price_cents: number; tax_rate: number; stock_units: number | null; min_stock: number | null }

const t = useT()
const supabase = useSupabaseClient()
const authedFetch = useAuthedFetch()
const { methods, ensureLoaded, defaultMethod } = usePaymentMethods()

const products = ref<Product[]>([])
const query = ref('')
const basket = ref<Map<string, number>>(new Map())
const method = ref('')
const busy = ref(false)
const error = ref('')
const done = ref('')

onMounted(async () => {
  const [{ data }] = await Promise.all([
    supabase.from('services_products').select('id, name, price_cents, tax_rate, stock_units, min_stock').eq('kind', 'product').order('name'),
    ensureLoaded(),
  ])
  products.value = (data as Product[] | null) ?? []
  method.value = defaultMethod.value
})

const shown = computed(() => {
  const q = query.value.trim().toLowerCase()
  return q ? products.value.filter((p) => p.name.toLowerCase().includes(q)) : products.value
})
const lines = computed(() => [...basket.value.entries()].map(([id, qty]) => ({ product: products.value.find((p) => p.id === id)!, qty })).filter((l) => l.product))
const totalCents = computed(() => lines.value.reduce((s, l) => s + l.product.price_cents * l.qty, 0))
const payMethods = computed(() => methods.value.filter((m) => m.key !== 'credit'))

function setQty(p: Product, qty: number) {
  const next = new Map(basket.value)
  const max = p.stock_units === null ? Infinity : p.stock_units
  const q = Math.min(Math.max(0, qty), max)
  if (q === 0) next.delete(p.id)
  else next.set(p.id, q)
  basket.value = next
}

async function sell() {
  if (!lines.value.length || !method.value) return
  busy.value = true
  error.value = ''
  done.value = ''
  try {
    const r = await authedFetch<{ sales: { factura: string | null }[] }>('/api/products/sell', {
      method: 'POST',
      body: { patientId: props.patientId, method: method.value, items: lines.value.map((l) => ({ productId: l.product.id, quantity: l.qty })) },
    })
    const numbers = r.sales.map((s) => s.factura).filter(Boolean)
    done.value = numbers.length
      ? t(`Sold and paid. Factura ${numbers.join(', ')}.`, `Vendido y cobrado. Factura ${numbers.join(', ')}.`)
      : t('Sold and paid.', 'Vendido y cobrado.')
    basket.value = new Map()
    const { data } = await supabase.from('services_products').select('id, name, price_cents, tax_rate, stock_units, min_stock').eq('kind', 'product').order('name')
    products.value = (data as Product[] | null) ?? []
    emit('sold')
  } catch (e: any) {
    error.value = e?.data?.statusMessage ?? t("Couldn't sell it.", 'No se ha podido vender.')
  } finally {
    busy.value = false
  }
}
</script>

<template>
  <div class="grid gap-4 lg:grid-cols-[minmax(0,1fr)_320px]" data-cy="sell-product">
    <section class="flex flex-col gap-2.5">
      <div class="flex flex-wrap items-center gap-2">
        <h3 class="flex-1 text-[14.5px] font-bold text-ink-900">{{ t('Sell a product', 'Vender producto') }}</h3>
        <input v-model="query" type="search" :placeholder="t('Search product', 'Buscar producto')" :aria-label="t('Search product', 'Buscar producto')" class="h-9 w-56 rounded-ctl border border-line-control bg-surface px-2.5 text-[13px] text-ink-900" />
      </div>
      <p v-if="!products.length" class="text-[13px] text-ink-muted">
        {{ t('No products yet: add them in Settings › Products & stock.', 'Todavía no hay productos: añádelos en Ajustes › Productos y stock.') }}
      </p>
      <div
        v-for="p in shown"
        :key="p.id"
        class="flex items-center gap-3 rounded-ctl border px-3 py-2.5"
        :class="[basket.has(p.id) ? 'border-brand ring-2 ring-brand/20' : 'border-line-control', stockStatus(p.stock_units, p.min_stock) === 'out' ? 'bg-surface-subtle' : 'bg-surface']"
        data-cy="sell-product-row"
        :data-name="p.name"
      >
        <div class="min-w-0 flex-1">
          <p class="truncate text-[14px] font-semibold" :class="stockStatus(p.stock_units, p.min_stock) === 'out' ? 'text-ink-faint' : 'text-ink-900'">{{ p.name }}</p>
          <p class="text-[12px]" :class="{ 'text-warning-text': stockStatus(p.stock_units, p.min_stock) === 'low', 'text-danger-text': stockStatus(p.stock_units, p.min_stock) === 'out', 'text-ink-muted': ['ok', 'untracked'].includes(stockStatus(p.stock_units, p.min_stock)) }">
            <template v-if="stockStatus(p.stock_units, p.min_stock) === 'out'">{{ t('Out of stock', 'Agotado') }}</template>
            <template v-else-if="p.stock_units === null">{{ t('To order', 'Bajo pedido') }} · IVA {{ Number(p.tax_rate) }} %</template>
            <template v-else>{{ t(`${p.stock_units} in stock`, `${p.stock_units} en stock`) }}<template v-if="stockStatus(p.stock_units, p.min_stock) === 'low'"> · {{ t('running low', 'quedan pocos') }}</template> · IVA {{ Number(p.tax_rate) }} %</template>
          </p>
        </div>
        <span class="font-mono text-[13.5px] font-semibold text-ink-900">{{ formatEur(p.price_cents) }}</span>
        <span v-if="basket.has(p.id)" class="inline-flex items-center overflow-hidden rounded-ctl border border-line-control">
          <button type="button" class="h-8 w-8 bg-surface-subtle text-[15px]" :aria-label="t('Fewer', 'Menos')" data-cy="sell-product-less" @click="setQty(p, basket.get(p.id)! - 1)">−</button>
          <span class="w-8 text-center text-[13.5px] font-semibold" data-cy="sell-product-qty">{{ basket.get(p.id) }}</span>
          <button type="button" class="h-8 w-8 bg-surface-subtle text-[15px]" :aria-label="t('More', 'Más')" :disabled="p.stock_units !== null && basket.get(p.id)! >= p.stock_units" data-cy="sell-product-more" @click="setQty(p, basket.get(p.id)! + 1)">+</button>
        </span>
        <UiBtn v-else size="sm" :disabled="stockStatus(p.stock_units, p.min_stock) === 'out'" data-cy="sell-product-add" @click="setQty(p, 1)">
          {{ stockStatus(p.stock_units, p.min_stock) === 'out' ? t('Out of stock', 'Agotado') : t('Add', 'Añadir') }}
        </UiBtn>
      </div>
    </section>

    <aside class="flex flex-col gap-2.5 self-start rounded-card border border-line bg-surface p-4">
      <h3 class="text-[14.5px] font-bold text-ink-900">{{ t('Take payment', 'Cobrar') }}</h3>
      <p v-if="!lines.length" class="text-[12.5px] text-ink-muted">{{ t('Add a product.', 'Añade un producto.') }}</p>
      <div v-for="l in lines" :key="l.product.id" class="flex justify-between text-[13.5px] text-ink-900">
        <span>{{ l.product.name }} × {{ l.qty }}</span><span class="font-mono">{{ formatEur(l.product.price_cents * l.qty) }}</span>
      </div>
      <div class="flex justify-between border-t border-line-divider pt-2.5 text-[14px] font-bold text-ink-900">
        <span>{{ t('Total', 'Total') }}</span><span class="font-mono" data-cy="sell-product-total">{{ formatEur(totalCents) }}</span>
      </div>
      <label class="flex flex-col gap-1 text-[12.5px] text-ink-muted">{{ t('Paid by', 'Forma de pago') }}
        <select v-model="method" class="h-9 rounded-ctl border border-line-control bg-surface px-2.5 text-[13px] text-ink-900" data-cy="sell-product-method">
          <option v-for="m in payMethods" :key="m.key" :value="m.key">{{ m.name }}</option>
        </select>
      </label>
      <p v-if="error" role="alert" class="text-[12.5px] text-danger-text">{{ error }}</p>
      <p v-if="done" role="status" class="text-[12.5px] font-medium text-success-text" data-cy="sell-product-done">{{ done }}</p>
      <UiBtn variant="primary" size="lg" :disabled="busy || !lines.length" data-cy="sell-product-submit" @click="sell">{{ t('Take payment and hand over', 'Cobrar y entregar') }}</UiBtn>
      <p class="text-[12px] text-ink-muted">{{ t('Takes it from stock, records the payment and issues its factura at the product\'s IVA.', 'Baja el stock, registra el pago y emite su factura con el IVA del producto.') }}</p>
    </aside>
  </div>
</template>
