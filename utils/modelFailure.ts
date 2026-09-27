import Anthropic from '@anthropic-ai/sdk'

// Why a model call failed, in a sentence the person who pressed the button
// can act on.
//
// Every AI button used to answer a failure with "The model did not answer.
// Try again." -- which is only good advice for the one cause that is
// transient. A rejected key or an account out of credit fails the same way on
// every retry, and the only record of which it was sat in the function log,
// where nobody looking at the button would find it. Try Alba had never
// produced a reply in production, and the screen gave no hint why.
//
// The key and the credit belong to QuiroFlow, not to the clinic, so the
// sentences say so: a clinic reading "the API key was rejected" should know
// it is not something in their settings.

/** The upstream message, e.g. "Your credit balance is too low ...". */
function apiMessage(err: InstanceType<typeof Anthropic.APIError>): string {
  const body = err.error as { error?: { message?: unknown } } | undefined
  const message = typeof body?.error?.message === 'string' ? body.error.message : err.message
  // h3 drops a statusMessage with characters outside printable ASCII, so the
  // upstream text is flattened before it is quoted.
  return message.replace(/[^\x20-\x7E]+/g, ' ').trim().slice(0, 200)
}

export function modelFailureMessage(err: unknown): string {
  // Before APIError: a connection failure is an APIError with no status.
  if (err instanceof Anthropic.APIConnectionTimeoutError) {
    return 'The AI service took too long to answer. Try again.'
  }
  if (err instanceof Anthropic.APIConnectionError) {
    return 'Could not reach the AI service. Try again in a moment.'
  }
  if (err instanceof Anthropic.AuthenticationError) {
    return "The AI service rejected QuiroFlow's API key (401). This is on QuiroFlow's side, not in your settings."
  }
  if (err instanceof Anthropic.PermissionDeniedError) {
    return `QuiroFlow's AI account is not allowed to make this request (403): ${apiMessage(err)}`
  }
  if (err instanceof Anthropic.NotFoundError) {
    return `The AI model is not available to QuiroFlow's account (404): ${apiMessage(err)}`
  }
  if (err instanceof Anthropic.RateLimitError) {
    return 'The AI service is rate limiting QuiroFlow right now (429). Try again in a minute.'
  }
  if (err instanceof Anthropic.BadRequestError) {
    const message = apiMessage(err)
    // The one failure that arrives as a 400 but is about the account, not
    // the request, and the likeliest reason nothing has ever worked.
    if (/credit balance/i.test(message)) {
      return "QuiroFlow's AI account has run out of credit, so nothing can be generated until it is topped up."
    }
    return `The AI service refused the request (400): ${message}`
  }
  if (err instanceof Anthropic.APIError) {
    if (err.status === 529) return 'The AI service is overloaded right now (529). Try again in a minute.'
    return `The AI service failed (${err.status ?? 'no status'}): ${apiMessage(err)}`
  }
  return 'The model did not answer. Try again.'
}
