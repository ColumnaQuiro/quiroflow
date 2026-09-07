<script setup lang="ts">
definePageMeta({ layout: 'developers' })
const { link, useDocHead } = useDevPortal()
useDocHead('Errors', 'Error response shape and every status code the QuiroFlow API returns.', 'errors')

const shape = `{
  "error": {
    "status": 400,
    "code": "invalid_request",
    "message": "\\"starts_at\\" must be an ISO 8601 datetime, e.g. 2026-03-14T09:30:00Z. Got \\"14/03/2026\\".",
    "field": "starts_at",
    "request_id": "d41a7c02-8b39-4e15-a6f2-0c7e5b91d834"
  }
}`

const CODES = [
  { status: '400', code: 'invalid_request', when: 'A malformed body, an unknown field, an unknown filter, or a value of the wrong type. <code>field</code> names the culprit.' },
  { status: '401', code: 'unauthorized', when: 'No token, or one that is invalid, revoked or expired.' },
  { status: '403', code: 'forbidden', when: 'Valid token, but it lacks the scope this endpoint needs. The message names the scope.' },
  { status: '404', code: 'not_found', when: 'No record with that id <em>in this account</em>. An id from another account looks identical to one that doesn’t exist.' },
  { status: '409', code: 'conflict', when: 'The write clashes with existing data — a double-booked practitioner, or a duplicate <code>external_reference</code>.' },
  { status: '429', code: 'rate_limited', when: 'Too many requests. See <em>Rate limits</em>.' },
  { status: '502', code: 'bad_gateway', when: 'A service we depend on refused — today only WhatsApp. Meta’s own message is passed through.' },
  { status: '500', code: 'server_error', when: 'Something broke on our side. Quote the <code>request_id</code>.' },
]

const retry = `async function callWithRetry(url, options, attempt = 0) {
  const res = await fetch(url, options)
  if (res.ok) return res.json()

  const body = await res.json()

  // 429 tells you exactly how long to wait — no guessing needed.
  if (res.status === 429 && attempt < 5) {
    const waitSeconds = Number(res.headers.get("Retry-After") ?? 1)
    await new Promise((r) => setTimeout(r, waitSeconds * 1000))
    return callWithRetry(url, options, attempt + 1)
  }

  // 5xx is worth retrying with backoff. 4xx is not: the same request will
  // fail the same way, so retrying just burns your rate limit.
  if (res.status >= 500 && attempt < 3) {
    await new Promise((r) => setTimeout(r, 2 ** attempt * 1000))
    return callWithRetry(url, options, attempt + 1)
  }

  throw new Error(\`\${body.error.code}: \${body.error.message} (request \${body.error.request_id})\`)
}`
</script>

<template>
  <DevportalPage title="Errors" lead="Every failure returns the same JSON shape, an HTTP status that matches, and an id you can quote.">
    <DevportalCode :code="shape" language="json" />

    <DevportalParams
      :params="[
        { name: 'error.status', type: 'integer', description: 'Mirrors the HTTP status code.' },
        { name: 'error.code', type: 'string', description: 'A stable machine-readable code. Branch on this, not on the message.' },
        { name: 'error.message', type: 'string', description: 'Written for a human debugging the call. It may change wording; don’t parse it.' },
        { name: 'error.field', type: 'string', description: 'Only on validation errors — the request field that failed.' },
        { name: 'error.request_id', type: 'uuid', description: 'Also returned as the <code>X-QuiroFlow-Request-Id</code> header. Appears in the clinic’s usage log.' },
      ]"
    />

    <h2>Codes</h2>
    <div class="my-4 overflow-hidden rounded-card border border-line">
      <table class="w-full text-[12.5px]">
        <tbody class="divide-y divide-line-row">
          <tr v-for="row in CODES" :key="row.code" class="align-top">
            <td class="w-[64px] px-3 py-2 font-mono text-[12px] text-ink-900">{{ row.status }}</td>
            <td class="w-[150px] px-3 py-2"><code class="font-mono text-[12px] text-ink-900">{{ row.code }}</code></td>
            <!-- eslint-disable-next-line vue/no-v-html -- authored copy, not user input -->
            <td class="px-3 py-2 leading-relaxed text-ink-muted2" v-html="row.when" />
          </tr>
        </tbody>
      </table>
    </div>

    <h2>Retrying</h2>
    <p>
      Retry <code>429</code> after the delay in the <code>Retry-After</code> header, and <code>5xx</code> with exponential backoff. Do not
      retry a <code>4xx</code> other than 429 — the request is wrong, so an identical retry fails identically and only consumes your rate
      limit.
    </p>
    <DevportalCode :code="retry" language="javascript" />

    <DevportalCallout>
      Log <code>request_id</code> whenever a call fails. It's the one thing that lets us find your exact request, and it turns "the API
      returned an error yesterday" into an answer instead of an investigation.
    </DevportalCallout>

    <h2>Writes and partial failure</h2>
    <p>
      Each write endpoint acts on a single record and either succeeds fully or changes nothing — there are no partial writes to unwind. What
      is <em>not</em> guaranteed is that a request which times out on your side didn't succeed on ours. For creates, set
      <code>external_reference</code> to your own identifier: a repeat with the same value returns <code>409</code> rather than creating a
      duplicate, which makes retries safe.
    </p>
    <p>
      Cancelling an appointment is idempotent — cancelling one that's already cancelled returns <code>200</code>, not an error. See
      <NuxtLink :to="link('reference')">Endpoints</NuxtLink>.
    </p>
  </DevportalPage>
</template>
