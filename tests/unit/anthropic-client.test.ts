import { describe, it, expect, afterEach } from 'vitest'
import { createAnthropicClient } from '../../server/utils/anthropicClient'

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
    const client = await createAnthropicClient('sk-ant-api03-test')
    expect(client.baseURL).to.equal('https://api.anthropic.com')
    expect(client.apiKey).to.equal('sk-ant-api03-test')
  })
})
