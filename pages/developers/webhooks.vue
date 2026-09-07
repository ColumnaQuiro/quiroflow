<script setup lang="ts">
definePageMeta({ layout: 'developers' })
const { link, useDocHead } = useDevPortal()
useDocHead('Webhooks', 'Receive signed HTTP callbacks when patients, appointments and invoices change.', 'webhooks')

const EVENTS = [
  { event: 'patient.created', fires: 'A patient record is created — in the app, through the API, or by an online booking.' },
  { event: 'patient.updated', fires: 'Any field on a patient changes. Saves that change nothing are not delivered.' },
  { event: 'patient.deleted', fires: 'A patient is deleted. <code>data</code> holds the record as it was.' },
  { event: 'appointment.created', fires: 'An appointment is booked, from any source.' },
  { event: 'appointment.updated', fires: 'An appointment is rescheduled, reassigned, or has its status changed — including cancellation, and including the API’s <code>DELETE</code>, which cancels rather than removes.' },
  { event: 'appointment.deleted', fires: 'An appointment is deleted from the calendar. Deletion is reversible in QuiroFlow, so you’ll also receive an <code>appointment.updated</code> if you subscribe to both — treat <code>appointment.deleted</code> as the authoritative one.' },
  { event: 'appointment.checked_in', fires: 'A patient is checked in for their appointment.' },
  { event: 'invoice.paid', fires: 'An invoice moves into <code>paid</code>. Only on that transition, not on every edit of a paid invoice.' },
]

const payload = `POST /your-endpoint HTTP/1.1
Content-Type: application/json
X-QuiroFlow-Event: appointment.created
X-QuiroFlow-Signature: 9f86d081884c7d659a2feaa0c55ad015a3bf4f1b2b0b822cd15d6c15b0f00a08

{
  "event": "appointment.created",
  "created_at": "2026-03-14T09:31:02.481Z",
  "data": {
    "id": "c3a91f52-...",
    "account_id": "0b7e2d18-...",
    "patient_id": "6f2b1e2a-...",
    "starts_at": "2026-03-20T10:00:00+00:00",
    "ends_at": "2026-03-20T10:30:00+00:00",
    "status": "booked"
  }
}`

const node = `import crypto from "node:crypto"
import express from "express"

const app = express()

// The signature covers the RAW bytes. Parse the JSON only after verifying —
// re-serialising a parsed object changes whitespace and key order, and the
// digest will never match.
app.post("/webhooks/quiroflow", express.raw({ type: "application/json" }), (req, res) => {
  const expected = crypto.createHmac("sha256", process.env.QUIROFLOW_WEBHOOK_SECRET)
    .update(req.body)
    .digest("hex")

  const received = req.get("X-QuiroFlow-Signature") ?? ""

  // Constant-time compare: a plain === leaks how much of the signature was
  // right through its timing, which is enough to forge one byte at a time.
  const ok =
    received.length === expected.length &&
    crypto.timingSafeEqual(Buffer.from(received), Buffer.from(expected))

  if (!ok) return res.status(401).end()

  const { event, data } = JSON.parse(req.body.toString("utf8"))
  handle(event, data)          // queue it — don't do the work here
  res.status(200).end()        // acknowledge fast
})`

const python = `import hmac, hashlib, os
from flask import Flask, request, abort

app = Flask(__name__)
SECRET = os.environ["QUIROFLOW_WEBHOOK_SECRET"].encode()

@app.post("/webhooks/quiroflow")
def quiroflow_webhook():
    # request.get_data() is the raw body — request.json would re-serialise.
    expected = hmac.new(SECRET, request.get_data(), hashlib.sha256).hexdigest()
    received = request.headers.get("X-QuiroFlow-Signature", "")

    if not hmac.compare_digest(expected, received):
        abort(401)

    payload = request.get_json()
    handle(payload["event"], payload["data"])
    return "", 200`

const php = `<?php
$secret   = getenv('QUIROFLOW_WEBHOOK_SECRET');
$raw      = file_get_contents('php://input');
$received = $_SERVER['HTTP_X_QUIROFLOW_SIGNATURE'] ?? '';

$expected = hash_hmac('sha256', $raw, $secret);

if (!hash_equals($expected, $received)) {
    http_response_code(401);
    exit;
}

$payload = json_decode($raw, true);
handle($payload['event'], $payload['data']);
http_response_code(200);`
</script>

