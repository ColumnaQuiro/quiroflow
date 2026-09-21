<script setup lang="ts">
definePageMeta({ layout: 'developers' })
const { link, useDocHead } = useDevPortal()

useDocHead(
  'Introduction',
  'Build on QuiroFlow: read patients, appointments, invoices and free slots, and book appointments from your own software.',
  'introduction',
)

const quickstart = `curl https://app.quiroflow.com/api/public/v1/appointments \\
  -H "Authorization: Bearer qf_live_..."`

const CAPABILITIES = [
  {
    title: 'Book from anywhere',
    body: 'Find free slots with the availability endpoint, then create the appointment. The same practitioner hours, per-practitioner durations and double-booking checks the clinic’s own calendar applies.',
    to: 'reference',
  },
  {
    title: 'Keep records in sync',
    body: 'Read and write patients, and read invoices and payments. Store your own identifier on any record with external_reference and look it up again by that.',
    to: 'reference',
  },
  {
    title: 'React to changes',
    body: 'Subscribe a webhook endpoint and receive an HMAC-signed POST when a patient, appointment or invoice changes — instead of polling for it.',
    to: 'webhooks',
  },
]
</script>

<template>
  <DevportalPage
    title="QuiroFlow API"
    lead="A REST API over the data in a QuiroFlow clinic: patients, appointments, availability, practitioners, invoices and payments — plus webhooks and WhatsApp sending."
  >
    <p>
      The API is REST over HTTPS. Requests and responses are JSON, timestamps are UTC ISO 8601, and money is always an integer number of
      cents. You can use it from any language with an HTTP client.
    </p>

    <DevportalCode :code="quickstart" language="curl" />

    <h2>What you can build</h2>
    <div class="mt-3 grid gap-3 sm:grid-cols-3">
      <NuxtLink
        v-for="item in CAPABILITIES"
        :key="item.title"
        :to="link(item.to)"
        class="block rounded-card border border-line bg-surface p-4 no-underline shadow-card transition hover:border-line-controlHover"
      >
        <p class="text-[13.5px] font-[560] text-ink-900">{{ item.title }}</p>
        <p class="mt-1.5 text-[12.5px] leading-relaxed text-ink-muted2">{{ item.body }}</p>
      </NuxtLink>
    </div>

    <h2>Getting started</h2>
    <ol>
      <li>
        In QuiroFlow, go to <strong>Settings → Developers</strong> and create a token, choosing the scopes your integration needs. The token
        is shown once.
      </li>
      <li>
        Send it on every request as <code>Authorization: Bearer &lt;token&gt;</code> — see
        <NuxtLink :to="link('authentication')">Authentication</NuxtLink>.
      </li>
      <li>
        Call an endpoint. <NuxtLink :to="link('reference')">Endpoints</NuxtLink> lists every one, and the machine-readable
        <a href="/api/public/v1/openapi.json">OpenAPI spec</a> will generate a client for you.
      </li>
    </ol>

    <DevportalCallout tone="warning">
      A token acts for a whole clinic account and is not tied to a member of staff. Anyone holding it can read patient data and book
      appointments as that clinic, so treat it like a password: keep it server-side, never ship it in a mobile app or front-end bundle, and
      revoke it the moment it might have leaked.
    </DevportalCallout>

    <h2>What this API does not do yet</h2>
    <p>
      Being explicit about the edges saves you finding them the hard way. In v1 there is no access to clinical notes, patient documents or
      uploaded files; no writing of invoices, payments or refunds; and no endpoints for packages, memberships or care plans. Reading is
      broad, writing is limited to patients and appointments.
    </p>
    <p>
      If your integration needs one of those, say what you're building — the ordering is driven by what people are actually blocked on.
    </p>

    <h2>Getting help</h2>
    <p>
      Email <a href="mailto:hola@quiroflow.com">hola@quiroflow.com</a>. Every response carries an
      <code>X-QuiroFlow-Request-Id</code> header — quoting it lets us find the exact request in the clinic's log, which turns most questions
      into a one-message answer.
    </p>
  </DevportalPage>
</template>
