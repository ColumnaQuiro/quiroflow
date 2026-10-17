import type Anthropic from '@anthropic-ai/sdk'

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

// Async because the SDK is imported here, on first use, rather than at the
// top of the module: everything in server/utils is evaluated on every cold
// start of the Netlify function, and most requests never talk to a model.
export async function createAnthropicClient(apiKey: string): Promise<Anthropic> {
  const { default: Anthropic } = await import('@anthropic-ai/sdk')
  return new Anthropic({ apiKey, baseURL: ANTHROPIC_BASE_URL })
}
