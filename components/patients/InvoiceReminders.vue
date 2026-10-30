<script setup lang="ts">
// Payment reminders for this patient (the invoice.overdue automations): on
// unless paused here, and when they were last sent one. Paused for a payment
// plan agreed at the desk, a family that settles monthly -- anyone the
// automatic message would only annoy. patients.invoice_reminders_paused.
const props = defineProps<{ patientId: string; canEdit: boolean }>()
const supabase = useSupabaseClient()
const t = useT()
const paused = ref(false)
const last = ref<{ sent_at: string; invoice_number: string } | null>(null)
const anyRule = ref(false)
const ready = ref(false)
const saving = ref(false)

onMounted(async () => {
  const [{ data: p }, { data: sends }, { count }] = await Promise.all([
    supabase.from('patients').select('invoice_reminders_paused').eq('id', props.patientId).maybeSingle(),
    supabase.from('automation_invoice_sends').select('sent_at, invoices!inner(invoice_number, patient_id)').eq('invoices.patient_id', props.patientId).order('sent_at', { ascending: false }).limit(1),
    supabase.from('automation_rules').select('id', { count: 'exact', head: true }).eq('trigger_event', 'invoice.overdue').eq('enabled', true),
  ])
  paused.value = !!(p as { invoice_reminders_paused?: boolean } | null)?.invoice_reminders_paused
  const s = ((sends ?? []) as unknown as { sent_at: string; invoices: { invoice_number: string } }[])[0]
  last.value = s ? { sent_at: s.sent_at, invoice_number: s.invoices.invoice_number } : null
  anyRule.value = (count ?? 0) > 0
  ready.value = true
})

async function toggle() {
  if (!props.canEdit || saving.value) return
  saving.value = true
  const next = !paused.value
  const { error } = await supabase.from('patients').update({ invoice_reminders_paused: next } as never).eq('id', props.patientId)
  saving.value = false
  if (!error) paused.value = next
}
const when = (iso: string) => new Date(iso).toLocaleDateString(t('en-GB', 'es-ES'), { day: 'numeric', month: 'short', year: 'numeric' })
</script>

<template>
  <div v-if="ready && anyRule" class="mt-3 flex flex-wrap items-center gap-x-3 gap-y-1 border-t border-line-row pt-3 text-[12.5px]" data-cy="invoice-reminders">
    <span class="font-medium text-ink-700">{{ t('Payment reminders', 'Recordatorios de pago') }}</span>
    <button
      type="button"
      role="switch"
      :aria-checked="!paused"
      :disabled="!canEdit || saving"
      class="relative h-5 w-9 shrink-0 rounded-full transition-colors disabled:opacity-50"
      :class="paused ? 'bg-line-control' : 'bg-brand'"
      data-cy="invoice-reminders-switch"
      @click="toggle"
    >
      <span class="absolute top-0.5 h-4 w-4 rounded-full bg-surface shadow left-0.5 transition-transform" :class="paused ? 'translate-x-0' : 'translate-x-4'" />
    </button>
    <span :class="paused ? 'text-warning-text' : 'text-ink-muted2'" data-cy="invoice-reminders-state">{{ paused ? t('Paused for this patient', 'Pausados para este paciente') : t('On', 'Activados') }}</span>
    <span v-if="last" class="text-ink-muted2" data-cy="invoice-reminders-last">· {{ t(`Last sent ${when(last.sent_at)} (${last.invoice_number})`, `Último enviado el ${when(last.sent_at)} (${last.invoice_number})`) }}</span>
  </div>
</template>
