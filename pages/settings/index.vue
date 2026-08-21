<script setup lang="ts">
const ICONS = {
  building: 'M2.25 21h19.5m-18-18v18m10.5-18v18m6-13.5V21M6.75 6.75h.75m-.75 3h.75m-.75 3h.75m3-6h.75m-.75 3h.75m-.75 3h.75M6.75 21v-3.375c0-.621.504-1.125 1.125-1.125h2.25c.621 0 1.125.504 1.125 1.125V21',
  users:
    'M18 18.72a9.094 9.094 0 003.741-.479 3 3 0 00-4.682-2.72m.94 3.198l.001.031c0 .225-.012.447-.037.666A11.944 11.944 0 0112 21c-2.17 0-4.207-.576-5.963-1.584A6.062 6.062 0 016 18.719m12 0a5.971 5.971 0 00-.941-3.197m0 0A5.995 5.995 0 0012 12.75a5.995 5.995 0 00-5.058 2.772m0 0a3 3 0 00-4.681 2.72 8.986 8.986 0 003.74.477m.94-3.197a5.971 5.971 0 00-.94 3.197M15 6.75a3 3 0 11-6 0 3 3 0 016 0zm6 3a2.25 2.25 0 11-4.5 0 2.25 2.25 0 014.5 0zm-13.5 0a2.25 2.25 0 11-4.5 0 2.25 2.25 0 014.5 0z',
  userCircle:
    'M17.982 18.725A7.488 7.488 0 0012 15.75a7.488 7.488 0 00-5.982 2.975m11.963 0a9 9 0 10-11.963 0m11.963 0A8.966 8.966 0 0112 21a8.966 8.966 0 01-5.982-2.275M15 9.75a3 3 0 11-6 0 3 3 0 016 0z',
  tag: 'M9.568 3H5.25A2.25 2.25 0 003 5.25v4.318c0 .597.237 1.17.659 1.591l9.581 9.581c.699.699 1.78.872 2.607.33a18.095 18.095 0 005.223-5.223c.542-.827.369-1.908-.33-2.607L11.16 3.66A2.25 2.25 0 009.568 3zM6 6h.008v.008H6V6z',
  calendar: 'M8 7V3m8 4V3m-9 8h10M5 21h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z',
  shoppingBag:
    'M15.75 10.5V6a3.75 3.75 0 10-7.5 0v4.5m11.356-1.993l1.263 12c.07.665-.45 1.243-1.119 1.243H4.25a1.125 1.125 0 01-1.12-1.243l1.264-12A1.125 1.125 0 015.513 7.5h12.974c.576 0 1.059.435 1.119 1.007z',
  gift: 'M21 11.25v8.25a1.5 1.5 0 01-1.5 1.5H4.5a1.5 1.5 0 01-1.5-1.5v-8.25M12 4.875A2.625 2.625 0 109.375 7.5H12m0-2.625V7.5m0-2.625A2.625 2.625 0 1114.625 7.5H12m0 0V21m-8.25-13.5h16.5a1.125 1.125 0 011.125 1.125v1.5a1.125 1.125 0 01-1.125 1.125H3.75a1.125 1.125 0 01-1.125-1.125v-1.5A1.125 1.125 0 013.75 7.5z',
  badgeCheck:
    'M9 12.75L11.25 15 15 9.75m-3-7.036A11.959 11.959 0 013.598 6 11.99 11.99 0 003 9.749c0 5.592 3.824 10.29 9 11.623 5.176-1.332 9-6.03 9-11.622 0-1.31-.21-2.571-.598-3.751h-.152c-3.196 0-6.1-1.248-8.25-3.285z',
  creditCard:
    'M2.25 8.25h19.5M2.25 9h19.5m-16.5 5.25h6m-6 2.25h3m-3.75 3h15a2.25 2.25 0 002.25-2.25V6.75A2.25 2.25 0 0019.5 4.5h-15a2.25 2.25 0 00-2.25 2.25v10.5A2.25 2.25 0 004.5 19.5z',
  chatBubble:
    'M8.625 12a.375.375 0 11-.75 0 .375.375 0 01.75 0zM12.375 12a.375.375 0 11-.75 0 .375.375 0 01.75 0zM16.125 12a.375.375 0 11-.75 0 .375.375 0 01.75 0zM21 12c0 4.556-4.03 8.25-9 8.25-1.09 0-2.134-.175-3.107-.497l-4.418 1.259a.75.75 0 01-.927-.928l1.26-4.418A8.987 8.987 0 013 12c0-4.556 4.03-8.25 9-8.25s9 3.694 9 8.25z',
  documentText:
    'M19.5 14.25v-2.625a3.375 3.375 0 00-3.375-3.375h-1.5A1.125 1.125 0 0113.5 7.125v-1.5a3.375 3.375 0 00-3.375-3.375H8.25m6.75 12l-3-3m0 0l-3 3m3-3v6m-1.5-15H5.625c-.621 0-1.125.504-1.125 1.125v17.25c0 .621.504 1.125 1.125 1.125h12.75c.621 0 1.125-.504 1.125-1.125V11.25a9 9 0 00-9-9z',
  arrowDownTray: 'M3 16.5v2.25A2.25 2.25 0 005.25 21h13.5A2.25 2.25 0 0021 18.75V16.5M16.5 12L12 16.5m0 0L7.5 12m4.5 4.5V3',
  paperClip:
    'M18.375 12.739l-7.693 7.693a4.5 4.5 0 01-6.364-6.364l10.94-10.94A3 3 0 1119.5 7.372L8.552 18.32m.009-.01l-.01.01m5.699-9.941l-7.81 7.81a1.5 1.5 0 002.112 2.13',
  bolt: 'M3.75 13.5l10.5-11.25L12 10.5h8.25L9.75 21.75 12 13.5H3.75z',
  lockClosed:
    'M16.5 10.5V6.75a4.5 4.5 0 10-9 0v3.75m-.75 11.25h10.5a2.25 2.25 0 002.25-2.25v-6.75a2.25 2.25 0 00-2.25-2.25H6.75a2.25 2.25 0 00-2.25 2.25v6.75a2.25 2.25 0 002.25 2.25z',
}

