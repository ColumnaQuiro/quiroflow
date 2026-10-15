<script setup lang="ts">
import { stockStatus } from '../../utils/products'

// Products at or under their minimum, on an owner's My Day (web and app):
// one line to say what to reorder, linking to Settings > Products & stock on
// the web. Nothing at all when the shelf is fine. Shared by both, so the
// caller decides who sees it and where the link goes.
const props = defineProps<{ to?: string | null }>()
const t = useT()
const supabase = useSupabaseClient()

const low = ref<{ name: string; units: number }[]>([])
onMounted(async () => {
  const { data } = await supabase.from('services_products').select('name, stock_units, min_stock').eq('kind', 'product').not('stock_units', 'is', null).order('name')
  low.value = ((data as { name: string; stock_units: number; min_stock: number | null }[] | null) ?? [])
    .filter((p) => ['low', 'out'].includes(stockStatus(p.stock_units, p.min_stock)))
    .map((p) => ({ name: p.name, units: p.stock_units }))
})
const line = computed(() => low.value.map((p) => (p.units === 0 ? `${p.name} (${t('out', 'agotado')})` : `${p.name} (${p.units})`)).join(', '))
</script>

<template>
  <div v-if="low.length" class="flex flex-wrap items-center gap-x-3 gap-y-1 rounded-card border border-warning-border bg-warning-bg2 px-4 py-2.5" data-cy="low-stock">
    <span class="text-[13px] font-semibold text-warning-text">{{ t(`${low.length} ${low.length === 1 ? 'product' : 'products'} low on stock`, `${low.length} ${low.length === 1 ? 'producto' : 'productos'} con stock bajo`) }}</span>
    <span class="min-w-0 flex-1 text-[12.5px] text-ink-700">{{ line }}</span>
    <NuxtLink v-if="props.to" :to="props.to" class="text-[12.5px] font-semibold text-brand-text">{{ t('Receive a delivery', 'Recibir mercancía') }} →</NuxtLink>
  </div>
</template>
