<script setup lang="ts">
import { API_VERSION } from '~/utils/apiContract'

definePageMeta({ layout: 'developers' })
const { useDocHead } = useDevPortal()
useDocHead('Base URL & versioning', 'Where the QuiroFlow API lives and how it changes over time.', 'base-url')

const base = `https://app.quiroflow.com/api/public/${API_VERSION}`
const example = `${base}/appointments?starts_at=gte:2026-03-01T00:00:00Z`
</script>

<template>
  <DevportalPage title="Base URL & versioning" lead="One base URL for every clinic, and a stated policy on what can change under it.">
    <h2>Base URL</h2>
    <DevportalCode :code="base" />
    <p>
      Unlike some practice-management APIs, there is no per-clinic hostname and no region in the URL. Which clinic you're acting for is
      decided entirely by your token, so the same base URL works for every account and you never have to ask a clinic what their API
      address is.
    </p>
    <DevportalCode :code="example" language="Example" />

    <h2>Versioning</h2>
    <p>
      The version is in the path. <code>{{ API_VERSION }}</code> is current. Within a version these changes can happen at any time, so your
      client must tolerate them:
    </p>
    <ul>
      <li>new endpoints;</li>
      <li>new fields in a response object;</li>
      <li>new optional request fields;</li>
      <li>new values in a string field that isn't a fixed enum.</li>
    </ul>
    <p>
      In practice that means: parse JSON into a structure that ignores unknown fields, and don't assume an object has exactly the keys it
      has today.
    </p>
    <p>These will not happen inside a version — they'd ship as <code>v2</code>:</p>
    <ul>
      <li>removing or renaming a field;</li>
      <li>changing a field's type;</li>
      <li>removing an endpoint, or changing what an existing one does;</li>
      <li>adding a required request field.</li>
    </ul>

    <DevportalCallout>
      When <code>v2</code> arrives, <code>v1</code> keeps working. We'll give at least 12 months' notice before switching one off, sent to
      the contact email recorded on each token that's still calling it — which is the practical reason to fill that field in.
    </DevportalCallout>

    <h2>Response headers</h2>
    <DevportalParams
      :params="[
        { name: 'X-QuiroFlow-Request-Id', type: 'uuid', description: 'Unique to this request. It appears in the clinic’s usage log — quote it in any support email.' },
        { name: 'X-QuiroFlow-Api-Version', type: 'string', description: 'The API version that served the request.' },
        { name: 'X-RateLimit-Limit', type: 'integer', description: 'Requests allowed per window.' },
        { name: 'X-RateLimit-Remaining', type: 'integer', description: 'Requests left in the current window.' },
        { name: 'X-RateLimit-Reset', type: 'integer', description: 'Seconds until the window resets.' },
      ]"
    />

    <h2>Conventions</h2>
    <ul>
      <li><strong>Timestamps</strong> are UTC ISO 8601 (<code>2026-03-14T09:30:00.000Z</code>) everywhere, in both directions.</li>
      <li>
        <strong>Money</strong> is an integer number of cents, in fields ending <code>_cents</code>. There are no floats — <code>4500</code>
        is €45.00.
      </li>
      <li><strong>Ids</strong> are UUIDs.</li>
      <li>
        <strong>Opening hours</strong> are the one exception to UTC: they're wall-clock strings in the clinic's own timezone, which is
        returned as <code>timezone</code> on the clinic.
      </li>
      <li>Fields are <code>snake_case</code>.</li>
    </ul>
  </DevportalPage>
</template>
