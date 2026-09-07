<script setup lang="ts">
import { API_SCOPES } from '~/utils/apiContract'

definePageMeta({ layout: 'developers' })
const { link, useDocHead } = useDevPortal()

useDocHead('Authentication', 'Authenticate with a scoped bearer token created in Settings → Developers.', 'authentication')

// Read from the same list the server authorises against, so a scope added to
// the API can't be missing from the page that documents them.
const scopeGroups = computed(() => {
  const groups = new Map<string, typeof API_SCOPES[number][]>()
  for (const scope of API_SCOPES) {
    groups.set(scope.group, [...(groups.get(scope.group) ?? []), scope])
  }
  return [...groups.entries()]
})

const request = `curl https://app.quiroflow.com/api/public/v1/patients \\
  -H "Authorization: Bearer qf_live_9c4f2a1b8e7d..." \\
  -H "Content-Type: application/json"`

const unauthorized = `{
  "error": {
    "status": 401,
    "code": "unauthorized",
    "message": "Missing bearer token. Send it as \\"Authorization: Bearer qf_live_…\\".",
    "request_id": "0f3c1e64-9a2b-4d51-8f7e-1c9b0a4d2e63"
  }
}`

const forbidden = `{
  "error": {
    "status": 403,
    "code": "forbidden",
    "message": "This token is missing the \\"appointments:write\\" scope. Add it in QuiroFlow under Settings → Developers.",
    "request_id": "7b2d90a1-4e63-4f28-9c5a-3d81e6f04b17"
  }
}`
</script>

<template>
  <DevportalPage
    title="Authentication"
    lead="Every request carries a bearer token. The token identifies one clinic account and the set of things it is allowed to do."
  >
    <p>
      Create a token in QuiroFlow under <strong>Settings → Developers</strong>. It's generated in your browser and we only ever store its
      SHA-256 hash, so it's shown once at creation and cannot be retrieved afterwards — if you lose it, revoke it and make another.
    </p>

    <DevportalCode :code="request" language="curl" />

    <p>
      All requests must use HTTPS. A request without a valid token is refused; there is no anonymous access to any endpoint except the
      <a href="/api/public/v1/openapi.json">OpenAPI spec</a> itself.
    </p>

    <h2>Scopes</h2>
    <p>
      A token carries only the scopes selected when it was created. Pick the narrowest set that does the job — a scheduling integration
      that never touches money has no reason to hold <code>billing:read</code>, and a token that can't read invoices can't leak them.
    </p>

    <div v-for="[group, scopes] in scopeGroups" :key="group" class="mt-4">
      <p class="text-[12.5px] font-[560] text-ink-700">{{ group }}</p>
      <div class="mt-1.5 overflow-hidden rounded-card border border-line">
        <table class="w-full text-[12.5px]">
          <tbody class="divide-y divide-line-row">
            <tr v-for="scope in scopes" :key="scope.key">
              <td class="w-[34%] px-3 py-2"><code class="font-mono text-[12px] text-ink-900">{{ scope.key }}</code></td>
              <td class="px-3 py-2 text-ink-muted2">{{ scope.en }}</td>
            </tr>
          </tbody>
        </table>
      </div>
    </div>

    <p>
      Calling an endpoint without its scope returns <code>403</code> and names the scope you're missing, so you can fix it without guessing:
    </p>
    <DevportalCode :code="forbidden" language="json" />

    <h2>Account scoping</h2>
    <p>
      A token belongs to exactly one clinic account and every response is already limited to that account's data. You never pass an account
      id, and there is no way to widen the scope of a request. An id belonging to another account behaves exactly as an id that doesn't
      exist — a <code>404</code>, never a <code>403</code>, so the API can't be used to probe whether a record exists elsewhere.
    </p>

    <h2>Identifying your integration</h2>
    <p>
      When you create a token you can record an <strong>app name</strong> and a <strong>contact email</strong>. These aren't sent on
      requests — they're stored with the token so the clinic can see which integration a token belongs to in their usage log, and so we
      have someone to contact if it starts misbehaving. Fill them in; a clinic staring at three unnamed tokens will revoke all of them.
    </p>

    <h2>Failure responses</h2>
    <p>A missing, invalid, revoked or expired token all return <code>401</code>:</p>
    <DevportalCode :code="unauthorized" language="json" />
    <p>
      See <NuxtLink :to="link('errors')">Errors</NuxtLink> for the full response shape and every code the API returns.
    </p>

    <h2>If a token leaks</h2>
    <p>
      Revoke it in <strong>Settings → Developers</strong>. Revocation takes effect on the very next request — there's no cache to wait out.
      Then create a replacement and deploy it. The usage log shows what the old token did while it was live, which is what you'll want when
      working out the blast radius.
    </p>
  </DevportalPage>
</template>
