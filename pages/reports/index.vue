<script setup lang="ts">
const ICONS = {
  bell: 'M14.857 17.082a23.848 23.848 0 005.454-1.31A8.967 8.967 0 0118 9.75v-.7V9A6 6 0 006 9v.75a8.967 8.967 0 01-2.312 6.022c1.733.64 3.56 1.085 5.455 1.31m5.714 0a24.255 24.255 0 01-5.714 0m5.714 0a3 3 0 11-5.714 0',
  calendar: 'M8 7V3m8 4V3m-9 8h10M5 21h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z',
  squares:
    'M3.75 6A2.25 2.25 0 016 3.75h2.25A2.25 2.25 0 0110.5 6v2.25a2.25 2.25 0 01-2.25 2.25H6a2.25 2.25 0 01-2.25-2.25V6zM3.75 15.75A2.25 2.25 0 016 13.5h2.25a2.25 2.25 0 012.25 2.25V18a2.25 2.25 0 01-2.25 2.25H6A2.25 2.25 0 013.75 18v-2.25zM13.5 6a2.25 2.25 0 012.25-2.25H18A2.25 2.25 0 0120.25 6v2.25A2.25 2.25 0 0118 10.5h-2.25a2.25 2.25 0 01-2.25-2.25V6zM13.5 15.75a2.25 2.25 0 012.25-2.25H18a2.25 2.25 0 012.25 2.25V18A2.25 2.25 0 0118 20.25h-2.25A2.25 2.25 0 0113.5 18v-2.25z',
  chartBar:
    'M3 13.125C3 12.504 3.504 12 4.125 12h2.25c.621 0 1.125.504 1.125 1.125v6.75C7.5 20.496 6.996 21 6.375 21h-2.25A1.125 1.125 0 013 19.875v-6.75zM9.75 8.625c0-.621.504-1.125 1.125-1.125h2.25c.621 0 1.125.504 1.125 1.125v11.25c0 .621-.504 1.125-1.125 1.125h-2.25a1.125 1.125 0 01-1.125-1.125V8.625zM16.5 4.125c0-.621.504-1.125 1.125-1.125h2.25C20.496 3 21 3.504 21 4.125v15.75c0 .621-.504 1.125-1.125 1.125h-2.25a1.125 1.125 0 01-1.125-1.125V4.125z',
  trendingUp: 'M2.25 18L9 11.25l4.306 4.306a11.95 11.95 0 015.814-5.518l2.74-1.22m0 0l-5.94-2.28m5.94 2.28l-2.28 5.941',
  billing: 'M3 10h18M7 15h1m4 0h1m-7 4h12a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z',
  exclamationTriangle:
    'M12 9v3.75m-9.303 3.376c-.866 1.5.217 3.374 1.948 3.374h14.71c1.73 0 2.813-1.874 1.948-3.374L13.949 3.378c-.866-1.5-3.032-1.5-3.898 0L2.697 16.126zM12 15.75h.007v.008H12v-.008z',
  badgeCheck:
    'M9 12.75L11.25 15 15 9.75m-3-7.036A11.959 11.959 0 013.598 6 11.99 11.99 0 003 9.749c0 5.592 3.824 10.29 9 11.623 5.176-1.332 9-6.03 9-11.622 0-1.31-.21-2.571-.598-3.751h-.152c-3.196 0-6.1-1.248-8.25-3.285z',
  arrowDownTray: 'M3 16.5v2.25A2.25 2.25 0 005.25 21h13.5A2.25 2.25 0 0021 18.75V16.5M16.5 12L12 16.5m0 0L7.5 12m4.5 4.5V3',
  adjustments:
    'M10.5 6h9.75M10.5 6a1.5 1.5 0 11-3 0m3 0a1.5 1.5 0 10-3 0M3.75 6H7.5m3 12h9.75m-9.75 0a1.5 1.5 0 01-3 0m3 0a1.5 1.5 0 00-3 0m-3.75 0H7.5m9-6h3.75m-3.75 0a1.5 1.5 0 01-3 0m3 0a1.5 1.5 0 00-3 0m-9.75 0h9.75',
}

const groups = [
  {
    label: 'Operations',
    items: [
      { to: '/reports/scheduled-reminders', label: 'Scheduled Reminders', description: 'WhatsApp delivery status and who has confirmed, is pending, or wants to reschedule.', icon: ICONS.bell },
      { to: '/reports/upcoming-visits', label: 'Upcoming Visits', description: 'How appointments are distributed across the month.', icon: ICONS.calendar },
      { to: '/reports/appointment-distribution', label: 'Appointment Distribution', description: 'Which shift/time of day performs best, by volume and completion.', icon: ICONS.squares },
    ],
  },
  {
    label: 'Growth & Performance',
    items: [
      { to: '/reports/statistics', label: 'Statistics', description: 'First visits, reports, revisions, PVA, conversion, and retention.', icon: ICONS.chartBar },
      { to: '/reports/income-performance', label: 'Income Performance', description: 'Compare practitioners and months side by side, with growth curves.', icon: ICONS.trendingUp },
    ],
  },
  {
    label: 'Financial',
    items: [
      { to: '/reports/income', label: 'Income & Payments', description: 'Revenue by day/week/month/year, payment method, practitioner, visit type.', icon: ICONS.billing },
      { to: '/reports/debtors', label: 'Debtors', description: 'Package/bono purchases with no paid invoice, and how much is outstanding.', icon: ICONS.exclamationTriangle },
      { to: '/reports/memberships', label: 'Memberships', description: 'Active membership count, monthly revenue, and failed payments.', icon: ICONS.badgeCheck },
    ],
  },
  {
    label: 'Data',
    items: [
      { to: '/reports/data-exports', label: 'Data Exports', description: 'Patients missing an email, phone, or a consent/data protection form.', icon: ICONS.arrowDownTray },
      { to: '/reports/custom', label: 'Custom Reports', description: 'Build and save your own report: source, metric, and chart.', icon: ICONS.adjustments },
    ],
  },
]
</script>

<template>
  <div>
    <h1 class="text-xl font-semibold text-gray-900">Reports</h1>
    <p class="mt-1 text-sm text-gray-500">Metrics across patients, appointments, and billing.</p>
    <div class="mt-8">
      <IconLinkGrid :groups="groups" />
    </div>
  </div>
</template>
