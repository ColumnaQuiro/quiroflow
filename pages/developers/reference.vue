<script setup lang="ts">
definePageMeta({ layout: 'developers' })
const { useDocHead } = useDevPortal()
useDocHead('Endpoints', 'Every endpoint in the QuiroFlow API, with parameters, request bodies and responses.', 'reference')

interface SchemaNode {
  type?: string
  format?: string
  description?: string
  nullable?: boolean
  enum?: string[]
  required?: string[]
  properties?: Record<string, SchemaNode>
  items?: SchemaNode
  allOf?: SchemaNode[]
  $ref?: string
}
interface Operation {
  tags?: string[]
  summary?: string
  description?: string
  security?: Record<string, string[]>[]
  parameters?: { name: string; in: string; required?: boolean; description?: string; schema?: SchemaNode }[]
  requestBody?: { content?: Record<string, { schema?: SchemaNode }> }
  responses?: Record<string, { description?: string }>
}
interface Spec {
  info: { title: string; version: string }
  servers: { url: string }[]
  tags: { name: string; description: string }[]
  paths: Record<string, Record<string, Operation> & { parameters?: unknown }>
  components: { schemas: Record<string, SchemaNode> }
}

// Rendered from the spec the API itself serves rather than from a second,
// hand-written copy -- which is the only way the reference and the running
// API stay in agreement over time.
const { data: spec, error } = await useFetch<Spec>('/api/public/v1/openapi.json')

const METHODS = ['get', 'post', 'patch', 'delete'] as const

const groups = computed(() => {
  if (!spec.value) return []
  return spec.value.tags.map((tag) => ({
    name: tag.name,
    description: tag.description,
    operations: Object.entries(spec.value!.paths).flatMap(([path, item]) =>
      METHODS.filter((method) => item[method]).map((method) => ({
        id: `${method}-${path}`.replace(/[^a-z0-9]+/gi, '-').toLowerCase(),
        method: method.toUpperCase(),
        path,
        op: item[method] as Operation,
      })),
    ).filter((entry) => entry.op.tags?.includes(tag.name)),
  })).filter((group) => group.operations.length > 0)
})

const serverUrl = computed(() => spec.value?.servers?.[0]?.url ?? '')

function scopeOf(op: Operation) {
  return op.security?.[0]?.bearerAuth?.[0]
}

function refName(ref?: string) {
  return ref?.split('/').pop()
}

// Follows $ref / allOf so a body documented as a reference still renders its
// fields inline, where someone building a request will actually look.
function resolve(schema: SchemaNode | undefined, depth = 0): SchemaNode | undefined {
  if (!schema || !spec.value || depth > 4) return schema
  if (schema.$ref) return resolve(spec.value.components.schemas[refName(schema.$ref)!], depth + 1)
  if (schema.allOf) {
    const merged: SchemaNode = { type: 'object', properties: {}, required: [] }
    for (const part of schema.allOf) {
      const resolved = resolve(part, depth + 1)
      Object.assign(merged.properties!, resolved?.properties ?? {})
      merged.required!.push(...(resolved?.required ?? []))
    }
    return merged
  }
  return schema
}

function bodyFields(op: Operation) {
  const schema = resolve(op.requestBody?.content?.['application/json']?.schema)
  if (!schema?.properties) return []
  return Object.entries(schema.properties).map(([name, node]) => ({
    name,
    type: typeLabel(node),
    required: schema.required?.includes(name) ?? false,
    description: inlineCode(node.description ?? ''),
  }))
}

function bodyNote(op: Operation) {
  return resolve(op.requestBody?.content?.['application/json']?.schema)?.description
}

