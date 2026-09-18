<script setup lang="ts">
import type { Tables } from '~/types/database.types'

const supabase = useSupabaseClient()
const store = useAccountStore()
const t = useT()
// The pickers cache this list; without invalidating, a method added here
// would not appear on a Billing tab until a full page reload.
const { invalidate: invalidatePaymentMethods, labelFor: methodLabel } = usePaymentMethods()

const methods = ref<Tables<'payment_methods'>[]>([])
const loading = ref(true)
const name = ref('')
const saving = ref(false)
const error = ref('')

async function load() {
  loading.value = true
  // is_system excluded: 'credit' and 'write_off' exist as rows so payments can
  // reference them, but they carry behaviour and renaming or deactivating one
  // would break the forms that special-case them. The note at the foot of this
  // page has always said they are not managed here; now they actually aren't.
  const { data } = await supabase.from('payment_methods').select('*').eq('is_system', false).order('sort_order').order('name')
  methods.value = data ?? []
  invalidatePaymentMethods()
  loading.value = false
}
onMounted(load)

// The key is what gets written to payments.method and never changes again --
// the name above it is a label staff can re-word whenever they like. Deriving
// it from the name once, here, is what lets "Transferencia bancaria" be
// renamed to "Transferencia" later without orphaning the payments taken under
// the old wording.
function keyFrom(name: string) {
  const base = name.trim().toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '')
  return base || 'method'
}

async function addMethod() {
  error.value = ''
  if (!name.value.trim()) return
  saving.value = true
  let key = keyFrom(name.value)
  // Two methods a staff member would read as different ("Bizum" and "bizum ")
  // collapse to one key, and the unique index would refuse the second with a
  // constraint message nobody can act on.
  const taken = new Set(methods.value.map((m) => m.key))
  if (taken.has(key)) {
    let n = 2
    while (taken.has(`${key}_${n}`)) n++
    key = `${key}_${n}`
  }
  const { error: insertError } = await supabase.from('payment_methods').insert({
    account_id: store.accountId!,
    key,
    name: name.value.trim(),
    sort_order: methods.value.length,
  })
  saving.value = false
  if (insertError) {
    error.value = insertError.message
    return
  }
  name.value = ''
  await load()
}

async function toggleActive(method: Tables<'payment_methods'>) {
  method.is_active = !method.is_active
  await supabase.from('payment_methods').update({ is_active: method.is_active }).eq('id', method.id)
  invalidatePaymentMethods()
}

async function removeMethod(id: string) {
  if (!confirm(t('Delete this payment method?', '¿Eliminar este método de pago?'))) return
  error.value = ''
  const { error: deleteError } = await supabase.from('payment_methods').delete().eq('id', id)
  // A method with payments against it is refused by the foreign key. That is
  // the right answer -- deleting it would leave those payments naming a method
  // the account no longer has, and the reports that group by method reading a
  // key with nothing behind it. Deactivating keeps the history and takes it
  // out of the pickers, which is what "we stopped taking bank transfers"
  // actually means.
  if (deleteError) {
    error.value = t(
      'This method has payments recorded against it, so it cannot be deleted. Deactivate it instead -- it will disappear from the payment forms and the history stays intact.',
      'Este método tiene pagos registrados, así que no se puede eliminar. Desactívalo en su lugar: desaparecerá de los formularios de pago y el historial se mantiene.',
    )
    return
  }
  await load()
}
</script>

<template>
  <div class="flex h-full flex-col">
    <PageHeader :title="t('Payment Methods', 'Métodos de Pago')" />
    <div class="flex-1 overflow-y-auto">
      <div class="flex gap-8 p-6">
        <SettingsNav />
        <div class="min-w-0 max-w-[660px] flex-1">
          <p class="text-[13px] text-ink-muted2">
            {{ t("The methods staff can record a payment against. Cash and Card are seeded by default -- add others (e.g. Bank Transfer) or deactivate ones you don't use.", 'Los métodos con los que el personal puede registrar un pago. Efectivo y Tarjeta se incluyen por defecto -- añade otros (p. ej. Transferencia Bancaria) o desactiva los que no uses.') }}
          </p>

          <div class="mt-4 overflow-hidden rounded-card border border-line bg-surface shadow-card">
            <table class="w-full text-[13px]">
              <thead class="border-b border-line bg-surface-subtle text-left text-[11px] font-[640] uppercase tracking-[.04em] text-ink-muted2">
                <tr>
                  <th class="px-4 py-2">{{ t('Name', 'Nombre') }}</th>
                  <th class="px-4 py-2">{{ t('Status', 'Estado') }}</th>
                  <th class="px-4 py-2"></th>
                </tr>
              </thead>
              <tbody class="divide-y divide-line-row">
                <template v-if="loading">
                  <tr v-for="i in 4" :key="i">
                    <td class="px-4 py-2.5"><UiSkeleton class="h-3.5 w-32 rounded-ctlSm" /></td>
                    <td class="px-4 py-2.5"><UiSkeleton class="h-5 w-16 rounded-pill" /></td>
                    <td class="px-4 py-2.5" />
                  </tr>
                </template>
                <tr v-for="m in methods" :key="m.id">
                  <td class="px-4 py-2.5 text-ink-700">{{ methodLabel(m.key) }}</td>
                  <td class="px-4 py-2.5">
                    <button
                      type="button"
                      class="rounded-pill px-2 py-0.5 text-[11px] font-medium"
                      :class="m.is_active ? 'bg-success-bg text-success-text' : 'bg-chip-bg text-chip-text'"
                      @click="toggleActive(m)"
                    >
                      {{ m.is_active ? t('Active', 'Activo') : t('Inactive', 'Inactivo') }}
                    </button>
                  </td>
                  <td class="px-4 py-2.5 text-right">
                    <button type="button" class="text-ink-faint hover:text-danger-text" @click="removeMethod(m.id)">✕</button>
                  </td>
                </tr>
              </tbody>
            </table>
          </div>

          <form class="mt-4 flex flex-wrap items-end gap-3 rounded-card border border-line bg-surface p-4 shadow-card" @submit.prevent="addMethod">
            <div>
              <label class="block text-[12.5px] font-medium text-ink-600">{{ t('Name', 'Nombre') }}</label>
              <input v-model="name" type="text" required :placeholder="t('Bank Transfer', 'Transferencia Bancaria')" class="mt-1 h-8 rounded-ctl border border-line-control bg-surface px-3 text-[13px] text-ink-700 focus:border-brand focus:outline-none focus:ring-1 focus:ring-brand/20" />
            </div>
            <UiBtn variant="primary" type="submit" :disabled="saving">{{ saving ? t('Adding…', 'Añadiendo…') : t('Add Method', 'Añadir Método') }}</UiBtn>
          </form>
          <p v-if="error" class="mt-2 text-[12.5px] text-danger-text">{{ error }}</p>
          <p class="mt-3 text-[12px] text-ink-faint">
            {{ t('"Credit on account" and write-offs are separate, built-in payment types (tied to a patient\'s real credit balance) and aren\'t managed here.', 'El "saldo a favor" y las bajas contables son tipos de pago independientes e integrados (vinculados al saldo real del paciente) y no se gestionan aquí.') }}
          </p>
        </div>
      </div>
    </div>
  </div>
</template>
