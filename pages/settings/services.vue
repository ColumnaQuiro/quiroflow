<script setup lang="ts">
import { formatEur } from '~/utils/billing'
import { parseEurosToCents } from '~/utils/appointmentTypes'
import { exemptionClause } from '~/utils/facturaTax'

// What a clinic charges for beyond appointment types: offered on quick
// receipts and when billing an appointment.
//
// There is no per-service tax field any more. services_products.tax_rate was
// saved and never read -- a factura's IVA comes from one account-wide rule
// (utils/facturaTax), so typing 21% here changed nothing on any document.
// The page says what that rule is instead. The column stays, at its default.

interface ServiceRow {
  id: string
  name: string
  price_cents: number
}

const supabase = useSupabaseClient()
const store = useAccountStore()
const t = useT()
const { showToast } = useToast()

const services = ref<ServiceRow[]>([])
const uses = ref<Record<string, number>>({})
const loading = ref(true)
const taxRule = ref<{ factura_tax_rate_bp: number; factura_tax_exemption_code: string | null } | null>(null)

async function load() {
  const [{ data }, { data: account }] = await Promise.all([
    supabase.from('services_products').select('id, name, price_cents').order('name'),
    supabase.from('accounts').select('factura_tax_rate_bp, factura_tax_exemption_code').eq('id', store.accountId!).maybeSingle(),
  ])
  services.value = data ?? []
  taxRule.value = account ?? null
  loading.value = false
  // How often each has been charged, which decides whether Delete is offered:
  // a charged service is refused by the database anyway
  // (invoice_line_items.service_id is `on delete restrict`), since deleting it
  // would take its receipts out of the income report's by-service figures. A
  // head count each, since a select of every line item would hit the row cap.
  const counts = await Promise.all(services.value.map((s) => supabase.from('invoice_line_items').select('id', { count: 'exact', head: true }).eq('service_id', s.id)))
  uses.value = Object.fromEntries(services.value.map((s, i) => [s.id, counts[i].count ?? 0]))
}
onMounted(load)

const taxLine = computed(() => {
  const rule = taxRule.value
  if (!rule) return ''
  const clause = exemptionClause(rule.factura_tax_exemption_code)
  if (clause) return t(`Prices are what the patient pays. Your facturas are issued exempt from IVA, citing: “${clause}”.`, `Los precios son lo que paga el paciente. Tus facturas se emiten exentas de IVA, con la mención: «${clause}».`)
  const rate = (rule.factura_tax_rate_bp / 100).toLocaleString('es-ES')
  return t(`Prices are what the patient pays, IVA included: your facturas are issued at ${rate}%.`, `Los precios son lo que paga el paciente, IVA incluido: tus facturas se emiten al ${rate}%.`)
})

const query = ref('')
const shown = computed(() => {
  const q = query.value.trim().toLowerCase()
  return q ? services.value.filter((s) => s.name.toLowerCase().includes(q)) : services.value
})

function usesLabel(id: string) {
  const n = uses.value[id]
  if (n === undefined) return ''
  if (n === 0) return t('Not charged yet', 'Aún sin cobrar')
  return n === 1 ? t('Charged once', 'Cobrado 1 vez') : t(`Charged ${n} times`, `Cobrado ${n} veces`)
}

function centsToInput(cents: number) {
  return (cents / 100).toFixed(2).replace('.', ',')
}

// --- adding ---

const newName = ref('')
const newPrice = ref('')
const adding = ref(false)
const addError = ref('')
const nameInput = ref<HTMLInputElement | null>(null)

async function addService() {
  addError.value = ''
  const name = newName.value.trim()
  const cents = parseEurosToCents(newPrice.value)
  if (!name || cents === null || !Number.isFinite(cents) || cents < 0) {
    addError.value = t('A service needs a name and a price.', 'Un servicio necesita nombre y precio.')
    return
  }
  adding.value = true
  const { error } = await supabase.from('services_products').insert({ account_id: store.accountId!, name, price_cents: cents })
  adding.value = false
  if (error) {
    addError.value = error.message
    return
  }
  newName.value = ''
  newPrice.value = ''
  await load()
}

// --- editing in place ---

const editingId = ref<string | null>(null)
const editName = ref('')
const editPrice = ref('')
const editError = ref('')

function startEdit(s: ServiceRow) {
  editingId.value = s.id
  editName.value = s.name
  editPrice.value = centsToInput(s.price_cents)
  editError.value = ''
}

async function saveEdit(s: ServiceRow) {
  const name = editName.value.trim()
  const cents = parseEurosToCents(editPrice.value)
  if (!name || cents === null || !Number.isFinite(cents) || cents < 0) {
    editError.value = t('A service needs a name and a price.', 'Un servicio necesita nombre y precio.')
    return
  }
  const { error } = await supabase.from('services_products').update({ name, price_cents: cents }).eq('id', s.id)
  if (error) {
    editError.value = error.message
    return
  }
  s.name = name
  s.price_cents = cents
  editingId.value = null
}

