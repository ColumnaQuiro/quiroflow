import { describe, it, expect, afterEach, vi } from 'vitest'
import { anthropicOutOfCredit, createAnthropicClient } from '../../server/utils/anthropicClient'

// Netlify's AI Gateway sets ANTHROPIC_BASE_URL in every function, and the SDK
// reads it on its own. The client has to go to Anthropic anyway, or our key
// goes to the gateway and every AI feature answers 401.

describe('Anthropic client', () => {
  const before = process.env.ANTHROPIC_BASE_URL

  afterEach(() => {
    if (before === undefined) delete process.env.ANTHROPIC_BASE_URL
    else process.env.ANTHROPIC_BASE_URL = before
  })

  it('talks to Anthropic even when the environment points elsewhere', async () => {
    process.env.ANTHROPIC_BASE_URL = 'https://quiroflow.netlify.app/.netlify/ai'
    const client = await createAnthropicClient('sk-ant-api03-test', { feature: 'test', accountId: null })
    expect(client.baseURL).to.equal('https://api.anthropic.com')
    expect(client.apiKey).to.equal('sk-ant-api03-test')
  })

  // The metering reads a clone of every response. The SDK must still get the
  // whole body, and a meter that cannot record (no database here) must not
  // turn a good reply into an error.
  it('hands the SDK an untouched reply when the meter cannot record', async () => {
    const reply = {
      id: 'msg_1', type: 'message', role: 'assistant', model: 'claude-sonnet-5',
      content: [{ type: 'text', text: 'Hola' }], stop_reason: 'end_turn', stop_sequence: null,
      usage: { input_tokens: 10, output_tokens: 2, cache_creation_input_tokens: 0, cache_read_input_tokens: 0 },
    }
    const spy = vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response(JSON.stringify(reply), { status: 200, headers: { 'content-type': 'application/json' } }))
    try {
      const client = await createAnthropicClient('sk-ant-api03-test', { feature: 'test', accountId: null })
      const message = await client.messages.create({ model: 'claude-sonnet-5', max_tokens: 16, messages: [{ role: 'user', content: 'Hola' }] })
      expect(message.content[0]).to.deep.equal({ type: 'text', text: 'Hola' })
    } finally {
      spy.mockRestore()
    }
  })
})

// Running out of prepaid credit stops every clinic's receptionist at once, so
// it has to be told apart from an ordinary bad request, which is our bug and
// not worth waking anyone for.
describe('Anthropic out of credit', () => {
  const body = (type: string, message: string) => JSON.stringify({ type: 'error', error: { type, message } })

  it('recognises the prepaid 400 by its message', () => {
    const r = anthropicOutOfCredit(400, body('invalid_request_error', 'Your credit balance is too low to access the Anthropic API. Please go to Plans & Billing to upgrade or purchase credits.'))
    expect(r.outOfCredit).to.equal(true)
    expect(r.type).to.equal('invalid_request_error')
  })

  it('recognises a 402 billing_error', () => {
    expect(anthropicOutOfCredit(402, body('billing_error', 'Billing issue')).outOfCredit).to.equal(true)
  })

  it('does not mistake an ordinary bad request for it', () => {
    expect(anthropicOutOfCredit(400, body('invalid_request_error', 'messages: at least one message is required')).outOfCredit).to.equal(false)
  })

  it('does not count a rate limit or an outage', () => {
    expect(anthropicOutOfCredit(429, body('rate_limit_error', 'Number of requests has exceeded your rate limit')).outOfCredit).to.equal(false)
    expect(anthropicOutOfCredit(529, body('overloaded_error', 'Overloaded')).outOfCredit).to.equal(false)
  })

  it('survives a body that is not JSON', () => {
    expect(anthropicOutOfCredit(502, '<html>Bad gateway</html>').outOfCredit).to.equal(false)
  })
})
