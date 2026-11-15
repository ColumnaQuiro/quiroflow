<script setup lang="ts">
definePageMeta({ layout: 'developers' })
const { useDocHead } = useDevPortal()
useDocHead('Changelog', 'Changes to the QuiroFlow API, newest first.', 'changelog')

// Newest first. Anything that would break an existing integration belongs
// under a new version, never here -- see Base URL & versioning.
const ENTRIES = [
  {
    date: '2026-11-13',
    version: 'v1',
    title: 'Booking rules, phone numbers and webhook payloads',
    changes: [
      'POST and PATCH /appointments refuse blocked time — a closure, a public holiday, a practitioner’s leave — and a room already taken, with 409, as GET /availability already left that time out.',
      'Cancelling through the API (DELETE, or PATCH to status cancelled) runs what a patient cancelling runs: the clinic’s cancellation automations, and the freed time offered to the waiting list.',
      'A duplicate external_reference on an appointment, or on a patient update, is a 409 instead of a 500.',
      'POST /patients reads phone_country_code as a two-letter country (ES) and defaults to the clinic’s own; local numbers were refused before. A dial code (+34) is still accepted.',
      'preferred_language accepts ca and fr as well as es and en.',
      'from and to on a list endpoint are refused with 400 instead of being ignored; filter on starts_at or created_at instead.',
      'A page past the last one returns an empty page instead of a 500.',
      'POST /whatsapp/send refuses a patient_id that is not one of the clinic’s patients.',
      'Webhook payloads carry the fields the REST resource publishes, and no internal or clinical fields. patient.updated is no longer sent for a change only to those.',
    ],
  },
  {
    date: '2026-10-11',
    version: 'v1',
    title: 'Waiting list and bookings from elsewhere',
    // One item, not two: a two-string array reads to scripts/i18n-extract.mjs
    // as an [English, Spanish] pair, and this portal is English only.
    changes: [
      'DELETE /appointments offers the freed time to the waiting list when the clinic offers it automatically; and appointments.source can also be waitlist (a patient taking an offered slot) or receptionist (the AI receptionist).',
    ],
  },
  {
    date: '2026-10-03',
    version: 'v1',
    title: 'Practitioners at their own clinics',
    changes: ['A practitioner can only be booked at a clinic they work at (Settings → Team → Clinics), as GET /availability already offered.'],
  },
  {
    date: '2026-09-30',
    version: 'v1',
    title: 'One booking per slot',
    changes: [
      'The double-booking check and the write are one step, across every clinic of the account, so two parallel calls for one slot cannot both succeed; and an appointment booked through the API sends the patient the same confirmation an online booking does.',
    ],
  },
  {
    date: '2026-09-25',
    version: 'v1',
    title: 'Archived clinics and appointment types',
    changes: ['Archived clinics and appointment types are left out of the lists and cannot be booked.'],
  },
  {
    date: '2026-09-14',
    version: 'v1',
    title: 'Leads',
    changes: [
      'POST /leads and the leads:write scope, for ad platforms and forms to post enquiries in, idempotent on external_id; and the whatsapp:webhook scope, for a forwarder relaying WhatsApp’s webhook to QuiroFlow.',
    ],
  },
  {
    date: '2026-09-07',
    version: 'v1.0.0',
    title: 'The API and this portal',
    changes: [
      'Read endpoints for patients, appointments, practitioners, clinics, appointment types, services, invoices and payments.',
      'Availability: free bookable slots, applying the same practitioner hours and durations as the clinic’s own booking page.',
      'Write endpoints for patients (create, update) and appointments (book, reschedule, cancel).',
      'Scoped tokens. Tokens now carry per-resource scopes instead of granting everything, and can be given an app name, a contact and an expiry.',
      'Rate limiting at 120 requests per minute per token, with X-RateLimit-* headers on every response.',
      'A consistent error envelope with a stable code, the offending field, and a request id that appears in the clinic’s usage log.',
      'Usage log in Settings → Developers → API & Tokens: the most recent API requests a clinic’s tokens made, with status and duration.',
      'A public OpenAPI 3.1 description at /api/public/v1/openapi.json.',
      'GET /patients/lookup now shares the same rate limiting, usage logging and error envelope as everything else. Its success response is unchanged; only its error bodies now use the standard shape.',
    ],
  },
  {
    date: '2026-09-05',
    version: '—',
    title: 'Patient lookup',
    changes: [
      'GET /patients/lookup, to check whether a lead is already a patient by email or phone.',
      'The patients:read scope, granted to tokens created from then on.',
    ],
  },
  {
    date: '2026-08-14',
    version: '—',
    title: 'WhatsApp sending',
    changes: [
      'POST /whatsapp/send, the first public endpoint, authenticated with a bearer token.',
      'Its camelCase fields (patientId, templateName, templateLanguage) still work; the snake_case spellings documented today are the preferred form.',
    ],
  },
]
</script>

<template>
  <DevportalPage title="Changelog" lead="What changed in the API, newest first. Breaking changes ship as a new version, never here.">
    <div class="space-y-8">
      <section v-for="entry in ENTRIES" :key="entry.date">
        <div class="flex flex-wrap items-baseline gap-2.5">
          <h2 class="!mt-0 text-[16px] font-[600] text-ink-900">{{ entry.title }}</h2>
          <UiPill v-if="entry.version !== '—'" tone="brand">{{ entry.version }}</UiPill>
          <time class="text-[12.5px] text-ink-faint">{{ entry.date }}</time>
        </div>
        <ul class="mt-2.5 space-y-1.5 pl-4 text-[13.5px] leading-relaxed text-ink-muted2" style="list-style: disc">
          <li v-for="change in entry.changes" :key="change">{{ change }}</li>
        </ul>
      </section>
    </div>
  </DevportalPage>
</template>
