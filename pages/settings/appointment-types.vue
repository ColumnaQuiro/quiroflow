<script setup lang="ts">
import type { Tables } from '~/types/database.types'

const supabase = useSupabaseClient()
const store = useAccountStore()
const t = useT()

const STAGE_OPTIONS = computed(() => [
  { value: '', label: t('Not classified', 'Sin clasificar') },
  { value: 'first_visit', label: t('First visit', 'Primera visita') },
  { value: 'first_visit_offer', label: t('First visit (offer)', 'Primera visita (oferta)') },
  { value: 'report', label: t('Report / exam findings', 'Informe / hallazgos del examen') },
  { value: 'revision', label: t('Revision / check-up', 'Revisión / control') },
  { value: 'maintenance', label: t('Maintenance package', 'Bono de mantenimiento') },
  { value: 'adjustment', label: t('Adjustment', 'Ajuste') },
  { value: 'other', label: t('Other', 'Otro') },
])

const types = ref<Tables<'appointment_types'>[]>([])
const loading = ref(true)

const name = ref('')
const duration = ref('30')
const price = ref('')
const color = ref('#4C6FEB')
const saving = ref(false)
const error = ref('')

async function load() {
  loading.value = true
  const { data } = await supabase.from('appointment_types').select('*').order('name')
  types.value = data ?? []
  loading.value = false
}
onMounted(load)

async function addType() {
  error.value = ''
  if (!name.value.trim()) return
  saving.value = true
  const { error: insertError } = await supabase.from('appointment_types').insert({
    account_id: store.accountId!,
    name: name.value.trim(),
    duration_minutes: parseInt(duration.value, 10) || 30,
    default_price_cents: Math.round((parseFloat(price.value) || 0) * 100),
    color: color.value,
  })
  saving.value = false
  if (insertError) {
    error.value = insertError.message
    return
  }
  name.value = ''
  duration.value = '30'
  price.value = ''
  await load()
}

async function removeType(id: string) {
  if (!confirm(t('Delete this appointment type?', '¿Eliminar este tipo de cita?'))) return
  await supabase.from('appointment_types').delete().eq('id', id)
  await load()
}

async function toggleBookable(type: Tables<'appointment_types'>) {
  const next = !type.online_booking_enabled
  type.online_booking_enabled = next
  await supabase.from('appointment_types').update({ online_booking_enabled: next }).eq('id', type.id)
}

// Payment requires Stripe to be set up for the account at all (Settings >
// Payments) -- same precondition the existing card-on-file feature already
// has, so the toggle is disabled rather than silently breaking checkout.
const stripeConfigured = ref(false)
async function loadStripeConfigured() {
  const { data } = await supabase.from('accounts').select('stripe_publishable_key').eq('id', store.accountId!).maybeSingle()
  stripeConfigured.value = !!data?.stripe_publishable_key
}
onMounted(loadStripeConfigured)

async function toggleOnlinePayment(type: Tables<'appointment_types'>) {
  if (!stripeConfigured.value) return
  const next = !type.online_payment_required
  type.online_payment_required = next
  await supabase.from('appointment_types').update({ online_payment_required: next }).eq('id', type.id)
}

async function updateStage(type: Tables<'appointment_types'>, stage: string) {
  type.stage = stage || null
  await supabase.from('appointment_types').update({ stage: stage || null }).eq('id', type.id)
}

async function updateName(type: Tables<'appointment_types'>, value: string) {
  const next = value.trim()
  if (!next || next === type.name) return
  type.name = next
  await supabase.from('appointment_types').update({ name: next }).eq('id', type.id)
}

async function updateDuration(type: Tables<'appointment_types'>, value: string) {
  const next = parseInt(value, 10) || type.duration_minutes
  type.duration_minutes = next
  await supabase.from('appointment_types').update({ duration_minutes: next }).eq('id', type.id)
}

async function updatePrice(type: Tables<'appointment_types'>, value: string) {
  const next = Math.round((parseFloat(value) || 0) * 100)
  type.default_price_cents = next
  await supabase.from('appointment_types').update({ default_price_cents: next }).eq('id', type.id)
}

async function updateColor(type: Tables<'appointment_types'>, value: string) {
  type.color = value
  await supabase.from('appointment_types').update({ color: value }).eq('id', type.id)
}