const groups = [
  {
    label: 'Clinic',
    items: [
      { to: '/settings/clinics', label: 'Clinics', description: 'Locations your practice operates from.', icon: ICONS.building },
      { to: '/settings/team', label: 'Team Members', description: 'Staff accounts, roles, and invites.', icon: ICONS.users },
      { to: '/settings/practitioners', label: 'Practitioners', description: 'Link migrated names to real accounts, or invite them.', icon: ICONS.userCircle },
      { to: '/settings/roles', label: 'Roles & Permissions', description: 'Control what each role can see and do.', icon: ICONS.lockClosed },
      { to: '/settings/appointment-types', label: 'Appointment Types', description: 'Visit types, durations, colors, default price.', icon: ICONS.tag },
      { to: '/settings/rooms', label: 'Calendar Resources', description: 'Rooms used for scheduling per clinic.', icon: ICONS.calendar },
      { to: '/settings/referral-sources', label: 'Referral Sources', description: 'The options on a patient\'s referral source field.', icon: ICONS.tag },
    ],
  },
  {
    label: 'Billing',
    items: [
      { to: '/billing/services', label: 'Services & Products', description: 'What you bill for.', icon: ICONS.shoppingBag },
      { to: '/settings/packages', label: 'Packages / Bonos', description: 'Session bundle templates you can sell to patients.', icon: ICONS.gift },
      { to: '/settings/memberships', label: 'Memberships', description: 'Recurring plan templates for patients.', icon: ICONS.badgeCheck },
      { to: '/settings/payments', label: 'Payments (Stripe)', description: 'Automate installments and renewals with a saved card.', icon: ICONS.creditCard },
    ],
  },
  {
    label: 'Communication',
    items: [
      { to: '/settings/whatsapp', label: 'WhatsApp', description: 'Webhook and message templates for recalls and confirmations.', icon: ICONS.chatBubble },
      { to: '/settings/docs', label: 'Docs', description: 'Reusable document templates with patient field placeholders.', icon: ICONS.documentText },
    ],
  },
  {
    label: 'Data',
    items: [
      { to: '/settings/import', label: 'Import Patients (CSV)', description: 'Migrate patient records from another system.', icon: ICONS.arrowDownTray },
      { to: '/settings/migrate-attachments', label: 'Migrate Attachments', description: 'Pull the real file content over from PracticeHub.', icon: ICONS.paperClip },
      { to: '/settings/webhooks', label: 'Webhooks', description: 'Subscribe an endpoint to patient, appointment, and invoice events.', icon: ICONS.bolt },
    ],
  },
]
</script>

<template>
  <div>
    <h1 class="text-xl font-semibold text-gray-900">Settings</h1>
    <p class="mt-1 text-sm text-gray-500">Manage how your clinic runs in QuiroFlow.</p>
    <div class="mt-8">
      <IconLinkGrid :groups="groups" />
    </div>
  </div>
</template>
