import type Anthropic from '@anthropic-ai/sdk'
import { serviceSupabase } from './serviceSupabase'
import { alertOps, writePlatformStatus } from './opsAlert'

// The one way the server builds an Anthropic client.
//
// The base URL is pinned, not left to the SDK, because the SDK reads
// ANTHROPIC_BASE_URL from the environment and Netlify sets that variable
// itself. Its AI Gateway injects ANTHROPIC_API_KEY and ANTHROPIC_BASE_URL into
// every function on a credit-based plan unless the project defines them, and
// ours keeps its key as NUXT_ANTHROPIC_API_KEY -- so the gateway's base URL
// went in, and every request carried QuiroFlow's real key to Netlify's gateway
// instead of to Anthropic. The gateway answered 401 with an empty body; every
// AI feature in production failed with "rejected QuiroFlow's API key" while the
// key itself worked from a terminal. Neither variable appears in Netlify's
// environment list, which is what made it look like a bad key.
//
// An empty-bodied 401 is the tell: Anthropic's own 401 always says why
// ("invalid x-api-key").
export const ANTHROPIC_BASE_URL = 'https://api.anthropic.com'

/** Who a model call is for, so its tokens can be put down to a clinic. */
export interface AnthropicUsageContext {
  /** A short stable name: 'receptionist_lead', 'help_assistant', ... */
  feature: string
  accountId: string | null
}

// Async because the SDK is imported here, on first use, rather than at the
// top of the module: everything in server/utils is evaluated on every cold
// start of the Netlify function, and most requests never talk to a model.
export async function createAnthropicClient(apiKey: string, usage: AnthropicUsageContext): Promise<Anthropic> {
  const { default: Anthropic } = await import('@anthropic-ai/sdk')
  return new Anthropic({ apiKey, baseURL: ANTHROPIC_BASE_URL, fetch: meteredFetch(usage) })
}

// Every clinic's receptionist runs on QuiroFlow's one prepaid key, so the
// credit running out stops all of them at once, and from a clinic's side it
// looks like the receptionist went quiet. The responses themselves are the
// only place that sees both what was spent (the usage block of each reply) and
// the moment it ran out (the refusal).
//
// Wrapping fetch rather than each call site means no model call added later
// can escape the count. The SDK retries 429s and 5xx through this same
// function, which is fine: only a 200 carries usage, and only once.
function meteredFetch(usage: AnthropicUsageContext): typeof fetch {
  return async (input, init) => {
    const response = await fetch(input, init)
    try {
      const url = new URL(typeof input === 'string' ? input : input instanceof URL ? input.href : input.url)
      if (url.pathname !== '/v1/messages') return response
      if (response.ok) await recordUsage(usage, response.clone())
      else await recordRefusal(usage, response.clone())
    } catch (e: any) {
      console.error('[anthropic] could not meter a response', e?.message ?? e)
    }
    return response
  }
}

async function recordUsage(context: AnthropicUsageContext, response: Response) {
  const body = (await response.json()) as Partial<Anthropic.Message>
  const u = body.usage
  if (!u || !body.model) return
  const service = serviceSupabase()
  if (!service) return
  const { error } = await service.from('ai_usage').insert({
    account_id: context.accountId,
    feature: context.feature,
    model: body.model,
    input_tokens: u.input_tokens ?? 0,
    output_tokens: u.output_tokens ?? 0,
    cache_creation_input_tokens: u.cache_creation_input_tokens ?? 0,
    cache_read_input_tokens: u.cache_read_input_tokens ?? 0,
  })
  if (error) console.error('[anthropic] could not record usage', error.message)
}

// Out of credit has come back two ways: a 402 billing_error, and, for prepaid
// accounts, a 400 invalid_request_error whose only distinguishing mark is the
// message ("Your credit balance is too low to access the Anthropic API"). A
// plain 400 is a bug in our request, not a billing problem, so the message is
// the only thing that tells them apart.
export function anthropicOutOfCredit(status: number, body: string): { outOfCredit: boolean; type: string; message: string } {
  let type = ''
  let message = body
  try {
    const parsed = JSON.parse(body) as { error?: { type?: string; message?: string } }
    type = parsed.error?.type ?? ''
    message = parsed.error?.message ?? body
  } catch {
    // Not JSON: keep the raw text.
  }
  return { outOfCredit: status === 402 || type === 'billing_error' || /credit balance/i.test(message), type, message }
}

async function recordRefusal(context: AnthropicUsageContext, response: Response) {
  const { outOfCredit, type, message } = anthropicOutOfCredit(response.status, await response.text())
  if (!outOfCredit) return

  console.error(`[anthropic] OUT OF CREDIT (${response.status} ${type}): ${message}`)
  await writePlatformStatus('anthropic.credit_error', {
    at: new Date().toISOString(),
    status: response.status,
    message: message.slice(0, 500),
    feature: context.feature,
  })
  await alertOps(
    'anthropic-credit',
    'Anthropic credit has run out: the AI receptionist is not answering',
    [
      `Anthropic refused a request from <b>${context.feature}</b> with ${response.status}: ${escapeHtml(message.slice(0, 300))}`,
      'Every clinic\'s receptionist, review replies and the help assistant share this one key, so all of them are stopped until credit is added.',
      'Add credit at <a href="https://platform.claude.com/settings/billing">platform.claude.com/settings/billing</a>. Turning on auto-reload there keeps this from happening again.',
    ],
    3,
  )
}

function escapeHtml(value: string) {
  return value.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c] as string)
}
