// A signed-in session against one clinic's PracticeHub website.
//
// The API key reaches everything else the import reads. It does not reach a
// submitted form's signed original: that is a PDF the website renders for a
// signed-in member of staff and nobody else (utils/practicehubWebPages.ts
// says what is read and why). So this signs in the way the sign-in page's
// own script does, and keeps the session.
//
// Signing in, as that script does it -- one endpoint, form-encoded, JSON back:
//
//   POST /config/scripts/users/login.php  { email, password, step: 'simple_auth' }
//     -> { step: 'enter' }                       signed in
//     -> { step: 'show_two_step_auth', auth_type: 'google' | 'email' }
//                                                a code is wanted
//     -> { result: 'error', message }            refused
//   POST the same  { email, password, code, trust_device: true,
//                    step: 'two_step_auth' | 'verify_email_code' }
//     -> { step: 'enter' }
//
// trust_device is sent because the job this serves runs unattended: a session
// that asked for a code every time it ran out would stop it overnight.
//
// Everything after sign-in is a GET that only shows something. Nothing here
// submits a form, saves, or deletes.
import type { SupabaseClient } from '@supabase/supabase-js'
import type { Database } from '~/types/database.types'
import { getAccountSecret, setAccountSecret } from '~/server/utils/accountSecrets'
import {
  looksLikePdf,
  parsePracticeHubFormSubmissions,
  parsePracticeHubPatientIds,
  practiceHubLoginOutcome,
  type PracticeHubFormSubmission,
  type PracticeHubLoginOutcome,
} from '~/utils/practicehubWebPages'

const LOGIN = '/config/scripts/users/login.php'
// One answer holds every patient: PracticeHub returned 1,535 in 0.2 s. The
// cap is only there so a huge clinic is read in a few answers, not one.
const LIST_PAGE = 5000

export class PracticeHubWebError extends Error {
  constructor(message: string, readonly statusCode = 502) { super(message) }
}

/** The session ran out and PracticeHub wants a code to start another. Only a person can supply it. */
export class PracticeHubCodeNeeded extends Error {
  constructor(readonly outcome: Extract<PracticeHubLoginOutcome, { state: 'code' }>) { super('PracticeHub is asking for a verification code.') }
}

export interface PracticeHubWebLogin { baseUrl: string; email: string; password: string }

export class PracticeHubWebClient {
  private cookie = ''
  private loaded = false
  constructor(
    private readonly login: PracticeHubWebLogin,
    private readonly store?: { load(): Promise<string | null>; save(cookie: string): Promise<void> },
  ) {}

  private absorb(res: Response) {
    for (const c of res.headers.getSetCookie?.() ?? []) {
      const pair = c.split(';')[0]!
      const name = pair.split('=')[0]
      const rest = this.cookie.split('; ').filter((p) => p && !p.startsWith(`${name}=`))
      // A cookie set to "deleted" is PracticeHub signing the session out.
      this.cookie = (/=deleted$/.test(pair) ? rest : [...rest, pair]).join('; ')
    }
  }

  private async raw(path: string, form?: Record<string, string>, attempt = 1): Promise<{ status: number; redirected: boolean; bytes: Buffer }> {
    const url = `${this.login.baseUrl.replace(/\/$/, '')}${path}`
    try {
      const res = await fetch(url, {
        method: form ? 'POST' : 'GET',
        body: form ? new URLSearchParams(form) : undefined,
        headers: { cookie: this.cookie, 'user-agent': 'QuiroFlow import', 'x-requested-with': 'XMLHttpRequest' },
        redirect: 'manual',
        signal: AbortSignal.timeout(20_000),
      })
      this.absorb(res)
      if (res.status >= 300 && res.status < 400) return { status: res.status, redirected: true, bytes: Buffer.alloc(0) }
      // Sign-in is never retried: a second attempt at a wrong password is how accounts get locked.
      if (res.status >= 500 && attempt < 3 && !form) return this.raw(path, form, attempt + 1)
      return { status: res.status, redirected: false, bytes: Buffer.from(await res.arrayBuffer()) }
    } catch (e) {
      if (attempt < 3 && !form) return this.raw(path, form, attempt + 1)
      throw new PracticeHubWebError(`PracticeHub did not answer (${(e as Error).message})`)
    }
  }

  private async post(form: Record<string, string>): Promise<PracticeHubLoginOutcome> {
    const res = await this.raw(LOGIN, form)
    let answer: unknown = null
    try {
      answer = JSON.parse(res.bytes.toString('utf8'))
    } catch {
      throw new PracticeHubWebError(`PracticeHub's sign-in did not answer as expected (HTTP ${res.status}). Check the PracticeHub address.`)
    }
    const outcome = practiceHubLoginOutcome(answer)
    if (outcome.state === 'in') await this.store?.save(this.cookie)
    return outcome
  }

