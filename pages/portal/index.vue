<script setup lang="ts">
// The web half of the patient app. Renders the same shared components as
// mobile/components/PatientHome.vue -- before this the two showed disjoint
// sets (the portal had invoices and nothing else, mobile had everything
// but), so what a patient could see depended on which one they opened.
definePageMeta({ layout: 'portal' })

const supabase = useSupabaseClient()
const user = useSupabaseUser()
const t = useT()
const { settings } = usePatientAppInfo()

const patient = ref<{ id: string; first_name: string } | null>(null)
const loading = ref(true)
const loadError = ref('')

watch(
  user,
  async (currentUser) => {
    if (!currentUser) return
    loading.value = true
    const { data, error } = await supabase.from('patients').select('id, first_name').eq('user_id', currentUser.sub).maybeSingle()
    if (error) loadError.value = error.message
    patient.value = data
    loading.value = false
  },
  { immediate: true },
)

// No slot picker on the web side yet -- the booking flow lives in the
// mobile app. Rather than show a Reschedule button that leads nowhere,
// the portal passes no bookHref and tells the patient where to go.
const showMessages = ref(false)
</script>

<template>
  <div v-if="loading">
    <UiSkeleton class="h-6 w-40 rounded-ctlSm" />
    <div class="mt-6 space-y-2">
      <UiSkeleton class="h-4 w-48 rounded-ctlSm" />
      <div class="overflow-hidden rounded-card border border-line bg-surface">
        <div v-for="i in 2" :key="i" class="space-y-1.5 border-b border-line px-4 py-3 last:border-0">
          <UiSkeleton class="h-3.5 w-40 rounded-ctlSm" />
          <UiSkeleton class="h-3 w-24 rounded-ctlSm" />
        </div>
      </div>
    </div>
  </div>
  <div v-else-if="loadError" class="text-sm text-danger-text">{{ loadError }}</div>
  <div v-else-if="!patient" class="text-sm text-ink-faint">{{ t('No patient record found.', 'No se encontró tu ficha de paciente.') }}</div>
  <div v-else class="space-y-6">
    <h1 class="text-xl font-semibold text-ink-900">{{ t(`Hi ${patient.first_name}`, `Hola ${patient.first_name}`) }}</h1>

    <PatientAppointmentsCard :patient-id="patient.id" :settings="settings" />
    <PatientBalanceCard :patient-id="patient.id" />
    <PatientInvoicesCard :patient-id="patient.id" />
    <PatientFilesCard :patient-id="patient.id" />

    <section>
      <div class="flex items-center justify-between">
        <h2 class="text-[13px] font-semibold text-ink-700">{{ t('Messages', 'Mensajes') }}</h2>
        <button type="button" class="text-[12.5px] font-medium text-brand-text" @click="showMessages = !showMessages">
          {{ showMessages ? t('Hide', 'Ocultar') : t('Open', 'Abrir') }}
        </button>
      </div>
      <div v-if="showMessages" class="mt-2 overflow-hidden rounded-card border border-line bg-surface">
        <PatientMessagesPanel :patient-id="patient.id" height="26rem" />
      </div>
    </section>
  </div>
</template>
