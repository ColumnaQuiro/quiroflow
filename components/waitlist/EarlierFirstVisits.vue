<script setup lang="ts">
// "Quiere adelantar su primera visita": patients with a first visit days
// away whom the clinic will offer an earlier time by WhatsApp when one frees
// up (earlier_visit_offers; server/utils/earlierVisitOffers.ts). Shown only
// at a clinic that has it switched on (accounts.earlier_first_visit_offers),
// which is done by hand -- there is no setting for it.
//
// Nobody is added here: the database enrols every first visit booked two or
// more days ahead. The desk can take someone off, which is what the patient's
// own "No, me quedo con la mía" does.
interface Row {
  id: string
  status: 'waiting' | 'offered'
  offers_made: number
  offered_starts_at: string | null
  offer_expires_at: string | null
  appointments: {
    starts_at: string
    patients: { id: string; first_name: string; last_name: string | null } | null
    appointment_types: { name: string } | null
    team_members: { full_name: string } | null
  } | null
}

const store = useAccountStore()
const supabase = useSupabaseClient()
const t = useT()
const { showToast } = useToast()

const enabled = ref(false)
const rows = ref<Row[]>([])
const loading = ref(true)
const loadError = ref(false)

async function load() {
  loading.value = true
  const { data, error } = await supabase
    .from('earlier_visit_offers')
    .select('id, status, offers_made, offered_starts_at, offer_expires_at, appointments(starts_at, patients(id, first_name, last_name), appointment_types(name), team_members(full_name))')
    .in('status', ['waiting', 'offered'])
  loadError.value = !!error
  if (error) console.error('[waitlist] earlier first visits load error', error)
  // Soonest visit first: the ones an earlier time matters least for are last.
  else rows.value = ((data as unknown as Row[]) ?? []).sort((a, b) => (a.appointments?.starts_at ?? '').localeCompare(b.appointments?.starts_at ?? ''))
  loading.value = false
}

onMounted(async () => {
  const { data: account } = await supabase.from('accounts').select('earlier_first_visit_offers').eq('id', store.accountId!).maybeSingle()
  enabled.value = Boolean((account as { earlier_first_visit_offers?: boolean } | null)?.earlier_first_visit_offers)
  if (enabled.value) await load()
})

function patientName(row: Row) {
  const p = row.appointments?.patients
  return p ? `${p.first_name} ${p.last_name ?? ''}`.trim() : t('Unknown patient', 'Paciente desconocido')
}
function formatDate(iso: string | null | undefined) {
  if (!iso) return '—'
  return new Date(iso).toLocaleString(t('en-GB', 'es-ES'), { weekday: 'short', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })
}
function formatTime(iso: string | null) {
  if (!iso) return ''
  return new Date(iso).toLocaleTimeString(t('en-GB', 'es-ES'), { hour: '2-digit', minute: '2-digit' })
}

const removing = ref<Row | null>(null)
const removeBusy = ref(false)
async function remove() {
  const row = removing.value
  if (!row) return
  removeBusy.value = true
  const { data, error } = await supabase
    .from('earlier_visit_offers')
    .update({ status: 'declined', closed_reason: 'removed_by_staff', offered_starts_at: null, offered_ends_at: null, offer_expires_at: null, updated_at: new Date().toISOString() } as never)
    .eq('id', row.id)
    .in('status', ['waiting', 'offered'])
    .select('id')
  removeBusy.value = false
  removing.value = null
  if (error) showToast(error.message, 'error')
  else if (!data?.length) showToast(t('Not removed: their visit has just changed.', 'No se ha quitado: su cita acaba de cambiar.'), 'error')
  await load()
}
</script>