  private async restore() {
    if (this.loaded) return
    this.loaded = true
    this.cookie = (await this.store?.load()) ?? ''
  }

  /**
   * Signs in. Cookies from before are sent along, because the trusted-device
   * one among them is what lets PracticeHub skip the code.
   */
  async signIn(): Promise<PracticeHubLoginOutcome> {
    await this.restore()
    // The sign-in page first, as a browser would: it starts the session the POST then fills.
    await this.raw('/')
    const outcome = await this.post({ email: this.login.email, password: this.login.password, step: 'simple_auth' })
    // Kept even when a code is pending: the code is checked against this session.
    if (outcome.state === 'code') await this.store?.save(this.cookie)
    return outcome
  }

  /** The code step, after signIn() said one was wanted. */
  async submitCode(code: string, method: 'app' | 'email'): Promise<PracticeHubLoginOutcome> {
    await this.restore()
    return this.post({
      code,
      email: this.login.email,
      password: this.login.password,
      step: method === 'app' ? 'two_step_auth' : 'verify_email_code',
      trust_device: 'true',
    })
  }

  /** Asks PracticeHub to send the code again, by email or to the phone it has. */
  async resendCode(via: 'email' | 'sms'): Promise<void> {
    await this.restore()
    await this.raw(LOGIN, { email: this.login.email, password: this.login.password, step: 'simple_auth', resend: 'true', resend_method: via })
    await this.store?.save(this.cookie)
  }

  /**
   * A page, signing in again once if the session ran out. PracticeHub answers
   * a request without a session by redirecting to its sign-in page -- or, for
   * some of its scripts, with that page's HTML and a 200. So `valid` decides:
   * an answer that is not what was asked for counts as signed out, once.
   */
  private async get(path: string, valid: (bytes: Buffer) => boolean): Promise<Buffer> {
    await this.restore()
    const name = path.split('?')[0]
    for (let again = false; ; again = true) {
      const res = this.cookie ? await this.raw(path) : { status: 302, redirected: true, bytes: Buffer.alloc(0) }
      if (res.status >= 500) throw new PracticeHubWebError(`PracticeHub answered ${res.status} for ${name}`)
      if (!res.redirected && res.status === 200 && valid(res.bytes)) return res.bytes
      if (again) throw new PracticeHubWebError(`PracticeHub's answer for ${name} was not what its website returns (HTTP ${res.status}).`)
      const outcome = await this.signIn()
      if (outcome.state === 'code') throw new PracticeHubCodeNeeded(outcome)
      if (outcome.state === 'wait') throw new PracticeHubWebError('PracticeHub is limiting sign-ins for the moment.', 429)
      if (outcome.state === 'refused') throw new PracticeHubWebError(outcome.message, 400)
    }
  }

  private async json(path: string): Promise<unknown> {
    const isJson = (bytes: Buffer) => {
      try {
        JSON.parse(bytes.toString('utf8'))
        return true
      } catch {
        return false
      }
    }
    return JSON.parse((await this.get(path, isJson)).toString('utf8'))
  }

  /** Every patient's website id, in the website's own order. */
  async patientIds(): Promise<string[]> {
    const ids: string[] = []
    for (let start = 0; ; start += LIST_PAGE) {
      const page = parsePracticeHubPatientIds(await this.json(`/config/scripts/patients/patientsList.php?draw=1&start=${start}&length=${LIST_PAGE}`))
      ids.push(...page.ids)
      if (page.ids.length < LIST_PAGE || ids.length >= page.total) break
    }
    return [...new Set(ids)]
  }

  /** One patient's submitted forms. */
  async patientForms(patientWebId: string): Promise<PracticeHubFormSubmission[]> {
    return parsePracticeHubFormSubmissions(await this.json(`/config/scripts/patients/get_patient/files.php?id=${encodeURIComponent(patientWebId)}`))
  }

  /** One form's signed original. */
  async formPdf(submission: PracticeHubFormSubmission): Promise<Buffer> {
    return this.get(submission.pdfPath, looksLikePdf)
  }
}

/** A client for the account's saved website sign-in, or null when none is saved. */
export async function practiceHubWebClientFor(admin: SupabaseClient<Database>, accountId: string): Promise<PracticeHubWebClient | null> {
  const [{ data: account }, email, password] = await Promise.all([
    admin.from('accounts').select('practicehub_base_url').eq('id', accountId).maybeSingle(),
    getAccountSecret(admin, accountId, 'practicehub_web_email'),
    getAccountSecret(admin, accountId, 'practicehub_web_password'),
  ])
  if (!account?.practicehub_base_url || !email || !password) return null
  return new PracticeHubWebClient(
    { baseUrl: account.practicehub_base_url, email, password },
    {
      load: () => getAccountSecret(admin, accountId, 'practicehub_web_session'),
      save: (cookie) => setAccountSecret(admin, accountId, 'practicehub_web_session', cookie),
    },
  )
}