// --- Per-practitioner overrides ---
// Different practitioners can need different amounts of time (or charge
// differently) for the same appointment type. Most (type, practitioner)
// pairs have no row here at all -- absence means "use this type's own
// duration/price", so the table stays sparse instead of needing one row
// per practitioner per type up front.
interface TeamMemberOption { id: string; full_name: string }
const teamMembers = ref<TeamMemberOption[]>([])
const overrides = ref<Tables<'appointment_type_overrides'>[]>([])
const openOverridesTypeId = ref<string | null>(null)

async function loadOverridesData() {
  const [{ data: members }, { data: ovr }] = await Promise.all([
    supabase.from('team_members').select('id, full_name').order('full_name'),
    supabase.from('appointment_type_overrides').select('*'),
  ])
  teamMembers.value = members ?? []
  overrides.value = ovr ?? []
}
onMounted(loadOverridesData)

function toggleOverrides(typeId: string) {
  openOverridesTypeId.value = openOverridesTypeId.value === typeId ? null : typeId
}

function overrideFor(typeId: string, teamMemberId: string) {
  return overrides.value.find((o) => o.appointment_type_id === typeId && o.team_member_id === teamMemberId) ?? null
}

async function saveOverride(typeId: string, teamMemberId: string, patch: { duration_minutes?: number | null; price_cents?: number | null }) {
  const existing = overrideFor(typeId, teamMemberId)
  const duration_minutes = 'duration_minutes' in patch ? (patch.duration_minutes ?? null) : (existing?.duration_minutes ?? null)
  const price_cents = 'price_cents' in patch ? (patch.price_cents ?? null) : (existing?.price_cents ?? null)

  if (duration_minutes === null && price_cents === null) {
    if (existing) {
      await supabase.from('appointment_type_overrides').delete().eq('id', existing.id)
      overrides.value = overrides.value.filter((o) => o.id !== existing.id)
    }
    return
  }

  if (existing) {
    await supabase.from('appointment_type_overrides').update({ duration_minutes, price_cents }).eq('id', existing.id)
    existing.duration_minutes = duration_minutes
    existing.price_cents = price_cents
  } else {
    const { data } = await supabase
      .from('appointment_type_overrides')
      .insert({ account_id: store.accountId!, appointment_type_id: typeId, team_member_id: teamMemberId, duration_minutes, price_cents })
      .select('*')
      .single()
    if (data) overrides.value.push(data)
  }
}

function updateOverrideDuration(typeId: string, teamMemberId: string, value: string) {
  const next = value.trim() === '' ? null : parseInt(value, 10)
  saveOverride(typeId, teamMemberId, { duration_minutes: Number.isFinite(next) ? next : null })
}
function updateOverridePrice(typeId: string, teamMemberId: string, value: string) {
  const next = value.trim() === '' ? null : Math.round((parseFloat(value) || 0) * 100)
  saveOverride(typeId, teamMemberId, { price_cents: next })
}
</script>

