<script setup lang="ts">
const sections = [
  { to: '/settings/clinics', label: 'Clinics', description: 'Locations your practice operates from.' },
  { to: '/settings/team', label: 'Team Members', description: 'Staff accounts, roles, and invites.' },
  { to: '/settings/practitioners', label: 'Practitioners', description: 'Link migrated practitioner names to real accounts, or invite them.' },
  { to: '/settings/appointment-types', label: 'Appointment Types', description: 'Visit types, durations, colors, default price.' },
  { to: '/billing/services', label: 'Services & Products', description: 'What you bill for.' },
  { to: '/settings/rooms', label: 'Calendar Resources', description: 'Rooms used for scheduling per clinic.' },
  { to: '/settings/packages', label: 'Packages / Bonos', description: 'Session bundle templates you can sell to patients.' },
  { to: '/settings/memberships', label: 'Memberships', description: 'Recurring plan templates for patients.' },
  { to: '/settings/whatsapp', label: 'WhatsApp', description: 'Webhook and message templates for recalls and confirmations.' },
  { to: '/settings/payments', label: 'Payments (Stripe)', description: 'Automate package installments and membership renewals with a saved card.' },
  { to: '/settings/docs', label: 'Docs', description: 'Reusable document templates with patient field placeholders.' },
  { to: '/settings/import', label: 'Import Patients (CSV)', description: 'Migrate patient records from another system.' },
  { to: '/settings/migrate-attachments', label: 'Migrate Attachments', description: 'Pull the real file content over from PracticeHub after importing the attachment list.' },
  { to: '/settings/webhooks', label: 'Webhooks', description: 'Subscribe an endpoint to patient, appointment, and invoice events.' },
]
</script>

<template>
  <div class="flex gap-8">
    <SettingsNav />
    <div class="min-w-0 flex-1">
      <h1 class="text-xl font-semibold text-gray-900">Settings</h1>
      <p class="mt-1 text-sm text-gray-500">Manage how your clinic runs in QuiroFlow — pick a section from the left, or below.</p>

      <div class="mt-6 divide-y divide-gray-200 overflow-hidden rounded-lg border border-gray-200 bg-white">
        <NuxtLink v-for="s in sections" :key="s.to" :to="s.to" class="flex items-center justify-between gap-4 px-4 py-3.5 hover:bg-gray-50">
          <div class="min-w-0">
            <p class="text-sm font-medium text-gray-900">{{ s.label }}</p>
            <p class="mt-0.5 truncate text-sm text-gray-500">{{ s.description }}</p>
          </div>
          <svg class="h-4 w-4 shrink-0 text-gray-300" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2">
            <path stroke-linecap="round" stroke-linejoin="round" d="M9 5l7 7-7 7" />
          </svg>
        </NuxtLink>
      </div>
    </div>
  </div>
</template>
