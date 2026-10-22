<script setup lang="ts">
import type { Tables } from '~/types/database.types'
import { formatEur } from '~/utils/billing'
import { THIRD_PARTY_KINDS, eurosToCents, thirdPartyKindLabel, type ThirdPartyKind } from '~/utils/thirdParties'

// Insurers (mutuas), medico-legal schemes and companies the clinic bills on a
// patient's behalf (20261022201348). A third party that patients are covered
// by, or that has been charged, is retired rather than deleted -- the
// database refuses the delete, and the statement of a past month still has to
// name it.
//
// Rates are optional: what this third party pays for a type of visit, and the
// copago the patient adds. They only fill in the amounts when a visit is
// charged; both can be changed there.

type ThirdParty = Tables<'third_parties'>
type Rate = Tables<'third_party_rates'>

const supabase = useSupabaseClient()
const store = useAccountStore()
const t = useT()
const { showToast } = useToast()

const thirdParties = ref<ThirdParty[]>([])
const rates = ref<Rate[]>([])
const types = ref<{ id: string; name: string; default_price_cents: number }[]>([])
const loading = ref(true)

async function load() {
  const [{ data: tps }, { data: rs }, { data: ats }] = await Promise.all([
    supabase.from('third_parties').select('*').order('name'),
    supabase.from('third_party_rates').select('*'),
    supabase.from('appointment_types').select('id, name, default_price_cents').is('archived_at', null).order('sort_order').order('name'),
  ])
  thirdParties.value = tps ?? []
  rates.value = rs ?? []
  types.value = ats ?? []
  loading.value = false
}
onMounted(load)

const active = computed(() => thirdParties.value.filter((tp) => tp.active))
const retired = computed(() => thirdParties.value.filter((tp) => !tp.active))
const ratesFor = (id: string) => rates.value.filter((r) => r.third_party_id === id)
const typeName = (id: string) => types.value.find((ty) => ty.id === id)?.name ?? '—'

// --- editing ---

interface Draft {
  id: string | null
  name: string
  kind: ThirdPartyKind
  tax_id: string
  address: string
  email: string
  phone: string
  contact_name: string
  notes: string
}
const blank = (): Draft => ({ id: null, name: '', kind: 'insurer', tax_id: '', address: '', email: '', phone: '', contact_name: '', notes: '' })
const draft = ref<Draft | null>(null)
const saving = ref(false)
const formError = ref('')

function edit(tp: ThirdParty | null) {
  formError.value = ''
  draft.value = tp
    ? {
        id: tp.id,
        name: tp.name,
        kind: tp.kind as ThirdPartyKind,
        tax_id: tp.tax_id ?? '',
        address: tp.address ?? '',
        email: tp.email ?? '',
        phone: tp.phone ?? '',
        contact_name: tp.contact_name ?? '',
        notes: tp.notes ?? '',
      }
    : blank()
}

async function save() {
  if (!draft.value) return
  formError.value = ''
  const d = draft.value
  if (!d.name.trim()) {
    formError.value = t('A name is required.', 'El nombre es obligatorio.')
    return
  }
  const row = {
    name: d.name.trim(),
    kind: d.kind,
    tax_id: d.tax_id.trim() || null,
    address: d.address.trim() || null,
    email: d.email.trim() || null,
    phone: d.phone.trim() || null,
    contact_name: d.contact_name.trim() || null,
    notes: d.notes.trim() || null,
  }
  saving.value = true
  const { error } = d.id
    ? await supabase.from('third_parties').update(row).eq('id', d.id)
    : await supabase.from('third_parties').insert({ ...row, account_id: store.accountId! })
  saving.value = false
  if (error) {
    formError.value = error.code === '23505' ? t('There is already a third party with that name.', 'Ya hay un tercero con ese nombre.') : error.message
    return
  }
  draft.value = null
  await load()
}

async function setActive(tp: ThirdParty, value: boolean) {
  const { error } = await supabase.from('third_parties').update({ active: value }).eq('id', tp.id)
  if (error) return showToast(error.message, 'error')
  tp.active = value
}

async function remove(tp: ThirdParty) {
  const { error } = await supabase.from('third_parties').delete().eq('id', tp.id)
  if (error) {
    // 23503: patients are covered by it, or it has been charged.
    showToast(
      error.code === '23503'
        ? t('It is in use by patients or charges. Retire it instead.', 'Lo usan pacientes o cargos. Retíralo en su lugar.')
        : error.message,
      'error',
    )
    return
  }
  await load()
}

// --- rates ---

const rateTypeId = ref<Record<string, string>>({})
const ratePays = ref<Record<string, string>>({})
const rateCopay = ref<Record<string, string>>({})

