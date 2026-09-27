import { describe, it, expect } from 'vitest'
import Anthropic from '@anthropic-ai/sdk'
import { modelFailureMessage } from '../../utils/modelFailure'

// Every AI button said "The model did not answer. Try again." whatever went
// wrong, so a rejected key or an empty account looked like a blip and the
// real reason sat in a function log. These pin that the reason is named.

const headers = new Headers()
const apiError = (status: number, message: string) =>
  Anthropic.APIError.generate(status, { type: 'error', error: { type: 'x', message } }, message, headers)

describe('Why a model call failed', () => {
  it('names a rejected API key as QuiroFlow\'s, not the clinic\'s', () => {
    const message = modelFailureMessage(apiError(401, 'invalid x-api-key'))
    expect(message).toContain('API key')
    expect(message).toContain('not in your settings')
  })

  it('names an account out of credit', () => {
    const message = modelFailureMessage(apiError(400, 'Your credit balance is too low to access the Anthropic API.'))
    expect(message).toContain('run out of credit')
  })

  it('quotes any other refused request', () => {
    expect(modelFailureMessage(apiError(400, 'thinking: unknown field'))).toContain('thinking: unknown field')
  })

  it('names rate limits and overload as worth retrying', () => {
    expect(modelFailureMessage(apiError(429, 'rate limited'))).toContain('Try again in a minute')
    expect(modelFailureMessage(apiError(529, 'Overloaded'))).toContain('overloaded')
  })

  it('names a model the account cannot use', () => {
    expect(modelFailureMessage(apiError(404, 'model: claude-x'))).toContain('not available')
  })

  it('keeps the statusMessage to printable ASCII', () => {
    expect(modelFailureMessage(apiError(400, 'línea\nnueva'))).toMatch(/^[\x20-\x7E]+$/)
  })

  it('falls back to "try again" for anything else', () => {
    expect(modelFailureMessage(new Error('boom'))).toBe('The model did not answer. Try again.')
  })
})
