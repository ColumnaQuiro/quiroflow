<script setup lang="ts">
import type { Tables } from '~/types/database.types'

definePageMeta({ layout: 'portal' })

interface AppointmentRow {
  id: string
  starts_at: string
  status: string
  appointment_types: { name: string } | null
}

const supabase = useSupabaseClient()
const user = useSupabaseUser()

const patient = ref<Tables<'patients'> | null>(null)
const appointments = ref<AppointmentRow[]>([])
const invoices = ref<Tables<'invoices'>[]>([])
const loading = ref(true)
const loadError = ref('')

watch(
  user,
  async (currentUser) => {
    if (!currentUser) return
    loading.value = true

    const { data: p, error: patientError } = await supabase
      .from('patients')
      .select('*')
      .eq('user_id', currentUser.sub)
      .maybeSingle()
    if (patientError) loadError.value = patientError.message
    patient.value = p

    if (p) {
      const [{ data: appts }, { data: invs }] = await Promise.all([
        supabase
          .from('appointments')
          .select('id, starts_at, status, appointment_types(name)')
          .eq('patient_id', p.id)
          .gte('starts_at', new Date().toISOString())
          .order('starts_at'),
        supabase.from('invoices').select('*').eq('patient_id', p.id).order('created_at', { ascending: false }),
      ])
      appointments.value = (appts as unknown as AppointmentRow[]) ?? []
      invoices.value = invs ?? []
    }
    loading.value = false
  },
  { immediate: true },
)

const statusClass: Record<string, string> = {
  paid: 'bg-green-50 text-green-700',
  unpaid: 'bg-red-50 text-red-700',
  void: 'bg-gray-100 text-gray-500',
}
</script>

<template>
  <div v-if="loading" class="text-sm text-gray-400">Loading…</div>
  <div v-else-if="loadError" class="text-sm text-red-600">{{ loadError }}</div>
  <div v-else-if="!patient" class="text-sm text-gray-400">No patient record found.</div>
  <div v-else>
    <h1 class="text-xl font-semibold text-gray-900">Hi {{ patient.first_name }}</h1>

    <section class="mt-6">
      <h2 class="text-sm font-semibold text-gray-900">Upcoming appointments</h2>
      <div class="mt-2 overflow-hidden rounded-lg border border-gray-200 bg-white">
        <ul v-if="appointments.length > 0" class="divide-y divide-gray-100">
          <li v-for="appt in appointments" :key="appt.id" class="px-4 py-3 text-sm">
            <p class="font-medium text-gray-900">{{ new Date(appt.starts_at).toLocaleString() }}</p>
            <p class="text-gray-500">{{ appt.appointment_types?.name ?? 'Appointment' }} &middot; {{ appt.status }}</p>
          </li>
        </ul>
        <p v-else class="p-6 text-center text-sm text-gray-400">No upcoming appointments.</p>
      </div>
    </section>

    <section class="mt-6">
      <h2 class="text-sm font-semibold text-gray-900">Invoices</h2>
      <div class="mt-2 overflow-hidden rounded-lg border border-gray-200 bg-white">
        <table v-if="invoices.length > 0" class="w-full text-sm">
          <thead class="border-b border-gray-200 bg-gray-50 text-left text-xs font-medium uppercase tracking-wide text-gray-500">
            <tr>
              <th class="px-4 py-2">Date</th>
              <th class="px-4 py-2">Invoice #</th>
              <th class="px-4 py-2">Total</th>
              <th class="px-4 py-2">Status</th>
            </tr>
          </thead>
          <tbody class="divide-y divide-gray-100">
            <tr v-for="inv in invoices" :key="inv.id">
              <td class="px-4 py-2.5 text-gray-900">{{ new Date(inv.created_at).toLocaleDateString() }}</td>
              <td class="px-4 py-2.5 text-gray-500">{{ inv.invoice_number }}</td>
              <td class="px-4 py-2.5 text-gray-900">€{{ (inv.total_cents / 100).toFixed(2) }}</td>
              <td class="px-4 py-2.5">
                <span class="rounded px-1.5 py-0.5 text-xs font-medium" :class="statusClass[inv.status]">{{ inv.status }}</span>
              </td>
            </tr>
          </tbody>
        </table>
        <p v-else class="p-6 text-center text-sm text-gray-400">No invoices yet.</p>
      </div>
    </section>
  </div>
</template>