<template>
  <section v-if="enabled" aria-labelledby="h-earlier-first-visits" class="mt-6" data-cy="earlier-first-visits">
    <h2 id="h-earlier-first-visits" class="text-[15px] font-bold text-ink-900">{{ t('Want to come in sooner for their first visit', 'Quieren adelantar su primera visita') }}</h2>
    <p class="mb-3 mt-1 max-w-[70ch] text-[12.5px] leading-snug text-ink-muted">
      {{
        t(
          'First visits booked two or more days ahead. When an earlier time frees up with the same practitioner, they are offered it by WhatsApp, one at a time, at most once a day. Tapping "Yes" moves their visit.',
          'Primeras visitas reservadas a dos días vista o más. Cuando se libera un hueco antes con el mismo quiropráctico, se les ofrece por WhatsApp, de uno en uno y como mucho una vez al día. Si pulsan «Sí», su cita se mueve sola.',
        )
      }}
    </p>

    <div class="overflow-x-auto rounded-card border border-line bg-surface shadow-card">
      <p v-if="!loading && loadError" class="px-4 py-5 text-[13px] text-danger-text" data-cy="earlier-first-visits-error">
        {{ t(`Couldn't load this list. Nothing has been changed.`, 'No se ha podido cargar esta lista. No se ha cambiado nada.') }}
      </p>
      <p v-else-if="!loading && rows.length === 0" class="px-4 py-5 text-[13px] text-ink-muted" data-cy="earlier-first-visits-empty">
        {{ t('No first visits far enough ahead right now.', 'Ahora mismo no hay primeras visitas lo bastante lejanas.') }}
      </p>
      <table v-else class="w-full min-w-[640px] text-[13px]">
        <thead class="border-b border-line bg-surface-subtle text-left text-[11px] font-[640] uppercase tracking-[.07em] text-ink-muted2">
          <tr>
            <th class="px-3 py-2">{{ t('Patient', 'Paciente') }}</th>
            <th class="px-3 py-2">{{ t('Their first visit', 'Su primera visita') }}</th>
            <th class="px-3 py-2">{{ t('Status', 'Estado') }}</th>
            <th class="px-3 py-2">{{ t('Offers sent', 'Ofertas enviadas') }}</th>
            <th class="px-3 py-2" />
          </tr>
        </thead>
        <tbody class="divide-y divide-line-divider">
          <template v-if="loading">
            <tr v-for="i in 2" :key="i">
              <td class="px-3 py-2.5"><UiSkeleton class="h-3.5 w-28 rounded-ctlSm" /></td>
              <td class="px-3 py-2.5"><UiSkeleton class="h-3.5 w-32 rounded-ctlSm" /></td>
              <td class="px-3 py-2.5"><UiSkeleton class="h-5 w-16 rounded-pill" /></td>
              <td class="px-3 py-2.5"><UiSkeleton class="h-3.5 w-6 rounded-ctlSm" /></td>
              <td class="px-3 py-2.5" />
            </tr>
          </template>
          <tr v-for="row in loading ? [] : rows" :key="row.id" data-cy="earlier-first-visit-row">
            <td class="px-3 py-2">
              <NuxtLink v-if="row.appointments?.patients" :to="`/patients/${row.appointments.patients.id}`" class="whitespace-nowrap font-medium text-ink-900 hover:text-brand-text">{{ patientName(row) }}</NuxtLink>
              <span v-else class="whitespace-nowrap text-ink-900">{{ patientName(row) }}</span>
            </td>
            <td class="px-3 py-2 text-ink-muted2">
              <span class="whitespace-nowrap">{{ formatDate(row.appointments?.starts_at) }}</span>
              <span class="block text-[12px]">{{ [row.appointments?.appointment_types?.name, row.appointments?.team_members?.full_name].filter(Boolean).join(' · ') }}</span>
            </td>
            <td class="px-3 py-2">
              <UiPill v-if="row.status === 'offered'" tone="brand" class="whitespace-nowrap">{{ t('Offer sent', 'Oferta enviada') }}</UiPill>
              <UiPill v-else tone="neutral" class="whitespace-nowrap">{{ t('Waiting', 'Esperando') }}</UiPill>
              <span v-if="row.status === 'offered'" class="mt-0.5 block whitespace-nowrap text-[12px] text-ink-muted2">
                {{ formatDate(row.offered_starts_at) }} · {{ t('until', 'hasta las') }} {{ formatTime(row.offer_expires_at) }}
              </span>
            </td>
            <td class="px-3 py-2 tabular-nums text-ink-muted2">{{ row.offers_made }}</td>
            <td class="px-3 py-2 text-right">
              <UiIconBtn icon="trash" tone="danger" :label="t('Stop offering earlier times', 'No ofrecerle más huecos')" @click="removing = row" />
            </td>
          </tr>
        </tbody>
      </table>
    </div>

    <UiConfirmDialog
      v-if="removing"
      :title="t(`Stop offering ${patientName(removing)} earlier times?`, `¿Dejar de ofrecer huecos antes a ${patientName(removing)}?`)"
      :confirm-label="t('Stop', 'Dejar de ofrecer')"
      :cancel-label="t('Cancel', 'Cancelar')"
      :busy="removeBusy"
      @confirm="remove"
      @cancel="removing = null"
    />
  </section>
</template>
