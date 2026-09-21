<script setup lang="ts">
import { RATE_LIMIT_REQUESTS, RATE_LIMIT_WINDOW_SECONDS } from '~/utils/apiContract'

definePageMeta({ layout: 'developers' })
const { link, useDocHead } = useDevPortal()
useDocHead('Rate limits', `The QuiroFlow API allows ${RATE_LIMIT_REQUESTS} requests per ${RATE_LIMIT_WINDOW_SECONDS} seconds per token.`, 'rate-limits')

const headers = `HTTP/1.1 200 OK
X-RateLimit-Limit: ${RATE_LIMIT_REQUESTS}
X-RateLimit-Remaining: 94
X-RateLimit-Reset: 38`

const limited = `HTTP/1.1 429 Too Many Requests
Retry-After: 12

{
  "error": {
    "status": 429,
    "code": "rate_limited",
    "message": "Rate limit of ${RATE_LIMIT_REQUESTS} requests per ${RATE_LIMIT_WINDOW_SECONDS}s exceeded. Retry in 12s.",
    "request_id": "5e8c3a71-2f4d-4b90-8a16-7d2c0e9f5b43"
  }
}`
</script>

<template>
  <DevportalPage
    :title="'Rate limits'"
    :lead="`${RATE_LIMIT_REQUESTS} requests per ${RATE_LIMIT_WINDOW_SECONDS} seconds, counted per token.`"
  >
    <p>
      The limit is per token, not per IP and not per clinic — two integrations at the same clinic each get their own budget, and one
      misbehaving script can't starve the other.
    </p>

    <h2>Headers</h2>
    <p>Every response tells you where you stand, so you can pace yourself instead of discovering the limit by hitting it:</p>
    <DevportalCode :code="headers" language="http" />

    <DevportalParams
      :params="[
        { name: 'X-RateLimit-Limit', type: 'integer', description: 'Requests allowed per window.' },
        { name: 'X-RateLimit-Remaining', type: 'integer', description: 'Requests left in the current window.' },
        { name: 'X-RateLimit-Reset', type: 'integer', description: 'Seconds until the window resets and the allowance returns to full.' },
      ]"
    />

    <h2>When you exceed it</h2>
    <DevportalCode :code="limited" language="http" />
    <p>
      <code>Retry-After</code> is the number of seconds to wait. Honour it rather than retrying immediately — a tight retry loop against a
      rate limit just keeps you at the limit. There's a worked retry helper on the
      <NuxtLink :to="link('errors')">Errors</NuxtLink> page.
    </p>

    <h2>Staying under it</h2>
    <ul>
      <li>
        <strong>Ask for more per request.</strong> <code>page_size=100</code> fetches a hundred records for one request. Fetching them one
        id at a time costs a hundred.
      </li>
      <li>
        <strong>Filter server-side.</strong> Narrowing with <NuxtLink :to="link('filtering')">filters</NuxtLink> is free; downloading
        everything and filtering in your own code is not.
      </li>
      <li>
        <strong>Use webhooks instead of polling.</strong> A job polling every 10 seconds spends most of its budget confirming nothing
        changed. See <NuxtLink :to="link('webhooks')">Webhooks</NuxtLink>.
      </li>
      <li>
        <strong>Spread bulk work.</strong> A nightly sync of a large clinic should pace itself across the window rather than firing
        everything at once.
      </li>
    </ul>

    <DevportalCallout>
      Building something that genuinely needs a higher limit? Email <a href="mailto:hola@quiroflow.com">hola@quiroflow.com</a> with
      what you're doing and the shape of the traffic. The limit is a default, not a hard ceiling.
    </DevportalCallout>
  </DevportalPage>
</template>
