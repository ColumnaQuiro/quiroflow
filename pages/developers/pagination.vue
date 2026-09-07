<script setup lang="ts">
import { DEFAULT_PAGE_SIZE, MAX_PAGE_SIZE } from '~/utils/apiContract'

definePageMeta({ layout: 'developers' })
const { link, useDocHead } = useDevPortal()
useDocHead('Pagination', 'How to page through list endpoints on the QuiroFlow API.', 'pagination')

const response = `{
  "total_entries": 412,
  "data": [
    { "id": "6f2b1e2a-...", "first_name": "María", "last_name": "Ferrer", ... },
    { "id": "b81c7d40-...", "first_name": "Andrés", "last_name": "Gil", ... }
  ],
  "links": {
    "previous": null,
    "self": "https://app.quiroflow.com/api/public/v1/patients?page=1",
    "next": "https://app.quiroflow.com/api/public/v1/patients?page=2"
  }
}`

const loop = `let url = "https://app.quiroflow.com/api/public/v1/patients?page_size=100"
const patients = []

while (url) {
  const res = await fetch(url, { headers: { Authorization: \`Bearer \${TOKEN}\` } })
  if (!res.ok) throw new Error(\`\${res.status} \${res.headers.get("X-QuiroFlow-Request-Id")}\`)

  const page = await res.json()
  patients.push(...page.data)

  // Follow the link rather than incrementing a counter: it already carries
  // every filter and sort you sent.
  url = page.links.next
}`
</script>

<template>
  <DevportalPage title="Pagination" lead="Every list endpoint is paginated, and every page tells you how to get the next one.">
    <p>
      Requests that return multiple records come back wrapped in an envelope with the total count, the records, and links. The default page
      size is <code>{{ DEFAULT_PAGE_SIZE }}</code>.
    </p>

    <DevportalCode :code="response" language="json" />

    <DevportalParams
      title="Response envelope"
      :params="[
        { name: 'total_entries', type: 'integer', description: 'Total records matching your filters across <em>all</em> pages — not the number in this one.' },
        { name: 'data', type: 'array', description: 'The records on this page.' },
        { name: 'links.self', type: 'string', description: 'This page.' },
        { name: 'links.next', type: 'string | null', description: '<code>null</code> on the last page. This is your loop condition.' },
        { name: 'links.previous', type: 'string | null', description: '<code>null</code> on the first page.' },
      ]"
    />

    <h2>Parameters</h2>
    <DevportalParams
      :params="[
        { name: 'page', type: 'integer', description: 'Page number, 1-based. Defaults to <code>1</code>.' },
        {
          name: 'page_size',
          type: 'integer',
          description: `Records per page. Defaults to <code>${DEFAULT_PAGE_SIZE}</code>, maximum <code>${MAX_PAGE_SIZE}</code>. A larger value is clamped rather than rejected, so asking for 500 gets you ${MAX_PAGE_SIZE}.`,
        },
      ]"
    />

    <h2>Follow the links</h2>
    <p>
      Use <code>links.next</code> rather than building your own <code>?page=</code> URLs. The links carry your filters and sort order
      forward, so following them keeps the query identical across pages — hand-built URLs are where a forgotten filter silently widens a
      query on page two.
    </p>

    <DevportalCode :code="loop" language="javascript" />

    <DevportalCallout tone="warning">
      Paging through a collection that's changing underneath you can repeat or skip a record, because each page is a fresh query. For a
      dataset that matters, sort by something stable and narrow with a filter — for example page through appointments
      <code>starts_at</code> at a time rather than walking the whole table. See
      <NuxtLink :to="link('filtering')">Filtering &amp; sorting</NuxtLink>.
    </DevportalCallout>

    <h2>Counting without fetching</h2>
    <p>
      To count matching records without pulling them, send your filters with <code>page_size=1</code> and read
      <code>total_entries</code>. That's one small request rather than paging through everything to call <code>.length</code>.
    </p>
  </DevportalPage>
</template>