async function addRate(tp: ThirdParty) {
  const typeId = rateTypeId.value[tp.id]
  const pays = eurosToCents(ratePays.value[tp.id])
  const copay = eurosToCents(rateCopay.value[tp.id]) ?? 0
  if (!typeId || pays === null || pays < 0 || copay < 0) return
  const { error } = await supabase
    .from('third_party_rates')
    .upsert({ account_id: store.accountId!, third_party_id: tp.id, appointment_type_id: typeId, pays_cents: pays, copay_cents: copay }, { onConflict: 'third_party_id,appointment_type_id' })
  if (error) return showToast(error.message, 'error')
  rateTypeId.value[tp.id] = ''
  ratePays.value[tp.id] = ''
  rateCopay.value[tp.id] = ''
  await load()
}

async function removeRate(r: Rate) {
  const { error } = await supabase.from('third_party_rates').delete().eq('id', r.id)
  if (error) return showToast(error.message, 'error')
  await load()
}

const input = 'h-9 touch:h-11 w-full rounded-ctl border border-line-control bg-surface px-3 text-[14px] text-ink-900 focus:border-brand focus:outline-none focus:ring-1 focus:ring-brand'
const label = 'block text-[12.5px] font-medium text-ink-700'
</script>

<template>
  <div class="flex h-full flex-col">
    <PageHeader :title="t('Third parties', 'Terceros')">
      <UiBtn variant="primary" data-cy="tp-new" @click="edit(null)">{{ t('New third party', 'Nuevo tercero') }}</UiBtn>
    </PageHeader>
    <div class="flex-1 overflow-y-auto">
      <div class="flex gap-8 p-4 pb-24 sm:px-6 sm:pt-6 lg:pb-6">
        <SettingsNav />
        <div class="flex min-w-0 max-w-[820px] flex-1 flex-col gap-4" data-cy="settings-list" :data-ready="loading ? undefined : 'true'">
          <p class="text-[13.5px] text-ink-muted">
            {{
              t(
                'Insurance companies, medico-legal schemes and companies you bill on behalf of patients. What they owe never counts as the patient\'s debt.',
                'Aseguradoras, mutuas, casos médico-legales y empresas a las que facturas en nombre de los pacientes. Lo que deben nunca cuenta como deuda del paciente.',
              )
            }}
          </p>

          <form v-if="draft" class="space-y-3 rounded-card border border-line bg-surface p-4 shadow-card" data-cy="tp-form" @submit.prevent="save">
            <h2 class="text-[16px] font-bold text-ink-900">{{ draft.id ? t('Edit third party', 'Editar tercero') : t('New third party', 'Nuevo tercero') }}</h2>
            <div class="grid gap-3 sm:grid-cols-2">
              <div>
                <label :class="label" for="tp-name">{{ t('Name', 'Nombre') }}</label>
                <input id="tp-name" v-model="draft.name" data-cy="tp-name" :class="input" type="text" />
              </div>
              <div>
                <label :class="label" for="tp-kind">{{ t('Type', 'Tipo') }}</label>
                <select id="tp-kind" v-model="draft.kind" data-cy="tp-kind" :class="input">
                  <option v-for="k in THIRD_PARTY_KINDS" :key="k" :value="k">{{ thirdPartyKindLabel(k, t) }}</option>
                </select>
              </div>
              <div>
                <label :class="label" for="tp-tax">{{ t('CIF / NIF', 'CIF / NIF') }}</label>
                <input id="tp-tax" v-model="draft.tax_id" data-cy="tp-tax-id" :class="input" type="text" />
              </div>
              <div>
                <label :class="label" for="tp-email">{{ t('Email', 'Email') }}</label>
                <input id="tp-email" v-model="draft.email" :class="input" type="email" />
              </div>
              <div class="sm:col-span-2">
                <label :class="label" for="tp-address">{{ t('Address', 'Dirección') }}</label>
                <input id="tp-address" v-model="draft.address" :class="input" type="text" />
              </div>
              <div>
                <label :class="label" for="tp-contact">{{ t('Contact', 'Persona de contacto') }}</label>
                <input id="tp-contact" v-model="draft.contact_name" :class="input" type="text" />
              </div>
              <div>
                <label :class="label" for="tp-phone">{{ t('Phone', 'Teléfono') }}</label>
                <input id="tp-phone" v-model="draft.phone" :class="input" type="tel" />
              </div>
              <div class="sm:col-span-2">
                <label :class="label" for="tp-notes">{{ t('Notes', 'Notas') }}</label>
                <textarea id="tp-notes" v-model="draft.notes" rows="2" class="w-full rounded-ctl border border-line-control bg-surface px-3 py-2 text-[14px] text-ink-900 focus:border-brand focus:outline-none" />
              </div>
            </div>
            <div class="flex items-center gap-2">
              <UiBtn type="submit" variant="primary" data-cy="tp-save" :disabled="saving">{{ saving ? t('Saving…', 'Guardando…') : t('Save', 'Guardar') }}</UiBtn>
              <UiBtn type="button" @click="draft = null">{{ t('Cancel', 'Cancelar') }}</UiBtn>
              <p v-if="formError" class="text-[12.5px] font-semibold text-danger-text">{{ formError }}</p>
            </div>
          </form>

          <template v-if="loading">
            <UiSkeleton v-for="i in 3" :key="i" class="h-16 w-full rounded-card" />
          </template>
          <p v-else-if="active.length === 0 && !draft" class="rounded-card border border-line bg-surface px-[18px] py-6 text-center text-[14px] text-ink-muted">
            {{ t('No third parties yet.', 'Aún no hay terceros.') }}
          </p>

          <section v-for="tp in active" :key="tp.id" class="overflow-hidden rounded-card border border-line bg-surface" data-cy="tp-row">
            <div class="flex flex-wrap items-center gap-3 px-[18px] py-3">
              <div class="min-w-0 flex-1">
                <strong class="text-[15px] text-ink-900" data-cy="tp-row-name">{{ tp.name }}</strong>
                <p class="text-[12.5px] text-ink-muted">
                  {{ thirdPartyKindLabel(tp.kind, t) }}<span v-if="tp.tax_id"> · {{ tp.tax_id }}</span><span v-if="tp.email"> · {{ tp.email }}</span>
                </p>
              </div>
              <UiBtn @click="edit(tp)">{{ t('Edit', 'Editar') }}</UiBtn>
              <UiBtn @click="setActive(tp, false)">{{ t('Retire', 'Retirar') }}</UiBtn>
            </div>
            <div class="border-t border-line-row bg-surface-subtle px-[18px] py-3">
              <p class="text-[12.5px] font-medium text-ink-700">{{ t('Rates by type of visit', 'Tarifas por tipo de visita') }}</p>
              <ul v-if="ratesFor(tp.id).length" class="mt-1.5 space-y-1 text-[13px]">
                <li v-for="r in ratesFor(tp.id)" :key="r.id" class="flex items-center gap-2" data-cy="tp-rate">
                  <span class="flex-1 text-ink-700">{{ typeName(r.appointment_type_id) }}</span>
                  <span class="text-ink-muted">{{ t('pays', 'paga') }} <span class="font-mono text-ink-900">{{ formatEur(r.pays_cents) }}</span></span>
                  <span class="text-ink-muted">· {{ t('copago', 'copago') }} <span class="font-mono text-ink-900">{{ formatEur(r.copay_cents) }}</span></span>
                  <button type="button" class="text-ink-faint hover:text-danger-text" :aria-label="t('Remove rate', 'Quitar tarifa')" @click="removeRate(r)">✕</button>
                </li>
              </ul>
              <form class="mt-2 flex flex-wrap items-end gap-2" @submit.prevent="addRate(tp)">
                <select v-model="rateTypeId[tp.id]" :aria-label="t('Type of visit', 'Tipo de visita')" class="h-9 rounded-ctl border border-line-control bg-surface px-2 text-[13px] text-ink-700">
                  <option :value="undefined" disabled>{{ t('Type of visit', 'Tipo de visita') }}</option>
                  <option v-for="ty in types" :key="ty.id" :value="ty.id">{{ ty.name }}</option>
                </select>
                <input v-model="ratePays[tp.id]" type="text" inputmode="decimal" :placeholder="t('Pays €', 'Paga €')" :aria-label="t('Third party pays (€)', 'Paga el tercero (€)')" class="h-9 w-24 rounded-ctl border border-line-control bg-surface px-2 text-[13px]" />
                <input v-model="rateCopay[tp.id]" type="text" inputmode="decimal" :placeholder="t('Copago €', 'Copago €')" :aria-label="t('Patient pays (€)', 'Paga el paciente (€)')" class="h-9 w-24 rounded-ctl border border-line-control bg-surface px-2 text-[13px]" />
                <UiBtn type="submit" :disabled="!rateTypeId[tp.id] || !ratePays[tp.id]">{{ t('Add rate', 'Añadir tarifa') }}</UiBtn>
              </form>
            </div>
          </section>

          <section v-if="retired.length" class="overflow-hidden rounded-card border border-line bg-surface">
            <h2 class="px-[18px] pb-2 pt-4 text-[16px] font-bold text-ink-900">{{ t(`Retired · ${retired.length}`, `Retirados · ${retired.length}`) }}</h2>
            <div v-for="tp in retired" :key="tp.id" class="flex items-center gap-3 border-t border-line-row px-[18px] py-2.5">
              <span class="flex-1 text-[14px] text-ink-500">{{ tp.name }}</span>
              <UiBtn @click="setActive(tp, true)">{{ t('Use again', 'Volver a usar') }}</UiBtn>
              <UiBtn @click="remove(tp)">{{ t('Delete', 'Eliminar') }}</UiBtn>
            </div>
          </section>
        </div>
      </div>
    </div>
  </div>
</template>