<template>
  <div class="flex h-full flex-col">
    <PageHeader :title="t('Appointment Types', 'Tipos de cita')" />
    <div class="flex-1 overflow-y-auto">
      <div class="flex gap-8 p-6">
        <SettingsNav />
        <div class="min-w-0 max-w-[1100px] flex-1">
          <p class="text-[13px] text-ink-muted2">{{ t('Visit types, durations, colors, and default price.', 'Tipos de visita, duraciones, colores y precio por defecto.') }}</p>

          <div class="mt-4 overflow-x-auto rounded-card border border-line bg-surface shadow-card">
            <table class="w-full text-[13px]">
              <thead class="border-b border-line bg-surface-subtle text-left text-[11px] font-[640] uppercase tracking-[.04em] text-ink-muted2">
                <tr>
                  <th class="w-[220px] px-4 py-2">{{ t('Name', 'Nombre') }}</th>
                  <th class="px-4 py-2">{{ t('Duration', 'Duración') }}</th>
                  <th class="px-4 py-2">{{ t('Default price', 'Precio por defecto') }}</th>
                  <th class="px-4 py-2">{{ t('Stage', 'Etapa') }}</th>
                  <th class="px-4 py-2">{{ t('Online booking', 'Reserva online') }}</th>
                  <th class="px-4 py-2">{{ t('Online payment', 'Pago online') }}</th>
                  <th class="px-4 py-2"></th>
                  <th class="px-4 py-2"></th>
                </tr>
              </thead>
              <tbody class="divide-y divide-line-row">
                <tr v-if="loading">
                  <td colspan="8" class="px-4 py-6 text-center text-ink-faint">{{ t('Loading…', 'Cargando…') }}</td>
                </tr>
                <tr v-else-if="types.length === 0">
                  <td colspan="8" class="px-4 py-6 text-center text-ink-faint">{{ t('No appointment types yet.', 'Todavía no hay tipos de cita.') }}</td>
                </tr>
                <template v-for="at in types" :key="at.id">
                <tr>
                  <td class="px-4 py-2.5 text-ink-700">
                    <div class="flex items-center gap-2">
                      <input
                        type="color"
                        :value="at.color"
                        class="h-6 w-6 shrink-0 rounded border border-line-control p-0"
                        @change="updateColor(at, ($event.target as HTMLInputElement).value)"
                      />
                      <input
                        :value="at.name"
                        type="text"
                        class="w-full min-w-[140px] rounded-ctlSm border border-transparent px-1.5 py-1 hover:border-line-control focus:border-brand focus:outline-none focus:ring-1 focus:ring-brand/20"
                        @change="updateName(at, ($event.target as HTMLInputElement).value)"
                      />
                    </div>
                  </td>
                  <td class="px-4 py-2.5 text-ink-muted2">
                    <div class="flex items-center gap-1">
                      <input
                        :value="at.duration_minutes"
                        type="number"
                        min="5"
                        step="5"
                        class="w-16 rounded-ctlSm border border-transparent px-1.5 py-1 hover:border-line-control focus:border-brand focus:outline-none focus:ring-1 focus:ring-brand/20"
                        @change="updateDuration(at, ($event.target as HTMLInputElement).value)"
                      />
                      {{ t('min', 'min') }}
                    </div>
                  </td>
                  <td class="px-4 py-2.5 text-ink-muted2">
                    <div class="flex items-center gap-1">
                      €
                      <input
                        :value="(at.default_price_cents / 100).toFixed(2)"
                        type="number"
                        min="0"
                        step="0.01"
                        class="w-20 rounded-ctlSm border border-transparent px-1.5 py-1 hover:border-line-control focus:border-brand focus:outline-none focus:ring-1 focus:ring-brand/20"
                        @change="updatePrice(at, ($event.target as HTMLInputElement).value)"
                      />
                    </div>
                  </td>
                  <td class="px-4 py-2.5">
                    <select
                      :value="at.stage ?? ''"
                      class="rounded-ctlSm border border-line-control bg-surface py-1 pl-2 pr-6 text-[12.5px] text-ink-600 focus:border-brand focus:outline-none focus:ring-1 focus:ring-brand/20"
                      @change="updateStage(at, ($event.target as HTMLSelectElement).value)"
                    >
                      <option v-for="s in STAGE_OPTIONS" :key="s.value" :value="s.value">{{ s.label }}</option>
                    </select>
                  </td>
                  <td class="px-4 py-2.5">
                    <label class="flex items-center gap-2 text-ink-600">
                      <SettingsToggle :model-value="at.online_booking_enabled" @update:model-value="toggleBookable(at)" />
                      {{ t('Bookable', 'Reservable') }}
                    </label>
                  </td>
                  <td class="px-4 py-2.5">
                    <label class="flex items-center gap-2 text-ink-600" :title="stripeConfigured ? '' : t('Set up Stripe in Settings > Payments first', 'Configura Stripe en Ajustes > Pagos primero')">
                      <SettingsToggle :model-value="at.online_payment_required" :disabled="!stripeConfigured" @update:model-value="toggleOnlinePayment(at)" />
                      {{ t('Require payment', 'Requerir pago') }}
                    </label>
                  </td>
                  <td class="px-4 py-2.5">
                    <button type="button" class="text-[12.5px] font-medium text-brand-text hover:text-brand-hover" @click="toggleOverrides(at.id)">
                      {{ t('Overrides', 'Excepciones') }}
                    </button>
                  </td>
                  <td class="px-4 py-2.5 text-right">
                    <button type="button" class="text-ink-faint hover:text-danger-text" @click="removeType(at.id)">✕</button>
                  </td>
                </tr>
                <tr v-if="openOverridesTypeId === at.id">
                  <td colspan="8" class="bg-surface-subtle px-4 py-3">
                    <p class="text-[12px] text-ink-muted2">
                      {{ t('Per-practitioner duration/price for', 'Duración/precio por profesional para') }} <span class="font-medium text-ink-700">{{ at.name }}</span> — {{ t('leave blank to use the defaults above.', 'deja en blanco para usar los valores por defecto de arriba.') }}
                    </p>
                    <div class="mt-2 space-y-1.5">
                      <div v-for="m in teamMembers" :key="m.id" class="flex items-center gap-3 text-[13px]">
                        <span class="w-40 shrink-0 truncate text-ink-700">{{ m.full_name }}</span>
                        <div class="flex items-center gap-1">
                          <input
                            :value="overrideFor(at.id, m.id)?.duration_minutes ?? ''"
                            type="number"
                            min="5"
                            step="5"
                            :placeholder="String(at.duration_minutes)"
                            class="w-16 rounded-ctlSm border border-line-control bg-surface px-1.5 py-1 focus:border-brand focus:outline-none focus:ring-1 focus:ring-brand/20"
                            @change="updateOverrideDuration(at.id, m.id, ($event.target as HTMLInputElement).value)"
                          />
                          <span class="text-ink-faint">{{ t('min', 'min') }}</span>
                        </div>
                        <div class="flex items-center gap-1">
                          <span class="text-ink-faint">€</span>
                          <input
                            :value="overrideFor(at.id, m.id)?.price_cents != null ? (overrideFor(at.id, m.id)!.price_cents! / 100).toFixed(2) : ''"
                            type="number"
                            min="0"
                            step="0.01"
                            :placeholder="(at.default_price_cents / 100).toFixed(2)"
                            class="w-20 rounded-ctlSm border border-line-control bg-surface px-1.5 py-1 focus:border-brand focus:outline-none focus:ring-1 focus:ring-brand/20"
                            @change="updateOverridePrice(at.id, m.id, ($event.target as HTMLInputElement).value)"
                          />
                        </div>
                      </div>
                      <p v-if="teamMembers.length === 0" class="text-[12.5px] text-ink-faint">{{ t('No team members yet.', 'Todavía no hay miembros del equipo.') }}</p>
                    </div>
                  </td>
                </tr>
                </template>
              </tbody>
            </table>
          </div>
          <p class="mt-2 text-[12px] text-ink-faint">
            {{ t('"Stage" lets the Statistics report count first visits, reports, revisions, etc. — pick whichever bucket each type maps to for you.', '"Etapa" permite que el informe de Estadísticas cuente primeras visitas, informes, revisiones, etc. — elige la categoría que corresponda a cada tipo.') }}
          </p>

          <form class="mt-4 flex flex-wrap items-end gap-3 rounded-card border border-line bg-surface p-4 shadow-card" @submit.prevent="addType">
            <div>
              <label class="block text-[12.5px] font-medium text-ink-600">{{ t('Name', 'Nombre') }}</label>
              <input v-model="name" type="text" required placeholder="Ajuste Quiropractico" class="mt-1 h-8 rounded-ctl border border-line-control bg-surface px-3 text-[13px] text-ink-700 focus:border-brand focus:outline-none focus:ring-1 focus:ring-brand/20" />
            </div>
            <div>
              <label class="block text-[12.5px] font-medium text-ink-600">{{ t('Duration (min)', 'Duración (min)') }}</label>
              <input v-model="duration" type="number" min="5" step="5" class="mt-1 h-8 w-24 rounded-ctl border border-line-control bg-surface px-3 text-[13px] text-ink-700 focus:border-brand focus:outline-none focus:ring-1 focus:ring-brand/20" />
            </div>
            <div>
              <label class="block text-[12.5px] font-medium text-ink-600">{{ t('Default price (€)', 'Precio por defecto (€)') }}</label>
              <input v-model="price" type="number" step="0.01" min="0" class="mt-1 h-8 w-28 rounded-ctl border border-line-control bg-surface px-3 text-[13px] text-ink-700 focus:border-brand focus:outline-none focus:ring-1 focus:ring-brand/20" />
            </div>
            <div>
              <label class="block text-[12.5px] font-medium text-ink-600">{{ t('Color', 'Color') }}</label>
              <input v-model="color" type="color" class="mt-1 h-8 w-14 rounded-ctl border border-line-control" />
            </div>
            <UiBtn variant="primary" type="submit" :disabled="saving">{{ saving ? t('Adding…', 'Añadiendo…') : t('Add Type', 'Añadir tipo') }}</UiBtn>
          </form>
          <p v-if="error" class="mt-2 text-[12.5px] text-danger-text">{{ error }}</p>
        </div>
      </div>
    </div>
  </div>
</template>
