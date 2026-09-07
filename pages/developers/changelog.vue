<script setup lang="ts">
definePageMeta({ layout: 'developers' })
const { useDocHead } = useDevPortal()
useDocHead('Changelog', 'Changes to the QuiroFlow API, newest first.', 'changelog')

// Newest first. Anything that would break an existing integration belongs
// under a new version, never here -- see Base URL & versioning.
const ENTRIES = [
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
      'Usage log in Settings → Developers: every API request a clinic’s tokens make, with status and duration.',
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
