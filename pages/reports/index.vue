<script setup lang="ts">
const sections = [
  { to: '/reports/scheduled-reminders', label: 'Scheduled Reminders', description: 'WhatsApp delivery status (sent/delivered/failed) and who has confirmed, is pending, or wants to reschedule.' },
  { to: '/reports/statistics', label: 'Statistics', description: 'First visits, reports, revisions, PVA, conversion, and retention.' },
  { to: '/reports/upcoming-visits', label: 'Upcoming Visits', description: 'How appointments are distributed across the month — plan ad spend and predict how the month will close.' },
  { to: '/reports/appointment-distribution', label: 'Appointment Distribution', description: 'Which shift/time of day performs best, by volume and completion rate.' },
  { to: '/reports/data-exports', label: 'Data Exports', description: 'Patients missing an email, phone, consent form, or data protection form; patients per practitioner.' },
  { to: '/reports/income', label: 'Income & Payments', description: 'Revenue by day/week/month/year, by payment method, by practitioner, and by visit type.' },
  { to: '/reports/income-performance', label: 'Income Performance', description: 'Compare practitioners and months side by side, with growth curves.' },
  { to: '/reports/debtors', label: 'Debtors', description: 'Package/bono purchases with no paid invoice, and how much is outstanding.' },
  { to: '/reports/memberships', label: 'Memberships', description: 'Active membership count, monthly revenue, and failed payments.' },
  { to: '/reports/custom', label: 'Custom Reports', description: 'Build and save your own report: pick a data source, a metric, and a chart.' },
]
</script>

<template>
  <div>
    <h1 class="text-xl font-semibold text-gray-900">Reports</h1>
    <p class="mt-1 text-sm text-gray-500">Metrics across patients, appointments, and billing.</p>
    <div class="mt-6 grid grid-cols-1 gap-4 sm:grid-cols-2">
      <NuxtLink
        v-for="s in sections"
        :key="s.to"
        :to="s.to"
        class="rounded-lg border border-gray-200 bg-white p-4 hover:border-indigo-300 hover:shadow-sm"
      >
        <p class="font-medium text-gray-900">{{ s.label }}</p>
        <p class="mt-1 text-sm text-gray-500">{{ s.description }}</p>
      </NuxtLink>
    </div>
  </div>
</template>