// Descriptions in the spec are plain text with markdown-style backticks (the
// form OpenAPI tooling expects). The portal renders them as HTML, so the
// backticks become real code spans instead of showing up as punctuation.
function inlineCode(text: string) {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/`([^`]+)`/g, '<code>$1</code>')
}

function typeLabel(node: SchemaNode): string {
  const resolved = node.$ref ? { type: refName(node.$ref) } : node
  if (node.enum) return node.enum.map((v) => `"${v}"`).join(' | ')
  if (resolved.type === 'array') return `${node.items ? typeLabel(node.items) : 'any'}[]`
  const base = resolved.format === 'uuid' ? 'uuid' : resolved.format === 'date-time' ? 'timestamp' : (resolved.type ?? 'any')
  return node.nullable ? `${base} | null` : base
}

// Query params are split so the handful that steer a request don't get lost
// among twenty filterable columns.
function controlParams(op: Operation) {
  return (op.parameters ?? []).filter((p) => p.in !== 'query' || ['page', 'page_size', 'order'].includes(p.name) || p.required)
}
function filterableFields(op: Operation) {
  return (op.parameters ?? []).filter((p) => p.in === 'query' && !['page', 'page_size', 'order'].includes(p.name) && !p.required).map((p) => p.name)
}

const expanded = ref<Record<string, boolean>>({})
function toggle(id: string) {
  expanded.value[id] = !expanded.value[id]
}

function curlFor(method: string, path: string) {
  const url = `${serverUrl.value}${path.replace('{id}', '{id}')}`
  if (method === 'GET') return `curl "${url}" \\\n  -H "Authorization: Bearer qf_live_..."`
  return `curl -X ${method} "${url}" \\\n  -H "Authorization: Bearer qf_live_..." \\\n  -H "Content-Type: application/json" \\\n  -d '{ ... }'`
}
</script>

<template>
  <DevportalPage title="Endpoints" lead="Generated from the API's own OpenAPI description, so it always matches what's deployed.">
    <div v-if="error" class="rounded-card border border-danger-border bg-danger-bg p-4 text-[13px] text-danger-text">
      Couldn't load the API description. Try
      <a href="/api/public/v1/openapi.json" class="underline">the raw spec</a>.
    </div>

    <template v-else-if="spec">
      <p>
        Base URL <code>{{ serverUrl }}</code>. Every endpoint needs a bearer token; the scope each one requires is shown beside it. Fetch
        the <a href="/api/public/v1/openapi.json">OpenAPI 3.1 description</a> to generate a client.
      </p>

      <section v-for="group in groups" :key="group.name" class="mt-9">
        <h2 :id="group.name.toLowerCase()">{{ group.name }}</h2>
        <p class="mt-1 text-[13px] leading-relaxed text-ink-muted2">{{ group.description }}</p>

        <div class="mt-3 divide-y divide-line-row overflow-hidden rounded-card border border-line bg-surface">
          <div v-for="entry in group.operations" :key="entry.id">
            <button type="button" class="flex w-full items-center gap-3 px-4 py-3 text-left hover:bg-surface-subtle" @click="toggle(entry.id)">
              <DevportalEndpoint :method="entry.method" :path="entry.path" :scope="scopeOf(entry.op)" />
              <span class="ml-auto shrink-0 text-[12.5px] text-ink-faint">{{ entry.op.summary }}</span>
              <svg
                viewBox="0 0 20 20"
                class="h-3.5 w-3.5 shrink-0 text-ink-faint transition"
                :class="expanded[entry.id] && 'rotate-90'"
                fill="none"
                stroke="currentColor"
                stroke-width="1.8"
              >
                <path d="m7 4 6 6-6 6" stroke-linecap="round" stroke-linejoin="round" />
              </svg>
            </button>

            <div v-if="expanded[entry.id]" class="border-t border-line-divider bg-surface-subtle px-4 py-4">
              <!-- eslint-disable-next-line vue/no-v-html -- our own spec text, escaped by inlineCode -->
              <p v-if="entry.op.description" class="dp-prose whitespace-pre-line text-[13px] leading-relaxed text-ink-muted2" v-html="inlineCode(entry.op.description)" />

              <template v-if="controlParams(entry.op).length">
                <p class="mt-4 text-[12.5px] font-[560] text-ink-700">Parameters</p>
                <DevportalParams
                  :params="controlParams(entry.op).map((p) => ({
                    name: p.name,
                    type: p.schema?.format === 'uuid' ? 'uuid' : (p.schema?.type ?? 'string'),
                    required: p.required,
                    description: inlineCode(p.description ?? ''),
                  }))"
                />
              </template>

              <template v-if="filterableFields(entry.op).length">
                <p class="mt-3 text-[12.5px] font-[560] text-ink-700">Filterable fields</p>
                <p class="mt-1.5 flex flex-wrap gap-1.5">
                  <code v-for="field in filterableFields(entry.op)" :key="field" class="rounded-ctlSm bg-surface px-1.5 py-0.5 font-mono text-[11.5px] text-ink-700">{{ field }}</code>
                </p>
              </template>

              <template v-if="bodyFields(entry.op).length">
                <p class="mt-4 text-[12.5px] font-[560] text-ink-700">Request body</p>
                <!-- eslint-disable-next-line vue/no-v-html -- our own spec text, escaped by inlineCode -->
                <p v-if="bodyNote(entry.op)" class="mt-1 text-[12.5px] leading-relaxed text-ink-muted2" v-html="inlineCode(bodyNote(entry.op) ?? '')" />
                <DevportalParams :params="bodyFields(entry.op)" />
              </template>

              <p class="mt-4 text-[12.5px] font-[560] text-ink-700">Responses</p>
              <ul class="mt-1.5 space-y-1">
                <li v-for="(response, status) in entry.op.responses" :key="status" class="flex gap-2.5 text-[12.5px]">
                  <code class="w-[36px] shrink-0 font-mono text-ink-900">{{ status }}</code>
                  <!-- eslint-disable-next-line vue/no-v-html -- our own spec text, escaped by inlineCode -->
                  <span class="text-ink-muted2" v-html="inlineCode(response.description ?? '')" />
                </li>
              </ul>

              <DevportalCode :code="curlFor(entry.method, entry.path)" language="curl" />
            </div>
          </div>
        </div>
      </section>
    </template>
  </DevportalPage>
</template>
