<script setup lang="ts">
import type { GrowthChannelRow } from '~/composables/useGrowthDashboard'

defineProps<{ rows: GrowthChannelRow[]; totals: GrowthChannelRow }>()
const emit = defineEmits<{ saveSpend: [channel: string, amountCents: number | null] }>()

const t = useT()

// Spend is the one column on this table the clinic owns rather than reads.
// Nothing in QuiroFlow can know what was paid inside Google Ads or Meta, so
// until an importer exists this cell is where the three cost figures come
// from -- and typing in the row you are already reading beats a separate
// settings screen that has to be found first.
const editing = ref<string | null>(null)
const draft = ref('')
const saving = ref<string | null>(null)

function startEditing(row: GrowthChannelRow) {
  editing.value = row.channel
  // Euros, because that is the unit an owner thinks in; cents are this
  // file's problem, not theirs.
  draft.value = row.spendCents === null ? '' : (row.spendCents / 100).toFixed(2).replace(/\.00$/, '')
}

async function commit(channel: string) {
  const raw = draft.value.trim().replace(',', '.')
  editing.value = null

  // Empty clears it, which is not the same as zero: "we did not spend here"
  // and "we have not said" are different answers, and only the second should
  // leave the cost columns blank.
  const amountCents = raw === '' ? null : Math.round(Number(raw) * 100)
  if (amountCents !== null && (!Number.isFinite(amountCents) || amountCents < 0)) return

  saving.value = channel
  try {
    emit('saveSpend', channel, amountCents)
  } finally {
    saving.value = null
  }
}

// Money arrives already formatted from the API, which is also where the
// decision lives about whether there is a figure at all -- the euro
// formatting that used to live here moved to server/utils/leads.ts, so the
// board, the drawer and this table cannot drift apart on it.
//
// An em dash, not €0: a referral has no ad spend, and a zero would put it in
// the same column of comparison as a channel that spent nothing this month
// but could.
function money(value: string | null) {
  return value ?? '—'
}
function percent(value: number | null) {
  return value === null ? '—' : `${value}%`
}
</script>

<template>
  <section class="overflow-hidden rounded-card border border-line bg-surface shadow-card">
    <div class="flex items-baseline justify-between gap-3 px-4 pb-3 pt-4 sm:px-[18px]">
      <h2 class="text-[13.5px] font-semibold tracking-tightTitle text-ink-900">{{ t('Channels', 'Canales') }}</h2>
      <NuxtLink to="/reports" class="shrink-0 text-[11px] font-semibold text-brand-text hover:underline">
        {{ t('Full report', 'Informe completo') }} →
      </NuxtLink>
    </div>

    <div class="overflow-x-auto">
      <table class="w-full min-w-[520px] border-collapse text-[12px]">
        <thead>
          <tr class="border-b border-line-divider text-[10px] uppercase tracking-[.06em] text-ink-faint">
            <th class="px-4 pb-[7px] text-left font-normal sm:pl-[18px]">{{ t('Channel', 'Canal') }}</th>
            <th class="px-2 pb-[7px] text-right font-normal">{{ t('Spend', 'Gasto') }}</th>
            <th class="px-2 pb-[7px] text-right font-normal">{{ t('Leads', 'Contactos') }}</th>
            <th class="px-2 pb-[7px] text-right font-normal">{{ t('Booked', 'Reservas') }}</th>
            <th class="px-2 pb-[7px] text-right font-normal">{{ t('Show', 'Asist.') }}</th>
            <th class="px-4 pb-[7px] text-right font-normal sm:pr-[18px]" :title="t('Cost per new patient', 'Coste por paciente nuevo')">CPNP</th>
          </tr>
        </thead>
        <tbody>
          <tr
            v-for="(row, i) in rows"
            :key="row.channel"
            class="border-b border-line-divider text-ink-700"
            :class="i % 2 === 1 ? 'bg-surface-subtle' : ''"
          >
            <td class="px-4 py-[9px] sm:pl-[18px]">{{ row.channel }}</td>
            <td class="px-2 py-[9px] text-right">
              <input
                v-if="editing === row.channel"
                v-model="draft"
                type="text"
                inputmode="decimal"
                class="w-20 rounded-ctl border border-brand bg-surface px-1.5 py-0.5 text-right text-[12px] text-ink-700 focus:outline-none"
                :data-test="`spend-input-${row.channel}`"
                autofocus
                @keyup.enter="commit(row.channel)"
                @keyup.esc="editing = null"
                @blur="commit(row.channel)"
              />
              <button
                v-else
                type="button"
                class="rounded-ctl px-1.5 py-0.5 hover:bg-chip-bg"
                :class="row.spend === null ? 'text-ink-faint' : ''"
                :disabled="saving === row.channel"
                :data-test="`spend-cell-${row.channel}`"
                :title="t('Click to record what you spent', 'Haz clic para registrar lo que gastaste')"
                @click="startEditing(row)"
              >{{ money(row.spend) }}</button>
            </td>
            <td class="px-2 py-[9px] text-right">{{ row.leads }}</td>
            <td class="px-2 py-[9px] text-right">{{ row.booked }}</td>
            <td class="px-2 py-[9px] text-right" :class="row.showRate === null ? 'text-ink-faint' : ''">{{ percent(row.showRate) }}</td>
            <td
              class="px-4 py-[9px] text-right sm:pr-[18px]"
              :class="row.costPerNewPatient === null ? 'text-ink-faint' : 'font-semibold'"
            >{{ money(row.costPerNewPatient) }}</td>
          </tr>
          <tr class="bg-chip-bg text-[12px] font-semibold text-ink-900">
            <td class="px-4 py-2.5 sm:pl-[18px]">{{ totals.channel }}</td>
            <td class="px-2 py-2.5 text-right">{{ money(totals.spend) }}</td>
            <td class="px-2 py-2.5 text-right">{{ totals.leads }}</td>
            <td class="px-2 py-2.5 text-right">{{ totals.booked }}</td>
            <td class="px-2 py-2.5 text-right">{{ percent(totals.showRate) }}</td>
            <td class="px-4 py-2.5 text-right sm:pr-[18px]">{{ money(totals.costPerNewPatient) }}</td>
          </tr>
        </tbody>
      </table>
    </div>
  </section>
</template>
