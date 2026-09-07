import type { SupabaseClient } from '@supabase/supabase-js'
import { ApiError, defineApiHandler, notFound } from '~/server/utils/publicApi'
import { applyFilters, assertUuid, listEnvelope, parseFilters, parseOrder, parsePagination } from '~/server/utils/publicApiQuery'
import type { ApiResource } from '~/server/utils/publicApiResources'

// PostgREST's generated types key every builder method off a literal table
// name, and this factory is generic over the table on purpose -- so the
// client is widened here once instead of each caller carrying a cast. The
// safety that matters (which columns are readable, filterable and sortable)
// comes from the resource registry, not from this type.
type LooseClient = SupabaseClient

// PostgREST's generated types parse the select string as a *literal* to work
// out the row shape. The resource registry holds those strings as plain
// `string`, so every `.select(resource.select)` comes back as
// GenericStringError instead of a row. Widening the client is the narrow fix;
// the alternative is duplicating each column list as a const literal next to
// the one the query already uses, which is exactly the drift the registry
// exists to prevent.
export function loose(supabase: unknown): LooseClient {
  return supabase as LooseClient
}

// Same reason as loose(): a row selected with a non-literal column list comes
// back as PostgREST's GenericStringError placeholder rather than a row type.
export function asRow(data: unknown): Record<string, any> {
  return data as Record<string, any>
}

function scoped(supabase: unknown, resource: ApiResource, accountId: string) {
  let query = (supabase as LooseClient).from(resource.table).select(resource.select, { count: 'exact' }).eq('account_id', accountId)
  for (const filter of resource.baseFilters ?? []) {
    query = filter.op === 'is_null' ? query.is(filter.column, null) : query.eq(filter.column, filter.value)
  }
  return query
}

export function listHandler(resource: ApiResource) {
  return defineApiHandler({ scope: resource.scope }, async ({ event, supabase, accountId }) => {
    // Parsed before the query is built so a bad filter is a 400 the caller
    // can act on, rather than a query that runs and returns the wrong rows.
    const pagination = parsePagination(event)
    const order = parseOrder(event, resource.sortable, resource.defaultOrder)
    const filters = parseFilters(event, resource.filterable)

    const query = applyFilters(scoped(supabase, resource, accountId), filters)
      .order(order.column, { ascending: order.ascending })
      // Secondary key so rows that tie on the sort column keep a stable
      // order between pages -- without it, paging through same-timestamp
      // rows can show one twice and skip another.
      .order('id', { ascending: true })
      .range(pagination.offset, pagination.offset + pagination.pageSize - 1)

    const { data, error, count } = await query
    if (error) throw new ApiError('server_error', error.message)

    return listEnvelope(event, (data ?? []).map(resource.serialize), count ?? 0, pagination)
  })
}

export function detailHandler(resource: ApiResource, label: string) {
  return defineApiHandler({ scope: resource.scope }, async ({ event, supabase, accountId }) => {
    const id = assertUuid(getRouterParam(event, 'id'), 'id')

    const { data, error } = await scoped(supabase, resource, accountId).eq('id', id).maybeSingle()
    if (error) throw new ApiError('server_error', error.message)
    // A row belonging to another account is indistinguishable from one that
    // doesn't exist, and must stay that way -- a 403 here would confirm the
    // id is real to a caller who has no business knowing that.
    if (!data) throw notFound(label)

    return { data: resource.serialize(data) }
  })
}

// Every write endpoint that accepts a foreign key calls this before using
// it. The FK constraint on its own only proves the row exists *somewhere* --
// it would happily let one clinic attach its appointment to another clinic's
// practitioner. This is the check that makes an id from outside the account
// indistinguishable from an id that doesn't exist.
// Table names don't singularise by trimming an underscore: "team_members"
// became "No team members in this account with id …". Error copy is read at
// the worst possible moment, so it's worth a lookup table.
const RESOURCE_LABELS: Record<string, string> = {
  patients: 'patient',
  clinics: 'clinic',
  team_members: 'practitioner',
  appointment_types: 'appointment type',
  calendar_resources: 'room',
  appointments: 'appointment',
  services_products: 'service',
  invoices: 'invoice',
}

export async function assertBelongsToAccount(
  supabase: unknown,
  table: string,
  id: string,
  accountId: string,
  field: string,
  extraConditions: Record<string, unknown> = {},
): Promise<Record<string, any>> {
  let query = (supabase as LooseClient).from(table).select('*').eq('id', id).eq('account_id', accountId)
  for (const [column, value] of Object.entries(extraConditions)) {
    query = value === null ? query.is(column, null) : query.eq(column, value)
  }
  const { data } = await query.maybeSingle()
  if (!data) {
    throw new ApiError('invalid_request', `No ${RESOURCE_LABELS[table] ?? table.replace(/_/g, ' ')} in this account with id "${id}".`, field)
  }
  return data
}