async function removeService(s: ServiceRow) {
  const { error } = await supabase.from('services_products').delete().eq('id', s.id)
  if (error) {
    // The count above only sees receipts this user can open; the database
    // sees them all, and refuses a service charged on any of them
    // (invoice_line_items.service_id is `on delete restrict`).
    showToast(
      error.code === '23503'
        ? t(`${s.name} has been charged on receipts, so it cannot be deleted. Rename it instead.`, `${s.name} ya se ha cobrado en recibos, así que no se puede eliminar. Cámbiale el nombre.`)
        : error.message,
      'error',
    )
    await load()
    return
  }
  await load()
}

const inputClass = 'h-9 touch:h-11 w-full rounded-ctl border border-line-control bg-surface px-3 text-[14px] text-ink-900 focus:border-brand focus:outline-none focus:ring-1 focus:ring-brand'
const iconBtn = 'flex h-9 w-9 touch:h-11 touch:w-11 shrink-0 items-center justify-center rounded-ctl text-ink-muted hover:bg-surface-subtle hover:text-ink-700'
const grid = 'grid grid-cols-[minmax(0,1fr)_110px] items-center gap-3 sm:grid-cols-[minmax(0,1fr)_120px_160px_84px]'
</script>

<template>
  <div class="flex h-full flex-col">
    <PageHeader :title="t('Services & Products', 'Servicios y productos')">
      <UiBtn variant="primary" data-cy="service-add" @click="nameInput?.focus()">{{ t('New service', 'Nuevo servicio') }}</UiBtn>
    </PageHeader>
    <div class="flex-1 overflow-y-auto">
      <div class="flex gap-8 p-4 pb-24 sm:px-6 sm:pt-6 lg:pb-6">
        <SettingsNav />
        <div class="flex min-w-0 max-w-[820px] flex-1 flex-col gap-4" data-cy="services-settings" :data-ready="loading ? undefined : 'true'">
          <p class="text-[13.5px] text-ink-muted">
            {{ t('What you charge for beyond appointment types: offered on quick receipts and when billing an appointment.', 'Lo que cobras además de los tipos de cita: se ofrece en los recibos rápidos y al cobrar una cita.') }}
          </p>

          <p v-if="taxLine" class="flex items-start gap-3 rounded-ctl border border-brand-tintBorder bg-brand-tint px-3.5 py-3 text-[13.5px] leading-snug text-ink-700" data-cy="services-tax-line">
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" class="mt-px shrink-0 text-brand-text" aria-hidden="true"><circle cx="12" cy="12" r="9" /><path d="M12 11v5M12 8h.01" /></svg>
            {{ taxLine }}
          </p>

          <section aria-labelledby="h-services" class="overflow-hidden rounded-card border border-line bg-surface">
            <div class="flex flex-wrap items-center gap-2 px-[18px] pb-3 pt-4">
              <h2 id="h-services" class="flex-1 text-[16px] font-bold text-ink-900">{{ t(`Services · ${services.length}`, `Servicios · ${services.length}`) }}</h2>
              <label class="flex h-9 touch:h-11 w-full items-center gap-2 rounded-ctl border border-line-control px-3 text-ink-muted sm:w-[260px]">
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true"><circle cx="11" cy="11" r="7" /><path d="M20 20l-3.5-3.5" /></svg>
                <input v-model="query" type="search" :placeholder="t('Search service', 'Buscar servicio')" :aria-label="t('Search service', 'Buscar servicio')" class="min-w-0 flex-1 border-0 bg-transparent text-[14px] text-ink-900 outline-none" />
              </label>
            </div>

            <div :class="grid" class="border-t border-line-row bg-surface-subtle px-[18px] py-2 text-[12px] font-bold uppercase tracking-[.04em] text-ink-muted max-sm:hidden">
              <span>{{ t('Name', 'Nombre') }}</span>
              <span class="text-right">{{ t('Price', 'Precio') }}</span>
              <span class="text-right">{{ t('Charged', 'Cobrado') }}</span>
              <span />
            </div>

            <template v-if="loading">
              <div v-for="i in 4" :key="i" class="flex items-center gap-4 border-t border-line-row px-[18px] py-4">
                <UiSkeleton class="h-4 w-48 rounded-ctlSm" />
                <UiSkeleton class="ml-auto h-4 w-16 rounded-ctlSm" />
              </div>
            </template>
            <p v-else-if="services.length === 0" class="border-t border-line-row px-[18px] py-6 text-center text-[14px] text-ink-muted">
              {{ t('No services yet. Add the first one below.', 'Todavía no hay servicios. Añade el primero abajo.') }}
            </p>
            <p v-else-if="shown.length === 0" class="border-t border-line-row px-[18px] py-6 text-center text-[14px] text-ink-muted">{{ t('No service matches.', 'Ningún servicio coincide.') }}</p>

            <template v-for="s in shown" :key="s.id">
              <form v-if="editingId === s.id" :class="grid" class="border-t border-line-row bg-surface-subtle py-2.5 pl-[18px] pr-3 shadow-[inset_3px_0_0_rgb(var(--color-brand))]" @submit.prevent="saveEdit(s)">
                <input v-model="editName" data-cy="service-edit-name" type="text" :aria-label="t('Name', 'Nombre')" :class="inputClass" @keydown.esc="editingId = null" />
                <input v-model="editPrice" data-cy="service-edit-price" type="text" inputmode="decimal" :aria-label="t('Price (€)', 'Precio (€)')" :class="[inputClass, 'text-right']" @keydown.esc="editingId = null" />
                <span class="text-right text-[13px] text-ink-muted max-sm:hidden">{{ usesLabel(s.id) }}</span>
                <span class="col-span-2 flex justify-end gap-1.5 sm:col-span-1">
                  <UiBtn variant="primary" type="submit" data-cy="service-edit-save">{{ t('Save', 'Guardar') }}</UiBtn>
                </span>
                <p v-if="editError" class="col-span-full text-[12.5px] font-semibold text-danger-text">{{ editError }}</p>
              </form>
              <div v-else data-cy="service-row" :class="grid" class="min-h-[58px] border-t border-line-row py-1.5 pl-[18px] pr-3">
                <div class="flex min-w-0 flex-col">
                  <strong class="truncate text-[15px] text-ink-900" data-cy="service-name">{{ s.name }}</strong>
                  <span class="text-[12.5px] text-ink-muted sm:hidden">{{ usesLabel(s.id) }}</span>
                </div>
                <span class="text-right text-[15px] font-semibold text-ink-900" data-cy="service-price">{{ formatEur(s.price_cents) }}</span>
                <span class="text-right text-[13px] text-ink-muted max-sm:hidden" data-cy="service-uses">{{ usesLabel(s.id) }}</span>
                <span class="col-span-2 flex justify-end sm:col-span-1">
                  <button type="button" data-cy="service-edit" :class="iconBtn" :aria-label="t(`Edit ${s.name}`, `Editar ${s.name}`)" @click="startEdit(s)">
                    <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M4 20h4L19 9l-4-4L4 16v4zM13.5 6.5l4 4" /></svg>
                  </button>
                  <button v-if="uses[s.id] === 0" type="button" data-cy="service-delete" :class="iconBtn" :aria-label="t(`Delete ${s.name}`, `Eliminar ${s.name}`)" @click="removeService(s)">
                    <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M4 7h16M10 11v6M14 11v6M6 7l1 13h10l1-13M9 7V4h6v3" /></svg>
                  </button>
                  <span v-else class="w-9 shrink-0 touch:w-11" aria-hidden="true" />
                </span>
              </div>
            </template>

            <form class="flex flex-wrap items-center gap-2.5 border-t border-line-row bg-surface-subtle px-[18px] py-3" @submit.prevent="addService">
              <input
                ref="nameInput"
                v-model="newName"
                data-cy="service-new-name"
                type="text"
                :placeholder="t('Add a service, e.g. Clinical report', 'Añade un servicio, ej. Informe clínico')"
                :aria-label="t('New service name', 'Nombre del nuevo servicio')"
                :class="[inputClass, 'min-w-[200px] flex-1 !w-auto']"
              />
              <input v-model="newPrice" data-cy="service-new-price" type="text" inputmode="decimal" placeholder="40,00" :aria-label="t('Price (€)', 'Precio (€)')" :class="[inputClass, '!w-[110px] text-right']" />
              <UiBtn type="submit" data-cy="service-new-save" :disabled="adding || !newName.trim()">{{ adding ? t('Adding…', 'Añadiendo…') : t('Add', 'Añadir') }}</UiBtn>
              <p v-if="addError" class="w-full text-[12.5px] font-semibold text-danger-text">{{ addError }}</p>
            </form>

            <p class="border-t border-line-row px-[18px] py-3 text-[13px] text-ink-muted">
              {{ t('A new price applies from now on; receipts already made keep theirs. A service that has been charged can be renamed but not deleted, so the income report keeps counting it.', 'Un precio nuevo se aplica a partir de ahora; los recibos ya hechos conservan el suyo. Un servicio ya cobrado se puede renombrar pero no eliminar, para que el informe de ingresos lo siga contando.') }}
            </p>
          </section>
        </div>
      </div>
    </div>
  </div>
</template>
