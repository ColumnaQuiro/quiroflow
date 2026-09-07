<script setup lang="ts">
definePageMeta({ layout: 'developers' })
const { link, useDocHead } = useDevPortal()
useDocHead('Filtering & sorting', 'Filter operators and sort syntax for QuiroFlow API list endpoints.', 'filtering')

const OPERATORS = [
  { op: 'eq', meaning: '=', example: 'status=eq:booked', note: 'The default — a bare <code>status=booked</code> means the same thing.' },
  { op: 'ne', meaning: '!=', example: 'status=ne:cancelled', note: '' },
  { op: 'gt', meaning: '>', example: 'total_cents=gt:5000', note: '' },
  { op: 'gte', meaning: '>=', example: 'starts_at=gte:2026-03-01T00:00:00Z', note: '' },
  { op: 'lt', meaning: '<', example: 'starts_at=lt:2026-04-01T00:00:00Z', note: '' },
  { op: 'lte', meaning: '<=', example: 'date_of_birth=lte:2008-01-01', note: '' },
  { op: 'like', meaning: 'contains', example: 'last_name=like:ferrer', note: 'Case-insensitive, matches anywhere in the value. Text fields only.' },
  { op: 'in', meaning: 'IN (…)', example: 'status=in:booked,completed', note: 'Comma-separated.' },
  { op: 'not-in', meaning: 'NOT IN (…)', example: 'status=not-in:cancelled,no_show', note: '' },
  { op: 'between', meaning: 'BETWEEN', example: 'starts_at=between:2026-03-01,2026-03-31', note: 'Inclusive at both ends.' },
  { op: 'null', meaning: 'IS NULL', example: 'practitioner_id=null:', note: 'The value after the colon is ignored.' },
  { op: 'not-null', meaning: 'IS NOT NULL', example: 'external_reference=not-null:', note: '' },
]

const combined = `GET /api/public/v1/appointments
  ?starts_at=gte:2026-03-01T00:00:00Z
  &starts_at=lt:2026-04-01T00:00:00Z   ← see the note below
  &status=in:booked,completed
  &practitioner_id=eq:9b1f...c2
  &order=starts_at.asc`

const ranged = `GET /api/public/v1/appointments
  ?starts_at=between:2026-03-01T00:00:00Z,2026-03-31T23:59:59Z
  &status=in:booked,completed
  &order=starts_at.asc`

const error = `{
  "error": {
    "status": 400,
    "code": "invalid_request",
    "message": "Unknown filter \\"patient\\". Filterable fields: id, patient_id, clinic_id, practitioner_id, ...",
    "field": "patient",
    "request_id": "d41a7c02-8b39-4e15-a6f2-0c7e5b91d834"
  }
}`
</script>

<template>
  <DevportalPage title="Filtering & sorting" lead="Narrow a list endpoint with field=operator:value, and sort it with order.">
    <h2>Syntax</h2>
    <p>
      Any filterable field on a resource can be filtered by writing the operator and the value together, separated by a colon. The
      per-endpoint field lists are in <NuxtLink :to="link('reference')">Endpoints</NuxtLink>.
    </p>
    <DevportalCode code="?field=operator:value" />

    <div class="my-4 overflow-hidden rounded-card border border-line">
      <table class="w-full text-[12.5px]">
        <thead class="bg-surface-subtle">
          <tr class="text-left text-[11px] uppercase tracking-wide text-ink-faint">
            <th class="px-3 py-2 font-[620]">Operator</th>
            <th class="px-3 py-2 font-[620]">Means</th>
            <th class="px-3 py-2 font-[620]">Example</th>
          </tr>
        </thead>
        <tbody class="divide-y divide-line-row">
          <tr v-for="row in OPERATORS" :key="row.op" class="align-top">
            <td class="px-3 py-2"><code class="font-mono text-[12px] text-ink-900">{{ row.op }}</code></td>
            <td class="px-3 py-2 font-mono text-[11.5px] text-ink-muted2">{{ row.meaning }}</td>
            <td class="px-3 py-2 text-ink-muted2">
              <code class="font-mono text-[11.5px] text-ink-900">{{ row.example }}</code>
              <!-- eslint-disable-next-line vue/no-v-html -- authored copy, not user input -->
              <p v-if="row.note" class="mt-0.5 text-[11.5px] text-ink-faint" v-html="row.note" />
            </td>
          </tr>
        </tbody>
      </table>
    </div>

    <h2>Combining filters</h2>
    <p>Multiple filters are combined with AND. Each field may appear once — if you repeat one, the last occurrence wins:</p>
    <DevportalCode :code="combined" language="http" />
    <p>
      So the range above doesn't do what it looks like. Use <code>between</code> for a range on a single field:
    </p>
    <DevportalCode :code="ranged" language="http" />

    <h2>Sorting</h2>
    <p>
      Sort with <code>order=field.asc</code> or <code>order=field.desc</code>. Only fields listed as sortable for that endpoint are
      accepted; each endpoint has a sensible default (appointments by <code>starts_at</code> descending, patients by
      <code>created_at</code> descending).
    </p>
    <DevportalCode code="?order=starts_at.asc" />
    <p>
      Results are always given a stable secondary sort by <code>id</code>, so records that tie on your sort field keep a consistent order
      between pages rather than shuffling and causing a page to repeat or skip one.
    </p>

    <h2>Invalid filters are rejected, not ignored</h2>
    <p>
      An unknown field, an unknown operator or a badly-typed value returns <code>400</code> naming the problem. Some APIs quietly drop
      filters they don't recognise; this one doesn't, deliberately.
    </p>
    <DevportalCode :code="error" language="json" />
    <DevportalCallout tone="warning">
      The reason is that a silently-ignored filter returns <strong>more</strong> records than you asked for. On an API over patient records,
      an integration that believes it fetched one patient's appointments but actually fetched the whole clinic's is a data-protection
      problem, not a typo. Failing the request is the safer behaviour, so a mistyped field name is something you find in development.
    </DevportalCallout>

    <h2>Efficient polling</h2>
    <p>
      To pick up changes without re-reading everything, filter on <code>created_at</code> and keep the timestamp of your last successful
      run. Bear in mind that this finds new records, not edits to existing ones — for edits, use
      <NuxtLink :to="link('webhooks')">webhooks</NuxtLink>, which are pushed as they happen.
    </p>
    <DevportalCode code="?created_at=gte:2026-03-14T08:00:00Z&order=created_at.asc" />
  </DevportalPage>
</template>
