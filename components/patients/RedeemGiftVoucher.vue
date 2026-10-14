<script setup lang="ts">
// "Canjear bono regalo" on the patient's Money tab: a gift voucher's code,
// redeemed onto this patient at the desk (/api/gift-vouchers/redeem). An
// amount or a service becomes credit on their account, a bono becomes that
// bono -- recorded and invoiced the way Add credit and selling a bono are.
const props = defineProps<{ patientId: string }>()
const emit = defineEmits<{ redeemed: [] }>()

const t = useT()
const authedFetch = useAuthedFetch()
const code = ref('')
const busy = ref(false)
const error = ref('')
const done = ref('')

async function redeem() {
  if (!code.value.trim()) return
  busy.value = true
  error.value = ''
  done.value = ''
  try {
    const r = await authedFetch<{ kind: string; label: string; itemName: string }>('/api/gift-vouchers/redeem', { method: 'POST', body: { code: code.value, patientId: props.patientId } })
    done.value = r.kind === 'package' ? t(`Redeemed: ${r.itemName} added to their bonos.`, `Canjeado: ${r.itemName}, añadido a sus bonos.`) : t(`Redeemed: ${r.label} added as credit.`, `Canjeado: ${r.label} añadido como saldo.`)
    code.value = ''
    emit('redeemed')
  } catch (e: any) {
    error.value = e?.data?.statusMessage ?? t("Couldn't redeem it.", 'No se ha podido canjear.')
  } finally {
    busy.value = false
  }
}
</script>

<template>
  <form class="flex flex-wrap items-end gap-2" data-cy="redeem-gift" @submit.prevent="redeem">
    <div>
      <label for="gift-code" class="block text-[11px] text-ink-muted">{{ t('Gift voucher code', 'Código del bono regalo') }}</label>
      <input id="gift-code" v-model="code" class="h-9 w-48 rounded-ctl border border-line-control bg-surface px-2.5 font-mono text-[13px] uppercase text-ink-900" placeholder="REGALO-…" data-cy="redeem-gift-code" />
    </div>
    <UiBtn type="submit" variant="primary" size="sm" :disabled="busy || !code.trim()" data-cy="redeem-gift-submit">{{ busy ? t('Redeeming…', 'Canjeando…') : t('Redeem', 'Canjear') }}</UiBtn>
    <p v-if="error" role="alert" class="w-full text-[12.5px] text-danger-text" data-cy="redeem-gift-error">{{ error }}</p>
    <p v-if="done" role="status" class="w-full text-[12.5px] text-success-text" data-cy="redeem-gift-done">{{ done }}</p>
  </form>
</template>