<template>
  <DevportalPage
    title="Webhooks"
    lead="Register an endpoint and QuiroFlow POSTs to it when something changes — instead of you polling to find out."
  >
    <p>
      Set them up in QuiroFlow under <strong>Settings → Webhooks</strong>: give a URL, tick the events you want, and you'll be given a
      signing secret. Each endpoint keeps a delivery log there, which is the first place to look when something isn't arriving.
    </p>

    <h2>Events</h2>
    <div class="my-4 overflow-hidden rounded-card border border-line">
      <table class="w-full text-[12.5px]">
        <tbody class="divide-y divide-line-row">
          <tr v-for="row in EVENTS" :key="row.event" class="align-top">
            <td class="w-[38%] px-3 py-2"><code class="font-mono text-[12px] text-ink-900">{{ row.event }}</code></td>
            <!-- eslint-disable-next-line vue/no-v-html -- authored copy, not user input -->
            <td class="px-3 py-2 leading-relaxed text-ink-muted2" v-html="row.fires" />
          </tr>
        </tbody>
      </table>
    </div>

    <h2>What a delivery looks like</h2>
    <DevportalCode :code="payload" language="http" />

    <DevportalParams
      title="Headers and body"
      :params="[
        { name: 'X-QuiroFlow-Event', type: 'string', description: 'The event name, also repeated in the body.' },
        { name: 'X-QuiroFlow-Signature', type: 'string', description: 'Hex-encoded HMAC-SHA256 of the raw request body, keyed with your endpoint’s secret.' },
        { name: 'event', type: 'string', description: 'Which event this is.' },
        { name: 'created_at', type: 'timestamp', description: 'When it happened.' },
        { name: 'data', type: 'object', description: 'The affected row. This is the <em>database</em> row, which is a wider shape than the REST resource of the same name — treat unknown fields as internal and don’t depend on them.' },
      ]"
    />

    <DevportalCallout tone="warning">
      Anyone who learns your endpoint URL can POST to it. Verifying the signature is what separates a real delivery from a forged one — if
      you skip it, anything on the internet can create appointments in your system. Never act on an unverified payload.
    </DevportalCallout>

    <h2>Verifying the signature</h2>
    <p>
      Compute HMAC-SHA256 over the <strong>raw request body</strong> using your endpoint's secret, hex-encode it, and compare it to the
      header in constant time.
    </p>

    <h3>Node.js</h3>
    <DevportalCode :code="node" language="javascript" />

    <h3>Python</h3>
    <DevportalCode :code="python" language="python" />

    <h3>PHP</h3>
    <DevportalCode :code="php" language="php" />

    <h2>Writing a good receiver</h2>
    <ul>
      <li>
        <strong>Verify before parsing.</strong> Both mistakes below produce a signature that never matches: parsing the JSON first and
        re-serialising it, or letting a body-parser middleware consume the raw bytes.
      </li>
      <li>
        <strong>Return 200 immediately.</strong> Acknowledge, then do the work on a queue. A handler that spends ten seconds calling
        another API before responding will eventually time out.
      </li>
      <li>
        <strong>Be idempotent.</strong> Assume a delivery can arrive more than once and key your processing on
        <code>data.id</code> plus <code>created_at</code>.
      </li>
      <li>
        <strong>Don't trust the payload as the current state.</strong> It's a snapshot of one moment. If exact current state matters, read
        the record back through the API.
      </li>
    </ul>

    <h2>Delivery guarantees</h2>
    <DevportalCallout>
      Be aware of the current limits before you design around webhooks. Delivery is <strong>at-most-once</strong>: a POST is attempted when
      the event happens and <strong>is not retried</strong> if your endpoint is down or returns an error. The delivery log in Settings →
      Webhooks records what was sent, not whether it arrived.
    </DevportalCallout>
    <p>
      So for anything where a missed event would be costly, pair webhooks with a periodic reconciliation pass over the API — webhooks for
      latency, a sweep for completeness. Retries with backoff are planned; until they ship, don't treat a webhook as the only path for
      critical data.
    </p>

    <h2>Webhooks or polling?</h2>
    <p>
      Use <strong>webhooks</strong> when you need to react quickly and the work is event-shaped — sending a message when an appointment is
      booked, updating a CRM when a patient's details change.
    </p>
    <p>
      Use <strong>polling</strong> when you need completeness, are behind a firewall that can't accept inbound requests, or are doing bulk
      work like a nightly export. See <NuxtLink :to="link('filtering')">Filtering &amp; sorting</NuxtLink> for filtering by
      <code>created_at</code>, and mind the <NuxtLink :to="link('rate-limits')">rate limit</NuxtLink>.
    </p>
    <p>Most solid integrations use both.</p>
  </DevportalPage>
</template>
